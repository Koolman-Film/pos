import { describe, it, expect } from 'vitest';

import {
  DEFAULT_UNIT_LABEL,
  FILM_SUB_UNIT,
  hasUnitSize,
  roundTo,
  toSellingUnits,
  toSubUnits,
  unitLabelOf,
  unitSizeFromName,
  unitSizeOf,
} from '@/lib/domain/unitSize';

/** หมวดที่ร้านใช้จริง — ด่านที่ให้เลขท้ายชื่อถูกอ่านเป็นตารางฟุต. */
const FILM = 'ฟิล์มกรองแสง';

/**
 * ม้วนละกี่ตารางฟุต — การหารที่เคยอยู่ในหัวคนรับของคืน (ร้านถาม 7 พ.ย. 2569).
 */
describe('unitSizeOf — อะไรนับว่า "ไม่ได้ระบุ"', () => {
  it('0 กับ ไม่ได้ตั้ง คือเรื่องเดียวกัน', () => {
    // ทั้งสองแบบต้องนำไปสู่พฤติกรรมเดียวกัน คือถามเป็นสัดส่วนของหน่วยที่ขาย
    expect(unitSizeOf({ unitSize: 0 })).toBe(0);
    expect(unitSizeOf({})).toBe(0);
    expect(unitSizeOf(null)).toBe(0);
  });

  it('ค่าพังจากช่องกรอกที่ว่าง ก็คือไม่ได้ระบุ ไม่ใช่ NaN', () => {
    // ช่อง type=number ที่ว่างอยู่ ให้ '' ซึ่ง Number('') เป็น 0 แต่ 'abc' เป็น NaN
    expect(unitSizeOf({ unitSize: Number('abc') })).toBe(0);
    expect(unitSizeOf({ unitSize: Number.POSITIVE_INFINITY })).toBe(0);
  });

  it('ติดลบไม่นับ — มันจะกลับทิศการหาร', () => {
    expect(unitSizeOf({ unitSize: -500 })).toBe(0);
  });

  it('hasUnitSize ตอบคำถามเดียวที่ฝั่งหน้าจอควรถาม', () => {
    expect(hasUnitSize({ unitSize: 500 })).toBe(true);
    expect(hasUnitSize({ unitSize: 0 })).toBe(false);
  });
});

/**
 * ขนาดม้วนเขียนไว้ท้ายชื่อสินค้าอยู่แล้ว (ร้านชี้ให้ดู 7 พ.ย. 2569).
 *
 * `(ม้วน) ฟิล์ม super nano ceramic 40% (250)` = ฟิล์มม้วนนั้น 250 ตารางฟุต
 * ร้านเขียนแบบนี้ทุกตัวใน 78 รายการ ความรู้จึงไม่ได้หายไปไหน มันอยู่ในที่ที่
 * คนอ่านออกแต่ระบบอ่านไม่ออก
 */
describe('unitSizeFromName — อ่านขนาดม้วนจากชื่อสินค้า', () => {
  it('อ่านเลขในวงเล็บท้ายชื่อ ไม่ใช่เลขอื่นในชื่อ', () => {
    // `(ม้วน)` อยู่หน้า และ `40%` อยู่กลาง — ทั้งคู่ต้องไม่ถูกหยิบมา
    expect(unitSizeFromName('(ม้วน) ฟิล์ม super nano ceramic 40% (250)')).toBe(250);
    expect(unitSizeFromName('(ม้วน) ฟิล์ม super nano ceramic 40% (500)')).toBe(500);
  });

  it('ชื่อที่ไม่ได้บอกขนาด ก็คือไม่รู้', () => {
    expect(unitSizeFromName('ฟิล์ม 3M CRM (ม้วน)')).toBe(0);
    expect(unitSizeFromName('ฟิล์ม 3M CRM 60%')).toBe(0);
    expect(unitSizeFromName('')).toBe(0);
  });

  it('มีคอมมาคั่นหลักพัน ก็ยังเป็นตัวเลข', () => {
    expect(unitSizeFromName('ฟิล์มม้วนใหญ่ (1,000)')).toBe(1000);
  });
});

