import { TicketListClient } from '@/components/tickets/TicketListClient';
import { getSessionContext } from '@/lib/auth/session';

import { loadShops, loadStatuses, loadTicketList } from './data';

export default async function TicketsPage() {
  const session = await getSessionContext();
  const [tickets, statuses, shops] = await Promise.all([loadTicketList(), loadStatuses(), loadShops()]);
  const accessibleShops = shops.filter((s) => session.accessibleShopIds.includes(s.id));

  return (
    <TicketListClient
      tickets={tickets}
      statuses={statuses}
      accessibleShops={accessibleShops}
      shops={shops}
      canSeeAllShops={session.seesAllShops}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
      }}
    />
  );
}
