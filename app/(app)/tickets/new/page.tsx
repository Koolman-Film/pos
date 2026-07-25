import { redirect } from 'next/navigation';

import { TicketDetailClient } from '@/components/tickets/TicketDetailClient';
import { getSessionContext } from '@/lib/auth/session';

import { saveTicket, updateOptionList } from '../actions';
import { blankTicket, loadDetailRegistries, loadShops, loadStatuses } from '../data';

export default async function NewTicketPage() {
  const session = await getSessionContext();
  // Creating requires the capability the prototype gates the button with; a
  // direct navigation to /tickets/new should not render the form otherwise.
  if (!session.canDo('list.createNew')) redirect('/tickets');

  const [shops, statuses, registries] = await Promise.all([loadShops(), loadStatuses(), loadDetailRegistries()]);
  const accessibleShops = shops.filter((s) => session.accessibleShopIds.includes(s.id));
  const defaultShop = accessibleShops[0]?.id ?? shops[0]?.id ?? 'cm';

  return (
    <TicketDetailClient
      initialTicket={blankTicket(defaultShop)}
      isNew
      shops={shops}
      statuses={statuses}
      capabilities={{
        'list.createNew': session.canDo('list.createNew'),
        'list.printSheet': session.canDo('list.printSheet'),
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
    />
  );
}
