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
  initialStatus,
  initialSearch,
  initialShop,
  initialCustomer,
  initialCategory,
  initialPeriod,
  initialPeriodValue,
  initialRangeStart,
  initialRangeEnd,
}: {
  tickets: TicketListRow[];
  statuses: StatusConfig[];
  accessibleShops: Shop[];
  shops: Shop[];
  canSeeAllShops: boolean;
  capabilities: Record<string, boolean>;
  /** สถานะที่เปิดมาจากลิงก์บนแดชบอร์ด — seeds the filter, does not lock it. */
  initialStatus?: string;
  /** `?q=` from the header search. */
  initialSearch?: string;
  /** มุมมองที่เปิดค้างไว้ — see lib/browser/ticketFilter.ts. */
  initialShop?: string;
  initialCustomer?: string;
  initialCategory?: string;
  initialPeriod?: string;
  initialPeriodValue?: string;
  initialRangeStart?: string;
  initialRangeEnd?: string;
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
      initialStatus={initialStatus}
      initialSearch={initialSearch}
      initialShop={initialShop}
      initialCustomer={initialCustomer}
      initialCategory={initialCategory}
      initialPeriod={initialPeriod}
      initialPeriodValue={initialPeriodValue}
      initialRangeStart={initialRangeStart}
      initialRangeEnd={initialRangeEnd}
    />
  );
}
