import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * วันที่รับเงินของใบงาน ต้องไม่ถูกเขียนทับเป็นวันนี้ (migration 0060).
 *
 * `save_ticket_children` throws every payment row away and writes them again on
 * each save, and the date came from `coalesce(paidAt, current_date)`. So a save
 * that carried no date — a row the old form never had a date field for, a
 * browser still running yesterday's code — silently moved money that arrived
 * last month onto today.
 *
 * Since ยอดขาย and สมุดบัญชีแหล่งเงิน count money on the day it was received,
 * that is two days' balances wrong at once, and a balance that was already
 * counted and reconciled changing after the fact.
 *
 * The fix is `uid`: the row's own key, which survives the delete, so the stored
 * date can be carried forward when the payload does not name one.
 */

const admin = adminClient();

const TICKET = 'JT-PAYDATE-01';
const UID = 'pPAYDATE1';
const RECEIVED_ON = '2026-07-26';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

async function cleanup() {
  await admin.from('tickets').delete().eq('id', TICKET);
}

async function seed() {
  const { error } = await admin.from('tickets').insert({
    id: TICKET,
    shop_id: 'cm',
    customer_name: 'คุณ ทดสอบวันที่',
    status: 'จองแล้ว',
    drop_off_date: RECEIVED_ON,
    pickup_date: RECEIVED_ON,
  });
  assertNoError('seed ticket', error);

  const { error: rpcErr } = await admin.rpc('save_ticket_children', {
    p_ticket_id: TICKET,
    p_items: [],
    p_payments: [
      { uid: UID, type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 6500, paidAt: RECEIVED_ON },
    ],
  });
  assertNoError('seed payment', rpcErr);
}

const paymentsOf = async () => {
  const { data } = await admin
    .from('ticket_payments')
    .select('uid, amount, paid_at')
    .eq('ticket_id', TICKET)
    .order('amount');
  return data ?? [];
};

describe('วันที่รับเงินในใบงาน', () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
  });
  afterAll(cleanup);

  it('keeps the day the money came in when a save only changes the amount', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [],
      // No `paidAt` — this is the shape the old form sent on every save.
      p_payments: [{ uid: UID, type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 7000 }],
    });
    assertNoError('save without a date', error);

    const rows = await paymentsOf();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(7000);
    expect(rows[0].paid_at).toBe(RECEIVED_ON);
  });

  it('moves the money when the shop really does correct the date', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [],
      p_payments: [
        { uid: UID, type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 6500, paidAt: '2026-07-01' },
      ],
    });
    assertNoError('save with a corrected date', error);
    expect((await paymentsOf())[0].paid_at).toBe('2026-07-01');
  });

  it('dates a genuinely new row today when nothing says otherwise', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [],
      p_payments: [
        { uid: UID, type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 6500, paidAt: RECEIVED_ON },
        { uid: 'pBRANDNEW', type: 'มัดจำ', method: 'เงินสด', amount: 100 },
      ],
    });
    assertNoError('save with a new row', error);

    const rows = await paymentsOf();
    expect(rows.find((r) => r.uid === UID)?.paid_at).toBe(RECEIVED_ON);
    expect(rows.find((r) => r.uid === 'pBRANDNEW')?.paid_at).toBe(today());
  });

  it('refuses a payload that repeats a uid to inherit another row’s date', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [],
      p_payments: [
        { uid: UID, type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 6500, paidAt: RECEIVED_ON },
        { uid: UID, type: 'มัดจำ', method: 'เงินสด', amount: 999999 },
      ],
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('uid ซ้ำ');
    expect(await paymentsOf()).toHaveLength(1);
  });

  it('refuses a duplicate uid written straight to the table', async () => {
    // The guard above is for the message a person reads; the invariant has to
    // hold on any other write path too.
    const { error } = await admin.from('ticket_payments').insert({
      ticket_id: TICKET,
      type: 'มัดจำ',
      method: 'เงินสด',
      amount: 999999,
      paid_at: RECEIVED_ON,
      uid: UID,
    });
    expect(error?.code).toBe('23505'); // unique_violation
  });
});
