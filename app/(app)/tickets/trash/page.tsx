import { notFound } from 'next/navigation';

import { TicketTrash } from '@/components/tickets/TicketTrash';
import { getSessionContext } from '@/lib/auth/session';

import { restoreTicket } from '../actions';
import { loadDeletedTicketList, loadShops } from '../data';

/**
 * ถังขยะใบงาน. Gated on `list.restore` — a caller without it gets a 404 rather
 * than an empty page, so the route does not advertise that a bin exists.
 */
export default async function TicketTrashPage() {
  const session = await getSessionContext();
  if (!session.canDo('list.restore')) notFound();

  const [tickets, shops] = await Promise.all([loadDeletedTicketList(), loadShops()]);

  return <TicketTrash tickets={tickets} shops={shops} restoreAction={restoreTicket} />;
}
