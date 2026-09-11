import { describe, it, expect } from 'vitest';
import { orderTotal, orderPaid, orderReported, orderPendingAdjustments } from '@/lib/domain/orders';

describe('orderTotal', () => {
  it('subtracts returns and adjustments from the items total', () => {
    const order = {
      items: [
        { name: 'A', qty: 10, requestedPrice: 1000 },
        { name: 'B', qty: 8, requestedPrice: 1500 },
      ],
      returns: [{ item: 'A', qty: 2 }],
      adjustments: [{ amount: 200 }],
    };
    // items: 10*1000 + 8*1500 = 22000; returns: 2*1000 = 2000; adjustments: 200
    expect(orderTotal(order)).toBe(22000 - 2000 - 200);
  });
  it('ignores a return referencing an item not on the order', () => {
    const order = {
      items: [{ name: 'A', qty: 1, requestedPrice: 100 }],
      returns: [{ item: 'ghost', qty: 5 }],
      adjustments: [],
    };
    expect(orderTotal(order)).toBe(100);
  });
  it('prices a return at the FIRST matching item name (prototype uses find)', () => {
    const order = {
      items: [
        { name: 'A', qty: 1, requestedPrice: 100 },
        { name: 'A', qty: 1, requestedPrice: 900 },
      ],
      returns: [{ item: 'A', qty: 1 }],
      adjustments: [],
    };
    // 1000 total, return priced off the first 'A' (100), not the second
    expect(orderTotal(order)).toBe(1000 - 100);
  });
  it('sums multiple adjustments and treats a missing amount as 0', () => {
    const order = {
      items: [{ name: 'A', qty: 1, requestedPrice: 1000 }],
      returns: [],
      adjustments: [{ amount: 100 }, {} as { amount: number }, { amount: 50 }],
    };
    expect(orderTotal(order)).toBe(1000 - 150);
  });
  it('tolerates a missing adjustments array', () => {
    const order = {
      items: [{ name: 'A', qty: 2, requestedPrice: 250 }],
      returns: [],
    } as unknown as Parameters<typeof orderTotal>[0];
    expect(orderTotal(order)).toBe(500);
  });
  it('returns 0 for an empty order', () => {
    expect(orderTotal({ items: [], returns: [], adjustments: [] })).toBe(0);
  });
});

describe('orderPaid', () => {
  it('sums payment amounts', () => {
    expect(orderPaid({ payments: [{ amount: 5000 }, { amount: 400 }] })).toBe(5400);
  });
  it('returns 0 when there are no payments', () => {
    expect(orderPaid({ payments: [] })).toBe(0);
  });
});

/**
 * สถานะการรับเงิน (migration 0048).
 *
 * ขายส่งรับเป็นเช็คลงวันที่ล่วงหน้าเป็นส่วนใหญ่ — a cheque in the drawer is not
 * money, and counting it as money cleared the customer's debt and moved the
 * money card on the strength of a promise.
 */
describe('orderPaid — เฉพาะที่รับเงินแล้ว', () => {
  it('ไม่นับรายการที่แจ้งแล้วแต่ยังไม่ยืนยัน', () => {
    expect(
      orderPaid({
        payments: [
          { amount: 5000, status: 'รับเงินแล้ว' },
          { amount: 20000, status: 'แจ้งแล้ว' },
        ],
      }),
    ).toBe(5000);
  });

  it('ไม่นับเช็คที่เด้ง — หนี้กลับมาเอง', () => {
    expect(
      orderPaid({
        payments: [
          { amount: 5000, status: 'รับเงินแล้ว' },
          { amount: 30000, status: 'เด้ง' },
        ],
      }),
    ).toBe(5000);
  });

  it('นับรายการที่ไม่มีสถานะเป็นเงินที่ได้แล้ว', () => {
    // Everything recorded before 0048 was money the moment it was typed, and the
    // migration backfills it to รับเงินแล้ว for that reason. Retail payments
    // never set the field at all. Defaulting the other way would re-open every
    // settled debt in the shop.
    expect(orderPaid({ payments: [{ amount: 900 }] })).toBe(900);
  });
});

describe('orderReported', () => {
  it('นับเฉพาะที่แจ้งแล้วรอยืนยัน', () => {
    const payments = [
      { amount: 5000, status: 'รับเงินแล้ว' },
      { amount: 20000, status: 'แจ้งแล้ว' },
      { amount: 30000, status: 'เด้ง' },
      { amount: 900 },
    ];
    expect(orderReported({ payments })).toBe(20000);
  });
});

/**
 * การปรับราคาต้องได้รับอนุมัติ (migration 0050).
 *
 * A price adjustment gives away the same money a below-standard price does, and
 * that one has always needed ผู้บริหาร. If an unapproved one still reduced the
 * bill, the approval would be decoration: the money would be gone before anyone
 * agreed to it.
 */
describe('orderTotal — ปรับราคาที่รออนุมัติ', () => {
  const base = {
    items: [{ name: 'A', qty: 10, requestedPrice: 1000 }],
    returns: [],
  };

  it('ยังไม่ลดยอด จนกว่าจะอนุมัติ', () => {
    expect(orderTotal({ ...base, adjustments: [{ amount: 200, status: 'รออนุมัติ' }] })).toBe(
      10000,
    );
  });

  it('อนุมัติแล้วจึงลดยอด', () => {
    expect(orderTotal({ ...base, adjustments: [{ amount: 200, status: 'อนุมัติแล้ว' }] })).toBe(
      9800,
    );
  });

  it('ปฏิเสธแล้วไม่ลดยอด แต่แถวยังอยู่', () => {
    // The row is kept on purpose: somebody asked and somebody said no, and a
    // deleted row leaves the next reader wondering whether it was ever raised.
    expect(orderTotal({ ...base, adjustments: [{ amount: 200, status: 'ปฏิเสธ' }] })).toBe(10000);
  });

  it('แถวที่ไม่มีสถานะ ถือว่าอนุมัติแล้ว', () => {
    // Everything written before 0050 had already been subtracted from figures
    // the shop has read; the migration backfills them for the same reason.
    expect(orderTotal({ ...base, adjustments: [{ amount: 200 }] })).toBe(9800);
  });
});

describe('orderPendingAdjustments', () => {
  it('นับเฉพาะที่รออนุมัติ', () => {
    const adjustments = [
      { amount: 200, status: 'รออนุมัติ' },
      { amount: 500, status: 'อนุมัติแล้ว' },
      { amount: 900, status: 'ปฏิเสธ' },
      { amount: 100 },
    ];
    expect(orderPendingAdjustments({ adjustments })).toBe(200);
  });
});
