import { describe, it, expect } from 'vitest';

import {
  deliveredByItem,
  deliveredValue,
  deliveryProgress,
  fullyDelivered,
  hasUndelivered,
  shelfEffect,
} from '@/lib/domain/deliveries';

/**
 * ส่งของหลายรอบใน PO เดียว (migration 0077).
 *
 * ลูกค้าสั่ง 200 ม้วน รับไปก่อน 80 ที่เหลือรออีกสองสัปดาห์ (ร้านแจ้ง 28 ก.ย.
 * 2569). Once that is possible "delivered" is no longer a yes/no on the PO but
 * a quantity per line, and this is the arithmetic the form, the list and the
 * database guard all have to agree on.
 */

const items = [
  { uid: 'u1', name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 200, requestedPrice: 1200 },
  { uid: 'u2', name: 'ลำโพง 6 นิ้ว', qty: 10, requestedPrice: 450 },
];

const round = (lines: [string, number][]) => ({
  items: lines.map(([itemUid, qty]) => ({ itemUid, qty })),
});

describe('deliveryProgress', () => {
  it('ยังไม่ได้ส่งเลย ทุกรายการค้างเต็มจำนวน', () => {
    expect(deliveryProgress(items, [])).toEqual([
      { uid: 'u1', name: items[0].name, ordered: 200, sent: 0, remaining: 200 },
      { uid: 'u2', name: items[1].name, ordered: 10, sent: 0, remaining: 10 },
    ]);
  });

  it('ส่งบางส่วน เหลือเท่าที่ยังไม่ได้ส่ง', () => {
    const p = deliveryProgress(items, [round([['u1', 80]])]);
    expect(p[0]).toMatchObject({ sent: 80, remaining: 120 });
    // รายการที่ยังไม่ได้แตะเลย ไม่ถูกนับว่าส่งไปด้วย
    expect(p[1]).toMatchObject({ sent: 0, remaining: 10 });
  });

  it('หลายรอบบวกกัน', () => {
    const p = deliveryProgress(items, [
      round([['u1', 80]]),
      round([
        ['u1', 120],
        ['u2', 10],
      ]),
    ]);
    expect(p.map((x) => x.sent)).toEqual([200, 10]);
    expect(p.every((x) => x.remaining === 0)).toBe(true);
  });

  it('ส่งเกินที่สั่ง ไม่กลายเป็นของค้างติดลบ', () => {
    // ข้อมูลผิด ไม่ใช่ของที่ต้องส่งเพิ่ม — ติดลบจะไหลไปโผล่เป็นยอดค้างส่งของสาขา
    const p = deliveryProgress(items, [round([['u1', 250]])]);
    expect(p[0]).toMatchObject({ sent: 250, remaining: 0 });
  });

  it('จับคู่ด้วย uid ไม่ใช่ชื่อ — สินค้าชื่อเดียวกันคนละราคาอยู่ใบเดียวกันได้', () => {
    const twoLines = [
      { uid: 'a', name: 'ฟิล์มใส', qty: 5, requestedPrice: 900 },
      { uid: 'b', name: 'ฟิล์มใส', qty: 5, requestedPrice: 700 },
    ];
    const p = deliveryProgress(twoLines, [round([['b', 5]])]);
    expect(p[0]).toMatchObject({ sent: 0, remaining: 5 });
    expect(p[1]).toMatchObject({ sent: 5, remaining: 0 });
  });
});

describe('deliveredByItem', () => {
  it('บรรทัดที่ไม่มี uid ถูกข้าม ไม่ใช่ถูกรวมเข้าถังเดียวกัน', () => {
    // ถ้าเก็บไว้ใต้คีย์ว่าง ของสองรายการจะบวกกันเป็นกองเดียว
    expect(
      deliveredByItem([
        round([
          ['', 5],
          ['u1', 3],
        ]),
      ]),
    ).toEqual({ u1: 3 });
  });
});

describe('hasUndelivered / fullyDelivered', () => {
  it('ค้างอยู่แม้แค่รายการเดียว ก็ยังไม่ครบ', () => {
    const rounds = [round([['u1', 200]])];
    expect(hasUndelivered(items, rounds)).toBe(true);
    expect(fullyDelivered(items, rounds)).toBe(false);
  });

  it('ครบทุกรายการจึงจะครบ', () => {
    const rounds = [
      round([
        ['u1', 200],
        ['u2', 10],
      ]),
    ];
    expect(fullyDelivered(items, rounds)).toBe(true);
  });

  it('PO ที่ยังไม่มีรายการสินค้า ไม่นับว่าส่งครบ', () => {
    // ถูกตามตรรกะ ผิดตามความจริง — และมันคือสิ่งที่จะปิด PO เปล่าให้เอง
    expect(fullyDelivered([], [])).toBe(false);
    expect(hasUndelivered([], [])).toBe(false);
  });
});

