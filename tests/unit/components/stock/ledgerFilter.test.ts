import { describe, it, expect } from 'vitest';

import {
  EMPTY_LEDGER_FILTER,
  isLedgerFiltered,
  ledgerParamValue,
  ledgerRange,
  ledgerStockIds,
  parseLedgerFilter,
} from '@/components/stock/ledgerFilter';

/**
 * ตัวกรองของประวัติสต็อก (ร้านขอ 17 พ.ย. 2569).
 *
 * กฎนี้ถูกอ่านสองฝั่ง — หน้าเซิร์ฟเวอร์ใช้สร้างคำถามไปยังฐานข้อมูล และหน้าจอ
 * ใช้วาดปุ่มว่าตอนนี้เลือกอะไรไว้ มันจึงต้องตีความ URL เดียวกันได้คำตอบเดียวกัน
 * เสมอ ไฟล์นี้ปักข้อตกลงนั้นไว้
 */

describe('อ่านตัวกรองจาก URL', () => {
  it('ไม่มีพารามิเตอร์ = ไม่กรองอะไร', () => {
    expect(parseLedgerFilter({})).toEqual(EMPTY_LEDGER_FILTER);
    expect(isLedgerFiltered(parseLedgerFilter({}))).toBe(false);
  });

  it('เลือกได้หลายค่าในตัวกรองเดียว', () => {
    const f = parseLedgerFilter({ lshop: 'cm~lp', lkind: 'ปรับสต็อก~รับเข้า' });
    expect(f.shops).toEqual(['cm', 'lp']);
    expect(f.kinds).toEqual(['ปรับสต็อก', 'รับเข้า']);
    expect(isLedgerFiltered(f)).toBe(true);
  });

  it('ชื่อสินค้าที่มีจุลภาคอยู่ในชื่อ ไม่ถูกหั่นเป็นหลายชื่อ', () => {
    /*
      ชื่อจริงของร้านมีจุลภาคตามปกติ ("เต็มคัน: หน้า, ข้าง, หลัง") ตัวคั่นที่
      เป็นจุลภาคจะเปลี่ยนชื่อเดียวเป็นสามชื่อที่ไม่ตรงกับอะไรเลย แล้วตารางจะ
      ว่างทั้งที่ปุ่มบอกว่าเลือกไว้หนึ่งอย่าง
    */
    const f = parseLedgerFilter({ lname: 'เต็มคัน: หน้า, ข้าง, หลัง' });
    expect(f.names).toEqual(['เต็มคัน: หน้า, ข้าง, หลัง']);
  });

  it('ค่าซ้ำและช่องว่าง ถูกเก็บกวาดทิ้ง', () => {
    expect(parseLedgerFilter({ lcat: ' ฟิล์มกรองแสง ~~ฟิล์มกรองแสง~ ' }).cats).toEqual([
      'ฟิล์มกรองแสง',
    ]);
  });

  it('วันที่ที่ไม่ใช่วันที่ ถูกทิ้ง ไม่ใช่ส่งต่อไปให้ฐานข้อมูล', () => {
    const f = parseLedgerFilter({ lfrom: 'เมื่อวาน', lto: '2026-13-45' });
    expect(f.from).toBe('');
    expect(f.to).toBe('');
  });

  it('กรอกช่วงเวลากลับหัว ก็อ่านว่าเป็นช่วงเดียวกัน', () => {
    // คนกรอกสองช่องนี้คนละครั้ง และพิมพ์ปลายทางก่อนได้ตามปกติ ตารางว่างเปล่า
    // ตอนนั้นจะอ่านเหมือนว่า "ช่วงนี้ไม่มีรายการ" ซึ่งไม่จริง
    const f = parseLedgerFilter({ lfrom: '2026-11-30', lto: '2026-11-01' });
    expect(f.from).toBe('2026-11-01');
    expect(f.to).toBe('2026-11-30');
  });

  it('เขียนกลับลง URL แล้วอ่านใหม่ ได้ของเดิม', () => {
    const values = ['ฟิล์ม 3M CRM 60%', 'TPU กันรอยเกรดพรีเมียม'];
    expect(parseLedgerFilter({ lname: ledgerParamValue(values) }).names).toEqual(values);
  });
});

describe('ช่วงเวลาที่ส่งให้ฐานข้อมูล', () => {
  it('อ่านบนนาฬิกาของร้าน และรวมทั้งวันสุดท้าย', () => {
    /*
      เซิร์ฟเวอร์เดินเวลา UTC — รายการที่บันทึกตอนสามทุ่มของวันที่ 17 เป็นของ
      วันที่ 18 ถ้าอ่านด้วยนาฬิกาเครื่อง แล้วจะหลุดออกจากช่วงที่คนเลือก
    */
    const r = ledgerRange(parseLedgerFilter({ lfrom: '2026-11-01', lto: '2026-11-30' }));
    expect(r.fromISO).toBe('2026-11-01T00:00:00+07:00');
    expect(r.toISO).toBe('2026-11-30T23:59:59.999+07:00');
    expect(new Date('2026-11-30T22:00:00+07:00') <= new Date(r.toISO)).toBe(true);
  });

  it('กรอกข้างเดียว ก็กรองข้างเดียว', () => {
    const r = ledgerRange(parseLedgerFilter({ lfrom: '2026-11-01' }));
    expect(r.fromISO).toBe('2026-11-01T00:00:00+07:00');
    expect(r.toISO).toBe('');
  });
});

describe('ชนิดสินค้า → รหัสสินค้า', () => {
  const products = [
    { id: 1, category: 'ฟิล์มกรองแสง' },
    { id: 2, category: 'ฟิล์มกรองแสง' },
    { id: 3, category: 'ฟิล์มกันรอย' },
  ];

  it('ไม่ได้เลือกชนิดสินค้า = ไม่กรองด้วยรหัส', () => {
    expect(ledgerStockIds(parseLedgerFilter({}), products)).toBeNull();
  });

  it('เลือกชนิดไหน ได้รหัสของชนิดนั้น', () => {
    expect(ledgerStockIds(parseLedgerFilter({ lcat: 'ฟิล์มกรองแสง' }), products)).toEqual([1, 2]);
  });

  it('ชนิดที่ไม่มีสินค้าเหลืออยู่ ได้รายการว่าง ไม่ใช่ null', () => {
    /*
      ว่างกับ null ต่างกันคนละเรื่อง: ว่างแปลว่า "ไม่มีอะไรตรง" ซึ่งต้องได้
      ตารางเปล่า ส่วน null แปลว่า "ไม่ได้กรอง" ซึ่งจะได้ทั้งสมุด — ถ้าสองอย่าง
      นี้ปนกัน ตัวกรองจะคลายตัวเองเงียบ ๆ แล้วคนอ่านจะนึกว่านี่คือผลของการกรอง
    */
    expect(ledgerStockIds(parseLedgerFilter({ lcat: 'เครื่องเสียง' }), products)).toEqual([]);
  });
});