describe('unitSizeOf — ค่าที่กรอกไว้ กับ ชื่อสินค้า', () => {
  const film = (over = {}) => ({
    name: '(ม้วน) ฟิล์ม super nano ceramic 40% (250)',
    category: FILM,
    ...over,
  });

  it('ไม่ได้กรอกไว้ ก็ใช้ขนาดจากชื่อ — ไม่ต้องไล่กรอก 78 รายการ', () => {
    expect(unitSizeOf(film())).toBe(250);
    expect(unitLabelOf(film())).toBe(FILM_SUB_UNIT);
  });

  it('ค่าที่กรอกไว้ชนะชื่อเสมอ — ไม่งั้นการแก้จะไม่มีผล', () => {
    expect(unitSizeOf(film({ unitSize: 300 }))).toBe(300);
  });

  it('สินค้าหมวดอื่นที่ชื่อลงท้ายด้วยเลข ไม่ถูกอ่านเป็นตารางฟุต', () => {
    // "ลำโพงคู่ (2)" ที่กลายเป็นม้วนละ 2 ตร.ฟ. จะทำให้คืนลำโพงหนึ่งคู่
    // ถูกคิดเป็นคืน 0.5 ชิ้น
    expect(unitSizeOf({ name: 'ลำโพงคู่ JBL Stage (2)', category: 'เครื่องเสียง' })).toBe(0);
  });

  it('หมวดอื่นที่กรอกขนาดไว้เอง ยังใช้ได้ — ด่านกันแค่การเดาจากชื่อ', () => {
    expect(unitSizeOf({ name: 'สายไฟ (ม้วน)', category: 'เครื่องเสียง', unitSize: 100 })).toBe(100);
  });
});

describe('unitLabelOf — ชื่อหน่วยย่อย', () => {
  it('ใช้ชื่อที่ร้านตั้งไว้', () => {
    expect(unitLabelOf({ unitSize: 500, unitLabel: 'ตร.ฟ.' })).toBe('ตร.ฟ.');
  });

  it('ฟิล์มที่ไม่ได้ตั้งชื่อหน่วย คือตารางฟุต', () => {
    expect(unitLabelOf({ unitSize: 500, category: FILM })).toBe(FILM_SUB_UNIT);
  });

  it('หมวดอื่นที่ไม่ได้ตั้งชื่อ ก็ยังต้องอ่านได้ว่าช่องนั้นกรอกอะไร', () => {
    expect(unitLabelOf({ unitSize: 500 })).toBe(DEFAULT_UNIT_LABEL);
    expect(unitLabelOf({ unitSize: 500, unitLabel: '   ' })).toBe(DEFAULT_UNIT_LABEL);
  });
});

describe('การแปลงหน่วย', () => {
  it('คืน 300 ตร.ฟ. จากม้วนละ 500 คือ 0.6 ม้วน', () => {
    expect(toSellingUnits(300, 500)).toBeCloseTo(0.6, 10);
  });

  it('ตัวเลขเดียวกัน ม้วนละ 250 คือ 1.2 ม้วน — ต่างกันสองเท่า', () => {
    // นี่คือเหตุผลที่ขนาดม้วนต้องอยู่ในระบบ ไม่ใช่ในชื่อสินค้า
    expect(toSellingUnits(300, 250)).toBeCloseTo(1.2, 10);
  });

  it('ไม่มีขนาดต่อหน่วย ก็ไม่หาร — ไม่ใช่หารด้วยศูนย์', () => {
    expect(toSellingUnits(0.6, 0)).toBe(0.6);
    expect(toSubUnits(0.6, 0)).toBe(0.6);
  });

  it('แปลงกลับแล้วได้เลขเดิมที่คนพิมพ์ลงไป', () => {
    // ช่องกรอกแสดงค่าที่คำนวณกลับจาก qty ถ้าไม่ปัด คนที่พิมพ์ 100 จะเห็น
    // 99.99999999999999 ในช่องของตัวเอง
    expect(toSubUnits(toSellingUnits(100, 350), 350)).toBe(100);
    expect(toSubUnits(toSellingUnits(300, 500), 500)).toBe(300);
  });

  it('roundTo ปัดที่สี่ตำแหน่งเป็นค่าตั้งต้น', () => {
    expect(roundTo(99.999999999)).toBe(100);
    expect(roundTo(0.123456)).toBe(0.1235);
  });
});
