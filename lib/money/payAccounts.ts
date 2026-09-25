import { BRANCH_OWNER, FINNIX_OWNER, type PayAccount } from '@/lib/domain/payAccount';
import type { createClient } from '@/lib/supabase/server';

/**
 * The แหล่งเงิน a document may send a customer to (migration 0062), for the
 * branches the caller can reach. Only what a document prints — no balances:
 * a sales person picking the account for a quotation has no business seeing
 * how much is in it.
 */
export async function loadPayAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopIds: string[],
): Promise<PayAccount[]> {
  if (shopIds.length === 0) return [];
  const { data } = await supabase
    .from('money_accounts')
    .select('id, shop_id, name, kind, account_no, owner, match_names')
    .eq('active', true)
    .in('shop_id', shopIds)
    .order('shop_id')
    .order('sort_order')
    .order('id');
  return (data ?? []).map((a) => ({
    id: a.id,
    shop: a.shop_id,
    name: a.name,
    kind: a.kind,
    accountNo: a.account_no ?? '',
    owner: a.owner === FINNIX_OWNER ? FINNIX_OWNER : BRANCH_OWNER,
    matchNames: a.match_names ?? [],
  }));
}
