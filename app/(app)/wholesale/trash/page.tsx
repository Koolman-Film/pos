import { notFound } from 'next/navigation';

import { WholesaleTrash } from '@/components/wholesale/WholesaleTrash';
import { getSessionContext } from '@/lib/auth/session';

import { restoreOrder } from '../actions';
import { loadDeletedOrders } from '../data';

/**
 * ถังขยะ PO ขายส่ง. Gated on `wholesale.restore` — a caller without it gets a
 * 404 rather than an empty page, so the route does not advertise that a bin
 * exists.
 */
export default async function WholesaleTrashPage() {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.restore')) notFound();

  const { orders, customers, shops } = await loadDeletedOrders(session);

  return (
    <WholesaleTrash
      orders={orders}
      customers={customers}
      shops={shops}
      restoreAction={restoreOrder}
    />
  );
}
