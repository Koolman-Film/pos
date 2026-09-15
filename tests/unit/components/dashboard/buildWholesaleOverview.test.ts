import { describe, it, expect } from 'vitest';

import {
  buildWholesaleOverview,
  type OverviewOrder,
} from '@/components/dashboard/buildWholesaleOverview';
import { buildTrend } from '@/components/dashboard/receivables';
import type { WholesaleRevenueLine } from '@/lib/domain/wholesaleRevenue';

/**
 * ขายส่งบนแดชบอร์ด.
 *
 * A wholesale-only branch used to open onto a dashboard built entirely from
 * tickets. These pin the card that fixes it, and that its numbers are the ones
 * the rest of the system already agrees on.
 */

const TODAY = '2026-09-15';

const po = (over: Partial<OverviewOrder>): OverviewOrder => ({
  id: 'WS-NT-0001',
  shop: 'north',
  customerId: 1,
  status: 'จัดส่งแล้ว',
  deliveredAt: '2026-09-05',
  createdAt: '2026-09-01T03:00:00Z',
  dueAt: '',
  salesBy: 'โหน่ง',
  items: [{ name: 'ฟิล์ม', qty: 10, requestedPrice: 1000 }],
  returns: [],
  adjustments: [],
  payments: [],
  ...over,
});

const line = (orderId: string, amount: number): WholesaleRevenueLine => ({
  orderId,
  shop: 'north',
  on: '2026-09-05',
  kind: 'ขาย',
  item: 'ฟิล์ม',
  amount,
});

const customers = [
  { id: 1, name: 'ร้านออโต้สไตล์' },
  { id: 2, name: 'ร้านดีคาร์แคร์' },
];

const build = (orders: OverviewOrder[], revenueLines: WholesaleRevenueLine[] = []) =>
  buildWholesaleOverview({ orders, customers, revenueLines, today: TODAY });

describe('buildWholesaleOverview', () => {
  it('shows nothing for a branch with no POs', () => {
    expect(build([])).toBeNull();
  });

  it('counts the POs in each open step, and leaves closed ones out of "open"', () => {
    const d = build([
      po({ id: 'A', status: 'รออนุมัติราคา', deliveredAt: null }),
      po({ id: 'B', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'C', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'D', status: 'ปิดงานแล้ว' }),
    ])!;
    expect(d.openCount).toBe(3);
    expect(d.statusCounts).toEqual([
      { status: 'รออนุมัติราคา', count: 1 },
      { status: 'รอจัดส่ง', count: 2 },
      { status: 'จัดส่งแล้ว', count: 0 },
      { status: 'ค้างชำระ', count: 0 },
    ]);
  });

  it('owes only for goods that have gone out and are not paid for', () => {
    const d = build([
      po({ id: 'SENT' }),
      po({ id: 'NOT-SENT', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'PAID', payments: [{ amount: 10000, status: 'รับเงินแล้ว' }] }),
    ])!;
    expect(d.owing).toEqual({ count: 1, amount: 10000 });
  });

  it('uses the same overdue and due-soon rules as the alerts', () => {
    const d = build([
      po({ id: 'LATE', dueAt: '2026-09-10' }),
      po({ id: 'SOON', dueAt: '2026-09-17' }),
      po({ id: 'LATER', dueAt: '2026-09-25' }),
    ])!;
    expect(d.overdue).toEqual({ count: 1, amount: 10000 });
    expect(d.dueSoon).toEqual({ count: 1, amount: 10000 });
  });

  it('adds up the period sales, and credits each rep with their own', () => {
    const d = build(
      [
        po({ id: 'A', salesBy: 'โหน่ง' }),
        po({ id: 'B', salesBy: 'เคน' }),
        po({ id: 'C', salesBy: 'เคน' }),
      ],
      [line('A', 5000), line('B', 23000), line('C', 2000)],
    )!;
    expect(d.sales).toBe(30000);
    expect(d.byRep.map((r) => [r.name, r.sales])).toEqual([
      ['เคน', 25000],
      ['โหน่ง', 5000],
    ]);
    expect(d.byRep[0]).toMatchObject({ openCount: 2, owing: 20000 });
  });

  it('lists the newest POs first with customer and total', () => {
    const d = build([
      po({ id: 'OLD', createdAt: '2026-08-01T00:00:00Z' }),
      po({ id: 'NEW', customerId: 2, createdAt: '2026-09-14T00:00:00Z' }),
    ])!;
    expect(d.recent[0]).toMatchObject({ id: 'NEW', customer: 'ร้านดีคาร์แคร์', total: 10000 });
    expect(d.recent.map((r) => r.id)).toEqual(['NEW', 'OLD']);
  });
});

describe('buildTrend — ขายส่งอยู่ในเส้นรายได้', () => {
  it('puts wholesale revenue in its month on the year view', () => {
    const t = buildTrend([], [], 'all', 'year', '2569', '', '', [
      { shop: 'north', on: '2026-09-05', amount: 23000 },
    ]);
    expect(t.revenue[8]).toBe(23000);
  });

  it('respects the branch on screen', () => {
    const t = buildTrend([], [], 'cm', 'year', '2569', '', '', [
      { shop: 'north', on: '2026-09-05', amount: 23000 },
    ]);
    expect(t.revenue[8]).toBe(0);
  });
});
