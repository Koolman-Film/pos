import { describe, expect, it } from 'vitest';

import { datesBlockSave, pickupBeforeDropOff } from '@/lib/domain/ticketDates';

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

describe('datesBlockSave', () => {
  const stored = { dropOff: at('2026-10-17T10:00'), pickup: at('2026-10-17T10:00') };

  it('ใบใหม่ที่วันที่กลับหัว บันทึกไม่ได้', () => {
    expect(datesBlockSave(null, at('2026-10-17T10:00'), at('2026-10-16T10:00'))).toBe(true);
  });

  it('ใบเก่าที่วันที่ผิดมาแต่เดิม และไม่ได้แตะวันที่ บันทึกได้', () => {
    // ใบที่ผิดมาก่อนมีกติกา (0085) ต้องยังรับเงิน/แก้งานได้ ไม่ใช่ล็อกตาย (0086)
    expect(datesBlockSave(stored, at('2026-10-17T10:00'), at('2026-10-17T10:00'))).toBe(false);
  });

  it('แก้วันที่ใบเก่า แต่ยังกลับหัวอยู่ บันทึกไม่ได้', () => {
    expect(datesBlockSave(stored, at('2026-10-17T10:00'), at('2026-10-17T09:00'))).toBe(true);
    expect(datesBlockSave(stored, at('2026-10-18T10:00'), at('2026-10-17T10:00'))).toBe(true);
  });

  it('แก้วันที่ใบเก่าให้ถูก บันทึกได้', () => {
    expect(datesBlockSave(stored, at('2026-10-17T10:00'), at('2026-10-17T16:00'))).toBe(false);
  });

  it('วันที่ถูกอยู่แล้ว ไม่เคยติด', () => {
    expect(datesBlockSave(null, at('2026-10-15T09:00'), at('2026-10-17T16:00'))).toBe(false);
    expect(datesBlockSave(stored, at('2026-10-15T09:00'), at('2026-10-17T16:00'))).toBe(false);
  });

  it('ช่องที่เคยว่างแล้วกรอกให้กลับหัว นับว่าแก้ บันทึกไม่ได้', () => {
    expect(
      datesBlockSave(
        { dropOff: at('2026-10-17T10:00'), pickup: null },
        at('2026-10-17T10:00'),
        at('2026-10-16T10:00'),
      ),
    ).toBe(true);
  });
});
