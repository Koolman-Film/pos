import { notFound } from 'next/navigation';

import { TicketDetailClient } from '@/components/tickets/TicketDetailClient';
import { getSessionContext } from '@/lib/auth/session';
import { loadPayAccounts } from '@/lib/money/payAccounts';
import { createClient } from '@/lib/supabase/server';

import {
  deleteTicket,
  getTicketAttachmentUrl,
  deleteServiceVisit,
  saveCarModel,
  saveCorporateBuyer,
  saveServiceVisit,
  saveInsurancePolicy,
  deleteInsurancePolicy,
  recordTicketDocument,
  saveTicket,
  saveTicketExtras,
  saveTicketTech,
  saveTicketItemFinnixDocs,
  setTicketPayAccount,
  unlockTicket,
  updateOptionList,
} from '../actions';
import {
  loadDetailRegistries,
  loadInsurancePlans,
  loadShops,
  loadStatuses,
  loadTicket,
} from '../data';

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();

  const supabase = await createClient();
  const [ticket, shops, statuses, registries, payAccounts] = await Promise.all([
    loadTicket(id),
    loadShops(),
    loadStatuses(),
    loadDetailRegistries(),
    loadPayAccounts(supabase, session.accessibleShopIds),
  ]);
  // RLS already scopes which tickets are visible; a miss is a genuine 404.
  if (!ticket) notFound();

  // After the ticket, because the plans a branch may sell depend on its shop.
  const insurancePlans = await loadInsurancePlans(ticket.shop);

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
      // ประวัติการแก้ไข — admin by ROLE, like the page it opens (0061). Not a
      // capability: those are what จัดการสิทธิ์ hands out, and this is not.
      canSeeHistory={session.roleId === 'admin'}
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
      extrasAction={saveTicketExtras}
      techAction={saveTicketTech}
      finnixDocAction={saveTicketItemFinnixDocs}
      payAccounts={payAccounts}
      payAccountAction={setTicketPayAccount}
      serviceVisitAction={saveServiceVisit}
      serviceVisitDeleteAction={deleteServiceVisit}
      insurancePlans={insurancePlans}
      insuranceAction={saveInsurancePolicy}
      insuranceDeleteAction={deleteInsurancePolicy}
      documentAction={recordTicketDocument}
    />
  );
}
