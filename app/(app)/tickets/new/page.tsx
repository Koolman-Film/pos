import { redirect } from 'next/navigation';

import { TicketDetailClient } from '@/components/tickets/TicketDetailClient';
import { getSessionContext } from '@/lib/auth/session';

import {
  getTicketAttachmentUrl,
  saveCarModel,
  saveCorporateBuyer,
  saveTicket,
  updateOptionList,
} from '../actions';
import { blankTicket, loadDetailRegistries, loadShops, loadStatuses } from '../data';

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  // Creating requires the capability the prototype gates the button with; a
  // direct navigation to /tickets/new should not render the form otherwise.
  if (!session.canDo('list.createNew')) redirect('/tickets');

  const [shops, statuses, registries] = await Promise.all([
    loadShops(),
    loadStatuses(),
    loadDetailRegistries(),
  ]);
  const accessibleShops = shops.filter((s) => session.accessibleShopIds.includes(s.id));
  const defaultShop = accessibleShops[0]?.id ?? shops[0]?.id ?? 'cm';

  // `?customer=<id>` — "สร้างใบงาน" from the ทะเบียนลูกค้า module. The name and
  // phone are snapshotted onto the ticket exactly as the in-form customer picker
  // does it, so nothing downstream needs to know where the pre-fill came from.
  const requestedCustomerId =
    typeof params.customer === 'string' ? Number(params.customer) : Number.NaN;
  const preselected = registries.retailCustomers.find((c) => c.id === requestedCustomerId);
  const initialTicket = preselected
    ? { ...blankTicket(defaultShop), customer: preselected.name, phone: preselected.phone }
    : blankTicket(defaultShop);

  return (
    <TicketDetailClient
      initialTicket={initialTicket}
      isNew
      shops={shops}
      statuses={statuses}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
        'options.manage': session.canDo('options.manage'),
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
      attachmentUrlAction={getTicketAttachmentUrl}
      corporateBuyerAction={saveCorporateBuyer}
      carModelAction={saveCarModel}
    />
  );
}
