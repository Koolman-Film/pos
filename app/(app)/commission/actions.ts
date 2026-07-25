'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import type { NewCommissionRuleInput } from '@/components/commission/CommissionModule';

/**
 * Create a commission rule (+ its team rows). Ports the prototype's `addRule`
 * (reference/v0.4/finnix-film.html:3473-3476), which is the module's ONLY
 * mutation — the prototype has no toggle/edit/delete UI, so none is ported.
 *
 * C2 — proxy auth is optimistic only; a Server Action is a bare POST to this
 * route and any client can call it without ever rendering the gated UI. So this
 * re-verifies the caller here, independent of `proxy.ts` and the UI gate:
 *   - `getSessionContext()` IS the auth check (revalidates against the Supabase
 *     auth server, redirects unauthenticated/unregistered/suspended callers).
 *   - `session.canDo('commission.addRule')` re-checks the capability server-side.
 * RLS (Task 7) remains the final backstop, not the only check.
 */
export async function addCommissionRule(input: NewCommissionRuleInput): Promise<void> {
  const session = await getSessionContext();
  if (!session.canDo('commission.addRule')) {
    throw new Error('forbidden');
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('commission_rules')
    .insert({
      category: input.category,
      name: input.name,
      type: input.type,
      value: Number(input.value),
      // A concrete shop id (the module resolves 'all' to a shop before calling);
      // null persists a shop-wide rule, matching the prototype's `shop:'all'`.
      shop_id: input.shop === 'all' ? null : input.shop,
      active: true,
    })
    .select('id')
    .single();

  if (error) throw error;

  const team = input.team.map((s) => s.trim()).filter(Boolean);
  if (team.length > 0) {
    const { error: teamError } = await supabase
      .from('commission_rule_teams')
      .insert(team.map((member) => ({ commission_rule_id: data.id, team_member: member })));
    if (teamError) throw teamError;
  }

  revalidatePath('/commission');
}
