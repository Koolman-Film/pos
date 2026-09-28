// tests/rls/order_deliveries.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
 * ส่งของหลายรอบใน PO เดียว (migration 0077).
 *
 * ลูกค้าสั่ง 200 ม้วน รับไปก่อน 80 ที่เหลือรออีกสองสัปดาห์ (ร้านแจ้ง 28 ก.ย.
 * 2569). The form offers what is still owed, but the form can be out of date —
 * so the rules that actually matter live here: never send more than was
 * ordered, never edit a PO out from under goods that have already gone, and
 * close the PO exactly when the last of it leaves.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const SALES_EMAIL = 'rounds-sales@test.local';
const ORDER = 'WS-TEST-ROUNDS';

let asSales: PosClient;

const signIn = async (email: string, roleId: string): Promise<PosClient> => {
  await deleteAuthUserByEmail(admin, email);
  const u = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `insert app_users ${email}`,
    (
      await admin.from('app_users').insert({
        id: u.id,
        email,
        name: email,
        role_id: roleId,
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
    `sign in ${email}`,
    (await client.auth.signInWithPassword({ email, password: PASSWORD })).error,
  );
  return client;
};

const deliver = (delivery: Record<string, unknown>) =>
  asSales.rpc('save_order_delivery', {
    p_order_id: ORDER,
    p_delivery: delivery as unknown as Json,
  });

const round = (over: Record<string, unknown> = {}) => ({
  uid: `d${Math.random().toString(36).slice(2, 8)}`,
  date: '2026-09-10',
  note: 'นิ่มซี่เส็ง NMS123456',
  attachments: ['cm/WS-TEST-ROUNDS/slip.jpg'],
  ...over,
});

const line = (uid: string, qty: number) => ({ uid, name: uid === 'u1' ? 'ฟิล์ม' : 'ลำโพง', qty });

const orderRow = async () => {
  const { data } = await admin
    .from('orders')
    .select('status, delivered_at, delivery_note')
    .eq('id', ORDER)
    .single();
  return data;
};

const sentQty = async () => {
  const { data } = await admin
    .from('order_deliveries')
    .select('order_delivery_items(item_uid, qty)')
    .eq('order_id', ORDER);
  const sent: Record<string, number> = {};
  for (const d of data ?? []) {
    for (const li of d.order_delivery_items ?? []) {
      sent[li.item_uid ?? ''] = (sent[li.item_uid ?? ''] ?? 0) + Number(li.qty);
    }
  }
  return sent;
};

beforeAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  asSales = await signIn(SALES_EMAIL, 'sales');
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  await deleteAuthUserByEmail(admin, SALES_EMAIL);
});

beforeEach(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  assertNoError(
    'insert order',
    (
      await admin
        .from('orders')
        .insert({ id: ORDER, shop_id: 'cm', customer_id: null, status: 'รอจัดส่ง' })
    ).error,
  );
  assertNoError(
    'insert items',
    (
      await admin.from('order_items').insert([
        {
          order_id: ORDER,
          name: 'ฟิล์ม',
          qty: 200,
          list_price: 1200,
          requested_price: 1200,
          uid: 'u1',
        },
        {
          order_id: ORDER,
          name: 'ลำโพง',
          qty: 10,
          list_price: 500,
          requested_price: 450,
          uid: 'u2',
        },
      ])
    ).error,
  );
});

