// tests/rls/order_payment_confirm.test.ts
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
const ADMIN_EMAIL = 'pochq-admin@test.local';
const SALES_EMAIL = 'pochq-sales@test.local';
const ORDER_ID = 'WS-TEST-CHQ1';
const UID = 'p-test-cheque-1';

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

const payment = (extra: Record<string, unknown> = {}) => [
  {
    uid: UID,
    amount: 20000,
    method: 'เช็คธนาคารกสิกร',
    date: '2026-09-01',
    chequeNo: '0012345',
    chequeBank: 'KBANK',
    chequeDate: '2026-10-15',
    ...extra,
  },
];

const storedPayment = async () => {
  const { data } = await admin
    .from('order_payments')
    .select('status, cleared_at, bounced_at, bounce_note, cheque_no')
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

async function saveChildren(client: PosClient, payments: Record<string, unknown>[]) {
  return client.rpc('save_order_children', {
    p_order_id: ORDER_ID,
    p_items: [{ name: 'ฟิล์ม 3M CRM', qty: 10, listPrice: 3000, requestedPrice: 3000, reason: '' }],
    p_returns: [],
    p_adjustments: [],
    // The RPC types the payload as Json; the fixtures are plain objects.
    p_payments: payments as unknown as Json,
    p_saved_on: '2026-09-01',
  });
}

describe('การรับเงินขายส่ง — สถานะและสิทธิ์', () => {
  it('รายการที่เพิ่งบันทึกเริ่มต้นที่ แจ้งแล้ว ไม่ใช่เงินที่ได้แล้ว', async () => {
    // Saved by an ADMIN, who does hold the capability: recording is still not
    // confirming. One deliberate click is the point of having a confirmation.
    const { error } = await saveChildren(asAdmin, payment());
    expect(error).toBeNull();
    expect(await storedPayment()).toMatchObject({ status: 'แจ้งแล้ว', cleared_at: null });
  });

  it('ส่ง status มาเองไม่มีผล — ค่าที่เก็บไว้เป็นตัวตัดสิน', async () => {
    const { error } = await saveChildren(
      asSales,
      payment({ status: 'รับเงินแล้ว', clearedAt: '2026-09-02' }),
    );
    expect(error).toBeNull();
    expect(await storedPayment()).toMatchObject({ status: 'แจ้งแล้ว', cleared_at: null });
  });

  it('sale ยืนยันเงินเข้าไม่ได้', async () => {
    const { error } = await asSales.rpc('confirm_order_payment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-10-16',
    });
    expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
    expect(await storedPayment()).toMatchObject({ status: 'แจ้งแล้ว' });
  });

  it('แอดมินยืนยันได้ และลงวันที่ที่เงินเข้าจริง', async () => {
    const { error } = await asAdmin.rpc('confirm_order_payment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-10-16',
    });
    expect(error).toBeNull();
    // Not today, and not the date the cheque was taken in: the date it landed.
    expect(await storedPayment()).toMatchObject({
      status: 'รับเงินแล้ว',
      cleared_at: '2026-10-16',
    });
  });

  it('บันทึก PO ซ้ำ ไม่ล้างการยืนยันที่ทำไปแล้ว', async () => {
    // The rows are deleted and re-inserted on every save, so this is the case
    // that would silently un-confirm a month of payments if it regressed.
    const { error } = await saveChildren(asSales, payment({ chequeNo: '0099999' }));
    expect(error).toBeNull();
    expect(await storedPayment()).toMatchObject({
      status: 'รับเงินแล้ว',
      cleared_at: '2026-10-16',
      // The editable half of the row still saves normally.
      cheque_no: '0099999',
    });
  });

  it('เช็คเด้ง: ต้องมีสิทธิ์ และเงินที่เคยยืนยันถูกถอนออก', async () => {
    const denied = await asSales.rpc('bounce_order_payment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-10-20',
      p_note: 'เงินในบัญชีไม่พอ',
    });
    expect(denied.error?.message ?? '').toContain('ไม่มีสิทธิ์');

    const { error } = await asAdmin.rpc('bounce_order_payment', {
      p_order_id: ORDER_ID,
      p_uid: UID,
      p_on: '2026-10-20',
      p_note: 'เงินในบัญชีไม่พอ',
    });
    expect(error).toBeNull();
    expect(await storedPayment()).toMatchObject({
      status: 'เด้ง',
      bounced_at: '2026-10-20',
      bounce_note: 'เงินในบัญชีไม่พอ',
      // It never cleared, so the money card must stop counting it.
      cleared_at: null,
    });
  });
});
