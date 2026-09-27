import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';
import { pagedData } from '@/lib/supabase/fetchAll';

/*
  Why every growing list is read through `pagedData`.

  PostgREST answers any single request with at most `max_rows` rows (1,000 here
  and on the hosted project) and says nothing when it stops. The customer list,
  the ticket list, the revenue report and the rest used to be one plain request
  each — correct until the table passed 1,000 rows, then silently short.
  Retail customers were at 523 and stock movements at 500 in September 2026.
*/
const admin = adminClient();
const SHOP = 'zp';
const ROWS = 1150;

async function cleanup() {
  await admin.from('tickets').delete().eq('shop_id', SHOP);
  await admin.from('shops').delete().eq('id', SHOP);
}

beforeAll(async () => {
  await cleanup();
  assertNoError(
    'shop',
    (await admin.from('shops').insert({ id: SHOP, name: 'ทดสอบอ่านทีละหน้า' })).error,
  );
  const now = new Date().toISOString();
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    id: `JT-ZP-${String(i + 1).padStart(5, '0')}`,
    shop_id: SHOP,
    customer_name: 'ทดสอบ',
    status: 'จองแล้ว',
    drop_off_date: now,
    pickup_date: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    assertNoError('seed', (await admin.from('tickets').insert(rows.slice(i, i + 500))).error);
  }
}, 60_000);

afterAll(cleanup);

describe('reading more than 1,000 rows', () => {
  it('stops at 1,000 with a single request, and says nothing', async () => {
    const { data, error } = await admin.from('tickets').select('id').eq('shop_id', SHOP);
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
  });

  it('gets every row, once, through pagedData', async () => {
    const { data } = await pagedData(
      (from, to) =>
        admin.from('tickets').select('id').eq('shop_id', SHOP).order('id').range(from, to),
      'tickets',
    );
    expect(data).toHaveLength(ROWS);
    expect(new Set(data.map((r) => r.id)).size).toBe(ROWS);
  });

  it('throws instead of returning a short list when a page fails', async () => {
    await expect(
      pagedData(
        (from, to) =>
          admin.from('tickets').select('no_such_column').eq('shop_id', SHOP).range(from, to),
        'tickets',
      ),
    ).rejects.toThrow(/no_such_column/);
  });
});
