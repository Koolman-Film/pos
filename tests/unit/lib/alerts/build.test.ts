import { describe, it, expect } from 'vitest';

import type { WsOrder } from '@/components/wholesale/types';
import { buildAlerts, type AlertInput } from '@/lib/alerts/build';
import { actionableAlerts, urgentItemIds } from '@/lib/alerts/types';

/**
 * การแจ้งเตือน — who is told what.
 *
 * The rules agreed with the shop, pinned: a person is only told about work they
 * can do; ผู้บริหาร/แอดมิน see every approval and every bill; a rep with a linked
 * login sees the bills for their own POs; and no alert carries a day count.
 */

const TODAY = '2026-09-14';

const po = (over: Partial<WsOrder>): WsOrder =>
  ({
    id: 'WS-NT-0001',
    shop: 'north',
    customerId: 1,
    status: 'รอจัดส่ง',
    dueAt: '',
    salesBy: 'โหน่ง',
    items: [{ name: 'ฟิล์ม', qty: 1, listPrice: 1000, requestedPrice: 1000, reason: '' }],
    returns: [],
    adjustments: [],
    payments: [],
    ...over,
  }) as WsOrder;

const pay = (over: Record<string, unknown>) =>
  ({
    amount: 1000,
    method: 'เช็ค',
    date: '2026-09-01',
    ...over,
  }) as unknown as WsOrder['payments'][number];

const EXEC_CAPS = [
  'wholesale.priceApproval',
  'wholesale.badDebt',
  'wholesale.confirmPayment',
  'wholesale.updateStatus',
  'accounting.addExpense',
  'stock.approveWithdraw',
];
const SALES_CAPS = ['wholesale.updateStatus'];

function input(over: Partial<AlertInput> & { caps?: string[]; navs?: string[] } = {}): AlertInput {
  const caps = new Set(over.caps ?? EXEC_CAPS);
  const navs = new Set(over.navs ?? ['wholesale', 'list', 'stock', 'money']);
  return {
    today: TODAY,
    can: (c) => caps.has(c),
    hasNav: (n) => navs.has(n),
    myRepNames: [],
    orders: [],
    unpaidTickets: [],
    expenses: [],
    withdrawals: [],
    lowStock: [],
    pettyTopups: [],
    expiringPolicies: [],
    ...over,
  };
}

const keys = (alerts: ReturnType<typeof buildAlerts>) => alerts.map((a) => a.key);
const find = (alerts: ReturnType<typeof buildAlerts>, key: string) =>
  alerts.find((a) => a.key === key);

describe('buildAlerts — ผู้บริหาร/แอดมิน', () => {
  const orders = [
    po({
      id: 'WS-NT-0010',
      status: 'รออนุมัติราคา',
      items: [{ name: 'ฟิล์ม', qty: 1, listPrice: 1200, requestedPrice: 1000, reason: '' }],
    }),
    po({ id: 'WS-NT-0011', status: 'ค้างชำระ' }),
    po({ id: 'WS-NT-0012', dueAt: '2026-09-10' }),
    po({ id: 'WS-NT-0013', payments: [pay({ status: 'แจ้งแล้ว', chequeDate: '2026-09-14' })] }),
  ];

  it('sees the approvals and the bills', () => {
    const a = buildAlerts(input({ orders }));
    expect(keys(a)).toEqual(
      expect.arrayContaining([
        'po.priceApproval',
        'po.badDebt',
        'receivable.overdue',
        'cheque.due',
      ]),
    );
  });

  it('puts ด่วน first', () => {
    const a = buildAlerts(input({ orders }));
    const levels = a.map((x) => x.level);
    expect(levels.indexOf('urgent')).toBe(0);
    expect(levels.lastIndexOf('urgent')).toBeLessThan(levels.indexOf('todo'));
  });

  it('writes messages, never day counts', () => {
    const a = buildAlerts(
      input({
        orders,
        unpaidTickets: [{ id: 'JT-CM-00001' }],
        expenses: [{ id: 1, dueAt: '2026-09-01' }],
        withdrawals: [{ id: 1 }],
        lowStock: [{ id: 1, name: 'ฟิล์ม' }],
        pettyTopups: [{ id: 1 }],
        expiringPolicies: [{ id: 1, plate: 'กข 1234' }],
      }),
    );
    for (const alert of a) expect(alert.title).not.toMatch(/\d/);
  });
});

