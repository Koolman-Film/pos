// tests/rls/order_adjustment_approval.test.ts
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
 * ยืนยันเงินเข้า ต้องมีสิทธิ์ และห้ามผ่านหน้าจอแก้ไข PO (migration 0048).
 *
 * A sale may edit and save this PO all day; none of those saves may turn a
 * cheque in the drawer into money. Two ways that could go wrong, and both are
 * reachable without the UI — a Server Action is a plain POST:
 *
 *   1. calling `confirm_order_payment` directly, and
 *   2. saving the PO with `status: 'รับเงินแล้ว'` in the payments payload.
 *
 * `save_order_children` answers the second by reading the stored status back
 * per uid and ignoring whatever the caller sent. These assertions are what stop
 * either from being quietly re-opened.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'poadj-admin@test.local';
const SALES_EMAIL = 'poadj-sales@test.local';
const ORDER_ID = 'WS-TEST-ADJ1';
const UID = 'a-test-adj-1';

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

const adjustment = (extra: Record<string, unknown> = {}) => [
  {
    uid: UID,
    amount: 500,
    reason: 'ลูกค้าต่อรองหลังส่งของ',
    date: '2026-09-03',
    ...extra,
  },
];

const storedAdjustment = async () => {
  const { data } = await admin
    .from('order_adjustments')
    .select('status, approved_at, reject_note, reason')
    .eq('order_id', ORDER_ID)
    .eq('uid', UID)
    .single();
  return data;
};

let asAdmin: PosClient;
let asSales: PosClient;

async function removeFixtures() {
  await admin.from('orders').delete().eq('id', ORDER_ID);
}

beforeAll(async () => {
  await removeFixtures();
  asAdmin = await makeUser(ADMIN_EMAIL, 'admin');
  asSales = await makeUser(SALES_EMAIL, 'sales');
  assertNoError(
    'seed order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER_ID, shop_id: 'cm', customer_id: null, status: 'ค้างชำระ' })
    ).error,
  );
});

afterAll(async () => {
  await removeFixtures();
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  await deleteAuthUserByEmail(admin, SALES_EMAIL);
});

async function saveChildren(client: PosClient, adjustments: Record<string, unknown>[]) {
  return client.rpc('save_order_children', {
    p_order_id: ORDER_ID,
    p_items: [{ name: 'ฟิล์ม 3M CRM', qty: 10, listPrice: 3000, requestedPrice: 3000, reason: '' }],
    p_returns: [],
    // The RPC types the payload as Json; the fixtures are plain objects.
    p_adjustments: adjustments as unknown as Json,
    p_payments: [],
    p_saved_on: '2026-09-01',
  });
}

describe('การปรับราคาขายส่ง — การอนุมัติและสิทธิ์', () => {
  it('รายการที่เพิ่งบันทึกเริ่มต้นที่ รออนุมัติ ไม่ใช่อนุมัติแล้ว', async () => {
    // Saved by an ADMIN, who does hold the capability: writing the adjustment
    // and approving it are two decisions, and the second is the point.
    const { error } = await saveChildren(asAdmin, adjustment());
    expect(error).toBeNull();
    expect(await storedAdjustment()).toMatchObject({ status: 'รออนุมัติ', approved_at: null });
  });

  it('ส่ง status มาเองไม่มีผล — ค่าที่เก็บไว้เป็นตัวตัดสิน', async () => {
    const { error } = await saveChildren(
      asSales,
      adjustment({ status: 'อนุมัติแล้ว', approvedAt: '2026-09-04' }),
    );
    expect(error).toBeNull();
    expect(await storedAdjustment()).toMatchObject({ status: 'รออนุมัติ', approved_at: null });
  });

  it('sale อนุมัติการปรับราคาไม่ได้', async () => {
    const { error } = await asSales.rpc('approve_order_adjustment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-09-05',
    });
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
    expect(await storedAdjustment()).toMatchObject({ status: 'รออนุมัติ' });
  });

  it('แอดมินอนุมัติได้', async () => {
    const { error } = await asAdmin.rpc('approve_order_adjustment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-09-05',
    });
    expect(error).toBeNull();
    expect(await storedAdjustment()).toMatchObject({
      status: 'อนุมัติแล้ว',
      approved_at: '2026-09-05',
    });
  });

  it('บันทึก PO ซ้ำ ไม่ล้างการอนุมัติที่ทำไปแล้ว', async () => {
    // The rows are deleted and re-inserted on every save, so this is the case
    // that would silently un-approve a month of adjustments if it regressed.
    const { error } = await saveChildren(asSales, adjustment({ reason: 'แก้เหตุผลใหม่' }));
    expect(error).toBeNull();
    expect(await storedAdjustment()).toMatchObject({
      status: 'อนุมัติแล้ว',
      approved_at: '2026-09-05',
      // The editable half of the row still saves normally.
      reason: 'แก้เหตุผลใหม่',
    });
  });

  it('ปฏิเสธ: ต้องมีสิทธิ์ และแถวยังอยู่พร้อมเหตุผล', async () => {
    const denied = await asSales.rpc('reject_order_adjustment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_note: 'ลดเยอะเกินไป',
    });
    expect(denied.error?.message ?? '').toContain('ไม่มีสิทธิ์');

    const { error } = await asAdmin.rpc('reject_order_adjustment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_note: 'ลดเยอะเกินไป',
    });
    expect(error).toBeNull();
    expect(await storedAdjustment()).toMatchObject({
      status: 'ปฏิเสธ',
      approved_at: null,
      reject_note: 'ลดเยอะเกินไป',
    });
  });
});
