import { notFound } from 'next/navigation';

import { WholesaleList } from '@/components/wholesale/WholesaleList';
import { getSessionContext } from '@/lib/auth/session';

import { updateOrderStatus } from './actions';
import { loadWholesaleListData } from './data';

/**
 * Wholesale order list (`/wholesale`). Ports the prototype's `WholesaleList`
 * view (reference/v0.4/finnix-film.html:2526-2648).
 *
 * `getSessionContext()` authorizes the request; `hasNav('wholesale')` gates the
 * whole module (the sidebar hides the link, but a direct navigation must also be
 * refused). Capabilities are resolved to a plain `caps` map here because a
 * Server Component cannot pass the `canDo` closure across to a Client Component.
 */
export default async function WholesalePage() {
  const session = await getSessionContext();
  if (!session.hasNav('wholesale')) notFound();

  const { orders, customers, wsStatuses, shops } = await loadWholesaleListData(session);

  const caps = {
    'wholesale.createNew': session.canDo('wholesale.createNew'),
    'wholesale.export': session.canDo('wholesale.export'),
  };

  return (
    <WholesaleList
      orders={orders}
      customers={customers}
      caps={caps}
      wsStatuses={wsStatuses}
      accessibleShops={shops}
      canSeeAllShops={session.seesAllShops}
      onUpdateStatus={updateOrderStatus}
    />
  );
}
