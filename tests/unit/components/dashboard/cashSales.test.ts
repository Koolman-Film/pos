import { describe, it, expect } from 'vitest';

import {
  orderReceipts,
  splitByWeight,
  sumReceipts,
  ticketReceipts,
  type ReceiptOrder,
  type ReceiptTicket,
} from '@/components/dashboard/cashSales';

/**
 * ยอดขายบนแดชบอร์ด = เงินที่รับแล้ว. The figure the shop compares with the money
 * in its accounts, so what counts, on which day, and how it splits are pinned.
 */

const job = (over: Partial<ReceiptTicket> = {}): ReceiptTicket => ({
  id: 'JT-CM-00214',
  shop: 'cm',
  held: false,
  items: [
    { category: 'ฟิล์มกรองแสง', soldPrice: 6000 },
    { category: 'เครื่องเสียง', soldPrice: 4000 },
  ],
  payments: [],
  ...over,
});

const po = (over: Partial<ReceiptOrder> = {}): ReceiptOrder => ({
  id: 'WS-NT-0001',
  shop: 'north',
  items: [
    { name: 'ฟิล์ม 3M', qty: 10, requestedPrice: 1500 },
    { name: 'ลำโพง JBL', qty: 1, requestedPrice: 5000 },
  ],
  payments: [],
  ...over,
});

const categoryOf = (name: string) =>
  ({ 'ฟิล์ม 3M': 'ฟิล์มกรองแสง', 'ลำโพง JBL': 'เครื่องเสียง' })[name] ?? '';

describe('ticketReceipts', () => {
  it('counts only what has been paid, on the day it was paid', () => {
    const lines = ticketReceipts([job({ payments: [{ amount: 5000, on: '2026-09-10' }] })], []);
    expect(sumReceipts(lines)).toBe(5000);
    expect(new Set(lines.map((l) => l.on))).toEqual(new Set(['2026-09-10']));
  });

  it('counts nothing for a job nobody has paid for yet', () => {
    expect(ticketReceipts([job()], [])).toEqual([]);
  });

  it('splits a payment across the job’s categories by value', () => {
    const lines = ticketReceipts([job({ payments: [{ amount: 5000, on: '2026-09-10' }] })], []);
    expect(lines.map((l) => [l.category, l.amount])).toEqual([
      ['ฟิล์มกรองแสง', 3000],
      ['เครื่องเสียง', 2000],
    ]);
  });

  it('gives ประกัน its share of a payment on the ticket it was sold on', () => {
    const lines = ticketReceipts(
      [
        job({
          items: [{ category: 'ฟิล์มกันรอย', soldPrice: 7500 }],
          payments: [{ amount: 10000, on: '2026-09-10' }],
        }),
      ],
      [{ ticketId: 'JT-CM-00214', price: 2500 }],
    );
    expect(lines.map((l) => [l.category, l.amount])).toEqual([
      ['ฟิล์มกันรอย', 7500],
      ['ประกัน', 2500],
    ]);
  });

  it('marks money taken for another Finnix shop', () => {
    const lines = ticketReceipts(
      [job({ held: true, payments: [{ amount: 1000, on: '2026-09-10' }] })],
      [],
    );
    expect(lines.every((l) => l.held)).toBe(true);
  });

  it('keeps a payment on a job with no priced lines, under ไม่ระบุชนิด', () => {
    const lines = ticketReceipts(
      [job({ items: [], payments: [{ amount: 800, on: '2026-09-10' }] })],
      [],
    );
    expect(lines).toEqual([expect.objectContaining({ category: 'ไม่ระบุชนิด', amount: 800 })]);
  });
});

describe('orderReceipts', () => {
  it('counts a PO payment only once the money is received, on the day it cleared', () => {
    const lines = orderReceipts(
      [
        po({
          payments: [
            { amount: 10000, status: 'รับเงินแล้ว', paidAt: '2026-08-30', clearedAt: '2026-09-05' },
            { amount: 5000, status: 'แจ้งชำระ', paidAt: '2026-09-06' },
            { amount: 3000, status: 'เช็คเด้ง', paidAt: '2026-09-07' },
          ],
        }),
      ],
      categoryOf,
    );
    expect(sumReceipts(lines)).toBe(10000);
    expect(new Set(lines.map((l) => l.on))).toEqual(new Set(['2026-09-05']));
  });

  it('counts a payment from before cheque tracking on its paid date', () => {
    const lines = orderReceipts(
      [po({ payments: [{ amount: 2000, paidAt: '2026-09-01' }] })],
      categoryOf,
    );
    expect(sumReceipts(lines)).toBe(2000);
    expect(lines[0].on).toBe('2026-09-01');
  });

  it('splits a PO payment by the stock category of the goods', () => {
    const lines = orderReceipts(
      [po({ payments: [{ amount: 10000, status: 'รับเงินแล้ว', paidAt: '2026-09-05' }] })],
      categoryOf,
    );
    expect(lines.map((l) => [l.category, l.amount])).toEqual([
      ['ฟิล์มกรองแสง', 7500],
      ['เครื่องเสียง', 2500],
    ]);
    expect(lines.every((l) => l.channel === 'ขายส่ง')).toBe(true);
  });
});

describe('splitByWeight', () => {
  it('adds up to the payment to the satang', () => {
    const shares = splitByWeight(100, [
      { category: 'ก', weight: 1 },
      { category: 'ข', weight: 1 },
      { category: 'ค', weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(sumReceipts(shares)).toBe(100);
  });
});
