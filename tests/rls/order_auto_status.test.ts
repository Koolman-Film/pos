// tests/rls/order_auto_status.test.ts
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
 * สถานะ PO เปลี่ยนเองตามกิจกรรม (migration 0081).
 *
 * สถานะเคยเป็นช่องที่คนเลือก ซึ่งบอกได้แค่ว่าใครคนหนึ่งเคยคิดว่างานอยู่ตรงไหน
 * ไม่ใช่ว่างานอยู่ตรงไหนจริง ๆ ลำดับที่ร้านกำหนด (2 ต.ค. 2569):
 *
 *   รออนุมัติราคา → รอจัดส่ง → [ส่งของ] → ค้างชำระ → เสร็จสิ้น
 *   โดยมี จัดส่งแล้วบางส่วน เมื่อของออกไม่ครบแต่เงินครบแล้ว
 *
 * ทุกเส้นทางที่เขียนข้อมูลลูกของ PO ต้องให้คำตอบเดียวกัน เพราะสถานะที่ถูกเฉพาะ
 * บางเส้นทางคือสถานะที่เชื่อไม่ได้ — ด่านจึงอยู่ที่ทริกเกอร์ของตารางลูก ไม่ใช่
 * ที่ชั้นแอป และนี่คือที่ที่พิสูจน์มัน
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'autostatus@test.local';
const ORDER = 'WS-TEST-AUTO';

let user: PosClient;

const statusOf = async () => {
  const { data } = await admin.from('orders').select('status').eq('id', ORDER).single();
  return data?.status ?? null;
};

const deliver = (uid: string, lines: [string, number][], date = '2026-10-02') =>
  user.rpc('save_order_delivery', {
    p_order_id: ORDER,
    p_delivery: {
      uid,
      date,
      note: 'นิ่มซี่เส็ง',
      attachments: ['cm/WS-TEST-AUTO/slip.jpg'],
      items: lines.map(([uidOf, qty]) => ({ uid: uidOf, name: uidOf, qty })),
    } as unknown as Json,
  });

/** ทุกเทสต์เริ่มจาก PO ใบใหม่ จึงเป็น insert ธรรมดา — ดัชนี uid เป็นแบบ partial
 *  ซึ่ง on conflict จับไม่ได้ (0049). */
const pay = (amount: number, uid = 'p1') =>
  admin.from('order_payments').insert({
    order_id: ORDER,
    uid,
    amount,
    method: 'เงินสด',
    paid_at: '2026-10-02',
    status: 'รับเงินแล้ว',
  });

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
        .insert({ id: ORDER, shop_id: 'cm', customer_id: null, status: 'รออนุมัติราคา' })
    ).error,
  );
});

/** สินค้าสองบรรทัด: ราคาเต็ม 200×100 + 10×500 = 25,000. */
const seedItems = async (discounted = false) =>
  assertNoError(
    'insert items',
    (
      await admin.from('order_items').insert([
        {
          order_id: ORDER,
          name: 'u1',
          qty: 200,
          list_price: 100,
          requested_price: discounted ? 90 : 100,
          uid: 'u1',
        },
        { order_id: ORDER, name: 'u2', qty: 10, list_price: 500, requested_price: 500, uid: 'u2' },
      ])
    ).error,
  );

