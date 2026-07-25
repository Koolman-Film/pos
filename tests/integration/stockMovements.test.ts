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

const logFor = async (item: string) => {
  const { data } = await admin
    .from('withdrawals')
    .select('item, shop_id, qty, type, withdrawn_by, status, withdrawn_at')
    .eq('item', item)
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

  it('decrements stock by a positive delta and logs it as ตัดสต็อก / อนุมัติแล้ว', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 3 }, source);

    expect(await qtyOf(SKU_A)).toBe(17);

    const log = await logFor(PRODUCT_A);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      item: PRODUCT_A,
      shop_id: 'cm',
      qty: 3,
      type: `ตัดสต็อกจากใบงาน (${DOC})`,
      withdrawn_by: 'ช่างทดสอบ',
      // Automatic movements record something that already happened, so they are
      // approved on arrival — unlike a manual withdrawal request.
      status: 'อนุมัติแล้ว',
    });
  });

  it('returns stock on a negative delta and logs it as คืนสต็อก', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: -4 }, source);

    expect(await qtyOf(SKU_A)).toBe(24);

    const log = await logFor(PRODUCT_A);
    expect(log[0].qty).toBe(-4);
    expect(log[0].type).toBe(`คืนสต็อกจากใบงาน (${DOC})`);
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

  it('logs a product the shop does not stock, rather than losing the movement', async () => {
    await applyStockMovements(admin as never, { ไม่มีในสต็อก: 2 }, source);

    const log = await logFor('ไม่มีในสต็อก');
    expect(log).toHaveLength(1);
    expect(log[0].qty).toBe(2);
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

  it('uses the ขายส่ง wording for a wholesale source', async () => {
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
    expect(log[0].type).toBe('ตัดสต็อกจากขายส่ง (WS-MOVE-0001)');
    expect(log[0].withdrawn_by).toBe('ระบบ (ขายส่ง)');
  });

  it('stamps the movement with today’s date', async () => {
    await applyStockMovements(admin as never, { [PRODUCT_A]: 1 }, source);
    const log = await logFor(PRODUCT_A);
    expect(log[0].withdrawn_at).toBe(new Date().toISOString().slice(0, 10));
  });
});
