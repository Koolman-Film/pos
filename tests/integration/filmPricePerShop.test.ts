import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * `film_price_matrix.shop_id` (migration 0029).
 *
 * The shop sells the same product for different money at different branches.
 * Before 0029 the table had one row per ชนิดสินค้า × สินค้า × ตำแหน่งติดตั้ง ×
 * ประเภทรถ shared by all five branches, so setting one branch's price silently
 * rewrote the other four.
 *
 * Migration 0003's `unique (category, product, position, car_type)` is the part
 * worth a live test: with it still in place, adding the column changes nothing —
 * the branch row is REFUSED because the ราคากลาง row already occupies the key.
 * These assertions fail loudly if that constraint ever comes back.
 */

const admin = adminClient();

const KEY = {
  category: 'TEST-CAT-0029',
  product: 'TEST-PROD-0029',
  position: 'TEST-POS',
  car_type: 'TEST-TYPE',
};

async function cleanup() {
  await admin.from('film_price_matrix').delete().eq('product', KEY.product);
}

beforeEach(cleanup);
afterAll(cleanup);

describe('film_price_matrix per-shop pricing', () => {
  it('holds a ราคากลาง and a branch price for the same product at once', async () => {
    const { error } = await admin.from('film_price_matrix').insert([
      { ...KEY, price: 2500, shop_id: null },
      { ...KEY, price: 2800, shop_id: 'cm' },
    ]);
    assertNoError('insert both scopes', error);

    const { data } = await admin
      .from('film_price_matrix')
      .select('shop_id, price')
      .eq('product', KEY.product)
      .order('shop_id', { ascending: true, nullsFirst: true });

    expect(data).toEqual([
      { shop_id: null, price: 2500 },
      { shop_id: 'cm', price: 2800 },
    ]);
  });

  it('still refuses a second ราคากลาง for the same combination', async () => {
    assertNoError(
      'seed global',
      (await admin.from('film_price_matrix').insert({ ...KEY, price: 2500, shop_id: null })).error,
    );
    const { error } = await admin
      .from('film_price_matrix')
      .insert({ ...KEY, price: 9999, shop_id: null });
    // NULL is not equal to itself in a unique index, so without the partial index
    // on `where shop_id is null` a branch could stack up duplicate ราคากลาง rows
    // and the lookup would pick between them arbitrarily.
    expect(error?.message ?? '').toMatch(/film_price_matrix_global_key/);
  });

  it('still refuses two prices for one branch', async () => {
    assertNoError(
      'seed branch',
      (await admin.from('film_price_matrix').insert({ ...KEY, price: 2800, shop_id: 'cm' })).error,
    );
    const { error } = await admin
      .from('film_price_matrix')
      .insert({ ...KEY, price: 9999, shop_id: 'cm' });
    expect(error?.message ?? '').toMatch(/film_price_matrix_shop_key/);
  });

  it('lets two branches disagree about the same product', async () => {
    const { error } = await admin.from('film_price_matrix').insert([
      { ...KEY, price: 2800, shop_id: 'cm' },
      { ...KEY, price: 2600, shop_id: 'lp' },
    ]);
    assertNoError('insert two branches', error);

    const { data } = await admin
      .from('film_price_matrix')
      .select('shop_id, price')
      .eq('product', KEY.product);
    expect(new Set((data ?? []).map((r) => r.price))).toEqual(new Set([2800, 2600]));
  });
});