describe('สถานะเปลี่ยนเองตามกิจกรรม', () => {
  it('เปิด PO ที่มีส่วนลด ค้างอยู่ที่รออนุมัติราคา', async () => {
    await seedItems(true);
    expect(await statusOf()).toBe('รออนุมัติราคา');
  });

  it('เปิด PO ราคาเต็ม ไม่ต้องรอใคร ไปรอจัดส่งเลย', async () => {
    // ไม่มีอะไรให้ผู้บริหารตัดสิน การให้มันนั่งรออนุมัติคือการสร้างคิวปลอม
    await seedItems(false);
    expect(await statusOf()).toBe('รอจัดส่ง');
  });

  it('ส่งของแล้วยังไม่ได้เงิน เป็นค้างชำระ', async () => {
    await seedItems(false);
    assertNoError('deliver', (await deliver('d1', [['u1', 80]])).error);
    expect(await statusOf()).toBe('ค้างชำระ');
  });

  it('เงินครบแต่ของยังไม่ครบ เป็นจัดส่งแล้วบางส่วน', async () => {
    await seedItems(false);
    await deliver('d1', [['u1', 80]]);
    assertNoError('pay', (await pay(25000)).error);
    expect(await statusOf()).toBe('จัดส่งแล้วบางส่วน');
  });

  it('ของครบ เงินครบ ปิดงาน', async () => {
    await seedItems(false);
    await deliver('d1', [
      ['u1', 200],
      ['u2', 10],
    ]);
    await pay(25000);
    // ชื่อสถานะปิดงานร้านตั้งเอง (seed: ปิดงานแล้ว, production: เสร็จสิ้น)
    expect(['ปิดงานแล้ว', 'เสร็จสิ้น']).toContain(await statusOf());
  });

  it('เช็คเด้ง เงินหายไป สถานะถอยกลับมาค้างชำระ', async () => {
    // สถานะที่เดินหน้าอย่างเดียว คือสถานะที่โกหกทันทีที่เงินหาย
    await seedItems(false);
    await deliver('d1', [
      ['u1', 200],
      ['u2', 10],
    ]);
    await pay(25000);
    assertNoError(
      'bounce',
      (await admin.from('order_payments').update({ status: 'เด้ง' }).eq('order_id', ORDER)).error,
    );
    expect(await statusOf()).toBe('ค้างชำระ');
  });

  it('ลบรอบส่งของ สถานะกลับไปขั้นก่อนหน้า', async () => {
    await seedItems(false);
    await deliver('d1', [['u1', 80]]);
    const { data: rows } = await admin
      .from('order_deliveries')
      .select('id')
      .eq('order_id', ORDER)
      .limit(1);
    assertNoError(
      'delete round',
      (await user.rpc('delete_order_delivery', { p_delivery_id: rows![0].id })).error,
    );
    expect(await statusOf()).toBe('รอจัดส่ง');
  });

  it('ตัดหนี้สูญแล้ว กิจกรรมถัดไปไม่เขียนทับ', async () => {
    // การตัดสินใจของคน ไม่ใช่ผลของกิจกรรม
    await seedItems(false);
    await deliver('d1', [['u1', 80]]);
    assertNoError(
      'write off',
      (await admin.from('orders').update({ status: 'ตัดหนี้สูญ' }).eq('id', ORDER)).error,
    );
    await pay(5000);
    expect(await statusOf()).toBe('ตัดหนี้สูญ');
  });

  it('ใบที่ยังไม่มีรายการสินค้า ไม่ถูกเดาสถานะให้', async () => {
    // ใบเปล่ายังไม่ใช่งาน การเดาจากความว่างคือการเดา
    expect(await statusOf()).toBe('รออนุมัติราคา');
  });

  it('คนที่ไม่มีสิทธิ์เปลี่ยนสถานะ ยังบันทึกการรับเงินได้ตามปกติ', async () => {
    /*
      สถานะที่ขยับตามเงินเป็นผลข้างเคียงของการบันทึก ไม่ใช่สิ่งที่คนบันทึกเลือก
      ถ้าด่านสิทธิ์มาขวาง คนรับเงินจะบันทึกเงินไม่ได้ทั้งที่เขามีสิทธิ์ทำสิ่งนั้น
    */
    await seedItems(false);
    await deliver('d1', [
      ['u1', 200],
      ['u2', 10],
    ]);
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
      const { error } = await user.rpc('save_order_children', {
        p_order_id: ORDER,
        p_items: [
          { uid: 'u1', name: 'u1', qty: 200, listPrice: 100, requestedPrice: 100 },
          { uid: 'u2', name: 'u2', qty: 10, listPrice: 500, requestedPrice: 500 },
        ] as unknown as Json,
        p_returns: [] as unknown as Json,
        p_adjustments: [] as unknown as Json,
        p_payments: [
          { uid: 'p9', amount: 25000, method: 'เงินสด', date: '2026-10-02' },
        ] as unknown as Json,
        p_saved_on: '2026-10-02',
      });
      expect(error).toBeNull();
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
