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
  // ?q= — the header search, sent to this page.
  const initialSearch = typeof params.q === 'string' ? params.q : undefined;
  // มุมมองที่เปิดค้างไว้ — what กลับไปรายการใบงาน comes back through, and what
  // makes a filtered list a link somebody can send (lib/browser/ticketFilter.ts).
  const str = (key: string) =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  return (
    <TicketListClient
      tickets={tickets}
      statuses={statuses}
      accessibleShops={accessibleShops}
      shops={shops}
      canSeeAllShops={session.seesAllShops}
      initialStatus={initialStatus}
      initialSearch={initialSearch}
      initialShop={str('shop')}
      initialCustomer={str('customer')}
      initialPeriod={str('period')}
      initialPeriodValue={str('pv')}
      initialRangeStart={str('rs')}
      initialRangeEnd={str('re')}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
        'list.restore': session.canDo('list.restore'),
      }}
    />
  );
}
