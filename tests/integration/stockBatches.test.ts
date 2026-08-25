import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient } from '../rls/_helpers';

/**
 * ต้นทุนตามล็อต against the real database (migration 0027).
 *
 * These are the figures the shop will read off a report, and they come out of
 * SQL — a unit test with a fake client could not tell you whether six rolls out
 * of a lot holding four really costs 4×800 + 2×950. So the arithmetic is pinned
 * here, against Postgres, end to end.
 *
 * Service-role client, so RLS is bypassed: this asserts the costing, and
 * `tests/rls/` covers who may invoke it.
 */

const admin = adminClient();

const SKU = 'SKU-BATCH-TEST';
const PRODUCT = 'ทดสอบล็อตต้นทุน';

async function stockId(): Promise<number> {
  const { data } = await admin.from('stock').select('id').eq('sku', SKU).single();
  return data!.id as number;
}

async function removeFixtures() {
  const { data } = await admin.from('stock').select('id').eq('sku', SKU).maybeSingle();
  if (data?.id) {
    const { data: moves } = await admin
      .from('stock_movements')
      .select('id')
      .eq('stock_id', data.id);
    const ids = (moves ?? []).map((m) => m.id);
    if (ids.length) await admin.from('stock_movement_batches').delete().in('movement_id', ids);
    await admin.from('stock_movements').delete().eq('stock_id', data.id);
    await admin.from('stock_batches').delete().eq('stock_id', data.id);
    await admin.from('stock').delete().eq('id', data.id);
  }
}

async function seed() {
  await admin.from('stock').insert({
    sku: SKU,
    name: PRODUCT,
    category: 'ฟิล์มกรองแสง',
    shop_id: 'cm',
    qty: 0,
    min_qty: 5,
    cost: 0,
  });
}

const receive = (id: number, qty: number, cost: number, docNo: string) =>
  admin.rpc('receive_stock', {
    p_stock_id: id,
    p_qty: qty,
    p_unit_cost: cost,
    p_supplier: '3M',
    p_doc_no: docNo,
    p_by_name: 'ผู้ทดสอบ',
    p_note: '',
  });

const consume = (id: number, qty: number, doc: string) =>
  admin.rpc('move_stock', {
    p_changes: [{ id, change: -qty }] as never,
    p_kind: 'ใบงาน',
    p_document_id: doc,
    p_by_name: 'ผู้ทดสอบ',
    p_note: '',
  });

const lots = async (id: number) => {
  const { data } = await admin
    .from('stock_batches')
    .select('doc_no, unit_cost, qty_received, qty_remaining')
    .eq('stock_id', id)
    .order('id');
  return data ?? [];
};

const movements = async (id: number) => {
  const { data } = await admin
    .from('stock_movements')
    .select('kind, document_id, change, cost_total')
    .eq('stock_id', id)
    .order('id');
  return data ?? [];
};

const product = async (id: number) => {
  const { data } = await admin.from('stock').select('qty, cost').eq('id', id).single();
  return data!;
};

describe('ต้นทุนตามล็อต (live database)', () => {
  beforeEach(async () => {
    await removeFixtures();
    await seed();
  });
  afterAll(removeFixtures);

  it('keeps each round of buying at its own price', async () => {
    const id = await stockId();
    await receive(id, 10, 800, 'INV-4471');
    await receive(id, 10, 950, 'INV-4520');

    expect(await lots(id)).toEqual([
      { doc_no: 'INV-4471', unit_cost: 800, qty_received: 10, qty_remaining: 10 },
      { doc_no: 'INV-4520', unit_cost: 950, qty_received: 10, qty_remaining: 10 },
    ]);

    // The single `cost` on the product is the weighted average now, and derived —
    // it used to be whatever the newest delivery happened to cost.
    expect(await product(id)).toEqual({ qty: 20, cost: 875 });
  });

  it('costs a job from the lots it actually drew on', async () => {
    const id = await stockId();
    await receive(id, 10, 800, 'INV-4471');
    await receive(id, 10, 950, 'INV-4520');

    // Six needed when the open lot holds four: 4×800 + 2×950 = 5,100. An average
    // would have said 6×875 = 5,250, which is a number nobody paid.
    await consume(id, 16, 'JT-1');
    await consume(id, 6, 'JT-2');

    const m = await movements(id);
    expect(m[2]).toMatchObject({ document_id: 'JT-1', cost_total: -13700 });
    // Only four were left to cover six; the rest is uncosted rather than invented.
    expect(m[3]).toMatchObject({ document_id: 'JT-2', cost_total: -3800 });
  });

  it('puts a cancelled job back into the lots it took from', async () => {
    const id = await stockId();
    await receive(id, 10, 800, 'INV-4471');
    await receive(id, 10, 950, 'INV-4520');
    await consume(id, 16, 'JT-1');

    await admin.rpc('move_stock', {
      p_changes: [{ id, change: 16 }] as never,
      p_kind: 'ยกเลิกใบงาน',
      p_document_id: 'JT-1',
      p_by_name: 'ผู้ทดสอบ',
      p_note: '',
    });

    // Exactly what came off goes back on, at the same prices.
    const m = await movements(id);
    expect(m[m.length - 1]).toMatchObject({ kind: 'ยกเลิกใบงาน', cost_total: 13700 });
    expect(await lots(id)).toEqual([
      { doc_no: 'INV-4471', unit_cost: 800, qty_received: 10, qty_remaining: 10 },
      { doc_no: 'INV-4520', unit_cost: 950, qty_received: 10, qty_remaining: 10 },
    ]);
  });

  it('makes a stock count move the lots too, not just the number', async () => {
    const id = await stockId();
    await receive(id, 10, 800, 'INV-4471');
    await receive(id, 10, 950, 'INV-4520');

    // Five short on the shelf. The oldest are the ones missing.
    await admin.rpc('count_stock', {
      p_id: id,
      p_counted: 15,
      p_by_name: 'ผู้ทดสอบ',
      p_note: 'นับรอบเดือน',
    });

    const after = await product(id);
    const remaining = (await lots(id)).reduce((s, b) => s + Number(b.qty_remaining), 0);
    // The two must agree, or the stock VALUE stops matching the shelf.
    expect(after.qty).toBe(15);
    expect(remaining).toBe(15);
    // (5×800 + 10×950) / 15
    expect(after.cost).toBe(900);
  });

  it('writes nothing for a count that matches what is already recorded', async () => {
    const id = await stockId();
    await receive(id, 10, 800, 'INV-4471');
    const before = (await movements(id)).length;

    await admin.rpc('count_stock', {
      p_id: id,
      p_counted: 10,
      p_by_name: 'ผู้ทดสอบ',
      p_note: 'นับซ้ำ',
    });

    expect((await movements(id)).length).toBe(before);
  });

  it('refuses a receipt of nothing', async () => {
    const id = await stockId();
    const { error } = await receive(id, 0, 800, 'INV-EMPTY');
    expect(error).toBeTruthy();
  });
});
