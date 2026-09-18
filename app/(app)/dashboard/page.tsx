import { Suspense } from 'react';
import { fmtThaiDayMonth, shopDayKey, startOfShopDay } from '@/lib/domain/format';
import { daysAgoValue } from '@/lib/domain/now';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { ticketTotal } from '@/lib/domain/tickets';
import { needsPriceApproval } from '@/lib/domain/orders';
import { buildWholesaleOverview } from '@/components/dashboard/buildWholesaleOverview';
import { productLabels } from '@/components/dashboard/productNames';
import {
  orderReceipts,
  receiptDate,
  sumReceipts,
  ticketReceipts,
} from '@/components/dashboard/cashSales';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';
import type { StatusConfig } from '@/components/ui/Badge';
import { Dashboard } from '@/components/dashboard/Dashboard';
import type {
  PendingApprovals,
  RecentJob,
  StatusTotal,
  UpcomingTicket,
  VisitTotal,
} from '@/components/dashboard/Dashboard';
import { updateTicketStatus } from '@/app/(app)/tickets/actions';
import { DashboardFilter } from '@/components/dashboard/DashboardFilter';
import {
  buildTrend,
  computePayables,
  computeReceivables,
  type TrendExpense,
} from '@/components/dashboard/receivables';
import type { CalendarTicket } from '@/components/dashboard/JobCalendar';
import { buildAppointments, type VisitDates } from '@/components/dashboard/appointments';
import { buildBranchComparison } from '@/components/dashboard/branchTotals';
import {
  buildMoneySources,
  type MoneyAccount,
  type MoneyMovement,
  type MoneyTransfer,
} from '@/components/dashboard/moneyFlow';

/**
 * การนัดหมายที่ไม่ใช่การจองครั้งแรก — one place, read by the calendar and by
 * the counts beside it.
 *
 * These are EVENTS on a job that already has a status, so they are counted
 * apart from the status bars rather than folded into them; the colours match
 * `VISIT_STATUSES` in JobCalendar so the same thing is the same colour in both.
 */
