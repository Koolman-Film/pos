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
      [{ ticketId: 'JT-CM-00214', shop: 'cm', on: '2026-09-10', amount: 2500 }],
    );
    expect(lines.map((l) => [l.category, l.amount])).toEqual([
      ['ฟิล์มกันรอย', 10000],
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
      { category: 'ก', held: false, weight: 1 },
      { category: 'ข', held: false, weight: 1 },
      { category: 'ค', held: false, weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(sumReceipts(shares)).toBe(100);
  });

  it('keeps the branch’s money and the held money apart, even in one ชนิดสินค้า', () => {
    // ฟิล์มกรองแสง the branch sold and ฟิล์มกรองแสง it is holding for another
    // shop are two sums that must not merge into one (0068).
    const shares = splitByWeight(1000, [
      { category: 'ฟิล์มกรองแสง', held: false, weight: 600 },
      { category: 'ฟิล์มกรองแสง', held: true, weight: 400 },
    ]);
    expect(shares).toEqual([
      { category: 'ฟิล์มกรองแสง', held: false, amount: 600 },
      { category: 'ฟิล์มกรองแสง', held: true, amount: 400 },
    ]);
    expect(sumReceipts(shares)).toBe(1000);
  });
});

/**
 * ใบงานเดียว มีทั้งของสาขาและของที่รับแทน (ร้านแจ้ง 25 ก.ย. 2569, migration 0068).
 *
 * One car carries the branch's own film and another branch's wrap, and the
 * customer pays once for both. The flag used to sit on the whole job, so the
 * shop had to call it all its own — overstating the takings — or all held,
 * losing the part it really earned.
 */
describe('ticketReceipts — ใบงานที่เงินไม่ได้เป็นของสาขาทั้งใบ', () => {
  const mixed = job({
    items: [
      { category: 'ฟิล์มกรองแสง', soldPrice: 6000, held: false },
      { category: 'ฟิล์มกันรอย', soldPrice: 4000, held: true },
    ],
    payments: [{ amount: 10000, on: '2026-09-25' }],
  });

  it('แบ่งเงินที่รับมาตามสัดส่วนของรายการ ว่าส่วนไหนเป็นของสาขา', () => {
    const lines = ticketReceipts([mixed], []);
    expect(lines).toEqual([
      {
        sourceId: 'JT-CM-00214',
        shop: 'cm',
        on: '2026-09-25',
        channel: 'ปลีก',
        category: 'ฟิล์มกรองแสง',
        held: false,
        amount: 6000,
      },
      {
        sourceId: 'JT-CM-00214',
        shop: 'cm',
        on: '2026-09-25',
        channel: 'ปลีก',
        category: 'ฟิล์มกันรอย',
        held: true,
        amount: 4000,
      },
    ]);
    // ยอดขายของสาขา counts only its own share; the whole payment is still there.
    expect(sumReceipts(lines.filter((l) => !l.held))).toBe(6000);
    expect(sumReceipts(lines)).toBe(10000);
  });

  it('แบ่งตามสัดส่วนเดิม แม้ลูกค้าจ่ายมาบางส่วน', () => {
    // A deposit buys a share of each line, not the whole of one of them.
    const lines = ticketReceipts(
      [job({ ...mixed, payments: [{ amount: 5000, on: '2026-09-25' }] })],
      [],
    );
    expect(sumReceipts(lines.filter((l) => !l.held))).toBe(3000);
    expect(sumReceipts(lines.filter((l) => l.held))).toBe(2000);
  });

  it('ประกันเป็นของสาขาที่ขาย แม้รายการอื่นในใบงานจะรับแทน', () => {
    const lines = ticketReceipts(
      [
        job({
          items: [{ category: 'ฟิล์มกันรอย', soldPrice: 4000, held: true }],
          payments: [{ amount: 5000, on: '2026-09-25' }],
        }),
      ],
      [{ ticketId: 'JT-CM-00214', shop: 'cm', on: '2026-09-25', amount: 1000 }],
    );
    expect(lines.find((l) => l.category === 'ประกัน')).toMatchObject({ held: false, amount: 1000 });
    // The whole 5,000 paid on the ticket is the held work's; the premium is
    // its own 1,000 on top (0071).
    expect(sumReceipts(lines.filter((l) => l.held))).toBe(5000);
  });

  it('ใบงานที่ไม่ได้บอกทีละรายการ ยังใช้คำตอบของทั้งใบเหมือนเดิม', () => {
    // A caller from before 0068 sends no per-line flag; the job's own answer
    // still decides, so nothing recorded earlier changes meaning.
    const lines = ticketReceipts(
      [job({ held: true, payments: [{ amount: 10000, on: '2026-09-25' }] })],
      [],
    );
    expect(lines.every((l) => l.held)).toBe(true);
  });
});

/**
 * ค่าประกันเข้ายอดขายตามวันที่รับเงินของมันเอง (migration 0071).
 *
 * A policy is usually bought after the job was delivered, paid in full and
 * locked, so its money never goes through the ticket. It used to be folded
 * into the ticket's split as a weight, which reported premium sales nobody had
 * paid for and understated the film in the same breath.
 */
describe('ticketReceipts — ค่าประกัน', () => {
  const film = job({
    items: [{ category: 'ฟิล์มกันรอย', soldPrice: 4000 }],
    payments: [{ amount: 4000, on: '2026-09-24' }],
  });
  const premium = {
    ticketId: 'JT-CM-00214',
    shop: 'cm',
    on: '2026-10-20',
    amount: 6000,
  };

  it('นับค่าประกันเป็นใบเสร็จของตัวเอง ในวันที่รับเงิน', () => {
    const lines = ticketReceipts([film], [premium]);
    // The film's money stays the film's — not diluted by a premium paid a
    // month later.
    expect(lines.find((l) => l.category === 'ฟิล์มกันรอย')).toMatchObject({
      amount: 4000,
      on: '2026-09-24',
    });
    expect(lines.find((l) => l.category === 'ประกัน')).toMatchObject({
      amount: 6000,
      on: '2026-10-20',
      held: false,
    });
    expect(sumReceipts(lines)).toBe(10000);
  });

  it('ยังไม่รับเงินค่าประกัน ก็ยังไม่เข้ายอดขาย', () => {
    // The sale is real and โมดูลรายได้ counts it on its own date; this card
    // counts cash, and no cash has arrived.
    const lines = ticketReceipts([film], []);
    expect(lines.every((l) => l.category !== 'ประกัน')).toBe(true);
  });

  it('ค่าประกันเป็นของสาขาที่ขาย แม้งานในใบจะเป็นของ Finnix', () => {
    const lines = ticketReceipts(
      [job({ items: [{ category: 'ฟิล์มกันรอย', soldPrice: 4000, held: true }], payments: [] })],
      [premium],
    );
    expect(lines.find((l) => l.category === 'ประกัน')?.held).toBe(false);
  });

  it('ใบงานที่ปิดและชำระครบไปแล้ว ยังรับค่าประกันทีหลังได้', () => {
    // The whole reason the premium has a payment of its own: nothing here
    // touches the ticket, which may be locked.
    const lines = ticketReceipts([job({ payments: [] })], [premium]);
    expect(sumReceipts(lines)).toBe(6000);
  });
});
