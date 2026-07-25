// Pure dashboard aggregation, colocated with the Dashboard module (Task 13).
//
// The plan (Step 3) sketched these under `lib/domain/dashboard.ts`, but the Wave-4
// ownership rules forbid touching `lib/**` (a shared, concurrently-read tree), so
// they live here in the dashboard module's own directory instead. They build on
// the Task 10 primitives (`ticketTotal`/`ticketPaid`/`orderTotal`/`orderPaid`)
// rather than re-implementing them.
//
// `computeReceivables`/`computePayables` reproduce the inline ลูกหนี้/เจ้าหนี้ logic
// from reference/v0.4/finnix-film.html:666-680 exactly (same filtering, same
// `name` composition, same sort). `buildTrend` replaces the prototype's
// seeded-random `buildTrendSeries` (:112-139) with a real aggregation over the
// fetched rows, keeping the identical `{labels,revenue,expense,profit}` shape so
// `LineChart` needs no changes — the one deliberate "same visual, real data"
// swap called out in the plan.

import { ticketTotal, ticketPaid, type TicketForTotals } from '@/lib/domain/tickets';
import { orderTotal, orderPaid, type OrderForTotals } from '@/lib/domain/orders';

export type ARItem = {
  id: string;
  name: string;
  amount: number;
  source: 'ใบงานติดตั้ง' | 'ขายส่ง';
};
export type APItem = { id: number; name: string; amount: number; source: string; due: string };

export type TrendSeries = {
  labels: string[];
  revenue: number[];
  expense: number[];
  profit: number[];
};

export function computeReceivables(
  tickets: (TicketForTotals & { id: string; shop: string; customer: string; plate: string })[],
  orders: (OrderForTotals & {
    id: string;
    shop: string;
    customerId: number;
    payments: { amount: number }[];
  })[],
  customers: { id: number; name: string }[],
  shopFilter: string,
): ARItem[] {
  const visible = tickets.filter((t) => shopFilter === 'all' || t.shop === shopFilter);
  const arFromTickets: ARItem[] = visible
    .filter((t) => ticketTotal(t) > ticketPaid(t))
    .map((t) => ({
      id: t.id,
      name: `${t.customer} (${t.plate})`,
      amount: ticketTotal(t) - ticketPaid(t),
      source: 'ใบงานติดตั้ง' as const,
    }));

  const wsVisible = orders.filter((o) => shopFilter === 'all' || o.shop === shopFilter);
  const arFromOrders: ARItem[] = wsVisible
    .filter((o) => orderTotal(o) > orderPaid(o))
    .map((o) => ({
      id: o.id,
      name: `${customers.find((c) => c.id === o.customerId)?.name ?? 'ยังไม่ระบุลูกค้า'} (${o.id})`,
      amount: orderTotal(o) - orderPaid(o),
      source: 'ขายส่ง' as const,
    }));

  return [...arFromTickets, ...arFromOrders].sort((a, b) => b.amount - a.amount);
}

export function computePayables(
  expenses: {
    id: number;
    shop: string;
    desc: string;
    category: string;
    amount: number;
    status: string;
    due?: string;
  }[],
  shopFilter: string,
): APItem[] {
  return expenses
    .filter((e) => (shopFilter === 'all' || e.shop === shopFilter) && e.status === 'รอจ่าย')
    .map((e) => ({
      id: e.id,
      name: e.desc,
      amount: Number(e.amount),
      source: e.category,
      due: e.due ?? '',
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- Real revenue/expense/profit trend (replaces buildTrendSeries) ----

export type TrendTicket = TicketForTotals & { shop: string; dropOff: Date | null };
export type TrendExpense = { shop: string; amount: number; status: string; paidAt: Date | null };

const MONTH_LABELS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Aggregates the already-fetched rows into a daily (or monthly, for the year
 * view) revenue/expense/profit series over the selected period. Revenue is
 * attributed to a ticket's drop-off date via `ticketTotal`; expense to a paid
 * expense's `paidAt`. Profit is revenue − expense. Same output shape as the
 * prototype's synthetic series.
 */
export function buildTrend(
  tickets: TrendTicket[],
  expenses: TrendExpense[],
  shopFilter: string,
  period: string,
  periodValue: string,
  rangeStart: string,
  rangeEnd: string,
): TrendSeries {
  const inShop = (shop: string) => shopFilter === 'all' || shop === shopFilter;
  const visibleTickets = tickets.filter((t) => inShop(t.shop) && t.dropOff);
  const paidExpenses = expenses.filter(
    (e) => inShop(e.shop) && e.status === 'จ่ายแล้ว' && e.paidAt,
  );

  // Year view: 12 monthly buckets for the selected Buddhist-era year.
  if (period === 'year') {
    const beYear = Number(periodValue) || new Date().getFullYear() + 543;
    const ceYear = beYear - 543;
    const revenue = new Array(12).fill(0);
    const expense = new Array(12).fill(0);
    for (const t of visibleTickets) {
      if (t.dropOff!.getFullYear() === ceYear) revenue[t.dropOff!.getMonth()] += ticketTotal(t);
    }
    for (const e of paidExpenses) {
      if (e.paidAt!.getFullYear() === ceYear)
        expense[e.paidAt!.getMonth()] += Number(e.amount || 0);
    }
    return {
      labels: MONTH_LABELS,
      revenue,
      expense,
      profit: revenue.map((r, i) => r - expense[i]),
    };
  }

  // Determine the day range for today/month/range.
  const today = startOfDay(new Date());
  let start: Date;
  let end: Date;
  if (period === 'month') {
    const [y, m] = (periodValue || '').split('-').map(Number);
    const year = y || today.getFullYear();
    const month = (m || today.getMonth() + 1) - 1;
    start = new Date(year, month, 1);
    end = new Date(year, month + 1, 0);
  } else if (period === 'range') {
    start = rangeStart
      ? startOfDay(new Date(rangeStart))
      : new Date(today.getTime() - 6 * 86400000);
    end = rangeEnd ? startOfDay(new Date(rangeEnd)) : today;
  } else {
    // 'today' (default): the trailing 7 days.
    start = new Date(today.getTime() - 6 * 86400000);
    end = today;
  }

  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const step = days > 30 ? Math.ceil(days / 20) : 1;

  const revByDay = new Map<string, number>();
  for (const t of visibleTickets)
    revByDay.set(dayKey(t.dropOff!), (revByDay.get(dayKey(t.dropOff!)) || 0) + ticketTotal(t));
  const expByDay = new Map<string, number>();
  for (const e of paidExpenses)
    expByDay.set(dayKey(e.paidAt!), (expByDay.get(dayKey(e.paidAt!)) || 0) + Number(e.amount || 0));

  const labels: string[] = [];
  const revenue: number[] = [];
  const expense: number[] = [];
  const profit: number[] = [];
  for (let i = 0; i < days; i += step) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    // For a coarse step (long ranges), fold every day in the bucket window.
    let r = 0;
    let e = 0;
    for (let j = 0; j < step; j++) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() + j);
      if (dd > end) break;
      r += revByDay.get(dayKey(dd)) || 0;
      e += expByDay.get(dayKey(dd)) || 0;
    }
    revenue.push(r);
    expense.push(e);
    profit.push(r - e);
  }

  return { labels, revenue, expense, profit };
}
