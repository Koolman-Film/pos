// tests/rls/order_stock_events.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { adminClient, assertNoError } from './_helpers';

/**
 * สต๊อกขายส่งเคลื่อนตามเหตุการณ์จริง (migration 0054).
 *
 * Saving a PO used to move the shelf, which is always too early: a PO is typed,
 * priced, argued over and re-saved several times before anything leaves the
 * building, and POs that were never delivered took stock with them.
 *
 * These pin the two properties the new rule exists for — the confirmation state
 * survives a re-save, and neither event can fire twice — because both are
 * invisible when they break. Nothing errors; the count is just quietly wrong.
 */

const admin = adminClient();
const ORDER = 'WS-TEST-STK1';
const PRODUCT = 'ฟิล์มทดสอบสต๊อก (ม้วน)';
const SKU = 'SKU-TEST-STK1';

const storedReturn = async () => {
  const { data } = await admin
    .from('order_returns')
    .select('uid, received_at, stock_returned_at, qty')
    .eq('order_id', ORDER)
    .single();
  return data;
};

const storedOrder = async () => {
  const { data } = await admin
    .from('orders')
    .select('stock_deducted_at, note')
    .eq('id', ORDER)
    .single();
  return data;
};

async function cleanup() {
  await admin.from('orders').delete().eq('id', ORDER);
  await admin.from('stock').delete().eq('sku', SKU);
}

beforeAll(async () => {
  await cleanup();
  assertNoError(
    'seed stock',
    (
      await admin.from('stock').insert({
        sku: SKU,
        name: PRODUCT,
        short_name: 'TEST-STK',
        category: 'ฟิล์มกรองแสง',
        shop_id: 'cm',
        qty: 100,
        min_qty: 0,
        cost: 500,
        sell_price: 900,
      })
    ).error,
  );
  assertNoError(
    'seed order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER, shop_id: 'cm', customer_id: null, status: 'รอจัดส่ง' })
    ).error,
  );
});

afterAll(cleanup);

describe('สต๊อกขายส่ง — ตัดตอนส่งของ คืนตอนยืนยันรับคืน', () => {
  it('PO ที่ยังไม่ส่งของ ยังไม่ถูกตัดสต๊อก', async () => {
    // The whole point of the change: a PO can sit in รอจัดส่ง through any number
    // of saves and the shelf must not move.
    expect(await storedOrder()).toMatchObject({ stock_deducted_at: null });
  });

  it('การยืนยันรับคืนอยู่รอดข้ามการบันทึก PO ใหม่', async () => {
    const uid = 'r-test-1';
    const save = (qty: number) =>
      admin.rpc('save_order_children', {
        p_order_id: ORDER,
        p_items: [
          { name: PRODUCT, qty: 10, listPrice: 900, requestedPrice: 900, reason: '' },
        ] as never,
        p_returns: [{ uid, item: PRODUCT, qty, reason: 'ของชำรุด', date: '2026-09-10' }] as never,
        p_adjustments: [] as never,
        p_payments: [] as never,
        p_saved_on: '2026-09-10',
      });

    assertNoError('first save', (await save(2)).error);
    expect(await storedReturn()).toMatchObject({ received_at: null, stock_returned_at: null });

    assertNoError(
      'confirm receipt',
      (
        await admin
          .from('order_returns')
          .update({ received_at: '2026-09-12', stock_returned_at: new Date().toISOString() })
          .eq('order_id', ORDER)
          .eq('uid', uid)
      ).error,
    );

    // The row is deleted and re-inserted on every save. If the confirmation did
    // not survive, a re-save would silently re-open it — and the stock guard
    // with it, letting the same goods go back on the shelf a second time.
    assertNoError('second save', (await save(3)).error);
    const after = await storedReturn();
    expect(after?.received_at).toBe('2026-09-12');
    expect(after?.stock_returned_at).toBeTruthy();
    // The editable half still saves normally.
    expect(Number(after?.qty)).toBe(3);
  });

  it('หมายเหตุของ PO บันทึกได้', async () => {
    assertNoError(
      'set note',
      (await admin.from('orders').update({ note: 'ส่งของช่วงบ่าย' }).eq('id', ORDER)).error,
    );
    expect(await storedOrder()).toMatchObject({ note: 'ส่งของช่วงบ่าย' });
  });
});
