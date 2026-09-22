import { describe, it, expect } from 'vitest';

import { groupExpenseReport, NO_SOURCE } from '@/components/accounting/expenseReport';

/**
 * รายงานค่าใช้จ่าย (ร้านขอ 22 ก.ย. 2569): สาขา → จ่ายจาก → วันที่, a table per
 * จ่ายจาก with its own total, a total per branch and a grand total.
 */

const e = (id: number, shop: string, source: string, day: string, amount: number) => ({
  id,
  shop,
  source,
  amount,
  dateObj: new Date(`2026-09-${day}T00:00:00`),
});

describe('groupExpenseReport', () => {
  const rows = [
    e(1, 'cm', 'เงินสดย่อย', '06', 150),
    e(2, 'cm', 'บัญชีธนาคารสาขา', '02', 35000),
    e(3, 'cm', 'เงินสดย่อย', '05', 400),
    e(4, 'lp', 'บัญชีธนาคารสาขา', '01', 1200),
    {
      id: 5,
      shop: 'cm',
      source: '',
      amount: 12400,
      dateObj: null,
      dueObj: new Date('2026-09-25T00:00:00'),
    },
  ];
  const accounts = (shop: string) =>
    shop === 'cm' ? ['บัญชีธนาคารสาขา', 'เงินสดย่อย'] : ['บัญชีธนาคารสาขา'];

  const report = groupExpenseReport(rows, ['cm', 'lp'], accounts);

  it('puts branches in the app’s order, and จ่ายจาก in the money register’s order', () => {
    expect(report.sections.map((s) => s.shopId)).toEqual(['cm', 'lp']);
    expect(report.sections[0].tables.map((t) => t.source)).toEqual([
      'บัญชีธนาคารสาขา',
      'เงินสดย่อย',
      NO_SOURCE,
    ]);
  });

  it('orders each table by date, oldest first', () => {
    const petty = report.sections[0].tables.find((t) => t.source === 'เงินสดย่อย')!;
    expect(petty.items.map((x) => x.id)).toEqual([3, 1]);
  });

  it('totals every table, every branch, and the whole report', () => {
    const cm = report.sections[0];
    expect(cm.tables.map((t) => t.total)).toEqual([35000, 550, 12400]);
    expect(cm.total).toBe(47950);
    expect(report.sections[1].total).toBe(1200);
    expect(report.total).toBe(49150);
  });

  it('keeps a label saved before the money register, after the real accounts', () => {
    const r = groupExpenseReport(
      [e(9, 'cm', 'โอน TTB', '03', 100), ...rows],
      ['cm', 'lp'],
      accounts,
    );
    expect(r.sections[0].tables.map((t) => t.source)).toEqual([
      'บัญชีธนาคารสาขา',
      'เงินสดย่อย',
      'โอน TTB',
      NO_SOURCE,
    ]);
  });
});
