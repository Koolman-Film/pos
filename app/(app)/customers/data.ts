import { createClient } from '@/lib/supabase/server';
import { ticketTotal } from '@/lib/domain/tickets';
import type { CustomerRow, CustomerVehicle } from '@/components/customers/types';

/**
 * Server-side reads for ทะเบียนลูกค้า.
 *
 * The registry itself is `retail_customers`, which the ticket form has been
 * writing to all along (`resolveRetailCustomerId` in the tickets actions creates
 * a row the first time a name+phone is used). What was missing was anywhere to
 * SEE it. Everything else on this screen — how many jobs, which vehicles, how
 * much spent, when they last came in — is derived from `tickets`, not stored a
 * second time, so it cannot drift from the job records.
 *
 * Soft-deleted tickets are excluded, same as every other list.
 */

/** The projection the ticket query below returns; the embed defeats inference. */
type CustomerTicketRow = {
  id: string;
  shop_id: string;
  retail_customer_id: number | null;
  customer_name: string;
  phone: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  car_type: string | null;
  status: string;
  drop_off_date: string | null;
  ticket_items: {
    sold_price: number;
    discount_type: string | null;
    discount_value: number | null;
  }[];
  ticket_payments: { amount: number }[];
};

export async function loadCustomers(): Promise<CustomerRow[]> {
  const supabase = await createClient();
  const [{ data: customerRows }, { data: ticketRows }] = await Promise.all([
    supabase.from('retail_customers').select('id, name, phone').order('name'),
    supabase
      .from('tickets')
      .select(
        'id, shop_id, retail_customer_id, customer_name, phone, plate, brand, model, car_type, status, drop_off_date, ' +
          'ticket_items(sold_price, discount_type, discount_value), ticket_payments(amount)',
      )
      .is('deleted_at', null)
      .order('drop_off_date', { ascending: false }),
  ]);

  // A ticket links to the registry by id, but tickets created before that link
  // existed (and any whose customer was typed by hand) only carry the name+phone
  // snapshot. Match on either, so the history is complete.
  const tickets = ((ticketRows ?? []) as unknown as CustomerTicketRow[]).map((t) => ({
    id: t.id,
    shop: t.shop_id,
    customerId: t.retail_customer_id,
    key: `${t.customer_name}|${t.phone ?? ''}`,
    plate: t.plate ?? '',
    brand: t.brand ?? '',
    model: t.model ?? '',
    carType: t.car_type ?? '',
    status: t.status,
    dropOff: t.drop_off_date ? new Date(t.drop_off_date) : null,
    total: ticketTotal({
      items: (t.ticket_items ?? []).map((i) => ({
        soldPrice: Number(i.sold_price || 0),
        discountType: (i.discount_type ?? undefined) as 'percent' | 'amount' | undefined,
        discountValue: i.discount_value == null ? undefined : Number(i.discount_value),
      })),
      payments: (t.ticket_payments ?? []).map((p) => ({ amount: Number(p.amount || 0) })),
    }),
  }));

  return (customerRows ?? []).map((c) => {
    const mine = tickets.filter(
      (t) => t.customerId === c.id || t.key === `${c.name}|${c.phone ?? ''}`,
    );
    const vehicles: CustomerVehicle[] = [];
    for (const t of mine) {
      if (!t.plate && !t.model) continue;
      if (vehicles.some((v) => v.plate === t.plate && v.model === t.model)) continue;
      vehicles.push({ plate: t.plate, brand: t.brand, model: t.model, carType: t.carType });
    }
    return {
      id: c.id,
      name: c.name,
      phone: c.phone ?? '',
      ticketCount: mine.length,
      totalSpent: mine.reduce((s, t) => s + t.total, 0),
      lastVisit: mine.reduce<Date | null>(
        (latest, t) => (t.dropOff && (!latest || t.dropOff > latest) ? t.dropOff : latest),
        null,
      ),
      vehicles,
      tickets: mine.map((t) => ({
        id: t.id,
        shop: t.shop,
        status: t.status,
        dropOff: t.dropOff,
        total: t.total,
      })),
    };
  });
}
