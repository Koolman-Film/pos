import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  ค่าใช้จ่ายหนึ่งแถวขยับ = ยอดคงเหลือทุกหน้าเปลี่ยน (ร้านเจอ 31 ต.ค. 2569).

  เดิมการเพิ่ม/แก้/ลบค่าใช้จ่าย ล้างแคชแค่ `/accounting` หน้าค่าใช้จ่ายจึง
  อัปเดตทันที ส่วนแดชบอร์ดกับการจัดการเงิน/บัญชี ยังเสิร์ฟหน้าที่เรนเดอร์ไว้ก่อน
  หน้านั้น — ร้านเปิดสองหน้าเทียบกันแล้วเห็นยอดเงินสดย่อยของบัญชีเดียวกันเป็น
  −94.74 กับ 5.26 ต่างกัน 100 พอดี เท่ากับรายการที่เพิ่งลงไป

  อาการนี้อ่านเหมือนระบบคำนวณผิด ทั้งที่ตัวคำนวณไม่ได้แตะเลย มันแค่ยังไม่ได้
  ถูกเรียกใหม่ — เทสต์ชุดนี้จึงปักที่ "ล้างหน้าไหนบ้าง" ไม่ใช่ที่ตัวเลข
*/

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/auth/session', () => ({
  getSessionContext: async () => ({
    userId: 'u-acc',
    name: 'บัญชี',
    accessibleShopIds: ['cm'],
    canDo: () => true,
  }),
}));

/** พอให้ action เดินจนจบ — เรื่องที่วัดคือการล้างแคช ไม่ใช่การเขียนฐานข้อมูล */
vi.mock('@/lib/supabase/server', () => {
  // ทุกเมธอดคืนตัวเองและ await ได้ — ลูกโซ่แบบไหนก็เดินจนจบ
  const api = {
    select: () => api,
    eq: () => api,
    in: () => api,
    insert: () => api,
    update: () => api,
    delete: () => api,
    maybeSingle: async () => ({ data: null }),
    then: (resolve: (v: { data: never[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  return {
    createClient: async () => ({
      from: () => api,
      rpc: async () => ({ error: null }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    }),
  };
});

import { addExpense, updateExpense, deleteExpense } from '@/app/(app)/accounting/actions';

/** ทุกหน้าที่อ่านกระแสเงินชุดเดียวกัน */
const MONEY_SCREENS = ['/accounting', '/money', '/dashboard', '/daily-report'];

beforeEach(() => revalidatePath.mockClear());

const pathsHit = () => revalidatePath.mock.calls.map((c) => c[0]);

describe('ค่าใช้จ่ายขยับ แล้วหน้าไหนถูกล้างแคชบ้าง', () => {
  it('เพิ่มรายการ ล้างทุกหน้าที่แสดงยอดคงเหลือ', async () => {
    await addExpense({
      shop: 'cm',
      source: 'เงินสดย่อย',
      status: 'จ่ายแล้ว',
      date: '2026-10-31',
      lines: [{ desc: 'พี่ซื้อน้ำแข็ง', category: 'สวัสดิการพนักงาน', amount: 100 }],
    });
    for (const p of MONEY_SCREENS) expect(pathsHit()).toContain(p);
  });

  it('แก้รายการ ล้างเหมือนกัน — แก้ยอดก็คือย้ายเงิน', async () => {
    await updateExpense({
      id: 1,
      shop: 'cm',
      desc: 'พี่ซื้อน้ำแข็ง',
      category: 'สวัสดิการพนักงาน',
      source: 'เงินสดย่อย',
      amount: 120,
      status: 'จ่ายแล้ว',
      paidAt: '2026-10-31',
      dueAt: null,
    });
    for (const p of MONEY_SCREENS) expect(pathsHit()).toContain(p);
  });

  it('ลบรายการ ล้างเหมือนกัน — เงินกลับเข้าลิ้นชัก', async () => {
    await deleteExpense(1);
    for (const p of MONEY_SCREENS) expect(pathsHit()).toContain(p);
  });
});
