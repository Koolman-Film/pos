// tests/rls/ticket_tech_after_lock.test.ts
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
 * ใบงานที่ปิดแล้ว: ช่างยังกรอก ข้อมูลของช่าง ได้ แต่แตะเงินไม่ได้ (migration 0066).
 *
 * The caller is a `sales` user — someone WITHOUT `list.unlock`, which is the
 * only interesting case: an admin can already edit anything. What this proves
 * is the shape of the hole the migration opens. It must be exactly big enough
 * for the technician's fields and no bigger, because `tickets_rw` lets any
 * member of the branch UPDATE the row, so a signed-in token can PATCH straight
 * through PostgREST without ever loading the form.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'tech0066@test.local';
const TICKET = 'JT-CM-T0066';

let user: PosClient;
let itemIds: number[] = [];

const stored = async () => {
  const { data } = await admin
    .from('tickets')
    .select('customer_name, status, locked, tech_by_category, extras')
    .eq('id', TICKET)
    .single();
  return data;
};

const storedQty = async () => {
  const { data } = await admin
    .from('ticket_items')
    .select('actual_qty')
    .eq('ticket_id', TICKET)
    .order('id');
  return (data ?? []).map((r) => r.actual_qty);
};

/** Put the ticket back to closed-and-empty between tests. */
const reset = async () => {
  await admin
    .from('tickets')
    .update({
      locked: true,
      customer_name: 'ทดสอบช่าง',
      status: 'ส่งมอบแล้ว',
      tech_by_category: {},
      extras: {},
    })
    .eq('id', TICKET);
  await admin.from('ticket_items').update({ actual_qty: {} }).eq('ticket_id', TICKET);
};

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

  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบช่าง',
        plate: 'ทดสอบ 0066',
        status: 'ส่งมอบแล้ว',
        drop_off_date: '2026-09-01T09:00:00+07:00',
        pickup_date: '2026-09-01T17:00:00+07:00',
        locked: true,
      })
    ).error,
  );
  const { data, error } = await admin
    .from('ticket_items')
    .insert([
      { ticket_id: TICKET, category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม A', sold_price: 5000 },
      { ticket_id: TICKET, category: 'เครื่องเสียง', sold: 'ลำโพง B', sold_price: 3000 },
    ])
    .select('id');
  assertNoError('insert items', error);
  itemIds = (data ?? []).map((r) => r.id).sort((a, b) => a - b);
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('ข้อมูลของช่างบนใบงานที่ล็อกแล้ว', () => {
  it('ช่างกรอกจำนวนที่ใช้จริงย้อนหลังได้ แม้ใบงานปิดและชำระครบแล้ว', async () => {
    await reset();
    const { error } = await user.rpc('save_ticket_tech', {
      p_ticket_id: TICKET,
      p_extras: { __meta: { qcBy: 'ช่างเอ' } } as Json,
      p_tech_by_category: { ฟิล์มกรองแสง: ['ช่างเอ'] } as Json,
      p_actual_qty: [{ 'ฟิล์ม A': 2 }, { 'ลำโพง B': 1 }] as Json,
    });
    expect(error).toBeNull();
    expect(await storedQty()).toEqual([{ 'ฟิล์ม A': 2 }, { 'ลำโพง B': 1 }]);
    expect(await stored()).toMatchObject({
      tech_by_category: { ฟิล์มกรองแสง: ['ช่างเอ'] },
      extras: { __meta: { qcBy: 'ช่างเอ' } },
      // Still closed. Recording materials does not reopen the job.
      locked: true,
    });
  });

  it('กรอกทีละครั้งได้ — ช่างคนที่สองไม่ถูกปิดกั้นเพราะคนแรกบันทึกไปแล้ว', async () => {
    await reset();
    await user.rpc('save_ticket_tech', {
      p_ticket_id: TICKET,
      p_extras: {} as Json,
      p_tech_by_category: {} as Json,
      p_actual_qty: [{ 'ฟิล์ม A': 2 }, {}] as Json,
    });
    const { error } = await user.rpc('save_ticket_tech', {
      p_ticket_id: TICKET,
      p_extras: {} as Json,
      p_tech_by_category: {} as Json,
      p_actual_qty: [{ 'ฟิล์ม A': 2 }, { 'ลำโพง B': 1 }] as Json,
    });
    expect(error).toBeNull();
    expect(await storedQty()).toEqual([{ 'ฟิล์ม A': 2 }, { 'ลำโพง B': 1 }]);
  });

  it('รายการสินค้าเปลี่ยนไปแล้ว ถูกปฏิเสธ ไม่ใช่เขียนผิดแถว', async () => {
    await reset();
    const { error } = await user.rpc('save_ticket_tech', {
      p_ticket_id: TICKET,
      p_extras: {} as Json,
      p_tech_by_category: {} as Json,
      p_actual_qty: [{ 'ฟิล์ม A': 2 }] as Json,
    });
    expect(error?.message ?? '').toContain('รายการสินค้าในใบงานเปลี่ยนไปแล้ว');
    expect(await storedQty()).toEqual([{}, {}]);
  });

  it('ยิงตรงเข้าฐานข้อมูล แก้ราคา/สถานะ/ล็อก ยังไม่ได้เหมือนเดิม', async () => {
    await reset();

    // The money the lock exists for. Before 0066 this went straight through:
    // the item rows were held by `save_ticket_children` alone, and a direct
    // PostgREST call never touches it.
    const price = await user.from('ticket_items').update({ sold_price: 1 }).eq('id', itemIds[0]);
    expect(price.error?.message ?? '').toContain('แก้ไขรายการสินค้าไม่ได้');
    const { data: after } = await admin
      .from('ticket_items')
      .select('sold_price')
      .eq('id', itemIds[0])
      .single();
    expect(Number(after?.sold_price)).toBe(5000);

    for (const patch of [
      { customer_name: 'ไม่ควรผ่าน' },
      { status: 'จองแล้ว' },
      { locked: false },
    ]) {
      const { error } = await user.from('tickets').update(patch).eq('id', TICKET);
      expect(error?.message ?? '').toContain('ปิดงานแล้ว');
    }

    expect(await stored()).toMatchObject({
      customer_name: 'ทดสอบช่าง',
      status: 'ส่งมอบแล้ว',
      locked: true,
    });
  });

  it('เขียนทับทั้งใบงานผ่าน save_ticket_children ยังถูกปฏิเสธ', async () => {
    // The wide path stays shut: it replaces items and payments wholesale, which
    // is exactly what a closed ticket must not accept.
    await reset();
    const { error } = await user.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [] as Json,
      p_payments: [] as Json,
    });
    expect(error?.message ?? '').toContain('ปิดงานแล้ว');
    expect(await storedQty()).toHaveLength(2);
  });
});
