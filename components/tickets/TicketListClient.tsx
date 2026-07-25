'use client';

import type { StatusConfig } from '@/components/ui/Badge';

import { TicketList } from './TicketList';
import type { Shop, TicketListRow } from './types';

/**
 * Client boundary for the list. A Server Component cannot hand a `canDo`
 * closure to a Client Component (functions are not serializable across the RSC
 * boundary), so the page passes a plain `capabilities` map and this wrapper
 * rebuilds `canDo` on the client for `TicketList`.
 */
export function TicketListClient({
  tickets,
  statuses,
  accessibleShops,
  shops,
  canSeeAllShops,
  capabilities,
}: {
  tickets: TicketListRow[];
  statuses: StatusConfig[];
  accessibleShops: Shop[];
  shops: Shop[];
  canSeeAllShops: boolean;
  capabilities: Record<string, boolean>;
}) {
  const canDo = (key: string) => !!capabilities[key];
  return (
    <TicketList
      tickets={tickets}
      statuses={statuses}
      canDo={canDo}
      accessibleShops={accessibleShops}
      shops={shops}
      canSeeAllShops={canSeeAllShops}
    />
  );
}
