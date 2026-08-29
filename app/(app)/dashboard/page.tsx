import { Suspense } from 'react';
import { startOfShopDay } from '@/lib/domain/format';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { ticketTotal } from '@/lib/domain/tickets';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';
import type { StatusConfig } from '@/components/ui/Badge';
import { appointmentDate, Dashboard } from '@/components/dashboard/Dashboard';
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
    { data: visitRows },
    { data: stockRows },
    { data: shopRows },
    { data: statusRows },
    { data: policyRows },
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, shop_id, customer_name, plate, brand, model, service_type, status, revenue_kind, extras, drop_off_date, pickup_date, ticket_items(category, booked, sold, sold_price, discount_type, discount_value), ticket_payments(amount), ticket_status_history(status, changed_at)',
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
      .select(
        'id, shop_id, description, category, source, amount, status, expense_kind, paid_at, due_at',
      ),
    supabase.from('petty_cash').select('shop_id, type, amount'),
    // เซอร์วิสที่บันทึกไว้ — each recorded visit is its own appointment, with
    // its own dates, and belongs on the 7-day card beside the bookings.
    supabase
      .from('service_visits')
      .select('ticket_id, visit_no, received_at, delivered_at')
      .order('visit_no', { ascending: false }),
    supabase.from('stock').select('category, shop_id, qty'),
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    supabase
      .from('statuses')
      .select('key, short, bg, text_color, dot, sort_order')
      .order('sort_order'),
    // ประกัน is not on any ticket (migration 0023), so revenue and the expiry
    // warning both have to read the policies themselves.
    supabase
      .from('insurance_policies')
      .select('id, ticket_id, plate, plan_name, price, sold_at, ends_at')
      .order('ends_at', { ascending: true }),
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
    // 'รับแทน' = the customer paid here for another Finnix shop's job, so the
    // money is held, not earned (migration 0031).
    held: t.revenue_kind === 'รับแทน',
    dropOff: toDate(t.drop_off_date),
    pickup: toDate(t.pickup_date),
    extras: (t.extras ?? {}) as Record<string, Record<string, unknown>>,
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
    // Paid on behalf of another Finnix shop (migration 0032).
    paidForFinnix: e.expense_kind === 'จ่ายแทน',
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
  // A policy carries no shop of its own; it belongs to the shop of its job.
  const shopByTicketId = new Map(tickets.map((t) => [t.id, t.shop]));
  const visibleTickets = shopTickets.filter((t) => inPeriod(t.dropOff));

  const arItems = computeReceivables(tickets, orders, customers, shopFilter);
  const apItems = computePayables(expenses, shopFilter);

  /*
    ประกัน sells two ways — with the install, or months later on a closed
    ticket — so it is its own record with its own วันที่ขาย and is never part
    of a ticket total (migration 0023). Revenue therefore adds the policies
    sold in the period on top of the tickets delivered in it.
  */
  type PolicyRow = {
    id: number;
    ticket_id: string;
    plate: string;
    plan_name: string;
    price: number;
    sold_at: string | null;
    ends_at: string | null;
  };
  const policies = ((policyRows ?? []) as unknown as PolicyRow[]).filter((p) =>
    inShop(shopByTicketId.get(p.ticket_id) ?? ''),
  );
  const insuranceRevenue = policies
    .filter((p) => inPeriod(p.sold_at ? new Date(`${p.sold_at}T00:00:00`) : null))
    .reduce((s, p) => s + num(p.price), 0);

  // ยอดขาย counts only what the branch earned. เงินรอคืน Finnix is collected
  // and recorded, but it belongs to another shop and is reported separately in
  // โมดูลรายได้ — never folded into this figure.
  const revenue =
    visibleTickets.filter((t) => !t.held).reduce((s, t) => s + ticketTotal(t), 0) +
    insuranceRevenue;

  /*
    ประกันใกล้หมดอายุ — the 30-day window the shop asked for.

    Read "as of now" rather than through the period filter, like the bookings
    window and the receivables list: a policy expiring next week is something
    to ring the customer about today, whatever month the dashboard is showing.
  */
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiringInsurance = policies
    .filter((p) => p.ends_at)
    .map((p) => ({
      ticketId: p.ticket_id,
      plate: p.plate,
      planName: p.plan_name,
      endsAt: p.ends_at as string,
      daysLeft: Math.round(
        (new Date(`${p.ends_at}T00:00:00`).getTime() - today.getTime()) / 86_400_000,
      ),
    }))
    // Already-expired ones stay off: the point is the call you can still make.
    .filter((p) => p.daysLeft >= 0 && p.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // ค่าใช้จ่าย counts what the branch spent on itself. A bill paid on behalf of
  // another Finnix shop left the drawer — so it still moves เงินสดย่อย below —
  // but it is that shop’s cost, and is reported as เงินรอรับคืน in บัญชี.
  const paidExpenses = expenses.filter(
    (e) => inShop(e.shop) && !e.paidForFinnix && e.status === 'จ่ายแล้ว' && inPeriod(e.paidAt),
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
  //
  // Measured on the SHOP's clock. This runs on a server in UTC, where local
  // midnight is 07:00 in Bangkok — every booking earlier than that fell outside
  // the window and the card simply did not list it.
  const windowStart = startOfShopDay();
  const windowEnd = new Date(windowStart.getTime() + 8 * 86400000 - 1);

  // Period-independent on purpose: this card is the next seven days, which the
  // selected month/year has no say over.
  //
  // The window is measured on วันที่นัด, not on the drop-off: a รอส่งมอบ job
  // came in days ago and is due back this week, and filtering on the old date
  // would keep the day it actually needs someone off the card entirely.
  /*
    One ticket can be several appointments.

    The booking is one. A งานแก้ is another — the car comes back on its own day
    — and every recorded เซอร์วิส visit is another again. They used to be
    invisible here: the card read the ticket's own dates, which are in the past
    by the time a car returns, so the day somebody actually has to be ready for
    it never appeared. Each is built as its own row carrying its own dates, so
    the existing grouping puts it under its own การนัดหมาย heading.
  */
  const visitsByTicket = new Map<string, { from: string; to: string }[]>();
  for (const v of visitRows ?? []) {
    const list = visitsByTicket.get(v.ticket_id) ?? [];
    list.push({ from: v.received_at ?? '', to: v.delivered_at ?? '' });
    visitsByTicket.set(v.ticket_id, list);
  }

  type Appointment = { t: (typeof shopTickets)[number]; appt: Date | null; row: UpcomingTicket };
  const asDate = (v: string) => (v ? new Date(`${v}T00:00:00+07:00`) : null);

  const appointments: Appointment[] = [];
  for (const t of shopTickets) {
    const base: UpcomingTicket = {
      id: t.id,
      customer: t.customer,
      brand: t.brand,
      model: t.model,
      plate: t.plate,
      serviceType: t.serviceType,
      categories: t.categories,
      products: t.products,
      dropOff: t.dropOff as Date,
      status: t.status,
      pickup: t.pickup,
    };
    appointments.push({ t, appt: appointmentDate(t), row: base });

    const rework = t.extras['แก้งาน'];
    if (rework?.checked) {
      const from = asDate(String(rework.receivedAt ?? ''));
      const to = asDate(String(rework.deliveredAt ?? ''));
      if (from || to) {
        const category = String(rework.category ?? '').trim();
        appointments.push({
          t,
          appt: appointmentDate({ status: t.status, dropOff: from, pickup: to }),
          row: {
            ...base,
            serviceType: 'แก้งาน',
            categories: category ? [category] : t.categories,
            products: [String(rework.detail ?? '').trim()].filter(Boolean),
            dropOff: (from ?? to) as Date,
            pickup: to,
          },
        });
      }
    }

    for (const v of visitsByTicket.get(t.id) ?? []) {
      const from = asDate(v.from);
      const to = asDate(v.to);
      if (!from && !to) continue;
      appointments.push({
        t,
        appt: appointmentDate({ status: t.status, dropOff: from, pickup: to }),
        row: {
          ...base,
          serviceType: 'Service',
          dropOff: (from ?? to) as Date,
          pickup: to,
        },
      });
    }
  }

  const upcoming: UpcomingTicket[] = appointments
    .filter(({ appt }) => appt && appt >= windowStart && appt <= windowEnd)
    .sort((a, b) => (a.appt as Date).getTime() - (b.appt as Date).getTime())
    .map(({ row }) => row);

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
      expiringInsurance={expiringInsurance}
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
