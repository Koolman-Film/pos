import { isDueSoon, isOverdue, outstanding, type BillOrder } from '@/lib/alerts/wholesale';
import { orderTotal } from '@/lib/domain/orders';

/**
 * ภาพรวมขายส่งบนแดชบอร์ด.
 *
 * Every card that a sales login may see on the dashboard was built from
 * tickets, so a branch that only sells wholesale — Finnix North — opened onto an
 * empty page, and โหน่ง/เคน had nothing about their own work on it at all.
 *
 * Nothing here is a new rule. The period sales are the PO payments received in
 * it (components/dashboard/cashSales.ts, the same receipts ยอดขายรวม adds up);
 * overdue and due-soon use the
 * predicates the bell and the wholesale list's `?flag=` filters use, so the
 * number on this card is the number of rows its link opens.
 *
 * What it shows is what the wholesale module already shows anyone who can open
 * it — PO totals, and sales per rep — so it is gated on that module, not on the
 * dashboard's money widgets.
 */

export type OverviewOrder = BillOrder & {
  id: string;
  shop: string;
  customerId: number;
  /** วันส่งของ — a PO is owed only once the goods have gone out. */
  deliveredAt: string | null;
  createdAt: string;
  salesBy: string;
};

export const WS_OPEN_STATUSES = ['รออนุมัติราคา', 'รอจัดส่ง', 'จัดส่งแล้ว', 'ค้างชำระ'] as const;

type Money = { count: number; amount: number };

export type WholesaleOverviewData = {
  /** POs not yet closed. */
  openCount: number;
  statusCounts: { status: string; count: number }[];
  /** ยอดขายส่งในช่วงที่เลือก. */
  sales: number;
  /** ค้างรับ — delivered, not closed, and not fully paid. */
  owing: Money;
  overdue: Money;
  dueSoon: Money;
  byRep: { name: string; openCount: number; sales: number; owing: number }[];
  recent: { id: string; customer: string; salesBy: string; total: number; status: string }[];
};

const OWES = 0.005;
const satang = (n: number) => Math.round(n * 100) / 100;
const owed = (list: OverviewOrder[]): Money => ({
  count: list.length,
  amount: satang(list.reduce((n, o) => n + outstanding(o), 0)),
});

export function buildWholesaleOverview({
  orders,
  customers,
  revenueLines,
  today,
}: {
  /** Already limited to the branch on screen; deleted POs already out. */
  orders: OverviewOrder[];
  customers: { id: number; name: string }[];
  /** Already limited to the branch and the period on screen. */
  revenueLines: { orderId: string; amount: number }[];
  today: string;
}): WholesaleOverviewData | null {
  // A branch that sells no wholesale gets no card, rather than a card of zeros.
  if (orders.length === 0) return null;

  const nameOf = new Map(customers.map((c) => [c.id, c.name]));
  const open = orders.filter((o) => o.status !== 'ปิดงานแล้ว');
  const owing = open.filter((o) => !!o.deliveredAt && outstanding(o) > OWES);
  const rep = (o: OverviewOrder) => (o.salesBy ?? '').trim();
  const repOfOrder = new Map(orders.map((o) => [o.id, rep(o)]));

  const byRep = [...new Set(orders.map(rep).filter(Boolean))]
    .map((name) => ({
      name,
      openCount: open.filter((o) => rep(o) === name).length,
      sales: satang(
        revenueLines
          .filter((l) => repOfOrder.get(l.orderId) === name)
          .reduce((n, l) => n + l.amount, 0),
      ),
      owing: satang(owing.filter((o) => rep(o) === name).reduce((n, o) => n + outstanding(o), 0)),
    }))
    .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name, 'th'));

  return {
    openCount: open.length,
    statusCounts: WS_OPEN_STATUSES.map((status) => ({
      status,
      count: orders.filter((o) => o.status === status).length,
    })),
    sales: satang(revenueLines.reduce((n, l) => n + l.amount, 0)),
    owing: owed(owing),
    overdue: owed(orders.filter((o) => isOverdue(o, today))),
    dueSoon: owed(orders.filter((o) => isDueSoon(o, today))),
    byRep,
    recent: [...orders]
      .sort(
        (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id),
      )
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        customer: nameOf.get(o.customerId) ?? 'ไม่ระบุลูกค้า',
        salesBy: rep(o),
        total: satang(orderTotal(o)),
        status: o.status,
      })),
  };
}
