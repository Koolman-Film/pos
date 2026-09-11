import { TicketListClient } from '@/components/tickets/TicketListClient';
import { getSessionContext } from '@/lib/auth/session';

import { loadShops, loadStatuses, loadTicketList } from './data';

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  const [tickets, statuses, shops] = await Promise.all([
    loadTicketList(),
    loadStatuses(),
    loadShops(),
  ]);
  const accessibleShops = shops.filter((s) => session.accessibleShopIds.includes(s.id));
  // Opened from a status bar on the dashboard: that number and this list
  // should be looking at the same jobs.
  const params = await searchParams;
  const initialStatus = typeof params.status === 'string' ? params.status : undefined;

  return (
    <TicketListClient
      tickets={tickets}
      statuses={statuses}
      accessibleShops={accessibleShops}
      shops={shops}
      canSeeAllShops={session.seesAllShops}
      initialStatus={initialStatus}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
        'list.restore': session.canDo('list.restore'),
      }}
    />
  );
}
