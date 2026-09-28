import { describe, it, expect } from 'vitest';

import {
  dueSoonInstallments,
  overdueInstallments,
  scheduleStatus,
  scheduleTotal,
  type Installment,
} from '@/lib/domain/installments';
import { PAYMENT_BOUNCED, PAYMENT_RECEIVED, PAYMENT_REPORTED } from '@/lib/domain/orders';

/**
 * งวดชำระของ PO ขายส่ง (migration 0078).
 *
 * มัดจำ 30% วันเปิด PO ที่เหลืออีก 30 วัน — สองงวดนี้มีชะตากรรมคนละอย่าง และ
 * ระบบเดิมที่มีกำหนดชำระวันเดียวต่อใบ พูดเรื่องนี้ไม่ได้เลย
 */

const schedule: Installment[] = [
  { uid: 'i1', seq: 1, dueAt: '2026-09-01', amount: 3000 },
  { uid: 'i2', seq: 2, dueAt: '2026-10-01', amount: 7000 },
];

const paid = (amount: number, over: Record<string, unknown> = {}) => ({
  amount,
  status: PAYMENT_RECEIVED,
  ...over,
});

describe('scheduleStatus', () => {
  it('เงินที่จิ้มงวดไว้ ลงงวดนั้น', () => {
    const s = scheduleStatus(schedule, [paid(3000, { installmentUid: 'i1' })]);
    expect(s[0]).toMatchObject({ uid: 'i1', paid: 3000, outstanding: 0 });
    expect(s[1]).toMatchObject({ uid: 'i2', paid: 0, outstanding: 7000 });
  });

  it('เงินที่ยังไม่ได้ระบุงวด ลงงวดที่เก่าที่สุดที่ยังค้าง', () => {
    // ถ้าปล่อยค้างไว้ ระบบจะทวงงวดที่เก็บเงินไปแล้ว — ลูกค้าเป็นคนรับกรรม
    const s = scheduleStatus(schedule, [paid(3000)]);
    expect(s[0]).toMatchObject({ paid: 3000, outstanding: 0 });
    expect(s[1]).toMatchObject({ paid: 0, outstanding: 7000 });
  });

  it('จ่ายเกินงวดที่จิ้มไว้ ส่วนเกินไหลไปงวดถัดไป ไม่ใช่หายไป', () => {
    const s = scheduleStatus(schedule, [paid(5000, { installmentUid: 'i1' })]);
    expect(s[0]).toMatchObject({ paid: 3000, outstanding: 0 });
    expect(s[1]).toMatchObject({ paid: 2000, outstanding: 5000 });
  });

  it('จิ้มงวดหลังไว้ งวดแรกยังค้างอยู่ ไม่ถูกยกให้ผ่านไปด้วย', () => {
    // ลูกค้าจ่ายงวดที่ 2 มาก่อนได้ และงวดที่ 1 ก็ยังค้างจริง ๆ
    const s = scheduleStatus(schedule, [paid(7000, { installmentUid: 'i2' })]);
    expect(s[0]).toMatchObject({ outstanding: 3000 });
    expect(s[1]).toMatchObject({ outstanding: 0 });
  });

  it('เช็คที่แค่แจ้งไว้ และเช็คเด้ง ไม่ใช่เงิน', () => {
    const s = scheduleStatus(schedule, [
      paid(3000, { status: PAYMENT_REPORTED }),
      paid(3000, { status: PAYMENT_BOUNCED }),
    ]);
    expect(s[0]).toMatchObject({ paid: 0, outstanding: 3000 });
  });

  it('งวดที่ถูกลบไปแล้วแต่การรับเงินยังจิ้มค้างไว้ เงินไม่หาย', () => {
    // uid ที่ไม่มีในตารางแล้ว ถูกปฏิบัติเหมือนเงินที่ไม่ได้ระบุงวด
    const s = scheduleStatus(schedule, [paid(3000, { installmentUid: 'ไม่มีแล้ว' })]);
    expect(s[0]).toMatchObject({ paid: 3000 });
  });

  it('เรียงตามกำหนดชำระ ไม่ใช่ตามลำดับที่ส่งมา', () => {
    const jumbled: Installment[] = [
      { uid: 'b', dueAt: '2026-10-01', amount: 7000, seq: 2 },
      { uid: 'a', dueAt: '2026-09-01', amount: 3000, seq: 1 },
    ];
    expect(scheduleStatus(jumbled, []).map((i) => i.uid)).toEqual(['a', 'b']);
  });
});

describe('overdueInstallments / dueSoonInstallments', () => {
  it('งวดแรกเลยกำหนด ทั้งที่งวดสองยังไม่ถึง', () => {
    // นี่คือประโยคที่ระบบเดิมพูดไม่ได้เลย
    const over = overdueInstallments(schedule, [], '2026-09-15');
    expect(over.map((i) => i.uid)).toEqual(['i1']);
    expect(over[0].outstanding).toBe(3000);
  });

  it('งวดที่เก็บครบแล้ว ไม่ทวง', () => {
    expect(
      overdueInstallments(schedule, [paid(3000, { installmentUid: 'i1' })], '2026-09-15'),
    ).toEqual([]);
  });

  it('ใกล้ถึงกำหนด นับเฉพาะงวดที่ยังไม่ถึงและยังค้าง', () => {
    const soon = dueSoonInstallments(schedule, [], '2026-09-29', '2026-10-02');
    expect(soon.map((i) => i.uid)).toEqual(['i2']);
    // งวดที่เลยกำหนดไปแล้ว ไม่ใช่ "ใกล้ถึง" — มันคือคนละคำถาม
    expect(soon.some((i) => i.uid === 'i1')).toBe(false);
  });
});

describe('scheduleTotal', () => {
  it('รวมทุกงวด เพื่อเอาไปเทียบกับยอด PO', () => {
    expect(scheduleTotal(schedule)).toBe(10000);
    expect(scheduleTotal([])).toBe(0);
  });
});