describe('buildAlerts — ใครเห็นอะไร', () => {
  const discounted = po({
    id: 'WS-NT-0020',
    status: 'รออนุมัติราคา',
    items: [{ name: 'ฟิล์ม', qty: 1, listPrice: 1200, requestedPrice: 1000, reason: '' }],
  });

  it('does not tell someone about approvals they cannot give', () => {
    const a = buildAlerts(input({ caps: SALES_CAPS, orders: [discounted] }));
    expect(find(a, 'po.priceApproval')).toBeUndefined();
    expect(find(a, 'po.badDebt')).toBeUndefined();
    expect(find(a, 'cheque.due')).toBeUndefined();
  });

  it('shows a rep with a linked login only the bills for their own POs', () => {
    const orders = [
      po({ id: 'WS-NT-0030', salesBy: 'โหน่ง', dueAt: '2026-09-10' }),
      po({ id: 'WS-NT-0031', salesBy: 'เคน', dueAt: '2026-09-10' }),
      // A "โหน่ง" in another branch is someone else.
      po({ id: 'WS-CM-0032', shop: 'cm', salesBy: 'โหน่ง', dueAt: '2026-09-10' }),
    ];
    const a = buildAlerts(
      input({ caps: SALES_CAPS, orders, myRepNames: [{ shop: 'north', name: 'โหน่ง' }] }),
    );
    const overdue = find(a, 'receivable.overdue')!;
    expect(overdue.itemIds).toEqual(['overdue:WS-NT-0030']);
    expect(overdue.href).toBe(`/wholesale?flag=overdue&sale=${encodeURIComponent('โหน่ง')}`);
  });

  it('shows someone in the module who is not a rep the whole branch', () => {
    const orders = [
      po({ id: 'WS-NT-0030', salesBy: 'โหน่ง', dueAt: '2026-09-10' }),
      po({ id: 'WS-NT-0031', salesBy: 'เคน', dueAt: '2026-09-10' }),
    ];
    const a = buildAlerts(input({ caps: SALES_CAPS, orders }));
    expect(find(a, 'receivable.overdue')?.count).toBe(2);
  });

  it('shows ผู้บริหาร every bill even when their login is linked to a rep', () => {
    const orders = [
      po({ id: 'WS-NT-0030', salesBy: 'โหน่ง', dueAt: '2026-09-10' }),
      po({ id: 'WS-NT-0031', salesBy: 'เคน', dueAt: '2026-09-10' }),
    ];
    const a = buildAlerts(input({ orders, myRepNames: [{ shop: 'north', name: 'โหน่ง' }] }));
    expect(find(a, 'receivable.overdue')?.count).toBe(2);
  });

  it('shows nothing from a section that was not loaded', () => {
    expect(buildAlerts(input({ orders: null, unpaidTickets: null, expenses: null }))).toEqual([]);
  });
});

describe('buildAlerts — กฎของแต่ละเรื่อง', () => {
  it('counts a cheque on or after its date, not before', () => {
    const a = buildAlerts(
      input({
        orders: [
          po({ id: 'A', payments: [pay({ status: 'แจ้งแล้ว', chequeDate: '2026-09-14' })] }),
          po({ id: 'B', payments: [pay({ status: 'แจ้งแล้ว', chequeDate: '2026-09-15' })] }),
        ],
      }),
    );
    expect(find(a, 'cheque.due')?.itemIds).toEqual(['cheque:A']);
  });

  it('calls a bill due soon within the next few days, and not further out', () => {
    const a = buildAlerts(
      input({
        orders: [po({ id: 'SOON', dueAt: '2026-09-17' }), po({ id: 'LATER', dueAt: '2026-09-18' })],
      }),
    );
    expect(find(a, 'receivable.dueSoon')?.itemIds).toEqual(['duesoon:SOON']);
  });

  it('does not chase a bill that has been paid', () => {
    const a = buildAlerts(
      input({
        orders: [
          po({ id: 'PAID', dueAt: '2026-09-01', payments: [pay({ status: 'รับเงินแล้ว' })] }),
        ],
      }),
    );
    expect(find(a, 'receivable.overdue')).toBeUndefined();
  });

  it('keeps a bounced cheque urgent while the bill is still open', () => {
    const a = buildAlerts(
      input({ orders: [po({ id: 'BOUNCE', payments: [pay({ status: 'เด้ง' })] })] }),
    );
    expect(find(a, 'cheque.bounced')).toMatchObject({ level: 'urgent', count: 1 });
  });

  it('splits expenses into late and coming up', () => {
    const a = buildAlerts(
      input({
        expenses: [
          { id: 1, dueAt: '2026-09-13' },
          { id: 2, dueAt: '2026-09-16' },
        ],
      }),
    );
    expect(find(a, 'expense.overdue')).toMatchObject({ level: 'urgent', count: 1 });
    expect(find(a, 'expense.dueSoon')).toMatchObject({ level: 'todo', count: 1 });
  });

  it('keeps แจ้งให้ทราบ off the bell and out of acknowledgements', () => {
    const a = buildAlerts(
      input({
        orders: [po({ id: 'LATE', dueAt: '2026-09-01' })],
        lowStock: [{ id: 1, name: 'ฟิล์ม' }],
      }),
    );
    expect(actionableAlerts(a).map((x) => x.key)).not.toContain('stock.low');
    expect(urgentItemIds(a)).toEqual(['overdue:LATE']);
  });
});
