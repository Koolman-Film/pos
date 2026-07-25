import {
  CommissionModule,
  type CommissionRuleView,
} from '@/components/commission/CommissionModule';
import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import { addCommissionRule } from './actions';

/**
 * Commission route — Server Component. Fetches the rule configuration and the
 * caller's accessible shops, then renders the (client) module.
 *
 * `getSessionContext()` gates rendering; per C2 the Server Action re-checks on
 * its own. The capability is evaluated here to a serializable boolean because a
 * closure cannot cross into the Client Component (see the module's note and the
 * Sidebar precedent).
 */
export default async function CommissionPage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const [{ data: ruleRows }, { data: shopRows }] = await Promise.all([
    supabase
      .from('commission_rules')
      .select(
        'id, category, name, type, value, shop_id, active, commission_rule_teams(team_member)',
      )
      .order('id'),
    supabase.from('shops').select('id, name').order('sort_order'),
  ]);

  const rules: CommissionRuleView[] = (ruleRows ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    type: r.type,
    value: r.value,
    // null shop_id is the prototype's shop-wide 'all'.
    shop: r.shop_id ?? 'all',
    team: (r.commission_rule_teams ?? []).map((t) => t.team_member),
    active: r.active,
  }));

  // Only the shops this caller may see, in canonical sort order.
  const accessibleShops = (shopRows ?? []).filter((s) => session.accessibleShopIds.includes(s.id));

  return (
    <CommissionModule
      rules={rules}
      canAddRule={session.canDo('commission.addRule')}
      addRuleAction={addCommissionRule}
      accessibleShops={accessibleShops}
      canSeeAllShops={session.seesAllShops}
    />
  );
}
