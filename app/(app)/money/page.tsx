import { notFound } from 'next/navigation';

import { MoneyModule } from '@/components/money/MoneyModule';
import { buildMoneySources, type MoneyAccount } from '@/components/dashboard/moneyFlow';
import { getSessionContext } from '@/lib/auth/session';
import { shopDayKey } from '@/lib/domain/format';
import { createClient } from '@/lib/supabase/server';

/**
 * การจัดการเงิน/บัญชี (`/money`) — the account register behind the dashboard's
 * เงินอยู่ที่ไหนบ้าง card.
 *
 * Gated on its own nav key (migration 0044) rather than on `accounting`: opening
 * balances, moving money between accounts and reconciling against the bank are
 * the bookkeeper's work, and the shop asked for the screen to be shut to
 * everyone else. `notFound()` rather than a refusal page, so the route does not
 * advertise that the module exists.
 *
 * Balances are computed by the SAME function the dashboard card uses. Two
 * implementations of "how much money is there" would eventually disagree, and
 * the whole point of this screen is that its figures can be trusted against a
 * bank statement.
 */
export default async function MoneyPage() {
  const session = await getSessionContext();
  if (!session.hasNav('money')) notFound();

  const supabase = await createClient();
  const [
    { data: shopRows },
    { data: accountRows },
    { data: transferRows },
    { data: reconRows },
    { data: ticketRows },
    { data: orderRows },
    { data: expenseRows },
  ] = await Promise.all([
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    supabase
      .from('money_accounts')
      .select(
        'id, shop_id, name, kind, account_no, opening_balance, opened_at, match_names, sort_order',
      )
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('money_transfers')
      .select('id, shop_id, from_account_id, to_account_id, amount, moved_at, note')
      .order('moved_at', { ascending: false }),
    supabase
      .from('money_reconciliations')
      .select('id, account_id, counted_at, counted_balance, system_balance, note')
      .order('counted_at', { ascending: false }),
    supabase
      .from('tickets')
      .select('shop_id, ticket_payments(amount, method, paid_at)')
      .is('deleted_at', null),
    // status และ cleared_at: เงินที่ยังไม่ยืนยันไม่ใช่เงินในลิ้นชัก (0048).
    supabase
      .from('orders')
      .select('shop_id, order_payments(amount, method, paid_at, status, cleared_at)'),
    supabase.from('expenses').select('shop_id, source, amount, status, paid_at'),
  ]);

  const shopNameById = new Map((shopRows ?? []).map((s) => [s.id, s.name]));
  const shops = session.accessibleShopIds.map((id) => ({
    id,
    name: shopNameById.get(id) ?? id,
  }));

  const accounts: MoneyAccount[] = (accountRows ?? []).map((a) => ({
    id: a.id,
    shop: a.shop_id,
    name: a.name,
    kind: a.kind,
    accountNo: a.account_no ?? '',
    openingBalance: Number(a.opening_balance ?? 0),
    openedAt: a.opened_at,
    matchNames: a.match_names ?? [],
    sortOrder: a.sort_order,
  }));

  const day = (v: string | null | undefined) => (v ? shopDayKey(new Date(v)) : '');
  const movements = [
    ...(ticketRows ?? []).flatMap((t) =>
      (t.ticket_payments ?? [])
        .filter((p) => p.method && p.paid_at)
        .map((p) => ({
          shop: t.shop_id,
          source: p.method,
          amount: Number(p.amount ?? 0),
          on: day(p.paid_at),
        })),
    ),
    /*
      เฉพาะที่ยืนยันแล้ว และลงวันที่ที่เงินเข้าจริง.

      A post-dated cheque in the drawer is not money in the account, and it
      is not money on the day it was taken in either — this card answers
      "เงินอยู่ที่ไหนบ้าง", so the movement belongs to `cleared_at`. Falls
      back to `paid_at` for the rows migrated from before the distinction
      existed, where the two were the same day by definition.
    */
    ...(orderRows ?? []).flatMap((o) =>
      (o.order_payments ?? [])
        .filter((p) => p.method && p.status === 'รับเงินแล้ว')
        .map((p) => ({
          shop: o.shop_id,
          source: p.method,
          amount: Number(p.amount ?? 0),
          on: day(p.cleared_at ?? p.paid_at),
        }))
        .filter((m) => m.on),
    ),
    ...(expenseRows ?? [])
      .filter((e) => e.source && e.status === 'จ่ายแล้ว' && e.paid_at)
      .map((e) => ({
        shop: e.shop_id,
        source: e.source,
        amount: -Number(e.amount ?? 0),
        on: day(e.paid_at),
      })),
  ];

  const transfers = (transferRows ?? []).map((t) => ({
    shop: t.shop_id,
    fromAccountId: t.from_account_id,
    toAccountId: t.to_account_id,
    amount: Number(t.amount ?? 0),
    on: t.moved_at,
  }));

  const overview = buildMoneySources(shops, accounts, movements, transfers);

  return (
    <MoneyModule
      shops={shops}
      accounts={accounts}
      overview={overview}
      transfers={(transferRows ?? []).map((t) => ({
        id: t.id,
        shop: t.shop_id,
        fromAccountId: t.from_account_id,
        toAccountId: t.to_account_id,
        amount: Number(t.amount ?? 0),
        movedAt: t.moved_at,
        note: t.note ?? '',
      }))}
      reconciliations={(reconRows ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        countedAt: r.counted_at,
        countedBalance: Number(r.counted_balance ?? 0),
        systemBalance: Number(r.system_balance ?? 0),
        note: r.note ?? '',
      }))}
    />
  );
}