const VISIT_KINDS = [
  ['แก้งาน', 'แก้งาน', '#B23A48'],
  ['Service', 'Service', '#2563EB'],
  ['เคลมประกัน', 'เคลมประกัน', '#7C3AED'],
  ['รถสไลด์', 'รถสไลด์', '#0F766E'],
] as const;

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
    ticketRows,
    orderRows,
    { data: customerRows },
    expenseRows,

    { data: accountRows },
    transferRows,
    { data: visitRows },
    stockRows,
    { data: shopRows },
    { data: statusRows },
    { data: policyRows },
    { data: claimRows },
  ] = await Promise.all([
    /*
      อ่านครบทุกแถว — the four reads below grow with the business, and every
      figure on this screen is a sum over them. PostgREST stops at 1,000 rows
      without saying so, so each is paged and ordered by something unique.
    */
    fetchAllRows(
      (from, to) =>
        supabase
          .from('tickets')
          .select(
            'id, shop_id, customer_name, plate, brand, model, service_type, status, revenue_kind, extras, drop_off_date, pickup_date, ticket_items(category, booked, sold, interested, sold_price, discount_type, discount_value), ticket_payments(amount, method, paid_at), ticket_status_history(status, changed_at)',
          )
          // Soft-deleted tickets (migration 0013) are out of every figure on this
          // screen — revenue, job counts, the calendar and the bookings window.
          .is('deleted_at', null)
          .order('drop_off_date', { ascending: false })
          .order('id')
          .range(from, to),
      'tickets',
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('orders')
          .select(
            'id, shop_id, customer_id, status, delivered_at, created_at, due_at, sales_by, order_items(name, qty, list_price, requested_price), order_returns(item_name, qty, returned_at), order_adjustments(amount, reason, adjusted_at, status), order_payments(amount, method, paid_at, status, cleared_at)',
          )
          // Deleted POs (migration 0040) are out of the wholesale figures here for
          // the same reason deleted tickets are out of the ticket ones above.
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      'orders',
    ),
    supabase.from('wholesale_customers').select('id, name'),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('expenses')
          .select(
            'id, shop_id, description, category, source, amount, status, expense_kind, paid_at, due_at',
          )
          .order('id')
          .range(from, to),
      'expenses',
    ),

    // ทะเบียนแหล่งเงิน (migration 0043) — the opening balances and the
    // transfers between accounts that turn movement into a real balance.
    supabase
      .from('money_accounts')
      .select(
        'id, shop_id, name, kind, account_no, opening_balance, opened_at, match_names, sort_order',
      )
      .eq('active', true)
      .order('sort_order'),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('money_transfers')
          .select('shop_id, from_account_id, to_account_id, amount, moved_at')
          .order('id')
          .range(from, to),
      'money_transfers',
    ),
    // เซอร์วิสที่บันทึกไว้ — each recorded visit is its own appointment, with
    // its own dates, and belongs on the 7-day card beside the bookings.
    supabase
      .from('service_visits')
      .select('ticket_id, visit_no, received_at, received_time, delivered_at, delivered_time')
      // Bounded, unlike the ticket read beside it: visits accumulate several
      // per job and this page loads on every visit to the app. A year either
      // side covers the calendar anyone actually pages to; older visits stay
      // on their ticket and on the ใบเซอร์วิส, they just do not paint a
      // calendar month nobody is looking at.
      .gte('received_at', daysAgoValue(365))
      .order('visit_no', { ascending: false }),
    // `name` is here for the ขายส่ง breakdown: a PO stores the product
    // NAME, and the stock register is where that name has a ชนิดสินค้า.
    //
    // Paged: PostgREST answers at most `max_rows` (1000) and says nothing when
    // it truncates, so a shop past that size silently loses whole ชนิดสินค้า out
    // of the stock summary and mis-files wholesale lines as ไม่ระบุชนิด.
    fetchAllRows<{ name: string; category: string; shop_id: string; qty: number }>(
      (from, to) =>
        supabase
          .from('stock')
          .select('name, category, shop_id, qty')
          .order('shop_id')
          .order('name')
          .range(from, to),
      'stock',
    ),
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
    // การเคลมที่มีวันนัด (migration 0041). Bounded like the visits above: a
    // claim is an appointment only while it is near, and the history lives on
    // its policy.
    supabase
      .from('insurance_claims')
      .select(
        'policy_id, service_visit_id, received_at, received_time, delivered_at, delivered_time, detail',
      )
      .not('received_at', 'is', null)
      .gte('received_at', daysAgoValue(365)),
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
    // Distinct product categories, and the product names the rows show: what was
    // sold, or — on a job still only booked — what the customer is interested in
    // (components/dashboard/productNames.ts).
    categories: [...new Set((t.ticket_items ?? []).map((i) => i.category).filter(Boolean))],
    products: productLabels(t.ticket_items ?? []),
    items: (t.ticket_items ?? []).map((i) => ({
      category: i.category,
      soldPrice: num(i.sold_price),
      discountType: (i.discount_type ?? undefined) as 'percent' | 'amount' | undefined,
      discountValue: i.discount_value == null ? undefined : num(i.discount_value),
    })),
    payments: (t.ticket_payments ?? []).map((p) => ({
      amount: num(p.amount),
      method: p.method ?? '',
      paidAt: toDate(p.paid_at),
      // The calendar day as stored — what ยอดขาย is dated by (cashSales.ts).
      paidOn: (p.paid_at ?? '').slice(0, 10),
    })),
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
    // วันส่งของ — the day a wholesale sale is earned (0045). Null means the
    // goods have not gone out, and nothing has been earned yet.
    deliveredAt: o.delivered_at,
    createdAt: o.created_at ?? '',
    dueAt: o.due_at ?? '',
    salesBy: o.sales_by ?? '',
    items: (o.order_items ?? []).map((i) => ({
      name: i.name,
      qty: num(i.qty),
      listPrice: num(i.list_price),
      requestedPrice: num(i.requested_price),
    })),
    returns: (o.order_returns ?? []).map((r) => ({
      item: r.item_name,
      qty: num(r.qty),
      date: r.returned_at,
    })),
    adjustments: (o.order_adjustments ?? []).map((a) => ({
      amount: num(a.amount),
      reason: a.reason ?? '',
      date: a.adjusted_at,
      // เฉพาะที่อนุมัติแล้วที่ลดยอด (0050) — `orderTotal` reads this.
      status: a.status ?? '',
    })),
    payments: (o.order_payments ?? []).map((p) => ({
      amount: num(p.amount),
      method: p.method ?? '',
      paidAt: toDate(p.paid_at),
      // ค้างรับ counts only รับเงินแล้ว (0048) — `orderPaid` reads this.
      status: p.status ?? '',
      clearedAt: toDate(p.cleared_at),
      paidOn: (p.paid_at ?? '').slice(0, 10),
      clearedOn: (p.cleared_at ?? '').slice(0, 10),
    })),
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
    due: e.due_at ? fmtThaiDayMonth(new Date(`${e.due_at}T00:00:00+07:00`)) : '',
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
    of a ticket total (migration 0023). Its premium is taken as a payment on
    that ticket, so ยอดขาย counts it through the payment (cashSales.ts); the
    policies here are for ประกันใกล้หมดอายุ.
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

  /*
    ยอดขาย = เงินที่รับแล้ว (ร้านขอ 16 ก.ย. 2569).

    The card counted every job dropped off in the period at its full price and
    every PO at the value of the goods sent out, so it never matched the money
    the shop actually had. Every sales figure on this screen now comes from
    the payments received — ticket payments on their paid day, PO payments
    once รับเงินแล้ว on the day the money arrived — the same rows and days
    โมดูลการเงิน counts as รับเข้า. The rules and the split by ชนิดสินค้า live
    in components/dashboard/cashSales.ts.

    ชนิดสินค้า of a wholesale product comes from the stock register, the same
    place the ขายส่ง picker takes the product from.
  */
  const stockCategoryByName = new Map<string, string>();
  for (const st of stockRows) {
    if (st.name && st.category && !stockCategoryByName.has(st.name)) {
      stockCategoryByName.set(st.name, st.category);
    }
  }
  const receipts = [
    ...ticketReceipts(
      tickets.map((t) => ({
        id: t.id,
        shop: t.shop,
        held: t.held,
        items: t.items,
        payments: t.payments.map((p) => ({ amount: p.amount, on: p.paidOn })),
      })),
      ((policyRows ?? []) as unknown as PolicyRow[]).map((p) => ({
        ticketId: p.ticket_id,
        price: num(p.price),
      })),
    ),
    ...orderReceipts(
      orders.map((o) => ({
        id: o.id,
        shop: o.shop,
        items: o.items,
        payments: o.payments.map((p) => ({
          amount: p.amount,
          status: p.status,
          paidAt: p.paidOn,
          clearedAt: p.clearedOn,
        })),
      })),
      (name) => stockCategoryByName.get(name) ?? '',
    ),
  ];
  /** Received in the period — for the branch on screen, or for one branch. */
  const receiptsIn = (shop: string | null) =>
    receipts.filter(
      (r) => (shop === null ? inShop(r.shop) : r.shop === shop) && inPeriod(receiptDate(r)),
    );

  // ยอดขาย counts only what the branch earned. เงินรอคืน Finnix is collected
  // and recorded, but it belongs to another shop and is reported separately in
  // โมดูลรายได้ — never folded into this figure.
  const periodSales = receiptsIn(null).filter((r) => !r.held);
  const retailRevenue = sumReceipts(periodSales.filter((r) => r.channel === 'ปลีก'));
  const wholesaleRevenue = sumReceipts(periodSales.filter((r) => r.channel === 'ขายส่ง'));
  const revenue = retailRevenue + wholesaleRevenue;

  /*
    ขายส่ง — the dashboard card for POs, for anyone who can open the wholesale
    module. Branch-scoped like every card here; the sales figure is the period
    on screen, everything owed or late is "as of now".
  */
  const wholesale = session.hasNav('wholesale')
    ? buildWholesaleOverview({
        orders: orders.filter((o) => inShop(o.shop)),
        customers,
        revenueLines: periodSales
          .filter((r) => r.channel === 'ขายส่ง')
          .map((r) => ({ orderId: r.sourceId, amount: r.amount })),
        today: shopDayKey(now),
      })
    : null;

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

  /*
    เงินอยู่ที่ไหนบ้าง — แยกตามสาขา แล้วตามแหล่งเงิน.

    Real balances, not movement: ยอดตั้งต้น + รับเข้า − จ่ายออก + โอนเข้า −
    โอนออก, per account (migration 0043). `components/dashboard/moneyFlow.ts`
    holds the arithmetic and the reasoning.

    NOT period-scoped: a balance is "as of now" by definition, and windowing it
    to September would produce a number that is nobody’s money.

    Shop-filtered, though. On ทุกร้าน the branch is the first level of the
    grouping and management sees the lot; picking one branch narrows the card
    to it, like every other card on the screen.
  */
  const day = (d: Date | null | undefined) => (d ? shopDayKey(d) : '');
  const moneyMovements: MoneyMovement[] = [
    ...tickets.flatMap((t) =>
      t.payments
        .filter((p) => p.method && p.paidAt)
        .map((p) => ({ shop: t.shop, source: p.method, amount: p.amount, on: day(p.paidAt) })),
    ),
    // เฉพาะที่ยืนยันแล้ว ลงวันที่ที่เงินเข้าจริง — a cheque in the drawer is
    // not money in the drawer, and not money on the day it arrived either.
    ...orders.flatMap((o) =>
      o.payments
        .filter((p) => p.method && p.status === 'รับเงินแล้ว' && (p.clearedAt || p.paidAt))
        .map((p) => ({
          shop: o.shop,
          source: p.method,
          amount: p.amount,
          on: day(p.clearedAt ?? p.paidAt),
        })),
    ),
    // Out of the drawer it went, whoever the bill belonged to — a จ่ายแทน
    // expense is still money that physically left this branch, which is the
    // question this card answers.
    ...expenses
      .filter((e) => e.source && e.status === 'จ่ายแล้ว' && e.paidAt)
      .map((e) => ({ shop: e.shop, source: e.source, amount: -e.amount, on: day(e.paidAt) })),
  ];

  const moneyAccounts: MoneyAccount[] = (accountRows ?? []).map((a) => ({
    id: a.id,
    shop: a.shop_id,
    name: a.name,
    kind: a.kind,
    accountNo: a.account_no ?? '',
    openingBalance: num(a.opening_balance),
    openedAt: a.opened_at,
    matchNames: a.match_names ?? [],
    sortOrder: a.sort_order,
  }));
  const moneyTransfers: MoneyTransfer[] = (transferRows ?? []).map((t) => ({
    shop: t.shop_id,
    fromAccountId: t.from_account_id,
    toAccountId: t.to_account_id,
    amount: num(t.amount),
    on: t.moved_at,
  }));
  const moneySources = buildMoneySources(
    accessibleShops.filter((s) => inShop(s.id)),
    moneyAccounts,
    moneyMovements,
    moneyTransfers,
  );

  /*
    ยอดขายแยกตามชนิดสินค้า — the same receipts as the headline, grouped by the
    ชนิดสินค้า each payment was split across (ประกัน included), so the rows add
    up to the figure above them, exactly.
  */
  const revenueByCategory = [...new Set(periodSales.map((r) => r.category))]
    .map((name) => ({
      name,
      amount: sumReceipts(periodSales.filter((r) => r.category === name)),
    }))
    .filter((c) => c.name && c.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  /*
    เปรียบเทียบรายสาขา.

    Management could ask "how is this branch doing" or "how is the business
    doing" and nothing in between, so comparing five branches meant picking
    each one from the filter in turn and writing the numbers down.

    Every figure is the SAME expression the card above uses, with the shop
    fixed instead of read from the filter — deliberately, because a table that
    computed ยอดขาย its own way would eventually disagree with the ยอดขาย card
    on the same screen, and then neither number could be trusted.

    Only built for ทุกร้าน, and only for a caller who may see other branches:
    with one branch selected there is nothing to compare it against.
  */
  const branchComparison =
    shopFilter === 'all' && session.hasDashboardWidget('branchCompare')
      ? buildBranchComparison(accessibleShops, (shop) => {
          const shopJobs = tickets.filter((t) => t.shop === shop && inPeriod(t.dropOff));
          const shopReceipts = receiptsIn(shop);
          const shopSales = shopReceipts.filter((r) => !r.held);
          const retail = sumReceipts(shopSales.filter((r) => r.channel === 'ปลีก'));
          const wholesale = sumReceipts(shopSales.filter((r) => r.channel === 'ขายส่ง'));
          const spend = expenses
            .filter(
              (e) =>
                e.shop === shop &&
                !e.paidForFinnix &&
                e.status === 'จ่ายแล้ว' &&
                inPeriod(e.paidAt),
            )
            .reduce((n, e) => n + e.amount, 0);
          return {
            revenue: retail + wholesale,
            retail,
            wholesale,
            expenses: spend,
            profit: retail + wholesale - spend,
            jobs: shopJobs.length,
            receivable: computeReceivables(tickets, orders, customers, shop).reduce(
              (n, a) => n + a.amount,
              0,
            ),
            payable: computePayables(expenses, shop).reduce((n, a) => n + a.amount, 0),
            heldForFinnix: sumReceipts(shopReceipts.filter((r) => r.held)),
          };
        })
      : undefined;

  const expenseCategories = [...new Set(paidExpenses.map((e) => e.category))];
  const expenseByCategory = expenseCategories.map((cat) => ({
    name: cat,
    amount: paidExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  }));

  const visibleStock = stockRows.filter((s) => inShop(s.shop_id));
  const stockCats = [...new Set(visibleStock.map((s) => s.category))];
  const stockByCategory = stockCats.map((cat) => ({
    name: cat,
    qty: visibleStock.filter((s) => s.category === cat).reduce((s, i) => s + num(i.qty), 0),
  }));
  const stockTotal = visibleStock.reduce((s, i) => s + num(i.qty), 0);

  const trendExpenses: TrendExpense[] = expenses.map((e) => ({
    shop: e.shop,
    amount: e.amount,
    status: e.status,
    paidAt: e.paidAt,
  }));
  // The revenue line plots the same receipts as the card, not job totals.
  const trend = buildTrend(
    [],
    trendExpenses,
    shopFilter,
    period,
    periodValue,
    rangeStart,
    rangeEnd,
    receipts.filter((r) => !r.held).map((r) => ({ shop: r.shop, on: r.on, amount: r.amount })),
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
  // One ticket can be several appointments — the booking, a งานแก้, and every
  // recorded เซอร์วิส visit. See components/dashboard/appointments.ts.
  const visitsByTicket = new Map<string, VisitDates[]>();
  for (const v of visitRows ?? []) {
    const list = visitsByTicket.get(v.ticket_id) ?? [];
    list.push({
      from: v.received_at ?? '',
      to: v.delivered_at ?? '',
      fromTime: v.received_time ?? '',
      toTime: v.delivered_time ?? '',
    });
    visitsByTicket.set(v.ticket_id, list);
  }

  /*
    การเคลมประกัน ก็เป็นการนัดหมาย.

    A claim is a day the customer brings the car in, exactly like a เซอร์วิส —
    it was simply invisible here because a claim had no dates of its own until
    0041. Keyed back to the ticket through its policy, because that is what the
    card groups by.
  */
  const ticketByPolicy = new Map(policies.map((p) => [p.id, p.ticket_id]));
  const claimsByTicket = new Map<string, VisitDates[]>();
  for (const c of claimRows ?? []) {
    // A claim made at a service visit is on the card as that visit already.
    if (c.service_visit_id) continue;
    const ticketId = ticketByPolicy.get(c.policy_id);
    if (!ticketId) continue;
    const list = claimsByTicket.get(ticketId) ?? [];
    list.push({
      from: c.received_at ?? '',
      to: c.delivered_at ?? '',
      fromTime: c.received_time ?? '',
      toTime: c.delivered_time ?? '',
      detail: c.detail ?? '',
    });
    claimsByTicket.set(ticketId, list);
  }

  const appointments = buildAppointments(shopTickets, visitsByTicket, claimsByTicket);

  const upcoming: UpcomingTicket[] = appointments
    .filter(({ appt }) => appt && appt >= windowStart && appt <= windowEnd)
    .sort((a, b) => (a.appt as Date).getTime() - (b.appt as Date).getTime())
    .map(({ row }) => row);

  // Pending approvals count across ALL orders the caller can see, not the
  // shop-filtered subset — matching the prototype, which reads `orders` directly
  // rather than `wsVisible` here (:896-897).
  const pendingApprovals: PendingApprovals = {
    /*
      Two ways the same decision reaches ผู้บริหาร: a price offered below the
      standard one, and a reduction written after the goods have gone out
      (migration 0050). Counting only the first would leave the second waiting
      on a screen nobody is told to open — and the second is the looser of the
      two, because by then the invoice has already been raised.
    */
    // The same predicate the ขายส่ง list filters by, so the number and the
    // list it opens can never disagree.
    discount: orders.filter(needsPriceApproval).length,
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
    total: ticketTotal(t),
  }));

  /*
    The calendar plots the ticket by its status, and งานแก้ / เซอร์วิส beside it
    under keys of their own.

    They are NOT statuses — the ticket keeps whatever status it has while the
    car comes back — but the calendar answers "what is happening that day", and
    a car returning is one of the things happening. Built from the same list
    that feeds the 7-day card, so the two can never disagree.
  */
  const calendarTickets: CalendarTicket[] = tickets
    .filter((t) => t.dropOff)
    .map((t) => ({
      id: t.id,
      shop: t.shop,
      status: t.status,
      dropOff: t.dropOff as Date,
      statusHistory: t.statusHistory,
    }));

  for (const a of appointments) {
    if (!VISIT_KINDS.some((v) => v[0] === a.row.serviceType)) continue;
    if (!a.appt) continue;
    calendarTickets.push({
      id: a.t.id,
      shop: a.t.shop,
      status: a.row.serviceType,
      dropOff: a.appt,
      // Empty on purpose: the calendar reads the last status change when there
      // is a history, and this entry is about its own date, not the ticket’s.
      statusHistory: [],
    });
  }

  /*
    …and the same events, counted for the period the dashboard is showing.

    Counted on the VISIT’s own date, not the ticket’s: a rework happening this
    month on a job booked last month belongs to this month, or the number means
    nothing. Kept out of `statusTotals` — those bars partition the jobs between
    them, and an event on a job that already has a status would be the same car
    counted twice.
  */
  const visitTotals: VisitTotal[] = VISIT_KINDS.map(([key, label, dot]) => ({
    key,
    label,
    dot,
    count: appointments.filter(
      (a) => a.row.serviceType === key && inShop(a.t.shop) && inPeriod(a.appt),
    ).length,
  }));

  return (
    <Dashboard
      hasDashboardWidget={session.hasDashboardWidget}
      revenue={revenue}
      retailRevenue={retailRevenue}
      wholesaleRevenue={wholesaleRevenue}
      totalExpenses={totalExpenses}
      moneySources={moneySources}
      arItems={arItems}
      apItems={apItems}
      revenueByCategory={revenueByCategory}
      expenseByCategory={expenseByCategory}
      stockByCategory={stockByCategory}
      stockTotal={stockTotal}
      trend={trend}
      calendarTickets={calendarTickets}
      visitTotals={visitTotals}
      branchComparison={branchComparison}
      shopFilter={shopFilter}
      caption={periodCaption(period, periodValue, rangeStart, rangeEnd, now)}
      statuses={statuses}
      totalJobs={visibleTickets.length}
      statusTotals={statusTotals}
      upcoming={upcoming}
      pendingApprovals={pendingApprovals}
      recentJobs={recentJobs}
      wholesale={wholesale}
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