describe('deliveredValue', () => {
  it('คิดตามของที่ออกไปจริง ไม่ใช่ทั้งใบ', () => {
    expect(deliveredValue(items, [round([['u1', 80]])])).toBe(96000);
  });

  it('ส่งครบเท่ากับมูลค่าทั้งใบ', () => {
    expect(
      deliveredValue(items, [
        round([
          ['u1', 200],
          ['u2', 10],
        ]),
      ]),
    ).toBe(200 * 1200 + 10 * 450);
  });
});

/**
 * ลบ PO แล้วคืนของเข้าชั้นเท่าไหร่ (migration 0079).
 *
 * ก่อนหน้านี้คิดจาก "จำนวนที่สั่ง ลบ จำนวนที่คืน" ซึ่งผิดสองชั้นตั้งแต่ของออกจาก
 * คลังทีละรอบ และที่แย่กว่านั้นคือตราประทับที่มันเช็ค (`orders.stock_deducted_at`)
 * ไม่ถูกเขียนอีกแล้ว — PO ที่ส่งของไปจริงจึงถูกลบโดยไม่คืนอะไรเลย
 */
describe('shelfEffect', () => {
  const round = (qty: number, stamped = true) => ({
    stockDeductedAt: stamped ? '2026-09-10T00:00:00Z' : null,
    items: [{ name: 'ฟิล์ม', qty }],
  });

  it('คืนเท่าที่ส่งไปจริง ไม่ใช่เท่าที่สั่ง', () => {
    // สั่ง 200 ส่งไป 80 — คืน 200 คือการเสกของที่ร้านไม่มี
    expect(
      shelfEffect([round(80)], [], { deducted: true, items: [{ name: 'ฟิล์ม', qty: 200 }] }),
    ).toEqual({ ฟิล์ม: 80 });
  });

  it('หลายรอบบวกกัน', () => {
    expect(shelfEffect([round(80), round(120)], [])).toEqual({ ฟิล์ม: 200 });
  });

  it('รอบที่ยังไม่ได้ตัดสต็อก ไม่นับ', () => {
    // ตราประทับคือหลักฐานเดียวที่บอกว่าชั้นวางขยับจริง
    expect(shelfEffect([round(80), round(50, false)], [])).toEqual({ ฟิล์ม: 80 });
  });

  it('การคืนที่ยืนยันรับของแล้ว หักออก', () => {
    expect(shelfEffect([round(80)], [{ name: 'ฟิล์ม', qty: 10 }])).toEqual({ ฟิล์ม: 70 });
  });

  it('ส่งไปแล้วรับคืนครบ ไม่เหลืออะไรให้ขยับ', () => {
    // ศูนย์ไม่ใช่การเคลื่อนไหว — ส่งเข้าไปก็ได้แค่แถวเปล่าในทะเบียนสต็อก
    expect(shelfEffect([round(80)], [{ name: 'ฟิล์ม', qty: 80 }])).toEqual({});
  });

  it('PO ที่ยังไม่ได้ส่งของเลย ไม่มีอะไรให้คืน', () => {
    // ไม่เคยเอาอะไรออกไป การคืนของจึงเป็นการเสกของขึ้นมา
    expect(shelfEffect([], [], { deducted: false, items: [{ name: 'ฟิล์ม', qty: 200 }] })).toEqual(
      {},
    );
  });

  it('PO เก่าที่ตัดสต็อกไปแล้วแต่ไม่มีรอบ ใช้จำนวนที่สั่งแทน', () => {
    // การ backfill ของ 0077 ควรเก็บครบแล้ว แต่ถ้าหลุดมา การคืนศูนย์ชิ้นคือการ
    // กลืนของหายไปเงียบ ๆ ซึ่งแย่กว่าการเดา
    expect(shelfEffect([], [], { deducted: true, items: [{ name: 'ฟิล์ม', qty: 200 }] })).toEqual({
      ฟิล์ม: 200,
    });
  });
});
