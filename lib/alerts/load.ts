import { mapOrder, ORDER_SELECT, type OrderRow } from '@/app/(app)/wholesale/data';
import type { SessionContext } from '@/lib/auth/session';
import { shopDayKey } from '@/lib/domain/format';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import type { createClient } from '@/lib/supabase/server';

import { buildAlerts } from './build';
import type { AlertSnapshot } from './types';
import { DUE_SOON_DAYS, shiftDay } from './wholesale';

/**
 * อ่านข้อมูลที่การแจ้งเตือนต้องใช้ — only what this person has access to.
 *
 * Every read is skipped entirely for someone without the nav or capability it
 * would feed: the bell polls every few minutes for every open tab, and reading
 * the stock table for a user who cannot see stock is waste. The rows that ARE
 * read arrive already limited to the caller's branches by RLS.
 *
 * Each section fails on its own. A broken query leaves that kind of alert out
 * instead of taking the header — and so every page — down with it.
 */

type Client = Awaited<ReturnType<typeof createClient>>;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function attempt<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    console.error(`alerts: ${label}`, e);
    return null;
  }
}

export async function loadAlertSnapshot(
  session: SessionContext,
  supabase: Client,
): Promise<AlertSnapshot> {
  const today = shopDayKey(new Date());
  const horizon = shiftDay(today, DUE_SOON_DAYS);
  // Called through the session rather than destructured: they are its methods.
  const can = (capability: string) => session.canDo(capability);
  const hasNav = (nav: string) => session.hasNav(nav);
  const skip = Promise.resolve(null);

  const [
    orders,
    myRepNames,
    unpaidTickets,
    expenses,
    withdrawals,
    lowStock,
    pettyTopups,
    policies,
    ack,
  ] = await Promise.all([
    hasNav('wholesale')
      ? attempt('orders', async () =>
          (
            await fetchAllRows(
              (from, to) =>
                supabase
                  .from('orders')
                  .select(ORDER_SELECT)
                  .is('deleted_at', null)
                  .neq('status', 'ปิดงานแล้ว')
                  .order('id')
                  .range(from, to) as unknown as Page<OrderRow>,
              'orders',
            )
          ).map(mapOrder),
        )
      : skip,
    hasNav('wholesale')
      ? attempt('sales_people', async () => {
          const { data, error } = await supabase
            .from('sales_people')
            .select('shop_id, name')
            .eq('user_id', session.userId)
            .eq('active', true);
          if (error) throw new Error(error.message);
          return (data ?? []).map((r) => ({ shop: r.shop_id, name: r.name }));
        })
      : skip,
    hasNav('list')
      ? attempt('tickets', () =>
          fetchAllRows(
            (from, to) =>
              supabase
                .from('tickets')
                .select('id')
                .eq('status', 'ค้างชำระ')
                .is('deleted_at', null)
                .order('id')
                .range(from, to),
            'tickets',
          ),
        )
      : skip,
    can('accounting.addExpense')
      ? attempt('expenses', async () =>
          (
            await fetchAllRows(
              (from, to) =>
                supabase
                  .from('expenses')
                  .select('id, due_at')
                  .eq('status', 'รอจ่าย')
                  .not('due_at', 'is', null)
                  .lte('due_at', horizon)
                  .order('id')
                  .range(from, to),
              'expenses',
            )
          ).map((e) => ({ id: e.id, dueAt: String(e.due_at).slice(0, 10) })),
        )
      : skip,
    can('stock.approveWithdraw')
      ? attempt('withdrawals', () =>
          fetchAllRows(
            (from, to) =>
              supabase
                .from('withdrawals')
                .select('id')
                .eq('status', 'รออนุมัติ')
                .order('id')
                .range(from, to),
            'withdrawals',
          ),
        )
      : skip,
    hasNav('stock')
      ? attempt('stock', async () =>
          // PostgREST cannot compare two columns, so the rows with a minimum
          // come back and the comparison happens here.
          (
            await fetchAllRows(
              (from, to) =>
                supabase
                  .from('stock')
                  .select('id, name, qty, min_qty')
                  .gt('min_qty', 0)
                  .order('id')
                  .range(from, to),
              'stock',
            )
          )
            .filter((s) => Number(s.qty) <= Number(s.min_qty))
            .map((s) => ({ id: s.id, name: s.name })),
        )
      : skip,
    hasNav('money')
      ? attempt('petty_cash', async () => {
          const [{ data: petty, error: pettyError }, { data: accounts, error: accError }] =
            await Promise.all([
              supabase
                .from('petty_cash')
                .select('id, shop_id, entry_at')
                .eq('type', 'เติมเงิน')
                .gt('amount', 0)
                .is('money_transfer_id', null)
                .is('transfer_skipped_at', null),
              supabase
                .from('money_accounts')
                .select('shop_id, opened_at, sort_order, id')
                .eq('kind', 'petty')
                .eq('active', true)
                .order('sort_order')
                .order('id'),
            ]);
          if (pettyError) throw new Error(pettyError.message);
          if (accError) throw new Error(accError.message);
          // The same cut-off the money page applies: a top-up dated before
          // the petty account opened is already inside its opening balance.
          const openedAt = new Map<string, string>();
          for (const a of accounts ?? []) {
            if (!openedAt.has(a.shop_id)) openedAt.set(a.shop_id, a.opened_at);
          }
          return (petty ?? [])
            .filter((p) => {
              const since = openedAt.get(p.shop_id);
              return !since || String(p.entry_at).slice(0, 10) >= since;
            })
            .map((p) => ({ id: p.id }));
        })
      : skip,
    hasNav('list')
      ? attempt('insurance_policies', async () => {
          // The dashboard's 30-day window, so the two agree.
          const { data, error } = await supabase
            .from('insurance_policies')
            .select('id, plate, ends_at')
            .gte('ends_at', today)
            .lte('ends_at', shiftDay(today, 30));
          if (error) throw new Error(error.message);
          return (data ?? []).map((p) => ({ id: p.id, plate: p.plate ?? '' }));
        })
      : skip,
    attempt('alert_acknowledgements', async () => {
      const { data, error } = await supabase
        .from('alert_acknowledgements')
        .select('acked_keys')
        .eq('user_id', session.userId)
        .eq('acked_on', today)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }),
  ]);

  return {
    viewer: session.userId,
    today,
    alerts: buildAlerts({
      today,
      can,
      hasNav,
      myRepNames: myRepNames ?? [],
      orders,
      unpaidTickets,
      expenses,
      withdrawals,
      lowStock,
      pettyTopups,
      expiringPolicies: policies,
    }),
    ackedToday: !!ack,
    ackedKeys: ack?.acked_keys ?? [],
  };
}
