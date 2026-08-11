import { Suspense } from 'react';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { ticketTotal } from '@/lib/domain/tickets';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';
import type { StatusConfig } from '@/components/ui/Badge';
import { Dashboard } from '@/components/dashboard/Dashboard';
import type {
  PendingApprovals,
  RecentJob,
  StatusTotal,
  UpcomingTicket,
} from '@/components/dashboard/Dashboard';
import { updateTicketStatus } from '@/app/(app)/tickets/actions';
import { DashboardFilter } from '@/components/dashboard/DashboardFilter';
import {
  buildTrend,
  computePayables,
  computeReceivables,
  type TrendExpense,
  type TrendTicket,
} from '@/components/dashboard/receivables';
import type { CalendarTicket } from '@/components/dashboard/JobCalendar';

// Aggregated server-side per the plan's Task 13, Step 5 model: fetch the raw rows
// (RLS already scopes them to the caller's shops), map them into the domain
// shapes, then compute the same numbers the prototype computed client-side. The
// shop/period filter lives in the URL query string, read here to re-scope.

const num = (v: unknown) => Number(v ?? 0);
const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const supabase = await createClient();

  const [
    { data: ticketRows },
    { data: orderRows },
    { data: customerRows },
    { data: expenseRows },
    { data: pettyRows },
    { data: stockRows },
    { data: shopRows },
    { data: statusRows },
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, shop_id, customer_name, plate, brand, model, service_type, status, drop_off_date, ticket_items(category, booked, sold, sold_price, discount_type, discount_value), ticket_payments(amount), ticket_status_history(status, changed_at)',
      )
      // Soft-deleted tickets (migration 0013) are out of every figure on this
      // screen — revenue, job counts, the calendar and the bookings window.
      .is('deleted_at', null)
      .order('drop_off_date', { ascending: false }),
    supabase
      .from('orders')
      .select(
        'id, shop_id, customer_id, status, order_items(name, qty, list_price, requested_price), order_returns(item_name, qty), order_adjustments(amount), order_payments(amount)',
      ),
    supabase.from('wholesale_customers').select('id, name'),
    supabase
      .from('expenses')
      .select('id, shop_id, description, category, source, amount, status, paid_at, due_at'),
    supabase.from('petty_cash').select('shop_id, type, amount'),
    supabase.from('stock').select('category, shop_id, qty'),
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    supabase
      .from('statuses')
      .select('key, short, bg, text_color, dot, sort_order')
      .order('sort_order'),
  ]);

  // ---- Shop options for the filter (names + access) ----
  const shopNameById = new Map((shopRows ?? []).map((s) => [s.id, s.name]));
  const accessibleShops = session.accessibleShopIds.map((id) => ({
    id,
    name: shopNameById.get(id) ?? id,
  }));
  const allowAllShops = session.seesAllShops;

  // ---- Resolve the active filter from the URL ----
  const getStr = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const requestedShop = getStr('shop');
  const defaultShop = allowAllShops ? 'all' : (session.accessibleShopIds[0] ?? 'all');
  const shopFilter =
    requestedShop === 'all' || session.accessibleShopIds.includes(requestedShop)
      ? requestedShop || defaultShop
      : defaultShop;
  const period = getStr('period') || DEFAULT_PERIOD;
  const now = new Date();
  // `pv` carries a month (`YYYY-MM`) or a Buddhist-era year depending on the
  // mode, and switching mode leaves the other mode's value behind in the URL.
  // Take it only when it is the right shape for the current mode, so the month
  // picker and the year list always show a value they actually offer.
  const requestedPeriodValue = getStr('pv');
  const periodValue =
    period === 'year'
      ? /^\d{4}$/.test(requestedPeriodValue)
        ? requestedPeriodValue
        : String(now.getFullYear() + 543)
      : period === 'month'
        ? /^\d{4}-\d{2}$/.test(requestedPeriodValue)
          ? requestedPeriodValue
          : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        : '';
  const rangeStart = getStr('rs');
  const rangeEnd = getStr('re');

  // ---- Map raw rows into domain shapes ----
  const tickets = (ticketRows ?? []).map((t) => ({
    id: t.id,
    shop: t.shop_id,
    customer: t.customer_name,
    plate: t.plate,
    brand: t.brand,
    model: t.model,
    serviceType: t.service_type,
    status: t.status,
    dropOff: toDate(t.drop_off_date),
    // Distinct product categories, and the product names the prototype shows on
    // the recent-jobs rows (`i.sold || i.booked`).
    categories: [...new Set((t.ticket_items ?? []).map((i) => i.category).filter(Boolean))],
    products: [...new Set((t.ticket_items ?? []).map((i) => i.sold || i.booked).filter(Boolean))],
    items: (t.ticket_items ?? []).map((i) => ({
      soldPrice: num(i.sold_price),
      discountType: (i.discount_type ?? undefined) as 'percent' | 'amount' | undefined,
      discountValue: i.discount_value == null ? undefined : num(i.discount_value),
    })),
    payments: (t.ticket_payments ?? []).map((p) => ({ amount: num(p.amount) })),
    statusHistory: (t.ticket_status_history ?? []).map((h) => ({
      status: h.status,
      changedAt: new Date(h.changed_at),
    })),
  }));

  const orders = (orderRows ?? []).map((o) => ({
    id: o.id,
    shop: o.shop_id,
    customerId: num(o.customer_id),
    status: o.status,
    items: (o.order_items ?? []).map((i) => ({
      name: i.name,
      qty: num(i.qty),
      listPrice: num(i.list_price),
      requestedPrice: num(i.requested_price),
    })),
    returns: (o.order_returns ?? []).map((r) => ({ item: r.item_name, qty: num(r.qty) })),
    adjustments: (o.order_adjustments ?? []).map((a) => ({ amount: num(a.amount) })),
    payments: (o.order_payments ?? []).map((p) => ({ amount: num(p.amount) })),
  }));

  const customers = (customerRows ?? []).map((c) => ({ id: num(c.id), name: c.name }));

  const expenses = (expenseRows ?? []).map((e) => ({
    id: num(e.id),
    shop: e.shop_id,
    desc: e.description,
    category: e.category,
    source: e.source,
    amount: num(e.amount),
    status: e.status,
    paidAt: toDate(e.paid_at),
    due: e.due_at
      ? new Date(`${e.due_at}T00:00:00`).toLocaleDateString('th-TH', {
          day: 'numeric',
          month: 'short',
        })
      : '',
  }));

  // ---- Aggregate (same output as the prototype's inline client math) ----
  const inShop = (shop: string) => shopFilter === 'all' || shop === shopFilter;
  // The period control used to move only the trend chart; the stat cards read
  // every row the caller could see, whatever the filter said. They now go
  // through the same window as every other module (`lib/domain/period.ts`),
  // attributing a ticket to its drop-off date and an expense to its paid date —
  // the same two dates `buildTrend` plots.
  const inPeriod = (d: Date | null) => isInPeriod(d, period, periodValue, rangeStart, rangeEnd);

  // Shop-scoped but period-independent: the 7-day booking window and the
  // receivables/payables lists are "as of now" figures, not period totals.
  const shopTickets = tickets.filter((t) => inShop(t.shop));
  const visibleTickets = shopTickets.filter((t) => inPeriod(t.dropOff));

  const arItems = computeReceivables(tickets, orders, customers, shopFilter);
  const apItems = computePayables(expenses, shopFilter);

  const revenue = visibleTickets.reduce((s, t) => s + ticketTotal(t), 0);

  const paidExpenses = expenses.filter(
    (e) => inShop(e.shop) && e.status === 'จ่ายแล้ว' && inPeriod(e.paidAt),
  );
  const totalExpenses = paidExpenses.reduce((s, e) => s + e.amount, 0);
  // Petty cash is a running balance, not a period total: `petty_cash` rows carry
  // no date to window on, and a month-scoped "cash on hand" would be wrong. Both
  // legs therefore stay all-time.
  const cashTopups = (pettyRows ?? [])
    .filter((p) => inShop(p.shop_id) && p.type === 'เติมเงิน')
    .reduce((s, p) => s + num(p.amount), 0);
  const cashSpent = expenses
    .filter((e) => inShop(e.shop) && e.source === 'เงินสดย่อย' && e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + e.amount, 0);
  const cashBalance = cashTopups - cashSpent;

  const shopBreakdown = accessibleShops.map((s) => ({
    name: s.name,
    count: tickets.filter((t) => t.shop === s.id && inPeriod(t.dropOff)).length,
  }));

  const expenseCategories = [...new Set(paidExpenses.map((e) => e.category))];
  const expenseByCategory = expenseCategories.map((cat) => ({
    name: cat,
    amount: paidExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  }));

  const visibleStock = (stockRows ?? []).filter((s) => inShop(s.shop_id));
  const stockCats = [...new Set(visibleStock.map((s) => s.category))];
  const stockByCategory = stockCats.map((cat) => ({
    name: cat,
    qty: visibleStock.filter((s) => s.category === cat).reduce((s, i) => s + num(i.qty), 0),
  }));
  const stockTotal = visibleStock.reduce((s, i) => s + num(i.qty), 0);

  const trendTickets: TrendTicket[] = tickets.map((t) => ({
    shop: t.shop,
    dropOff: t.dropOff,
    items: t.items,
    payments: t.payments,
  }));
  const trendExpenses: TrendExpense[] = expenses.map((e) => ({
    shop: e.shop,
    amount: e.amount,
    status: e.status,
    paidAt: e.paidAt,
  }));
  const trend = buildTrend(
    trendTickets,
    trendExpenses,
    shopFilter,
    period,
    periodValue,
    rangeStart,
    rangeEnd,
  );

  // ---- Row 3 / Row 4 widgets (correction C13) ----
  const statuses: StatusConfig[] = (statusRows ?? []).map((s) => ({
    key: s.key,
    short: s.short,
    bg: s.bg,
    text: s.text_color,
    dot: s.dot,
  }));

  // Per-status bars over the shop-filtered set. The prototype divides by
  // `visible.length || 1` so an empty set yields 0% rather than NaN.
  const statusDenominator = visibleTickets.length || 1;
  const statusTotals: StatusTotal[] = statuses.map((s) => {
    const count = visibleTickets.filter((t) => t.status === s.key).length;
    return { key: s.key, count, pct: Math.round((count / statusDenominator) * 100) };
  });

  // Bookings from today through 7 days out, ascending — prototype `isWithinDays`
  // (:109) inlined here because the boundary is what matters: from today at
  // 00:00:00.000 through the 7th day at 23:59:59.999.
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 7);
  windowEnd.setHours(23, 59, 59, 999);

  // Period-independent on purpose: this card is the next seven days, which the
  // selected month/year has no say over.
  const upcoming: UpcomingTicket[] = shopTickets
    .filter((t) => t.dropOff && t.dropOff >= windowStart && t.dropOff <= windowEnd)
    .sort((a, b) => (a.dropOff as Date).getTime() - (b.dropOff as Date).getTime())
    .map((t) => ({
      id: t.id,
      customer: t.customer,
      brand: t.brand,
      model: t.model,
      plate: t.plate,
      serviceType: t.serviceType,
      categories: t.categories,
      dropOff: t.dropOff as Date,
    }));

  // Pending approvals count across ALL orders the caller can see, not the
  // shop-filtered subset — matching the prototype, which reads `orders` directly
  // rather than `wsVisible` here (:896-897).
  const pendingApprovals: PendingApprovals = {
    discount: orders.filter(
      (o) => o.status === 'รออนุมัติราคา' && o.items.some((i) => i.requestedPrice < i.listPrice),
    ).length,
    badDebt: orders.filter((o) => o.status === 'ค้างชำระ').length,
  };

  // Newest five in scope. The query already sorts by drop-off descending, which
  // is the order the prototype's seeded array happens to be in.
  const recentJobs: RecentJob[] = visibleTickets.slice(0, 5).map((t) => ({
    id: t.id,
    customer: t.customer,
    brand: t.brand,
    model: t.model,
    plate: t.plate,
    serviceType: t.serviceType,
    categories: t.categories,
    products: t.products,
    status: t.status,
  }));

  const calendarTickets: CalendarTicket[] = tickets
    .filter((t) => t.dropOff)
    .map((t) => ({
      id: t.id,
      shop: t.shop,
      status: t.status,
      dropOff: t.dropOff as Date,
      statusHistory: t.statusHistory,
    }));

  return (
    <Dashboard
      hasDashboardWidget={session.hasDashboardWidget}
      revenue={revenue}
      totalExpenses={totalExpenses}
      cashBalance={cashBalance}
      arItems={arItems}
      apItems={apItems}
      shopBreakdown={shopBreakdown}
      expenseByCategory={expenseByCategory}
      stockByCategory={stockByCategory}
      stockTotal={stockTotal}
      trend={trend}
      calendarTickets={calendarTickets}
      shopFilter={shopFilter}
      caption={periodCaption(period, periodValue, rangeStart, rangeEnd, now)}
      statuses={statuses}
      totalJobs={visibleTickets.length}
      statusTotals={statusTotals}
      upcoming={upcoming}
      pendingApprovals={pendingApprovals}
      recentJobs={recentJobs}
      canDo={session.canDo}
      onUpdateTicketStatus={updateTicketStatus}
      filter={
        <Suspense fallback={null}>
          <DashboardFilter
            shopFilter={shopFilter}
            period={period}
            periodValue={periodValue}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            allowAllShops={allowAllShops}
            shopOptions={accessibleShops}
          />
        </Suspense>
      }
    />
  );
}
