import { RevenueModule } from '@/components/revenue/RevenueModule';
import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import { exportRevenue } from './actions';
import { loadSaleLines } from './data';

/**
 * โมดูลรายได้ — Server Component.
 *
 * `getSessionContext()` IS the authorization check (it redirects an invalid
 * caller); the `revenue` nav permission gates the sidebar entry, and RLS scopes
 * every row to the caller's shops on top of that.
 */
export default async function RevenuePage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const [lines, { data: shopRows }] = await Promise.all([
    loadSaleLines(),
    supabase.from('shops').select('id, name, sort_order').order('sort_order', { ascending: true }),
  ]);

  const accessibleShops = (shopRows ?? [])
    .filter((s) => session.accessibleShopIds.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <RevenueModule
      lines={lines}
      accessibleShops={accessibleShops}
      canSeeAllShops={session.seesAllShops}
      canExport={session.canDo('accounting.export')}
      canSeeCost={session.hasDashboardWidget('seeStockPrices')}
      exportAction={exportRevenue}
    />
  );
}
