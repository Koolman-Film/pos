import { describe, it, expect } from 'vitest';

import {
  actualQtyComplete,
  hasActualQty,
  missingQtyCount,
  qtyProducts,
  reworkTicked,
  techOpenWhileLocked,
} from '@/lib/domain/techQty';

/**
 * จำนวนสินค้าที่ใช้จริง — which rows want a number, and whether ข้อมูลของช่าง
 * is still open on a ticket that has closed (ร้านขอ 23 ก.ย. 2569).
 */

const film = (positions: { product: string }[], actualQtyMap = {}) => ({
  category: 'ฟิล์มกรองแสง',
  sold: 'บานหน้า: 3M CR70, คู่หน้า: 3M CR70',
  positions,
  actualQtyMap,
});

describe('qtyProducts', () => {
  it('takes a film item from its positions, one row per distinct product', () => {
    // `sold` is a summary line on a film item, never a product — a row for it
    // would ask the technician for a quantity of a sentence.
    expect(
      qtyProducts(film([{ product: '3M CR70' }, { product: '3M CR70' }, { product: '3M CR40' }])),
    ).toEqual(['3M CR70', '3M CR40']);
  });

  it('takes anything else from the product it sold', () => {
    expect(qtyProducts({ category: 'เครื่องเสียง', sold: 'ลำโพง JBL' })).toEqual(['ลำโพง JBL']);
  });

  it('asks nothing of งานบริการ, or of a line nobody filled in', () => {
    expect(qtyProducts({ category: 'งานบริการ', sold: 'ล้างรถ' })).toEqual([]);
    expect(qtyProducts({ category: 'ฟิล์มกรองแสง', sold: '', positions: [] })).toEqual([]);
  });
});

describe('hasActualQty', () => {
  it('counts a number as recorded, and zero as still blank', () => {
    // serializeTicket drops zero and non-numeric entries rather than storing
    // them, so 0 and blank reach the database the same way.
    const it_ = { category: 'เครื่องเสียง', sold: 'ลำโพง', actualQtyMap: { ลำโพง: 2 } };
    expect(hasActualQty(it_, 'ลำโพง')).toBe(true);
    expect(hasActualQty({ ...it_, actualQtyMap: { ลำโพง: 0 } }, 'ลำโพง')).toBe(false);
    expect(hasActualQty({ ...it_, actualQtyMap: { ลำโพง: '' } }, 'ลำโพง')).toBe(false);
    expect(hasActualQty({ ...it_, actualQtyMap: {} }, 'ลำโพง')).toBe(false);
  });
});

describe('ข้อมูลของช่างบนใบงานที่ปิดแล้ว', () => {
  const twoProducts = [film([{ product: '3M CR70' }, { product: '3M CR40' }])];

  it('stays open while a quantity is missing — the technician is not finished', () => {
    expect(missingQtyCount(twoProducts)).toBe(2);
    expect(techOpenWhileLocked({ items: twoProducts })).toBe(true);
  });

  it('is still open when only some of the rows are filled in', () => {
    // Two technicians, two categories, two different days: the second one must
    // not be shut out because the first one saved.
    const half = [film([{ product: '3M CR70' }, { product: '3M CR40' }], { '3M CR70': 1 })];
    expect(missingQtyCount(half)).toBe(1);
    expect(techOpenWhileLocked({ items: half })).toBe(true);
  });

  it('closes with the rest of the ticket once every row has a number', () => {
    const done = [
      film([{ product: '3M CR70' }, { product: '3M CR40' }], { '3M CR70': 1, '3M CR40': 2 }),
    ];
    expect(actualQtyComplete(done)).toBe(true);
    expect(techOpenWhileLocked({ items: done })).toBe(false);
  });

  it('opens again when แก้งาน is ticked — a rework takes more material', () => {
    const done = [film([{ product: '3M CR70' }], { '3M CR70': 1 })];
    expect(techOpenWhileLocked({ items: done, extras: { แก้งาน: { checked: true } } })).toBe(true);
    expect(techOpenWhileLocked({ items: done, extras: { แก้งาน: { checked: false } } })).toBe(
      false,
    );
    // An extra that is merely PRESENT is not ticked — the form leaves the
    // object behind when the box is cleared.
    expect(
      techOpenWhileLocked({ items: done, extras: { แก้งาน: { detail: 'ฟิล์มมีฝุ่น' } } }),
    ).toBe(false);
  });

  it('has nothing outstanding on a ticket with nothing to count', () => {
    expect(techOpenWhileLocked({ items: [{ category: 'งานบริการ', sold: 'ล้างรถ' }] })).toBe(false);
    expect(techOpenWhileLocked({ items: [] })).toBe(false);
  });
});

describe('reworkTicked', () => {
  it('reads the tick and nothing else', () => {
    expect(reworkTicked({ แก้งาน: { checked: true } })).toBe(true);
    expect(reworkTicked({ Service: { checked: true } })).toBe(false);
    expect(reworkTicked({})).toBe(false);
    expect(reworkTicked(null)).toBe(false);
  });
});
