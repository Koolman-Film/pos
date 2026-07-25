import { notFound } from 'next/navigation';

import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';
import { getSessionContext } from '@/lib/auth/session';

import {
  approveOrderPrice,
  markOrderBadDebt,
  rejectOrderPrice,
  saveCustomer,
  saveOrder,
} from '../actions';
import { loadOrderDetailData } from '../data';

/**
 * Wholesale order detail / new-PO editor (`/wholesale/[id]`, with `id === 'new'`
 * for a fresh draft). Ports the prototype's `WholesaleDetail`
 * (reference/v0.4/finnix-film.html:2690-2967).
 *
 * The capability-gated transitions are wired to the server actions
 * (`approveOrderPrice`/`rejectOrderPrice` → `wholesale.priceApproval`,
 * `markOrderBadDebt` → `wholesale.badDebt`), each of which re-checks the
 * capability on the server per correction C2. The `caps` map here only controls
 * whether the buttons render.
 */
export default async function WholesaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session.hasNav('wholesale')) notFound();

  const data = await loadOrderDetailData(session, id);
  if (!data || !data.order) notFound();

  const caps = {
    'wholesale.createNew': session.canDo('wholesale.createNew'),
    'wholesale.priceApproval': session.canDo('wholesale.priceApproval'),
    'wholesale.badDebt': session.canDo('wholesale.badDebt'),
    'wholesale.export': session.canDo('wholesale.export'),
  };

  return (
    <WholesaleDetail
      order={data.order}
      isNew={data.isNew}
      caps={caps}
      customers={data.customers}
      orders={data.orders}
      stock={data.stock}
      paymentMethods={data.paymentMethods}
      shopInfo={data.shopInfo}
      wsStatuses={data.wsStatuses}
      shops={data.shops}
      onSaveOrder={saveOrder}
      onApprovePrice={approveOrderPrice}
      onRejectPrice={rejectOrderPrice}
      onMarkBadDebt={markOrderBadDebt}
      onSaveCustomer={saveCustomer}
    />
  );
}
