import { notFound } from 'next/navigation';

import { WholesaleList } from '@/components/wholesale/WholesaleList';
import { getSessionContext } from '@/lib/auth/session';

import { updateOrderStatus } from './actions';
import { loadWholesaleListData } from './data';

/**
 * Wholesale order list (`/wholesale`). Ports the prototype's `WholesaleList`
 * view (reference/v0.4/finnix-film.html:2526-2648).
 *
 * `getSessionContext()` authorizes the request; `hasNav('wholesale')` gates the
 * whole module (the sidebar hides the link, but a direct navigation must also be
 * refused). Capabilities are resolved to a plain `caps` map here because a
 * Server Component cannot pass the `canDo` closure across to a Client Component.
 */
export default async function WholesalePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!session.hasNav('wholesale')) notFound();

  const { orders, customers, wsStatuses, shops } = await loadWholesaleListData(session);

  const caps = {
    'wholesale.createNew': session.canDo('wholesale.createNew'),
    'wholesale.export': session.canDo('wholesale.export'),
    'wholesale.updateStatus': session.canDo('wholesale.updateStatus'),
  };

  /*
    Products the PO could not deduct from stock, handed over by `saveOrder`.

    It travels in the URL because saving a PO ends in a redirect to this list —
    the alternative was swallowing it, which is what used to happen: the goods
    left the shelf and the count never moved.
  */
  const params = await searchParams;
  const raw = typeof params.stock === 'string' ? params.stock : '';
  const stockWarning = raw.trim()
    ? `บันทึก PO แล้ว แต่ตัดสต็อกไม่สำเร็จ: ${raw.trim()} — ตรวจว่าสินค้ายังอยู่ในทะเบียนของสาขานี้ แล้วปรับสต็อกเอง`
    : undefined;

  return (
    <WholesaleList
      orders={orders}
      customers={customers}
      caps={caps}
      wsStatuses={wsStatuses}
      accessibleShops={shops}
      canSeeAllShops={session.seesAllShops}
      onUpdateStatus={updateOrderStatus}
      stockWarning={stockWarning}
    />
  );
}
