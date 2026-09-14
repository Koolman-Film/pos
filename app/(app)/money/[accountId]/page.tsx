import { notFound } from 'next/navigation';

import { getExpenseAttachmentUrl } from '@/app/(app)/accounting/actions';
import { buildAccountLedger, byAccountOrder } from '@/components/dashboard/moneyFlow';
import { LedgerModule } from '@/components/money/LedgerModule';
import { getSessionContext } from '@/lib/auth/session';
import { shopDayKey } from '@/lib/domain/format';
import { periodBounds, periodCaption, type PeriodKey } from '@/lib/domain/period';
import { createClient } from '@/lib/supabase/server';

import { exportAccountLedger, saveMoneyReconciliation } from '../actions';
import { loadMoneyData } from '../data';

const PERIODS: readonly PeriodKey[] = ['today', 'month', 'year', 'range'];

/**
 * สมุดบัญชีแหล่งเงิน (`/money/<account>`) — why an account holds what it holds.
 *
 * Its own URL rather than a panel on /money, so a bookkeeper can send "K-bank,
 * September" to the owner as a link, bookmark it, and print it. The period lives
 * in the query string for the same reason.
 *
 * Built on the server from `loadMoneyData`, the loader the register uses, with
 * `buildAccountLedger`, which applies the register's own ownership rules — so the
 * last line here is always the figure in the register's table. Gated like /money;
 * an account the caller's branches cannot see is simply not found (RLS).
 */
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session.hasNav('money')) notFound();

  const [{ accountId }, sp] = await Promise.all([params, searchParams]);
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  // The SHOP's day. The server runs in UTC, and "today" before 07:00 in
  // Bangkok would otherwise still be yesterday.
  const now = new Date();
  const todayKey = shopDayKey(now);
  const period: PeriodKey = PERIODS.includes(one('period') as PeriodKey)
    ? (one('period') as PeriodKey)
    : 'month';
  const periodValue =
    one('v') ||
    (period === 'year' ? String(Number(todayKey.slice(0, 4)) + 543) : todayKey.slice(0, 7));
  const rangeStart = one('from');
  const rangeEnd = one('to');
  const { from, to } = periodBounds(period, periodValue, rangeStart, rangeEnd, todayKey);

  const supabase = await createClient();
  const [{ data: shopRows }, money] = await Promise.all([
    supabase.from('shops').select('id, name'),
    loadMoneyData(supabase),
  ]);

  const account = money.accounts.find((a) => a.id === id);
  if (!account) notFound();

  const ledger = buildAccountLedger(
    id,
    money.accounts,
    money.movements,
    money.transfers,
    money.reconciliations,
    from,
    to,
    todayKey,
  );
  if (!ledger) notFound();

  return (
    <LedgerModule
      account={{
        id: account.id,
        name: account.name,
        kind: account.kind,
        accountNo: account.accountNo,
        openedAt: account.openedAt,
        shopName: (shopRows ?? []).find((s) => s.id === account.shop)?.name ?? account.shop,
      }}
      branchAccounts={money.accounts
        .filter((a) => a.shop === account.shop)
        .sort(byAccountOrder)
        .map((a) => ({ id: a.id, name: a.name }))}
      ledger={ledger}
      caption={periodCaption(period, periodValue, rangeStart, rangeEnd, now)}
      period={period}
      periodValue={periodValue}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      todayKey={todayKey}
      links={{
        // A reference is a link only where the reader may open what it points
        // at; otherwise it is still printed, just as text.
        tickets: session.hasNav('list'),
        wholesale: session.hasNav('wholesale'),
        expenseFiles: session.hasNav('accounting'),
      }}
      reconcileAction={saveMoneyReconciliation}
      exportAction={exportAccountLedger}
      attachmentUrlAction={session.hasNav('accounting') ? getExpenseAttachmentUrl : undefined}
    />
  );
}
