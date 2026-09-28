// tests/rls/order_installments.test.ts
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
 * ตารางงวดชำระของ PO (migration 0078).
 *
 * มัดจำ 30% วันเปิด PO ที่เหลืออีก 30 วัน. สิ่งที่ฐานข้อมูลต้องรับประกันมีสาม
 * อย่าง: ตารางถูกแทนที่ทั้งชุดในคำสั่งเดียว, `orders.due_at` ตามไปเป็นงวด
 * สุดท้ายเสมอ (ทุกที่ที่ยังอ่านคอลัมน์นั้นจะได้ความหมายที่ถูก), และ "เงินก้อน
 * นี้เข้างวดไหน" อยู่รอดข้ามการบันทึก PO ที่ลบลูกทิ้งแล้วใส่กลับใหม่
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'installments@test.local';
const ORDER = 'WS-TEST-INST';

let user: PosClient;

const save = (installments: Record<string, unknown>[]) =>
  user.rpc('save_order_installments', {
    p_order_id: ORDER,
    p_installments: installments as unknown as Json,
  });

const stored = async () => {
  const { data } = await admin
    .from('order_installments')
    .select('uid, seq, due_at, amount, note')
    .eq('order_id', ORDER)
    .order('seq');
  return (data ?? []).map((i) => ({ ...i, amount: Number(i.amount) }));
};

const dueAt = async () => {
  const { data } = await admin.from('orders').select('due_at').eq('id', ORDER).single();
  return data?.due_at ?? null;
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
        role_id: 'sales',
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
});

afterAll(async () => {
  await admin.from('orders').delete().eq('id', ORDER);
  await deleteAuthUserByEmail(admin, EMAIL);
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
});

describe('ตารางงวดชำระ', () => {
  it('บันทึกงวดได้ และเรียงลำดับตามที่ส่งมา', async () => {
    const { error } = await save([
      { uid: 'i1', dueAt: '2026-09-01', amount: 3000, note: 'มัดจำ' },
      { uid: 'i2', dueAt: '2026-10-01', amount: 7000 },
    ]);
    expect(error).toBeNull();
    expect(await stored()).toEqual([
      { uid: 'i1', seq: 1, due_at: '2026-09-01', amount: 3000, note: 'มัดจำ' },
      { uid: 'i2', seq: 2, due_at: '2026-10-01', amount: 7000, note: '' },
    ]);
  });

  it('กำหนดชำระของทั้งใบ ตามงวดสุดท้ายเสมอ', async () => {
    // แดชบอร์ด รายงาน และกระดิ่งเตือนบางส่วนยังอ่าน orders.due_at อยู่ — ปล่อย
    // ให้มันค้างวันเก่าไว้ คือการมีตัวเลขสองชุดที่ขัดกันเองในระบบเดียว
    await save([
      { uid: 'i1', dueAt: '2026-09-01', amount: 3000 },
      { uid: 'i2', dueAt: '2026-10-01', amount: 7000 },
    ]);
    expect(await dueAt()).toBe('2026-10-01');
  });

  it('บันทึกทับ = แทนที่ทั้งชุด ไม่ใช่เพิ่มต่อท้าย', async () => {
    await save([{ uid: 'i1', dueAt: '2026-09-01', amount: 3000 }]);
    await save([{ uid: 'i9', dueAt: '2026-11-01', amount: 9000 }]);
    expect(await stored()).toEqual([
      { uid: 'i9', seq: 1, due_at: '2026-11-01', amount: 9000, note: '' },
    ]);
  });

  it('ลบงวดทิ้งหมดได้ และไม่ไปแตะกำหนดชำระที่กรอกไว้เอง', async () => {
    await admin.from('orders').update({ due_at: '2026-12-31' }).eq('id', ORDER);
    const { error } = await save([]);
    expect(error).toBeNull();
    expect(await stored()).toEqual([]);
    expect(await dueAt()).toBe('2026-12-31');
  });

  it('งวดที่ไม่มีกำหนดชำระ ถูกปฏิเสธทั้งชุด', async () => {
    const { error } = await save([
      { uid: 'i1', dueAt: '2026-09-01', amount: 3000 },
      { uid: 'i2', dueAt: '', amount: 7000 },
    ]);
    expect(error?.message ?? '').toContain('ทุกงวดต้องมีกำหนดชำระ');
    expect(await stored()).toEqual([]);
  });

  it('uid ซ้ำในชุดเดียวกัน ถูกปฏิเสธ', async () => {
    const { error } = await save([
      { uid: 'i1', dueAt: '2026-09-01', amount: 3000 },
      { uid: 'i1', dueAt: '2026-10-01', amount: 7000 },
    ]);
    expect(error?.message ?? '').toContain('uid ซ้ำกัน');
  });

  it('PO ที่ไม่มีอยู่ ถูกปฏิเสธ ไม่ใช่เงียบ', async () => {
    const { error } = await user.rpc('save_order_installments', {
      p_order_id: 'WS-ไม่มีจริง',
      p_installments: [] as unknown as Json,
    });
    expect(error?.message ?? '').toContain('ไม่พบ PO นี้');
  });
});

describe('เงินก้อนนี้เข้างวดไหน', () => {
  it('อยู่รอดข้ามการบันทึก PO', async () => {
    // `save_order_children` ลบลูกทั้งหมดแล้วใส่กลับใหม่ทุกครั้ง — ถ้าไม่ได้ติด
    // ไปกับ payload การจิ้มงวดจะหายทุกครั้งที่มีคนกดบันทึก
    await save([{ uid: 'i1', dueAt: '2026-09-01', amount: 3000 }]);
    assertNoError(
      'save children',
      (
        await user.rpc('save_order_children', {
          p_order_id: ORDER,
          p_items: [] as unknown as Json,
          p_returns: [] as unknown as Json,
          p_adjustments: [] as unknown as Json,
          p_payments: [
            { uid: 'p1', amount: 3000, method: 'เงินสด', date: '2026-09-01', installmentUid: 'i1' },
          ] as unknown as Json,
          p_saved_on: '2026-09-01',
        })
      ).error,
    );
    const { data } = await admin
      .from('order_payments')
      .select('uid, installment_uid')
      .eq('order_id', ORDER);
    expect(data).toEqual([{ uid: 'p1', installment_uid: 'i1' }]);
  });

  it('ไม่ได้ระบุงวด เก็บเป็นค่าว่าง ไม่ใช่ null', async () => {
    assertNoError(
      'save children',
      (
        await user.rpc('save_order_children', {
          p_order_id: ORDER,
          p_items: [] as unknown as Json,
          p_returns: [] as unknown as Json,
          p_adjustments: [] as unknown as Json,
          p_payments: [
            { uid: 'p2', amount: 500, method: 'เงินสด', date: '2026-09-01' },
          ] as unknown as Json,
          p_saved_on: '2026-09-01',
        })
      ).error,
    );
    const { data } = await admin
      .from('order_payments')
      .select('installment_uid')
      .eq('order_id', ORDER)
      .single();
    expect(data?.installment_uid).toBe('');
  });
});
