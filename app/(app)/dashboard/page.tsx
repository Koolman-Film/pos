import { Suspense } from 'react';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { ticketTotal, ticketPaid } from '@/lib/domain/tickets';
import { Dashboard } from '@/components/dashboard/Dashboard';
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
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, shop_id, customer_name, plate, status, drop_off_date, ticket_items(sold_price, discount_type, discount_value), ticket_payments(amount), ticket_status_history(status, changed_at)'
      ),
    supabase
      .from('orders')
      .select(
        'id, shop_id, customer_id, order_items(name, qty, requested_price), order_returns(item_name, qty), order_adjustments(amount), order_payments(amount)'
      ),
    supabase.from('wholesale_customers').select('id, name'),
    supabase
      .from('expenses')
      .select('id, shop_id, description, category, source, amount, status, paid_at, due_at'),
    supabase.from('petty_cash').select('shop_id, type, amount'),
    supabase.from('stock').select('category, shop_id, qty'),
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
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
  const defaultShop = allowAllShops ? 'all' : session.accessibleShopIds[0] ?? 'all';
  const shopFilter =
    requestedShop === 'all' || session.accessibleShopIds.includes(requestedShop)
      ? requestedShop || defaultShop
      : defaultShop;
  const period = getStr('period') || 'today';
  const now = new Date();
  const periodValue =
    getStr('pv') ||
    (period === 'year'
      ? String(now.getFullYear() + 543)
      : period === 'month'
        ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        : '');
  const rangeStart = getStr('rs');
  const rangeEnd = getStr('re');

  // ---- Map raw rows into domain shapes ----
  const tickets = (ticketRows ?? []).map((t) => ({
    id: t.id,
    shop: t.shop_id,
    customer: t.customer_name,
    plate: t.plate,
    status: t.status,
    dropOff: toDate(t.drop_off_date),
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
    items: (o.order_items ?? []).map((i) => ({
      name: i.name,
      qty: num(i.qty),
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
      ? new Date(`${e.due_at}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      : '',
  }));

  // ---- Aggregate (same output as the prototype's inline client math) ----
  const inShop = (shop: string) => shopFilter === 'all' || shop === shopFilter;
  const visibleTickets = tickets.filter((t) => inShop(t.shop));

  const arItems = computeReceivables(tickets, orders, customers, shopFilter);
  const apItems = computePayables(expenses, shopFilter);

  const revenue = visibleTickets.reduce((s, t) => s + ticketTotal(t), 0);
  const outstanding = visibleTickets.reduce((s, t) => s + Math.max(ticketTotal(t) - ticketPaid(t), 0), 0);

  const paidExpenses = expenses.filter((e) => inShop(e.shop) && e.status === 'จ่ายแล้ว');
  const totalExpenses = paidExpenses.reduce((s, e) => s + e.amount, 0);
  const cashTopups = (pettyRows ?? [])
    .filter((p) => inShop(p.shop_id) && p.type === 'เติมเงิน')
    .reduce((s, p) => s + num(p.amount), 0);
  const cashSpent = expenses
    .filter((e) => inShop(e.shop) && e.source === 'เงินสดย่อย' && e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + e.amount, 0);
  const cashBalance = cashTopups - cashSpent;

  const shopBreakdown = accessibleShops.map((s) => ({
    name: s.name,
    count: tickets.filter((t) => t.shop === s.id).length,
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
  const trend = buildTrend(trendTickets, trendExpenses, shopFilter, period, periodValue, rangeStart, rangeEnd);

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
      cashTopups={cashTopups}
      cashSpent={cashSpent}
      outstanding={outstanding}
      arItems={arItems}
      apItems={apItems}
      shopBreakdown={shopBreakdown}
      expenseByCategory={expenseByCategory}
      stockByCategory={stockByCategory}
      stockTotal={stockTotal}
      trend={trend}
      calendarTickets={calendarTickets}
      shopFilter={shopFilter}
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
