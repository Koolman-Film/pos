import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * `order_payments.uid` must be unique within a PO (migration 0049).
 *
 * 0048 made `uid` the key that survives the delete-and-reinsert inside
 * `save_order_children`, and documented that a forged payload cannot promote a
 * payment to รับเงินแล้ว (CORRECTION C2). That promise had a hole: the function
 * copies the stored confirmation forward BY UID, so a payload that repeated an
 * already-confirmed uid handed that confirmation to a second, fabricated row.
 *
 * Reproduced against a real database before the fix:
 *
 *   before : pREAL001 · 1,000 · รับเงินแล้ว
 *   payload: [{uid: pREAL001, amount: 1000}, {uid: pREAL001, amount: 999999}]
 *   after  : both rows รับเงินแล้ว — ฿1,000,999 counted as received
 *
 * Anyone who can save a PO could mint confirmed money without holding
 * `wholesale.confirmPayment` and without ever calling `confirm_order_payment`.
 * The same duplication also made one confirm click settle every row sharing
 * that uid, because those functions update `where uid = p_uid`.
 *
 * These tests pin both layers of the fix: the readable guard inside the
 * function, and the partial unique index that holds even if someone writes to
 * the table directly.
 */

const admin = adminClient();

const ORDER = 'WS-UID-0001';
const CONFIRMED_UID = 'pREAL001';

async function cleanup() {
  await admin.from('orders').delete().eq('id', ORDER);
}

/** A PO carrying one genuinely confirmed cheque. */
async function seedConfirmedPayment() {
  const { error } = await admin
    .from('orders')
    .insert({ id: ORDER, shop_id: 'cm', customer_id: 1, status: 'รออนุมัติราคา' });
  assertNoError('seed uid order', error);

  const { error: rpcErr } = await admin.rpc('save_order_children', {
    p_order_id: ORDER,
    p_items: [],
    p_returns: [],
    p_adjustments: [],
    p_payments: [{ uid: CONFIRMED_UID, amount: 1000, method: 'เช็ค', date: '2026-09-10' }],
    p_saved_on: '2026-09-10',
  });
  assertNoError('seed uid payment', rpcErr);

  // Stand in for a real confirmation. `confirm_order_payment` is security
  // definer and checks the capability of the CALLER, which the service-role
  // client does not carry — the state it produces is what matters here.
  const { error: confirmErr } = await admin
    .from('order_payments')
    .update({ status: 'รับเงินแล้ว', cleared_at: '2026-09-10' })
    .eq('order_id', ORDER)
    .eq('uid', CONFIRMED_UID);
  assertNoError('confirm uid payment', confirmErr);
}

const paymentsOf = async () => {
  const { data } = await admin
    .from('order_payments')
    .select('uid, amount, status')
    .eq('order_id', ORDER)
    .order('amount');
  return data ?? [];
};

describe('order_payments.uid uniqueness', () => {
  beforeEach(async () => {
    await cleanup();
    await seedConfirmedPayment();
  });
  afterAll(cleanup);

  it('rejects a save whose payload repeats a uid, and changes nothing', async () => {
    const { error } = await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [],
      p_returns: [],
      p_adjustments: [],
      p_payments: [
        { uid: CONFIRMED_UID, amount: 1000, method: 'เช็ค', date: '2026-09-10' },
        // The fabricated row, riding the confirmed row's uid.
        { uid: CONFIRMED_UID, amount: 999999, method: 'เช็ค', date: '2026-09-10' },
      ],
      p_saved_on: '2026-09-10',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('uid ซ้ำ');

    // The PO still holds exactly the one cheque that was really received.
    const rows = await paymentsOf();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(1000);
    expect(rows[0].status).toBe('รับเงินแล้ว');
  });

  it('refuses a duplicate uid written straight to the table', async () => {
    // Defence in depth: the guard above is for the message the user reads, but
    // the invariant has to survive any other write path too.
    const { error } = await admin.from('order_payments').insert({
      order_id: ORDER,
      amount: 999999,
      method: 'เช็ค',
      paid_at: '2026-09-10',
      uid: CONFIRMED_UID,
      status: 'รับเงินแล้ว',
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // unique_violation
  });

  it('still carries a confirmation forward, and starts a new payment unconfirmed', async () => {
    const { error } = await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [],
      p_returns: [],
      p_adjustments: [],
      p_payments: [
        { uid: CONFIRMED_UID, amount: 1000, method: 'เช็ค', date: '2026-09-10' },
        { uid: 'pNEW002', amount: 500, method: 'เช็ค', date: '2026-09-10' },
      ],
      p_saved_on: '2026-09-10',
    });
    assertNoError('honest save', error);

    const rows = await paymentsOf();
    expect(rows).toHaveLength(2);
    // 0048's actual promise, still intact: the stored confirmation survives the
    // delete-and-reinsert, and a genuinely new payment does not inherit one.
    expect(rows.find((r) => r.uid === CONFIRMED_UID)?.status).toBe('รับเงินแล้ว');
    expect(rows.find((r) => r.uid === 'pNEW002')?.status).toBe('แจ้งแล้ว');
  });

  it('leaves pre-0048 rows, which all carry a blank uid, able to coexist', async () => {
    // The index is partial (`where uid <> ''`) precisely so the backfilled rows
    // from before 0048 are not retro-actively illegal.
    const { error } = await admin.from('order_payments').insert([
      { order_id: ORDER, amount: 10, method: 'เงินสด', paid_at: '2026-09-10', uid: '' },
      { order_id: ORDER, amount: 20, method: 'เงินสด', paid_at: '2026-09-10', uid: '' },
    ]);
    assertNoError('legacy blank uid rows', error);
  });
});
