import { describe, it, expect } from 'vitest';

import { THAI_BANKS, bankOptions } from '@/lib/domain/banks';

/**
 * รายชื่อธนาคารของช่องรับเช็ค (ร้านขอ 6 พ.ย. 2569).
 *
 * สิ่งที่ต้องไม่พังคือข้อเดียว: ชื่อที่พิมพ์ไว้ตอนยังเป็นช่องพิมพ์เปล่า ต้องไม่
 * หายไปเมื่อมีคนเปิดใบเก่ามาแก้เรื่องอื่น
 */
describe('bankOptions', () => {
  it('ยังไม่ได้เลือกธนาคาร ก็ได้รายการมาตรฐาน', () => {
    expect(bankOptions('')).toEqual(THAI_BANKS);
    expect(bankOptions(null)).toEqual(THAI_BANKS);
    expect(bankOptions(undefined)).toEqual(THAI_BANKS);
  });

  it('ธนาคารที่อยู่ในรายการอยู่แล้ว ไม่ถูกใส่ซ้ำ', () => {
    const out = bankOptions('กสิกรไทย');
    expect(out).toEqual(THAI_BANKS);
    expect(out.filter((b) => b === 'กสิกรไทย')).toHaveLength(1);
  });

  it('ชื่อที่พิมพ์ไว้เองก่อนมี dropdown ยังเลือกได้ และอยู่บนสุด', () => {
    // ถ้ามันหลุดจากรายการ การเปิดใบเก่ามาแก้ยอดเงิน จะล้างธนาคารของเช็คทิ้งไป
    // ด้วยโดยไม่มีใครตั้งใจ — หลักฐานของเช็คใบนั้นหายไปเงียบ ๆ
    const out = bankOptions('KBANK');
    expect(out[0]).toBe('KBANK');
    expect(out).toHaveLength(THAI_BANKS.length + 1);
  });

  it('ช่องว่างหน้าหลังไม่นับเป็นธนาคาร', () => {
    expect(bankOptions('   ')).toEqual(THAI_BANKS);
  });
});

describe('THAI_BANKS', () => {
  it('ไม่มีชื่อซ้ำ', () => {
    expect(new Set(THAI_BANKS).size).toBe(THAI_BANKS.length);
  });

  it('ไม่มีคำว่า "ธนาคาร" นำหน้า — ไม่งั้นกดตัวอักษรแรกเพื่อกระโดดใน dropdown ไม่ได้', () => {
    // ทุกตัวเลือกขึ้นต้นเหมือนกัน = การพิมพ์ตัวแรกเลือกอะไรไม่ได้เลย ซึ่งเป็น
    // วิธีที่เร็วที่สุดในการหาจากรายการยี่สิบกว่าชื่อ
    expect(THAI_BANKS.filter((b) => b.startsWith('ธนาคาร'))).toEqual([]);
  });

  it('มีธนาคารใหญ่ที่ร้านรับเช็คบ่อยอยู่หกอันดับแรก', () => {
    expect(THAI_BANKS.slice(0, 6)).toContain('กสิกรไทย');
    expect(THAI_BANKS.slice(0, 6)).toContain('ไทยพาณิชย์');
    expect(THAI_BANKS.slice(0, 6)).toContain('กรุงเทพ');
  });
});