describe('รอบส่งของ', () => {
  it('ส่งบางส่วนได้ และ PO ยังไม่ปิด', async () => {
    const { error } = await deliver(round({ items: [line('u1', 80)] }));
    expect(error).toBeNull();
    expect(await sentQty()).toEqual({ u1: 80 });
    // ยังค้างอยู่ 120 กับลำโพงอีก 10 — ปิดตอนนี้คือบอกว่าส่งครบทั้งที่ไม่ครบ
    expect(await orderRow()).toMatchObject({ status: 'รอจัดส่ง', delivered_at: '2026-09-10' });
  });

  it('รอบที่ส่งครบ ปิด PO ให้เอง และวันที่ยังเป็นของรอบแรก', async () => {
    await deliver(round({ items: [line('u1', 80)] }));
    const { error } = await deliver(
      round({ date: '2026-10-02', note: 'Kerry TH9', items: [line('u1', 120), line('u2', 10)] }),
    );
    expect(error).toBeNull();
    expect(await orderRow()).toMatchObject({
      status: 'จัดส่งแล้ว',
      // รอบแรกคือวันที่ยอดขายก้อนแรกเกิด การส่งรอบหลังไม่ย้ายมัน
      delivered_at: '2026-09-10',
      // ส่วนหลักฐานเป็นของรอบล่าสุด ซึ่งคือสิ่งที่ด่านหลักฐาน (0055) อ่าน
      delivery_note: 'Kerry TH9',
    });
  });

  it('ส่งเกินจำนวนที่สั่ง ถูกปฏิเสธ', async () => {
    await deliver(round({ items: [line('u1', 80)] }));
    const { error } = await deliver(round({ items: [line('u1', 130)] }));
    expect(error?.message ?? '').toContain('เกินจำนวนที่สั่ง');
    expect(await sentQty()).toEqual({ u1: 80 });
  });

  it('ส่งของที่ไม่ได้อยู่ใน PO ถูกปฏิเสธ', async () => {
    const { error } = await deliver(round({ items: [{ uid: 'ไม่มีจริง', name: 'x', qty: 1 }] }));
    expect(error?.message ?? '').toContain('รายการสินค้าใน PO เปลี่ยนไปแล้ว');
  });

  it('ไม่มีหลักฐาน ส่งไม่ได้ — ด่านเดียวกับ 0055 แต่ทีละรอบ', async () => {
    const { error } = await deliver(round({ attachments: [], items: [line('u1', 1)] }));
    expect(error?.message ?? '').toContain('ต้องแนบหลักฐาน');
    expect(await sentQty()).toEqual({});
  });

  it('ไม่กรอกข้อมูลการจัดส่ง ส่งไม่ได้', async () => {
    const { error } = await deliver(round({ note: '  ', items: [line('u1', 1)] }));
    expect(error?.message ?? '').toContain('ต้องกรอกข้อมูลการจัดส่ง');
  });

  it('uid เดิมยิงซ้ำ ไม่ได้รอบใหม่ — กดปุ่มสองครั้งไม่ใช่ส่งสองรอบ', async () => {
    const same = round({ items: [line('u1', 80)] });
    const first = await deliver(same);
    const second = await deliver(same);
    expect(second.data).toBe(first.data);
    expect(await sentQty()).toEqual({ u1: 80 });
  });

  it('ของที่ส่งไปแล้ว ลดจำนวนหรือลบทิ้งไม่ได้', async () => {
    await deliver(round({ items: [line('u1', 80)] }));

    const { error } = await asSales.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [
        { uid: 'u1', name: 'ฟิล์ม', qty: 50, listPrice: 1200, requestedPrice: 1200 },
      ] as unknown as Json,
      p_returns: [] as unknown as Json,
      p_adjustments: [] as unknown as Json,
      p_payments: [] as unknown as Json,
      p_saved_on: '2026-09-11',
    });
    expect(error?.message ?? '').toContain('ส่งออกไปแล้ว');

    // ของเดิมต้องยังอยู่ครบ — การปฏิเสธที่ลบข้อมูลไปครึ่งหนึ่งแย่กว่าไม่ปฏิเสธ
    const { data: items } = await admin
      .from('order_items')
      .select('uid, qty')
      .eq('order_id', ORDER)
      .order('uid');
    expect(items).toEqual([
      { uid: 'u1', qty: 200 },
      { uid: 'u2', qty: 10 },
    ]);
  });

  it('เพิ่มจำนวนของรายการที่ส่งไปแล้วได้ — ลูกค้าสั่งเพิ่ม ไม่ใช่การลบของ', async () => {
    await deliver(round({ items: [line('u1', 80)] }));
    const { error } = await asSales.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [
        { uid: 'u1', name: 'ฟิล์ม', qty: 300, listPrice: 1200, requestedPrice: 1200 },
        { uid: 'u2', name: 'ลำโพง', qty: 10, listPrice: 500, requestedPrice: 450 },
      ] as unknown as Json,
      p_returns: [] as unknown as Json,
      p_adjustments: [] as unknown as Json,
      p_payments: [] as unknown as Json,
      p_saved_on: '2026-09-11',
    });
    expect(error).toBeNull();
    // และรอบที่ส่งไปแล้วยังชี้ถูกที่ หลัง uid เดิมถูกใส่กลับ
    expect(await sentQty()).toEqual({ u1: 80 });
  });
});

describe('ลบรอบส่งของ', () => {
  it('ลบแล้ว PO ที่ปิดไปกลับมารอจัดส่ง', async () => {
    await deliver(round({ items: [line('u1', 200), line('u2', 10)] }));
    expect(await orderRow()).toMatchObject({ status: 'จัดส่งแล้ว' });

    const { data: rows } = await admin
      .from('order_deliveries')
      .select('id')
      .eq('order_id', ORDER)
      .order('id', { ascending: false })
      .limit(1);
    const { error } = await asSales.rpc('delete_order_delivery', {
      p_delivery_id: rows![0].id,
    });
    expect(error).toBeNull();
    expect(await orderRow()).toMatchObject({ status: 'รอจัดส่ง', delivered_at: null });
    expect(await sentQty()).toEqual({});
  });

  it('ไม่มีสิทธิ์เปลี่ยนสถานะ PO ก็ลบรอบไม่ได้', async () => {
    await deliver(round({ items: [line('u1', 80)] }));
    const { data: rows } = await admin
      .from('order_deliveries')
      .select('id')
      .eq('order_id', ORDER)
      .limit(1);

    assertNoError(
      'revoke updateStatus',
      (
        await admin
          .from('role_permissions')
          .update({ allowed: false })
          .eq('role_id', 'sales')
          .eq('permission_type', 'module_capability')
          .eq('permission_key', 'wholesale.updateStatus')
      ).error,
    );
    try {
      const { error } = await asSales.rpc('delete_order_delivery', {
        p_delivery_id: rows![0].id,
      });
      expect(error?.message ?? '').toContain('ไม่มีสิทธิ์');
      expect(await sentQty()).toEqual({ u1: 80 });
    } finally {
      await admin
        .from('role_permissions')
        .update({ allowed: true })
        .eq('role_id', 'sales')
        .eq('permission_type', 'module_capability')
        .eq('permission_key', 'wholesale.updateStatus');
    }
  });
});
