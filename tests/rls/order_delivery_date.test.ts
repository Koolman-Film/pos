// tests/rls/order_delivery_date.test.ts
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
 * วันที่ส่งของกรอกเองได้ และเป็นตัวตัดสินยอดค้างรับ (ร้านขอ 24 ก.ย. 2569).
 *
 * A PO dragged straight to ค้างชำระ never went through ออกใบส่งของ, so it had no
 * `delivered_at` — and the dashboard's ค้างรับ card and รายงานรายได้ both read
 * that column, so real money was missing from both. The form carries the date
 * of its own now. These pin the two things the database has to allow for that
 * to work, and the one it must still refuse.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'shipdate@test.local';
const ORDER = 'WS-TEST-SHIP';

let user: PosClient;

const stored = async () => {
  const { data } = await admin
    .from('orders')
    .select('status, delivered_at, delivery_note, delivery_attachments')
    .eq('id', ORDER)
    .single();
  return data;
};

const reset = async (patch: Record<string, unknown>) => {
  await admin
    .from('orders')
    .update({
      status: 'ค้างชำระ',
      delivered_at: null,
      delivery_note: '',
      delivery_attachments: [],
      ...patch,
    })
    .eq('id', ORDER);
};

beforeAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
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
    'insert order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER, shop_id: 'cm', customer_id: null, status: 'ค้างชำระ' })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('วันที่ส่งของบน PO', () => {
  it('กรอกวันที่ส่งของบน PO ที่ค้างชำระได้ โดยไม่ต้องออกใบส่งของ', async () => {
    await reset({});
    const { error } = await user
      .from('orders')
      .update({ delivered_at: '2026-09-20' })
      .eq('id', ORDER);
    expect(error).toBeNull();
    expect(await stored()).toMatchObject({ status: 'ค้างชำระ', delivered_at: '2026-09-20' });
  });

  it('แก้วันที่ส่งของที่กรอกผิดได้ — เป็นการแก้ที่ตั้งใจ ไม่ใช่ผลข้างเคียง', async () => {
    await reset({ delivered_at: '2026-09-20' });
    const { error } = await user
      .from('orders')
      .update({ delivered_at: '2026-09-18' })
      .eq('id', ORDER);
    expect(error).toBeNull();
    expect((await stored())?.delivered_at).toBe('2026-09-18');
  });

  it('PO ที่มีวันที่อยู่แล้ว ยังออกใบส่งของเก็บหลักฐานได้ตามปกติ', async () => {
    /*
      The shape `recordOrderDelivery` now writes. It used to carry the date and
      the evidence in one update guarded on `delivered_at is null`, so a PO that
      already had a date saved NOTHING — no ข้อมูลการจัดส่ง, no attachment, and
      the status left where it was — and reported success.
    */
    await reset({ delivered_at: '2026-09-18' });
    const { error } = await user
      .from('orders')
      .update({
        status: 'จัดส่งแล้ว',
        delivery_note: 'ขนส่ง Kerry · TH123',
        delivery_attachments: ['wholesale/evidence.jpg'],
      })
      .eq('id', ORDER);
    expect(error).toBeNull();
    expect(await stored()).toMatchObject({
      status: 'จัดส่งแล้ว',
      // The first date stands — a ใบส่งของ must not re-date the sale.
      delivered_at: '2026-09-18',
      delivery_note: 'ขนส่ง Kerry · TH123',
    });
  });

  it('เปลี่ยนเป็นจัดส่งแล้วโดยไม่มีหลักฐาน ยังถูกปฏิเสธเหมือนเดิม', async () => {
    await reset({ delivered_at: '2026-09-18' });
    const { error } = await user.from('orders').update({ status: 'จัดส่งแล้ว' }).eq('id', ORDER);
    expect(error?.message ?? '').toContain('ต้องกรอกข้อมูลการจัดส่ง');
    expect((await stored())?.status).toBe('ค้างชำระ');
  });
});
