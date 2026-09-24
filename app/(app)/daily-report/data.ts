import { notFound } from 'next/navigation';
import type { ComponentProps } from 'react';

import { orderReceipts, ticketReceipts } from '@/components/dashboard/cashSales';
import {
  buildDailyReport,
  previousDay,
  type OutstandingJob,
} from '@/components/dailyReport/buildDailyReport';
import type { DailyReportView } from '@/components/dailyReport/DailyReportView';
import { getSessionContext } from '@/lib/auth/session';
import { shopDayKey } from '@/lib/domain/format';
import { ticketTotal } from '@/lib/domain/tickets';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { createClient } from '@/lib/supabase/server';

import { loadMoneyData } from '../money/data';

/**
 * รายงานการเงินรายวัน — everything the page shows, read and computed on the
 * server, for app/(app)/daily-report/page.tsx.
 *
 * Gated on its own nav key, `dailyReport` (migration 0066), granted to แอดมิน
 * and ผู้บริหาร by default: it is the owners' page, and a shop can give it to a
 * branch manager without also handing over the money register.
 *
 * The day and branch live in the URL (`?d=YYYY-MM-DD&shop=`) so a day's report
 * can be sent as a link and printed again later.
 *
 * ① reads only the payments made on the day and the day before, then runs them
 * through the dashboard's own split; ②–④ go through `loadMoneyData`, the loader
 * /money uses, because a balance needs every movement since the account opened.
 */

type ItemRow = {
  category: string | null;
  sold_price: number | string | null;
  discount_type: string | null;
  discount_value: number | string | null;
};

type TicketPayRow = {
  ticket_id: string;
  amount: number | string | null;
  paid_at: string | null;
  tickets: { shop_id: string; revenue_kind: string | null; ticket_items: ItemRow[] | null } | null;
};

type OrderPayRow = {
  order_id: string;
  amount: number | string | null;
  status: string | null;
  paid_at: string | null;
  cleared_at: string | null;
  orders: {
    shop_id: string;
    order_items:
      | { name: string; qty: number | string | null; requested_price: number | string | null }[]
      | null;
  } | null;
};

