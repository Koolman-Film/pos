import type { Ticket, TicketSavePayload } from './types';

const toISODate = (d: string) => (d ? new Date(d + 'T00:00:00').toISOString().slice(0, 10) : '');

/**
 * Flatten the client ticket into the plain-JSON payload the create/update
 * server actions accept.
 *
 * Schema gap (flagged for review): the `tickets` table has no columns for
 * `notes`, `created_by`, `qc_photos`, `install_confirmed(_at)` or
 * `status_history` (status history is its own table). Since a Wave 4 module task
 * must not alter migration `0004`, these fields are carried inside the free-form
 * `extras` jsonb under a reserved `__meta` key and reconstructed on load.
 */
export function serializeTicket(t: Ticket, isNew: boolean): TicketSavePayload {
  const extras: Record<string, unknown> = { ...t.extras };
  extras.__meta = {
    notes: t.notes ?? '',
    createdBy: t.createdBy ?? '',
    qcPhotos: t.qcPhotos ?? [],
    installConfirmed: !!t.installConfirmed,
    installConfirmedAt: t.installConfirmedAt ?? '',
  };

  return {
    id: t.id,
    isNew,
    shop: t.shop,
    customer: t.customer,
    phone: t.phone,
    plate: t.plate,
    carType: t.carType,
    brand: t.brand,
    model: t.model,
    color: t.color,
    serviceType: t.serviceType,
    status: t.status,
    bookingChannel: t.bookingChannel,
    techByCategory: t.techByCategory || {},
    dropOffDate:
      t.dropOffDateObj instanceof Date
        ? t.dropOffDateObj.toISOString()
        : new Date(t.dropOffDateObj).toISOString(),
    pickupDate:
      t.pickupDateObj instanceof Date
        ? t.pickupDateObj.toISOString()
        : new Date(t.pickupDateObj).toISOString(),
    extras,
    items: t.items.map((i) => ({
      category: i.category,
      booked: i.booked || '',
      bookedPrice: Number(i.bookedPrice || 0),
      sold: i.sold || '',
      soldPrice: Number(i.soldPrice || 0),
      discountType: i.discountType ?? null,
      discountValue:
        i.discountValue != null && i.discountValue !== '' ? Number(i.discountValue) : null,
      positions: (i.positions || []).map((p) => ({
        position: p.position,
        product: p.product || '',
        price: Number(p.price || 0),
      })),
      // Recorded actual usage. This was previously dropped here, which meant the
      // technician's numbers never reached the server and no stock ever moved.
      // Blank/non-numeric entries are discarded rather than sent as NaN.
      actualQty: Object.fromEntries(
        Object.entries(i.actualQtyMap ?? {})
          .map(([name, qty]) => [name, Number(qty)] as const)
          .filter(([name, qty]) => name && Number.isFinite(qty) && qty !== 0),
      ),
    })),
    payments: t.payments.map((p) => ({
      type: p.type,
      method: p.method,
      amount: Number(p.amount || 0),
      paidAt: toISODate(p.date || '') || new Date().toISOString().slice(0, 10),
    })),
  };
}
