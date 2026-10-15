import { describe, expect, it } from 'vitest';

import { pickupBeforeDropOff } from '@/lib/domain/ticketDates';

const at = (iso: string) => new Date(`${iso}+07:00`);

describe('pickupBeforeDropOff', () => {
  it('ส่งหลังรับ = ถูกต้อง', () => {
    expect(pickupBeforeDropOff(at('2026-10-15T09:00'), at('2026-10-17T16:00'))).toBe(false);
  });

  it('ส่งก่อนรับ = ผิด', () => {
    // กรณีที่ร้านเจอ: รับ 15 ต.ค. แต่ส่ง 17 ก.ย.
    expect(pickupBeforeDropOff(at('2026-10-15T09:00'), at('2026-09-17T16:00'))).toBe(true);
  });

  it('วันเดียวกัน เวลาส่งหลังเวลารับ = ถูกต้อง', () => {
    expect(pickupBeforeDropOff(at('2026-10-15T09:00'), at('2026-10-15T16:00'))).toBe(false);
  });

  it('วันเดียวกัน เวลาส่งก่อนเวลารับ = ผิด', () => {
    expect(pickupBeforeDropOff(at('2026-10-15T16:00'), at('2026-10-15T09:00'))).toBe(true);
  });

  it('เวลาเท่ากันเป๊ะ = ผิด', () => {
    // "เวลาส่งงานต้องหลังจากเวลารับงานเท่านั้น" — เท่ากันไม่ใช่หลัง
    expect(pickupBeforeDropOff(at('2026-10-15T09:00'), at('2026-10-15T09:00'))).toBe(true);
  });

  it('ยังกรอกไม่ครบ ยังไม่เตือน', () => {
    // ใบที่กรอกค้างอยู่ไม่ควรขึ้นคำเตือนที่คนยังตอบไม่ได้
    expect(pickupBeforeDropOff(null, at('2026-10-15T09:00'))).toBe(false);
    expect(pickupBeforeDropOff(at('2026-10-15T09:00'), null)).toBe(false);
    expect(pickupBeforeDropOff(null, null)).toBe(false);
  });

  it('วันที่ที่อ่านไม่ออก ไม่ทำให้ฟอร์มล็อกตาย', () => {
    expect(pickupBeforeDropOff(new Date('ไม่ใช่วันที่'), at('2026-10-15T09:00'))).toBe(false);
  });
});
