import { notFound } from 'next/navigation';

import { TicketDetailClient } from '@/components/tickets/TicketDetailClient';
import { getSessionContext } from '@/lib/auth/session';

import {
  deleteTicket,
  getTicketAttachmentUrl,
  saveCarModel,
  saveCorporateBuyer,
  saveTicket,
  unlockTicket,
  updateOptionList,
} from '../actions';
import { loadDetailRegistries, loadShops, loadStatuses, loadTicket } from '../data';

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();

  const [ticket, shops, statuses, registries] = await Promise.all([
    loadTicket(id),
    loadShops(),
    loadStatuses(),
    loadDetailRegistries(),
  ]);
  // RLS already scopes which tickets are visible; a miss is a genuine 404.
  if (!ticket) notFound();

  return (
    <TicketDetailClient
      initialTicket={ticket}
      isNew={false}
      shops={shops}
      statuses={statuses}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
        'options.manage': session.canDo('options.manage'),
        'list.delete': session.canDo('list.delete'),
        'list.unlock': session.canDo('list.unlock'),
      }}
      currentUserName={session.name}
      initialOptions={registries.options}
      initialStock={registries.stock}
      initialCarModels={registries.carModels}
      initialPriceMatrix={registries.priceMatrix}
      filmPriceMatrix={registries.filmPriceMatrix}
      initialRetailCustomers={registries.retailCustomers}
      initialCorporateBuyers={registries.corporateBuyers}
      shopInfo={registries.shopInfo}
      saveAction={saveTicket}
      optionAction={updateOptionList}
      deleteAction={deleteTicket}
      unlockAction={unlockTicket}
      attachmentUrlAction={getTicketAttachmentUrl}
      corporateBuyerAction={saveCorporateBuyer}
      carModelAction={saveCarModel}
    />
  );
}