type JobRow = {
  id: string;
  shop_id: string;
  status: string | null;
  revenue_kind: string | null;
  drop_off_date: string | null;
  ticket_items: ItemRow[] | null;
  ticket_payments: { amount: number | string | null; paid_at: string | null }[] | null;
  ticket_status_history: { status: string; changed_at: string }[] | null;
};

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const num = (v: unknown) => Number(v ?? 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * งานขายค้างชำระ counts jobs in these statuses on the day (ร้านขอ 24 ก.ย. 2569).
 * Matched against a status's key OR its short label: รอ QC is the short label
 * of 'กำลัง QC ก่อนติดตั้ง', and ออกใบงานแล้ว is one the shop added itself.
 */
const DUE_STATUS_LABELS = ['รอ QC', 'ออกใบงานแล้ว', 'กำลังติดตั้ง', 'รอส่งมอบ', 'ค้างชำระ'];

export type DailyReportProps = ComponentProps<typeof DailyReportView>;

export async function loadDailyReport(
  sp: Record<string, string | string[] | undefined>,
): Promise<DailyReportProps> {
  const session = await getSessionContext();
  if (!session.hasNav('dailyReport')) notFound();

  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  // The SHOP's day — the server runs in UTC.
  const today = shopDayKey(new Date());
  const day = DAY_RE.test(one('d')) && one('d') <= today ? one('d') : today;
  const yesterday = previousDay(day);
  const dayList = `(${yesterday},${day})`;

  const supabase = await createClient();
  const [
    { data: shopRows },
    { data: statusRows },
    money,
    ticketPays,
    orderPays,
    jobRows,
    policyRows,
  ] = await Promise.all([
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    supabase.from('statuses').select('key, short'),
    loadMoneyData(supabase),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('ticket_payments')
          .select(
            'id, ticket_id, amount, paid_at, tickets!inner(shop_id, revenue_kind, ticket_items(category, sold_price, discount_type, discount_value))',
          )
          .is('tickets.deleted_at', null)
          .in('paid_at', [yesterday, day])
          .order('id')
          .range(from, to) as unknown as Page<TicketPayRow>,
      'ticket_payments',
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('order_payments')
          .select(
            'id, order_id, amount, status, paid_at, cleared_at, orders!inner(shop_id, order_items(name, qty, requested_price))',
          )
          .is('orders.deleted_at', null)
          // วันที่เงินเข้าจริง: cleared_at, or paid_at on rows from before 0048.
          .or(`cleared_at.in.${dayList},and(cleared_at.is.null,paid_at.in.${dayList})`)
          .order('id')
          .range(from, to) as unknown as Page<OrderPayRow>,
      'order_payments',
    ),
    /*
      Every job booked by the day, for งานค้างชำระ. Whether one counts depends
      on its status ON the day and what it had been paid BY the day, neither of
      which a filter on today's columns can express — so it is read whole, the
      way the dashboard reads it, and decided in `outstandingOn`.
    */
    fetchAllRows(
      (from, to) =>
        supabase
          .from('tickets')
          .select(
            'id, shop_id, status, revenue_kind, drop_off_date, ticket_items(category, sold_price, discount_type, discount_value), ticket_payments(amount, paid_at), ticket_status_history(status, changed_at)',
          )
          .is('deleted_at', null)
          .lte('drop_off_date', day)
          .order('id')
          .range(from, to) as unknown as Page<JobRow>,
      'tickets',
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from('insurance_policies')
          .select('id, ticket_id, price, sold_at')
          .order('id')
          .range(from, to) as unknown as Page<{
          ticket_id: string;
          price: number | string | null;
          sold_at: string | null;
        }>,
      'insurance_policies',
    ),
  ]);

  // ---- which branches ------------------------------------------------------
  const shopNameById = new Map((shopRows ?? []).map((s) => [s.id, s.name]));
  const accessibleShops = session.accessibleShopIds.map((id) => ({
    id,
    name: shopNameById.get(id) ?? id,
  }));
  const requested = one('shop');
  const shopFilter =
    requested === 'all' || session.accessibleShopIds.includes(requested)
      ? requested
      : accessibleShops.length > 1
        ? 'all'
        : (accessibleShops[0]?.id ?? 'all');
  const shops =
    shopFilter === 'all' ? accessibleShops : accessibleShops.filter((s) => s.id === shopFilter);

  // ---- ① the payments, grouped back into their ticket / PO ------------------
  const tickets = new Map<string, Parameters<typeof ticketReceipts>[0][number]>();
  for (const p of ticketPays) {
    if (!p.tickets) continue;
    const t = tickets.get(p.ticket_id) ?? {
      id: p.ticket_id,
      shop: p.tickets.shop_id,
      // รับแทน = collected here for another Finnix shop's job (0031).
      held: p.tickets.revenue_kind === 'รับแทน',
      items: (p.tickets.ticket_items ?? []).map((i) => ({
        category: i.category ?? '',
        soldPrice: num(i.sold_price),
        discountType: (i.discount_type ?? undefined) as 'percent' | 'amount' | undefined,
        discountValue: i.discount_value == null ? undefined : num(i.discount_value),
      })),
      payments: [],
    };
    t.payments.push({ amount: num(p.amount), on: (p.paid_at ?? '').slice(0, 10) });
    tickets.set(p.ticket_id, t);
  }

  const orders = new Map<string, Parameters<typeof orderReceipts>[0][number]>();
  for (const p of orderPays) {
    if (!p.orders) continue;
    const o = orders.get(p.order_id) ?? {
      id: p.order_id,
      shop: p.orders.shop_id,
      items: (p.orders.order_items ?? []).map((i) => ({
        name: i.name,
        qty: num(i.qty),
        requestedPrice: num(i.requested_price),
      })),
      payments: [],
    };
    o.payments.push({
      amount: num(p.amount),
      status: p.status ?? '',
      paidAt: p.paid_at,
      clearedAt: p.cleared_at,
    });
    orders.set(p.order_id, o);
  }

  const productNames = [
    ...new Set([...orders.values()].flatMap((o) => o.items.map((i) => i.name))),
  ];
  const { data: stockRows } = productNames.length
    ? await supabase.from('stock').select('name, category').in('name', productNames)
    : { data: [] as { name: string; category: string | null }[] };
  const categoryOf = new Map<string, string>();
  for (const st of stockRows ?? []) {
    if (st.name && st.category && !categoryOf.has(st.name)) categoryOf.set(st.name, st.category);
  }

  const receipts = [
    ...ticketReceipts(
      [...tickets.values()],
      policyRows
        .filter((p) => tickets.has(p.ticket_id))
        .map((p) => ({ ticketId: p.ticket_id, price: num(p.price) })),
    ),
    ...orderReceipts([...orders.values()], (name) => categoryOf.get(name) ?? ''),
  ];

  // ---- งานค้างชำระ ------------------------------------------------------------
  // ประกัน counts toward what a job owes from the day it was sold (0023).
  const premiumBy = new Map<string, number>();
  for (const p of policyRows) {
    if ((p.sold_at ?? '').slice(0, 10) > day) continue;
    premiumBy.set(p.ticket_id, (premiumBy.get(p.ticket_id) ?? 0) + num(p.price));
  }
  const dueStatuses = [
    ...DUE_STATUS_LABELS,
    ...(statusRows ?? [])
      .filter((s) => DUE_STATUS_LABELS.includes(s.key) || DUE_STATUS_LABELS.includes(s.short))
      .map((s) => s.key),
  ];
  const jobs: OutstandingJob[] = jobRows.map((t) => ({
    id: t.id,
    shop: t.shop_id,
    held: t.revenue_kind === 'รับแทน',
    dropOff: (t.drop_off_date ?? '').slice(0, 10),
    total:
      (premiumBy.get(t.id) ?? 0) +
      ticketTotal({
        items: (t.ticket_items ?? []).map((i) => ({
          soldPrice: num(i.sold_price),
          discountType: (i.discount_type ?? undefined) as 'percent' | 'amount' | undefined,
          discountValue: i.discount_value == null ? undefined : num(i.discount_value),
        })),
        payments: [],
      }),
    payments: (t.ticket_payments ?? []).map((p) => ({
      amount: num(p.amount),
      on: (p.paid_at ?? '').slice(0, 10),
    })),
    history: (t.ticket_status_history ?? [])
      .slice()
      .sort((a, b) => (a.changed_at < b.changed_at ? -1 : a.changed_at > b.changed_at ? 1 : 0))
      .map((h) => ({ status: h.status, on: shopDayKey(new Date(h.changed_at)) })),
    status: t.status ?? '',
  }));

  const report = buildDailyReport({
    day,
    shops,
    receipts,
    accounts: money.accounts,
    movements: money.movements,
    transfers: money.transfers,
    jobs,
    dueStatuses,
    today,
  });

  return {
    report,
    today,
    shopFilter,
    shops: accessibleShops,
    scopeName: shopFilter === 'all' ? 'ทุกสาขา' : (shops[0]?.name ?? ''),
    showShopColumn: shops.length > 1,
    linksToMoney: session.hasNav('money'),
  };
}
