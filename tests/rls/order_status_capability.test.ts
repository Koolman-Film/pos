// tests/rls/order_status_capability.test.ts
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

import type { Database } from '@/lib/types/database';

/**
 * เปลี่ยนสถานะ PO ต้องมีสิทธิ์ และการอนุมัติราคาต้องทิ้งร่องรอย (migration 0051).
 *
 * `wholesale.updateStatus` was checked in the Server Action and nowhere else,
 * while `orders_rw` lets any member of the branch UPDATE the row — so a
 * signed-in token could PATCH the status straight through PostgREST without
 * ever loading the screen that has the control. The same hole, and the same
 * fix, as ลบ/กู้คืน PO in 0040: the trigger is what actually stops it.
 *
 * `sales` is the role used for the refusals. It holds `wholesale.updateStatus`
 * by default, so the fixture takes that one key away — and NOT `tech`, which
 * cannot reach the module at all: `orders_rw` requires the wholesale nav, so a
 * tech user is refused by RLS long before any of this is exercised.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'postatus-admin@test.local';
const SALES_EMAIL = 'postatus-sales@test.local';
const ORDER_ID = 'WS-TEST-ST01';

async function signedIn(email: string): Promise<PosClient> {
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assertNoError(`sign in as ${email}`, error);
  return client;
}

async function makeUser(email: string, role: string): Promise<PosClient> {
  await deleteAuthUserByEmail(admin, email);
  const user = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `insert app_users for ${email}`,
    (
      await admin.from('app_users').insert({
        id: user.id,
        email,
        name: email,
        role_id: role,
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  return signedIn(email);
}

const storedOrder = async () => {
  const { data } = await admin
    .from('orders')
    .select('status, price_decision, price_decided_at, price_decided_by')
    .eq('id', ORDER_ID)
    .single();
  return data;
};

const resetOrder = async (status: string) => {
  await admin.from('orders').update({ status }).eq('id', ORDER_ID);
};

let asAdmin: PosClient;
let asSales: PosClient;

beforeAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER_ID);
  asAdmin = await makeUser(ADMIN_EMAIL, 'admin');
  asSales = await makeUser(SALES_EMAIL, 'sales');
  // sales holds updateStatus by default; the caller this test is about is the
  // one who does NOT, so take that single key away for this run.
  assertNoError(
    'revoke updateStatus from sales',
    (
      await admin
        .from('role_permissions')
        .update({ allowed: false })
        .eq('role_id', 'sales')
        .eq('permission_type', 'module_capability')
        .eq('permission_key', 'wholesale.updateStatus')
    ).error,
  );
  assertNoError(
    'seed order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER_ID, shop_id: 'cm', customer_id: null, status: 'รออนุมัติราคา' })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER_ID);
  await admin
    .from('role_permissions')
    .update({ allowed: true })
    .eq('role_id', 'sales')
    .eq('permission_type', 'module_capability')
    .eq('permission_key', 'wholesale.updateStatus');
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, SALES_EMAIL);
});

describe('สถานะ PO — สิทธิ์ และร่องรอยการอนุมัติราคา', () => {
  it('คนที่ไม่มีสิทธิ์ ยิงตรงเข้าฐานข้อมูลก็เปลี่ยนสถานะไม่ได้', async () => {
    const { error } = await asSales
      .from('orders')
      .update({ status: 'ปิดงานแล้ว' })
      .eq('id', ORDER_ID);
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
    expect(await storedOrder()).toMatchObject({ status: 'รออนุมัติราคา' });
  });

  it('แก้ PO โดยไม่แตะสถานะ ยังทำได้ตามปกติ', async () => {
    // Most edits to a PO are lines and prices; the guard must not stand in the
    // way of those or it would make the module unusable for everyone else.
    const { error } = await asSales
      .from('orders')
      .update({ status: 'รออนุมัติราคา', customer_id: null })
      .eq('id', ORDER_ID);
    expect(error).toBeNull();
  });

  it('แอดมินเปลี่ยนสถานะได้', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({ status: 'ปิดงานแล้ว' })
      .eq('id', ORDER_ID);
    expect(error).toBeNull();
    await resetOrder('รออนุมัติราคา');
  });

  it('อนุมัติราคาแล้วบันทึกว่าใครอนุมัติและเมื่อไหร่', async () => {
    const { error } = await asAdmin.rpc('decide_order_price', {
      p_order_id: ORDER_ID,
      p_approve: true,
    });
    expect(error).toBeNull();

    const row = await storedOrder();
    expect(row).toMatchObject({ status: 'รอจัดส่ง', price_decision: 'อนุมัติ' });
    // The whole point: a status alone proved nothing, because anybody could set
    // one. These two say who and when.
    expect(row?.price_decided_at).toBeTruthy();
    expect(row?.price_decided_by).toBeTruthy();
  });

  it('ปฏิเสธราคาก็ทิ้งร่องรอยเหมือนกัน', async () => {
    // A rejection somebody has to explain later is worth as much as an approval.
    const { error } = await asAdmin.rpc('decide_order_price', {
      p_order_id: ORDER_ID,
      p_approve: false,
    });
    expect(error).toBeNull();
    expect(await storedOrder()).toMatchObject({
      status: 'รออนุมัติราคา',
      price_decision: 'ปฏิเสธ',
    });
  });

  it('คนที่ไม่มีสิทธิ์อนุมัติราคา เรียกฟังก์ชันตรงก็ไม่ผ่าน', async () => {
    const { error } = await asSales.rpc('decide_order_price', {
      p_order_id: ORDER_ID,
      p_approve: true,
    });
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
    expect(await storedOrder()).toMatchObject({ status: 'รออนุมัติราคา' });
  });
});
