import { notFound } from 'next/navigation';

import { CustomersModule } from '@/components/customers/CustomersModule';
import { getSessionContext } from '@/lib/auth/session';
import { loadShops, loadStatuses } from '@/app/(app)/tickets/data';

import { deleteCustomer, saveCustomer } from './actions';
import { loadCustomers } from './data';

/**
 * ทะเบียนลูกค้า. Gated on the `customers` nav permission — the sidebar hides the
 * entry without it, and this re-check is what makes a typed URL behave the same.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session.hasNav('customers')) notFound();
  const params = await searchParams;

  const [customers, shops, statuses] = await Promise.all([
    loadCustomers(),
    loadShops(),
    loadStatuses(),
  ]);

  return (
    <CustomersModule
      customers={customers}
      shops={shops}
      statuses={statuses}
      canEdit={session.canDo('customers.edit')}
      canCreateTicket={session.canDo('list.createNew')}
      saveAction={saveCustomer}
      deleteAction={deleteCustomer}
      initialSearch={typeof params.q === 'string' ? params.q : undefined}
    />
  );
}
