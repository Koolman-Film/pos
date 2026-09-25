// tests/rls/item_revenue_kind.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import {
  type PosClient,
  adminClient,
  assertNoError,
  createAuthUser,
  deleteAuthUserByEmail,
  supabaseAnonKey,
  supabaseUrl,
} from './_helpers';

import type { Database, Json } from '@/lib/types/database';

/**
 * รายได้สาขา / รับแทน Finnix ทีละรายการ (migration 0068).
 *
 * 0031 asked this of the whole ticket. One job sells several ชนิดสินค้า and only
 * some may belong to another branch (ร้านแจ้ง 25 ก.ย. 2569), so the answer moved
 * onto the line. These pin that `save_ticket_children` carries it — the one
 * place every ticket's items are written — and that a line which does not say
 * is the branch's, as every line was before.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'itemkind@test.local';
const TICKET = 'JT-CM-T0068';

let user: PosClient;

const itemsOf = async () => {
  const { data } = await admin
    .from('ticket_items')
    .select('sold, revenue_kind')
    .eq('ticket_id', TICKET)
    .order('id');
  return (data ?? []).map((i) => [i.sold, i.revenue_kind] as const);
};

const save = (items: Record<string, unknown>[]) =>
  user.rpc('save_ticket_children', {
    p_ticket_id: TICKET,
    p_items: items as Json,
    p_payments: [] as Json,
  });

beforeAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
  const u = await createAuthUser(admin, EMAIL, PASSWORD);
  assertNoError(
    'insert app_users',
    (
      await admin.from('app_users').insert({
        id: u.id,
        email: EMAIL,
        name: EMAIL,
        role_id: 'admin',
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  user = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    'sign in',
    (await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })).error,
  );
  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบรับแทน',
        plate: 'ทดสอบ 0068',
        status: 'จองแล้ว',
        drop_off_date: '2026-09-25T09:00:00+07:00',
        pickup_date: '2026-09-25T17:00:00+07:00',
      })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('รายได้/รับแทน ทีละรายการสินค้า', () => {
  it('เก็บคำตอบของแต่ละรายการไว้คนละค่า บนใบงานเดียวกัน', async () => {
    const { error } = await save([
      { category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม A', soldPrice: 6000, revenueKind: 'รายได้' },
      { category: 'ฟิล์มกันรอย', sold: 'TPU', soldPrice: 4000, revenueKind: 'รับแทน' },
    ]);
    expect(error).toBeNull();
    expect(await itemsOf()).toEqual([
      ['ฟิล์ม A', 'รายได้'],
      ['TPU', 'รับแทน'],
    ]);
  });

  it('รายการที่ไม่ได้บอก ถือเป็นรายได้ของสาขา — เหมือนทุกแถวก่อนหน้านี้', async () => {
    const { error } = await save([{ category: 'เครื่องเสียง', sold: 'ลำโพง', soldPrice: 2000 }]);
    expect(error).toBeNull();
    expect(await itemsOf()).toEqual([['ลำโพง', 'รายได้']]);
  });

  it('ค่าที่ไม่รู้จัก ไม่หลุดเข้าฐานข้อมูล', async () => {
    // The column has a CHECK; the function maps anything but the held word to
    // รายได้ rather than letting a typo become a third kind.
    const { error } = await save([
      { category: 'เครื่องเสียง', sold: 'ลำโพง', soldPrice: 2000, revenueKind: 'อะไรก็ไม่รู้' },
    ]);
    expect(error).toBeNull();
    expect(await itemsOf()).toEqual([['ลำโพง', 'รายได้']]);
  });
});
