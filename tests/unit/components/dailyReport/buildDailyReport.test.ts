import { describe, it, expect } from 'vitest';

import type { SalesReceipt } from '@/components/dashboard/cashSales';
import type { MoneyAccount } from '@/components/dashboard/moneyFlow';
import { buildDailyReport, nextDay, previousDay } from '@/components/dailyReport/buildDailyReport';

/**
 * สรุปการเงินประจำวัน — what counts on the day, how it is grouped, and that the
 * balance columns add up.
 */

const DAY = '2026-09-23';
const shops = [
  { id: 'cm', name: 'Finnix Film เชียงใหม่' },
  { id: 'north', name: 'Central Audio' },
];

const account = (over: Partial<MoneyAccount>): MoneyAccount => ({
  id: 1,
  shop: 'cm',
  name: 'เงินสดหน้าร้าน',
  kind: 'cash',
  accountNo: '',
  openingBalance: 0,
  openedAt: '2026-09-01',
  matchNames: [],
  sortOrder: 0,
  ...over,
});

const accounts = [
  account({ id: 1, name: 'เงินสดหน้าร้าน', matchNames: ['เงินสด'], openingBalance: 1000 }),
  account({
    id: 2,
    name: 'Kbank',
    kind: 'bank',
    matchNames: ['โอน กสิกร'],
    openingBalance: 50000,
    sortOrder: 1,
  }),
  account({ id: 3, name: 'เงินสดย่อย', kind: 'petty', openingBalance: 2000, sortOrder: 2 }),
];

const receipt = (over: Partial<SalesReceipt>): SalesReceipt => ({
  sourceId: 'JT-1',
  shop: 'cm',
  on: DAY,
  channel: 'ปลีก',
  held: false,
  category: 'ฟิล์มกรองแสง',
  amount: 0,
  ...over,
});

describe('buildDailyReport', () => {
  const report = buildDailyReport({
    day: DAY,
    shops,
    receipts: [
      receipt({ amount: 6000 }),
      receipt({ category: 'เครื่องเสียง', amount: 4000 }),
      receipt({ sourceId: 'JT-2', amount: 1500 }),
      receipt({ sourceId: 'WS-1', channel: 'ขายส่ง', amount: 8000 }),
      // รับแทน — collected, not earned.
      receipt({ sourceId: 'JT-9', held: true, amount: 700 }),
      // Yesterday — only for the comparison.
      receipt({ sourceId: 'JT-0', on: previousDay(DAY), amount: 10000 }),
      // Another day altogether.
      receipt({ sourceId: 'JT-X', on: '2026-09-20', amount: 99999 }),
    ],
    accounts,
    movements: [
      { shop: 'cm', source: 'เงินสด', amount: 5000, on: '2026-09-10' },
      { shop: 'cm', source: 'เงินสด', amount: 7500, on: DAY },
      { shop: 'cm', source: 'โอน กสิกร', amount: 12000, on: DAY },
      { shop: 'cm', source: 'โอน TTB', amount: 700, on: DAY },
      { shop: 'cm', source: 'เงินสดย่อย', amount: -350, on: DAY },
      { shop: 'cm', source: 'Kbank', amount: -1200, on: DAY },
      { shop: 'cm', source: 'เงินสด', amount: 999, on: nextDay(DAY) },
    ],
    transfers: [
      { shop: 'cm', fromAccountId: 1, toAccountId: 2, amount: 6000, on: DAY },
      { shop: 'cm', fromAccountId: 1, toAccountId: 3, amount: 500, on: '2026-09-15' },
    ],
  });

  it('counts only the money in on the day, retail and wholesale apart', () => {
    expect(report.sales.total).toBe(19500);
    expect(report.sales.channels).toEqual([
      {
        channel: 'ปลีก',
        total: 11500,
        categories: [
          { name: 'ฟิล์มกรองแสง', amount: 7500 },
          { name: 'เครื่องเสียง', amount: 4000 },
        ],
      },
      { channel: 'ขายส่ง', total: 8000, categories: [{ name: 'ฟิล์มกรองแสง', amount: 8000 }] },
    ]);
  });

  it('keeps เงินรอคืน Finnix out of ยอดขาย but reports it', () => {
    expect(report.sales.held).toBe(700);
    expect(report.sales.documents).toBe(4);
  });

  it('carries yesterday for the comparison', () => {
    expect(report.sales.previousTotal).toBe(10000);
  });

  it('groups money in and out by the account that claims the label', () => {
    expect(report.inflow.rows.map((r) => [r.name, r.amount, r.accountId])).toEqual([
      ['เงินสดหน้าร้าน', 7500, 1],
      ['Kbank', 12000, 2],
      ['โอน TTB', 700, null],
    ]);
    expect(report.inflow.total).toBe(20200);
    expect(report.outflow.rows.map((r) => [r.name, r.amount])).toEqual([
      ['Kbank', 1200],
      ['เงินสดย่อย', 350],
    ]);
    expect(report.outflow.total).toBe(1550);
    expect(report.hasUnmatched).toBe(true);
  });

  it('balances run from the close of yesterday to the close of the day', () => {
    const [cm] = report.balances;
    const byName = new Map(cm.accounts.map((a) => [a.name, a]));
    expect(byName.get('เงินสดหน้าร้าน')).toMatchObject({
      opening: 1000 + 5000 - 500,
      inflow: 7500,
      outflow: 0,
      transfer: -6000,
      closing: 5500 + 7500 - 6000,
    });
    expect(byName.get('Kbank')).toMatchObject({
      opening: 50000,
      inflow: 12000,
      outflow: 1200,
      transfer: 6000,
      closing: 66800,
    });
    expect(byName.get('เงินสดย่อย')).toMatchObject({ opening: 2500, closing: 2150 });
    for (const a of cm.accounts) {
      expect(a.opening + a.inflow - a.outflow + a.transfer).toBeCloseTo(a.closing, 2);
    }
  });

  it('leaves out branches not in scope', () => {
    const one = buildDailyReport({
      day: DAY,
      shops: [shops[1]],
      receipts: [receipt({ amount: 500 })],
      accounts,
      movements: [{ shop: 'cm', source: 'เงินสด', amount: 500, on: DAY }],
      transfers: [],
    });
    expect(one.sales.total).toBe(0);
    expect(one.inflow.rows).toEqual([]);
    expect(one.balances).toEqual([]);
  });
});

describe('previousDay / nextDay', () => {
  it('crosses month and year ends', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});
