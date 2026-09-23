import { notFound } from 'next/navigation';

import { orderReceipts, ticketReceipts } from '@/components/dashboard/cashSales';
import { buildDailyReport, previousDay } from '@/components/dailyReport/buildDailyReport';
import { DailyReportView } from '@/components/dailyReport/DailyReportView';
import { getSessionContext } from '@/lib/auth/session';
import { shopDayKey } from '@/lib/domain/format';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { createClient } from '@/lib/supabase/server';

import { loadMoneyData } from '../money/data';

/**
 * สรุปการเงินประจำวัน (`/daily-report`) — the one-page daily brief for the owners.
 *
 * Gated on `money`, not a nav key of its own: every figure after ① is a balance
 * or a movement from การจัดการเงิน/บัญชี, and a page that showed them to someone
 * the register is shut to would undo the reason that module has its own gate.
 * By default that is admin and exec — exactly who the report is for.
 *
 * The day and branch live in the URL (`?d=YYYY-MM-DD&shop=`) so a day's report
 * can be sent as a link and printed again later.
 *
 * ① reads only the payments made on the day and the day before, then runs them
 * through the dashboard's own split; ②–④ go through `loadMoneyData`, the loader
 * /money uses, because a balance needs every movement since the account opened.
 */

type TicketPayRow = {
  ticket_id: string;
  amount: number | string | null;
  paid_at: string | null;
  tickets: {
    shop_id: string;
    revenue_kind: string | null;
    ticket_items:
      | {
          category: string | null;
          sold_price: number | string | null;
          discount_type: string | null;
          discount_value: number | string | null;
        }[]
      | null;
  } | null;
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

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const num = (v: unknown) => Number(v ?? 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session.hasNav('money')) notFound();

  const sp = await searchParams;
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
  const [{ data: shopRows }, money, ticketPays, orderPays] = await Promise.all([
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
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

  const ticketIds = [...tickets.keys()];
  const productNames = [
    ...new Set([...orders.values()].flatMap((o) => o.items.map((i) => i.name))),
  ];
  const [{ data: policyRows }, { data: stockRows }] = await Promise.all([
    ticketIds.length
      ? supabase.from('insurance_policies').select('ticket_id, price').in('ticket_id', ticketIds)
      : Promise.resolve({ data: [] as { ticket_id: string; price: number | string | null }[] }),
    productNames.length
      ? supabase.from('stock').select('name, category').in('name', productNames)
      : Promise.resolve({ data: [] as { name: string; category: string | null }[] }),
  ]);
  const categoryOf = new Map<string, string>();
  for (const st of stockRows ?? []) {
    if (st.name && st.category && !categoryOf.has(st.name)) categoryOf.set(st.name, st.category);
  }

  const receipts = [
    ...ticketReceipts(
      [...tickets.values()],
      (policyRows ?? []).map((p) => ({ ticketId: p.ticket_id, price: num(p.price) })),
    ),
    ...orderReceipts([...orders.values()], (name) => categoryOf.get(name) ?? ''),
  ];

  const report = buildDailyReport({
    day,
    shops,
    receipts,
    accounts: money.accounts,
    movements: money.movements,
    transfers: money.transfers,
  });

  return (
    <DailyReportView
      report={report}
      today={today}
      shopFilter={shopFilter}
      shops={accessibleShops}
      scopeName={shopFilter === 'all' ? 'ทุกสาขา' : (shops[0]?.name ?? '')}
      showShopColumn={shops.length > 1}
    />
  );
}
