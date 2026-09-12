// tests/rls/order_delivery_evidence.test.ts
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
 * เปลี่ยนเป็น "จัดส่งแล้ว" ต้องมีหลักฐาน (migration 0055).
 *
 * The form asks for the courier, the tracking number and a photograph, but a
 * required field in a form is a suggestion: the Server Action behind it is a
 * plain POST. These run as a signed-in user through PostgREST — the path that
 * skips the form entirely — because that is the one the rule has to hold on.
 *
 * The caller is an ADMIN on purpose. This is not about who is asking; it is
 * about the row being complete before the transition that takes the stock off
 * the shelf and counts the sale, and the most privileged user in the shop is
 * the one most likely to be in a hurry.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const ADMIN_EMAIL = 'delivevi-admin@test.local';
const ORDER_ID = 'WS-TEST-DLV1';

async function makeAdmin(): Promise<PosClient> {
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
  const user = await createAuthUser(admin, ADMIN_EMAIL, PASSWORD);
  assertNoError(
    'insert app_users',
    (
      await admin.from('app_users').insert({
        id: user.id,
        email: ADMIN_EMAIL,
        name: ADMIN_EMAIL,
        role_id: 'admin',
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    'sign in',
    (await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD })).error,
  );
  return client;
}

const stored = async () => {
  const { data } = await admin
    .from('orders')
    .select('status, delivered_at, delivery_note, delivery_attachments')
    .eq('id', ORDER_ID)
    .single();
  return data;
};

const resetOrder = async () => {
  await admin
    .from('orders')
    .update({
      status: 'รอจัดส่ง',
      delivered_at: null,
      delivery_note: '',
      delivery_attachments: [],
    })
    .eq('id', ORDER_ID);
};

let asAdmin: PosClient;

beforeAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER_ID);
  asAdmin = await makeAdmin();
  assertNoError(
    'seed order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER_ID, shop_id: 'cm', customer_id: null, status: 'รอจัดส่ง' })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER_ID);
  await deleteAuthUserByEmail(admin, ADMIN_EMAIL);
});

describe('จัดส่งแล้ว ต้องมีข้อมูลการจัดส่งและไฟล์แนบ', () => {
  it('ไม่มีข้อมูลการจัดส่ง เปลี่ยนสถานะไม่ได้', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({ status: 'จัดส่งแล้ว', delivered_at: '2026-09-12' })
      .eq('id', ORDER_ID);
    expect(error?.message ?? '').toContain('ข้อมูลการจัดส่ง');
    expect(await stored()).toMatchObject({ status: 'รอจัดส่ง' });
  });

  it('มีข้อมูลแต่ไม่แนบไฟล์ ก็ยังไม่ผ่าน', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({
        status: 'จัดส่งแล้ว',
        delivered_at: '2026-09-12',
        delivery_note: 'นิ่มซี่เส็ง NMS123456',
      })
      .eq('id', ORDER_ID);
    expect(error?.message ?? '').toContain('แนบหลักฐาน');
    expect(await stored()).toMatchObject({ status: 'รอจัดส่ง' });
    await resetOrder();
  });

  it('ช่องว่างล้วน ไม่นับว่ากรอกแล้ว', async () => {
    // Otherwise the rule is one spacebar away from meaning nothing.
    const { error } = await asAdmin
      .from('orders')
      .update({
        status: 'จัดส่งแล้ว',
        delivered_at: '2026-09-12',
        delivery_note: '   ',
        delivery_attachments: ['cm/WS-TEST-DLV1/x.jpg'],
      })
      .eq('id', ORDER_ID);
    expect(error?.message ?? '').toContain('ข้อมูลการจัดส่ง');
    await resetOrder();
  });

  it('ครบแล้วผ่าน', async () => {
    const { error } = await asAdmin
      .from('orders')
      .update({
        status: 'จัดส่งแล้ว',
        delivered_at: '2026-09-12',
        delivery_note: 'นิ่มซี่เส็ง NMS123456 · คุณสมชายรับของ',
        delivery_attachments: ['cm/WS-TEST-DLV1/slip.jpg'],
      })
      .eq('id', ORDER_ID);
    expect(error).toBeNull();
    expect(await stored()).toMatchObject({
      status: 'จัดส่งแล้ว',
      delivery_note: 'นิ่มซี่เส็ง NMS123456 · คุณสมชายรับของ',
    });
  });

  it('PO ที่ส่งไปแล้ว ยังแก้เรื่องอื่นได้โดยไม่ถูกถามหาหลักฐานซ้ำ', async () => {
    // The evidence is demanded on the TRANSITION. A PO delivered last month
    // must stay editable — re-priced, re-saved, its status moved on to
    // ค้างชำระ — without anybody being asked to photograph the past again.
    const { error } = await asAdmin
      .from('orders')
      .update({ status: 'ค้างชำระ' })
      .eq('id', ORDER_ID);
    expect(error).toBeNull();
    expect(await stored()).toMatchObject({ status: 'ค้างชำระ' });
  });

  it('service_role ยังทำงานได้ — seed และสคริปต์ซ่อมข้อมูลไม่มีรูปให้แนบ', async () => {
    // 0052's bypass, re-stated here because `create or replace` drops whatever
    // it does not repeat. Without it every fixture in this suite would fail.
    await resetOrder();
    const { error } = await admin
      .from('orders')
      .update({ status: 'จัดส่งแล้ว', delivered_at: '2026-09-12' })
      .eq('id', ORDER_ID);
    expect(error).toBeNull();
  });
});
