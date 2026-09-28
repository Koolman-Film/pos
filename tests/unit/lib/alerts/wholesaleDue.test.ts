import { describe, it, expect } from 'vitest';

import { isDueSoon, isOverdue, type BillOrder } from '@/lib/alerts/wholesale';
import { PAYMENT_RECEIVED } from '@/lib/domain/orders';

/**
 * เลยกำหนดชำระ / ใกล้ถึงกำหนด เมื่อ PO แบ่งเป็นงวด (migration 0078).
 *
 * กระดิ่งเตือนเดิมเทียบยอดค้าง "ทั้งก้อน" กับกำหนดชำระ "วันเดียว" จึงเตือนได้
 * แบบทั้งใบหรือไม่เตือนเลย. PO ที่มัดจำ 30% วันเปิดงาน และที่เหลืออีก 30 วัน
 * ค้างงวดแรกมาสองสัปดาห์แล้วก็ยังเงียบสนิท เพราะทั้งใบยังไม่ถึงกำหนด
 *
 * PO ที่ไม่ได้แบ่งงวด — ซึ่งคือทุกใบก่อนหน้านี้ — ต้องได้คำตอบเดิมทุกประการ
 */

const bill = (over: Partial<BillOrder> = {}): BillOrder => ({
  status: 'จัดส่งแล้ว',
  items: [{ name: 'ฟิล์ม', qty: 10, requestedPrice: 1000 }],
  returns: [],
  adjustments: [],
  payments: [],
  ...over,
});

const schedule = [
  { uid: 'i1', seq: 1, dueAt: '2026-09-01', amount: 3000 },
  { uid: 'i2', seq: 2, dueAt: '2026-10-01', amount: 7000 },
];

describe('isOverdue — มีตารางงวด', () => {
  it('งวดแรกเลยกำหนด ถือว่าเลยกำหนดชำระแล้ว แม้ทั้งใบยังไม่ถึง', () => {
    const o = bill({ installments: schedule, dueAt: '2026-10-01' });
    expect(isOverdue(o, '2026-09-15')).toBe(true);
  });

  it('งวดแรกเก็บครบแล้ว ยังไม่เลยกำหนด', () => {
    const o = bill({
      installments: schedule,
      dueAt: '2026-10-01',
      payments: [{ amount: 3000, status: PAYMENT_RECEIVED, installmentUid: 'i1' }],
    });
    expect(isOverdue(o, '2026-09-15')).toBe(false);
  });

  it('เงินที่รับมาแล้วแต่ลืมจิ้มงวด ก็ยังนับให้งวดที่ค้างเก่าสุด', () => {
    // ไม่อย่างนั้นระบบจะทวงงวดที่เก็บเงินไปแล้ว ซึ่งลูกค้าเป็นคนรับกรรม
    const o = bill({
      installments: schedule,
      dueAt: '2026-10-01',
      payments: [{ amount: 3000, status: PAYMENT_RECEIVED }],
    });
    expect(isOverdue(o, '2026-09-15')).toBe(false);
  });

  it('PO ที่ปิดแล้ว ไม่ทวง', () => {
    const o = bill({ status: 'ปิดงานแล้ว', installments: schedule });
    expect(isOverdue(o, '2026-09-15')).toBe(false);
  });
});

describe('isDueSoon — มีตารางงวด', () => {
  it('งวดถัดไปจะถึงกำหนดใน 3 วัน', () => {
    const o = bill({ installments: schedule, dueAt: '2026-10-01' });
    expect(isDueSoon(o, '2026-09-29')).toBe(true);
  });

  it('ยังอีกไกล ไม่เตือน', () => {
    const o = bill({ installments: schedule, dueAt: '2026-10-01' });
    expect(isDueSoon(o, '2026-09-20')).toBe(false);
  });

  it('งวดที่เก็บครบแล้ว ไม่นับว่าใกล้ถึงกำหนด', () => {
    const o = bill({
      installments: [{ uid: 'i2', dueAt: '2026-10-01', amount: 7000 }],
      dueAt: '2026-10-01',
      payments: [{ amount: 7000, status: PAYMENT_RECEIVED, installmentUid: 'i2' }],
    });
    expect(isDueSoon(o, '2026-09-29')).toBe(false);
  });
});

describe('PO ที่ไม่ได้แบ่งงวด ยังใช้กติกาเดิม', () => {
  it('เลยกำหนดทั้งใบ และยังเก็บไม่ครบ', () => {
    const o = bill({ dueAt: '2026-09-01' });
    expect(isOverdue(o, '2026-09-15')).toBe(true);
  });

  it('เก็บครบแล้ว ไม่ทวง', () => {
    const o = bill({
      dueAt: '2026-09-01',
      payments: [{ amount: 10000, status: PAYMENT_RECEIVED }],
    });
    expect(isOverdue(o, '2026-09-15')).toBe(false);
  });

  it('ไม่ได้ตกลงวันไว้เลย ไม่มีอะไรให้เลยกำหนด', () => {
    expect(isOverdue(bill({ dueAt: '' }), '2026-09-15')).toBe(false);
    expect(isDueSoon(bill({ dueAt: '' }), '2026-09-15')).toBe(false);
  });

  it('ตารางงวดว่าง ไม่ถูกตีความว่า "ไม่ค้างอะไรเลย"', () => {
    // ถ้าเช็คแค่ว่า field มีอยู่ไหม PO ที่ลบงวดทิ้งหมดจะเงียบสนิททั้งที่ค้างจริง
    const o = bill({ installments: [], dueAt: '2026-09-01' });
    expect(isOverdue(o, '2026-09-15')).toBe(true);
  });
});
