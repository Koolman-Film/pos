import { notFound } from 'next/navigation';

import { MoneyModule } from '@/components/money/MoneyModule';
import { buildMoneySources } from '@/components/dashboard/moneyFlow';
import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import { loadMoneyData } from './data';

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
 * Balances are computed by the SAME function the dashboard card uses, over the
 * SAME movements the account ledger lists (`./data.ts`). Two implementations of
 * "how much money is there" would eventually disagree, and the whole point of
 * this screen is that its figures can be trusted against a bank statement.
 */
export default async function MoneyPage() {
  const session = await getSessionContext();
  if (!session.hasNav('money')) notFound();

  const supabase = await createClient();
  const [{ data: shopRows }, money] = await Promise.all([
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    loadMoneyData(supabase),
  ]);

  const shopNameById = new Map((shopRows ?? []).map((s) => [s.id, s.name]));
  const shops = session.accessibleShopIds.map((id) => ({
    id,
    name: shopNameById.get(id) ?? id,
  }));

  const overview = buildMoneySources(shops, money.accounts, money.movements, money.transfers);

  return (
    <MoneyModule
      shops={shops}
      accounts={money.accounts}
      overview={overview}
      transfers={money.transfers.map((t) => ({
        id: t.id,
        shop: t.shop,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amount: t.amount,
        movedAt: t.on,
        note: t.note,
      }))}
      reconciliations={money.reconciliations}
      pendingTopups={money.pendingTopups}
    />
  );
}
