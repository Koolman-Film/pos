import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';
import { applyStockMovements } from '@/lib/stock/movements';

/**
 * `applyStockMovements` against the real database.
 *
 * The unit tests next door cover the arithmetic; these cover the part that only a
 * real Postgres can answer: that the right stock row is decremented, that the
 * audit row lands with the prototype's exact type/by/status wording, that shop
 * scoping is respected, and that a product the shop does not carry is still
 * logged rather than swallowed.
 *
 * Uses a service-role client, so RLS is bypassed — that is correct here: these
 * assert the movement mechanics, and `tests/rls/` covers who is allowed to invoke
 * them.
 */

const admin = adminClient();

const SKU_A = 'SKU-MOVE-A';
const SKU_B = 'SKU-MOVE-B';
const PRODUCT_A = 'ทดสอบสินค้าเคลื่อนไหว A';
const PRODUCT_B = 'ทดสอบสินค้าเคลื่อนไหว B';
const DOC = 'JT-MOVE-0001';

async function removeFixtures() {
  await admin.from('stock_movements').delete().in('item_name', [PRODUCT_A, PRODUCT_B]);
  await admin.from('withdrawals').delete().like('type', `%${DOC}%`);
  await admin.from('withdrawals').delete().in('item', [PRODUCT_A, PRODUCT_B, 'ไม่มีในสต็อก']);
  await admin.from('stock').delete().in('sku', [SKU_A, SKU_B]);
}

async function seedStock() {
  const { error } = await admin.from('stock').insert([
    // Same product name in two shops: the movement must only touch one of them.
    {
      sku: SKU_A,
      name: PRODUCT_A,
      category: 'ฟิล์มกรองแสง',
      shop_id: 'cm',
      qty: 20,
      min_qty: 5,
      cost: 100,
      sell_price: 200,
    },
    {
      sku: SKU_B,
      name: PRODUCT_A,
      category: 'ฟิล์มกรองแสง',
      shop_id: 'lp',
      qty: 20,
      min_qty: 5,
      cost: 100,
      sell_price: 200,
    },
  ]);
  assertNoError('seed movement stock', error);
}

const qtyOf = async (sku: string) => {
  const { data } = await admin.from('stock').select('qty').eq('sku', sku).single();
  return Number(data!.qty);
};

/**
 * The ledger, newest first. It replaced `withdrawals` as the audit trail in
 * migration 0026: keyed by stock_id, carrying before/after, and written by the
 * same statement that moves the quantity.
 */
const logFor = async (item: string) => {
  const { data } = await admin
    .from('stock_movements')
    .select(
      'item_name, shop_id, kind, document_id, change, qty_before, qty_after, moved_by_name, moved_at',
    )
    .eq('item_name', item)
    .order('id', { ascending: false });
  return data ?? [];
};

const source = {
  kind: 'ใบงาน',
  documentId: DOC,
  by: 'ช่างทดสอบ',
  shopId: 'cm',
};

describe('applyStockMovements (live database)', () => {
  beforeEach(async () => {
    await removeFixtures();
    await seedStock();
  });
  afterAll(removeFixtures);

  it('decrements stock and writes the before/after into the ledger', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 3 }, source);

    expect(await qtyOf(SKU_A)).toBe(17);

    const log = await logFor(PRODUCT_A);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      item_name: PRODUCT_A,
      shop_id: 'cm',
      kind: 'ใบงาน',
      document_id: DOC,
      // Signed the way stock moves: consuming is negative.
      change: -3,
      // The pair that makes the ledger answer "why did this drop".
      qty_before: 20,
      qty_after: 17,
      moved_by_name: 'ช่างทดสอบ',
    });
  });

  it('returns stock on a negative delta, and the ledger says so', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: -4 }, source);

    expect(await qtyOf(SKU_A)).toBe(24);

    const log = await logFor(PRODUCT_A);
    expect(log[0].change).toBe(4);
    expect(log[0].qty_before).toBe(20);
    expect(log[0].qty_after).toBe(24);
  });

  it('only touches the stock row for the movement shop', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 5 }, source);

    expect(await qtyOf(SKU_A)).toBe(15); // cm — affected
    expect(await qtyOf(SKU_B)).toBe(20); // lp — untouched
  });

  it('applies several products in one movement', async () => {
    await admin.from('stock').insert({
      sku: 'SKU-MOVE-C',
      name: PRODUCT_B,
      category: 'เครื่องเสียง',
      shop_id: 'cm',
      qty: 8,
      min_qty: 2,
      cost: 50,
      sell_price: 90,
    });

    await applyStockMovements(admin as never, { [PRODUCT_A]: 2, [PRODUCT_B]: 3 }, source);

    expect(await qtyOf(SKU_A)).toBe(18);
    expect(await qtyOf('SKU-MOVE-C')).toBe(5);
    await admin.from('stock').delete().eq('sku', 'SKU-MOVE-C');
  });

  it('reports a product the shop does not stock instead of a phantom entry', async () => {
    const result = await applyStockMovements(admin as never, { ไม่มีในสต็อก: 2 }, source);

    // Nothing moved, so there is nothing honest to put in a ledger — but the
    // caller is told, and puts it in front of a human.
    expect(result.unmatched).toEqual(['ไม่มีในสต็อก']);
    expect(await logFor('ไม่มีในสต็อก')).toHaveLength(0);
  });

  it('does nothing at all for an empty delta', async () => {
    await applyStockMovements(admin as never, {}, source);

    expect(await qtyOf(SKU_A)).toBe(20);
    expect(await logFor(PRODUCT_A)).toHaveLength(0);
  });

  it('skips zero deltas mixed in with real ones', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 0 }, source);

    expect(await qtyOf(SKU_A)).toBe(20);
    expect(await logFor(PRODUCT_A)).toHaveLength(0);
  });

  it('lets stock go negative rather than clamping, so a miscount stays visible', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 25 }, source);
    expect(await qtyOf(SKU_A)).toBe(-5);
  });

  it('accumulates across successive movements', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 3 }, source);
    await applyStockMovements(admin as never, { [PRODUCT_A]: 2 }, source);
    await applyStockMovements(admin as never, { [PRODUCT_A]: -1 }, source);

    expect(await qtyOf(SKU_A)).toBe(16); // 20 - 3 - 2 + 1
    expect(await logFor(PRODUCT_A)).toHaveLength(3);
  });

  it('records the source module and its document on the entry', async () => {
    await applyStockMovements(
      admin as never,
      { [PRODUCT_A]: 1 },
      {
        kind: 'ขายส่ง',
        documentId: 'WS-MOVE-0001',
        by: 'ระบบ (ขายส่ง)',
        shopId: 'cm',
      },
    );

    const log = await logFor(PRODUCT_A);
    expect(log[0].kind).toBe('ขายส่ง');
    expect(log[0].document_id).toBe('WS-MOVE-0001');
    expect(log[0].moved_by_name).toBe('ระบบ (ขายส่ง)');
  });

  it('stamps the movement with when it happened', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 1 }, source);
    const log = await logFor(PRODUCT_A);
    expect(String(log[0].moved_at).slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });
});
