import { describe, it, expect } from 'vitest';

import {
  buildTrend,
  computePayables,
  computeReceivables,
  type TrendExpense,
  type TrendTicket,
} from '@/components/dashboard/receivables';

describe('computeReceivables', () => {
  it('includes an unpaid ticket and an unpaid wholesale order, sorted by amount descending', () => {
    const tickets = [
      { id: 'JT-1', shop: 'cm', customer: 'A', plate: '1กก', items: [{ soldPrice: 1000 }], payments: [] },
    ];
    const orders = [
      {
        id: 'WS-1',
        shop: 'cm',
        customerId: 1,
        items: [{ name: 'X', qty: 1, requestedPrice: 5000 }],
        returns: [],
        adjustments: [],
        payments: [],
      },
    ];
    const customers = [{ id: 1, name: 'ร้านทดสอบ' }];
    const result = computeReceivables(tickets, orders, customers, 'all');
    expect(result.map((r) => r.source)).toEqual(['ขายส่ง', 'ใบงานติดตั้ง']); // 5000 > 1000, descending
    expect(result[0].amount).toBe(5000);
  });

  it('excludes a fully-paid ticket', () => {
    const tickets = [
      {
        id: 'JT-1',
        shop: 'cm',
        customer: 'A',
        plate: '1กก',
        items: [{ soldPrice: 1000 }],
        payments: [{ amount: 1000 }],
      },
    ];
    expect(computeReceivables(tickets, [], [], 'all')).toHaveLength(0);
  });
});

describe('computePayables', () => {
  it('only includes expenses with status รอจ่าย, filtered by shop', () => {
    const expenses = [
      { id: 1, shop: 'cm', desc: 'A', category: 'ค่าเช่า', amount: 1000, status: 'รอจ่าย', due: '25 ก.ค.' },
      { id: 2, shop: 'lp', desc: 'B', category: 'ค่าเช่า', amount: 2000, status: 'รอจ่าย', due: '25 ก.ค.' },
      { id: 3, shop: 'cm', desc: 'C', category: 'ค่าเช่า', amount: 500, status: 'จ่ายแล้ว', due: '' },
    ];
    expect(computePayables(expenses, 'cm')).toEqual([
      { id: 1, name: 'A', amount: 1000, source: 'ค่าเช่า', due: '25 ก.ค.' },
    ]);
  });
});

describe('buildTrend', () => {
  it('produces a 7-point daily series for the default (today) period with profit = revenue − expense', () => {
    const today = new Date();
    const tickets: TrendTicket[] = [
      { shop: 'cm', dropOff: today, items: [{ soldPrice: 3000 }], payments: [] },
    ];
    const expenses: TrendExpense[] = [
      { shop: 'cm', amount: 1000, status: 'จ่ายแล้ว', paidAt: today },
      { shop: 'cm', amount: 999, status: 'รอจ่าย', paidAt: today }, // unpaid → excluded
    ];
    const trend = buildTrend(tickets, expenses, 'all', 'today', '', '', '');

    expect(trend.labels).toHaveLength(7);
    expect(trend.revenue).toHaveLength(7);
    expect(trend.expense).toHaveLength(7);
    // Today is the last bucket.
    expect(trend.revenue[6]).toBe(3000);
    expect(trend.expense[6]).toBe(1000); // the รอจ่าย expense is not counted
    trend.profit.forEach((p, i) => expect(p).toBe(trend.revenue[i] - trend.expense[i]));
  });

  it('scopes to the selected shop', () => {
    const today = new Date();
    const tickets: TrendTicket[] = [
      { shop: 'cm', dropOff: today, items: [{ soldPrice: 3000 }], payments: [] },
      { shop: 'lp', dropOff: today, items: [{ soldPrice: 5000 }], payments: [] },
    ];
    const trend = buildTrend(tickets, [], 'lp', 'today', '', '', '');
    expect(trend.revenue[6]).toBe(5000);
  });
});
