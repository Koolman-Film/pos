import { describe, expect, it } from 'vitest';

import {
  branchShare,
  finnixDue,
  finnixShare,
  isSplit,
  itemTotal,
  ticketFinnixTotal,
} from '@/lib/domain/finnixShare';

describe('finnixShare', () => {
  it('ไม่ระบุ = ของสาขาทั้งบรรทัด', () => {
    expect(finnixShare({ soldPrice: 4500 })).toBe(0);
    expect(branchShare({ soldPrice: 4500 })).toBe(4500);
    expect(isSplit({ soldPrice: 4500 })).toBe(false);
  });

  it('แบ่งกันได้ — 1,500 จาก 4,500 เป็นของ Finnix', () => {
    const i = { soldPrice: 4500, finnixAmount: 1500 };
    expect(finnixShare(i)).toBe(1500);
    expect(branchShare(i)).toBe(3000);
    expect(isSplit(i)).toBe(true);
  });

  it('เต็มบรรทัด ไม่นับว่าแบ่ง', () => {
    const i = { soldPrice: 2200, finnixAmount: 2200 };
    expect(branchShare(i)).toBe(0);
    expect(isSplit(i)).toBe(false);
  });

  it('คิดบนยอดหลังส่วนลด ไม่ใช่ราคาตั้ง', () => {
    // 1,000 ลด 400 = 600 สุทธิ
    const i = { soldPrice: 1000, discountType: 'amount' as const, discountValue: 400 };
    expect(itemTotal(i)).toBe(600);
    expect(branchShare({ ...i, finnixAmount: 200 })).toBe(400);
  });

  it('กรอกเกินยอดขาย ถูกหนีบ — รายได้สาขาติดลบไม่ได้', () => {
    /*
      ยอด Finnix ที่มากกว่าที่ขายได้ไม่ใช่ข้อมูล มันคือการพิมพ์ผิด ฐานข้อมูล
      หนีบไว้เหมือนกัน แต่หน้าจอต้องแสดงผลก่อนที่จะมีการบันทึก
    */
    const i = { soldPrice: 1000, finnixAmount: 9999 };
    expect(finnixShare(i)).toBe(1000);
    expect(branchShare(i)).toBe(0);
  });

  it('ติดลบถูกหนีบเป็นศูนย์', () => {
    expect(finnixShare({ soldPrice: 1000, finnixAmount: -50 })).toBe(0);
  });

  it('ข้อมูลเก่าที่ยังไม่มีตัวเลข อ่านจากธงเดิม', () => {
    // ใบงานที่บันทึกก่อน 0084 ต้องนับเหมือนเมื่อวานทุกบาท
    expect(finnixShare({ soldPrice: 3000, revenueKind: 'รับแทน' })).toBe(3000);
    expect(finnixShare({ soldPrice: 3000, revenueKind: 'รายได้' })).toBe(0);
  });

  it('รวมทั้งใบงาน', () => {
    expect(
      ticketFinnixTotal([
        { soldPrice: 4500, finnixAmount: 1500 },
        { soldPrice: 2200, finnixAmount: 2200 },
        { soldPrice: 1000 },
      ]),
    ).toBe(3700);
  });
});

describe('finnixDue', () => {
  it('ขายเป็นของ Finnix 5,000 เข้าบัญชีแล้ว 2,000 เหลือคืน 3,000', () => {
    expect(finnixDue(5000, 2000)).toBe(3000);
  });

  it('เข้าครบแล้วเหลือศูนย์', () => {
    expect(finnixDue(5000, 5000)).toBe(0);
  });

  it('เข้ามากกว่าที่ขาย ติดลบ ไม่ถูกซ่อน', () => {
    // เข้าบัญชี Finnix มากกว่าที่ขายเป็นของเขา แปลว่ามีอะไรผิด
    expect(finnixDue(5000, 6000)).toBe(-1000);
  });
});
