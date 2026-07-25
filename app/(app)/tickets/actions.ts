'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { TablesInsert, TablesUpdate } from '@/lib/types/database';
import type { OptionListName, TicketSavePayload } from '@/components/tickets/types';

export type SaveResult = { ok: boolean; error?: string; id?: string };

/**
 * CORRECTION C2 — proxy auth is optimistic only; every server action re-checks.
 *
 * `getSessionContext()` IS the authorization check: it verifies the caller
 * against the Supabase auth server and redirects unauthenticated callers to
 * /login (it throws NEXT_REDIRECT, so it must not sit inside a try that swallows
 * it). We then re-check the exact capability the prototype gates the UI action
 * with — creating a ticket requires `canDo('list.createNew')` — because a client
 * can POST this action without ever rendering the button. RLS (Task 7) is the
 * backstop that scopes rows by shop, not the only check.
 */

const OPTION_LISTS: OptionListName[] = [
  'booking_channels', 'service_types', 'car_types', 'car_brands', 'time_slots',
  'film_positions', 'wrap_positions', 'extra_options', 'slide_types', 'technicians',
  'product_categories', 'service_items', 'payment_methods',
];

async function nextTicketId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shop: string
): Promise<string> {
  const prefix = `JT-${shop.toUpperCase()}-`;
  const { data } = await supabase.from('tickets').select('id').like('id', `${prefix}%`);
  let max = 0;
  for (const row of data ?? []) {
    const n = Number(String(row.id).slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

async function resolveRetailCustomerId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  phone: string
): Promise<number | null> {
  if (!name.trim()) return null;
  const { data: existing } = await supabase
    .from('retail_customers')
    .select('id')
    .eq('name', name)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: inserted } = await supabase
    .from('retail_customers')
    .insert({ name, phone })
    .select('id')
    .single();
  return inserted?.id ?? null;
}

async function writeTicketChildren(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  p: TicketSavePayload
) {
  // Replace items (+ positions via cascade) and payments wholesale — the form
  // owns the complete list, so a delete-then-insert keeps them in sync.
  await supabase.from('ticket_items').delete().eq('ticket_id', ticketId);
  await supabase.from('ticket_payments').delete().eq('ticket_id', ticketId);

  for (const it of p.items) {
    const { data: itemRow, error: itemErr } = await supabase
      .from('ticket_items')
      .insert({
        ticket_id: ticketId,
        category: it.category,
        booked: it.booked,
        booked_price: it.bookedPrice,
        sold: it.sold,
        sold_price: it.soldPrice,
        discount_type: it.discountType,
        discount_value: it.discountValue,
      })
      .select('id')
      .single();
    if (itemErr) throw new Error(itemErr.message);
    if (itemRow && it.positions.length) {
      const { error: posErr } = await supabase.from('ticket_item_positions').insert(
        it.positions.map((pos) => ({
          ticket_item_id: itemRow.id,
          position: pos.position,
          product: pos.product,
          price: pos.price,
        }))
      );
      if (posErr) throw new Error(posErr.message);
    }
  }

  if (p.payments.length) {
    const { error: payErr } = await supabase.from('ticket_payments').insert(
      p.payments.map((pay) => ({
        ticket_id: ticketId,
        type: pay.type,
        method: pay.method,
        amount: pay.amount,
        paid_at: pay.paidAt,
      }))
    );
    if (payErr) throw new Error(payErr.message);
  }
}

function ticketRow(p: TicketSavePayload, id: string, retailCustomerId: number | null) {
  return {
    id,
    shop_id: p.shop,
    retail_customer_id: retailCustomerId,
    customer_name: p.customer,
    phone: p.phone,
    plate: p.plate,
    car_type: p.carType,
    brand: p.brand,
    model: p.model,
    color: p.color,
    service_type: p.serviceType,
    status: p.status,
    booking_channel: p.bookingChannel,
    tech_by_category: p.techByCategory,
    drop_off_date: p.dropOffDate,
    pickup_date: p.pickupDate,
    extras: p.extras,
  };
}

export async function createTicket(p: TicketSavePayload): Promise<SaveResult> {
  const session = await getSessionContext();
  if (!session.canDo('list.createNew')) return { ok: false, error: 'ไม่มีสิทธิ์สร้างใบงานใหม่' };
  const supabase = await createClient();
  try {
    const id = await nextTicketId(supabase, p.shop);
    const retailId = await resolveRetailCustomerId(supabase, p.customer, p.phone);
    const { error } = await supabase
      .from('tickets')
      .insert(ticketRow(p, id, retailId) as unknown as TablesInsert<'tickets'>);
    if (error) throw new Error(error.message);
    await writeTicketChildren(supabase, id, p);
    await supabase.from('ticket_status_history').insert({ ticket_id: id, status: p.status });
    revalidatePath('/tickets');
    revalidatePath(`/tickets/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

export async function updateTicket(p: TicketSavePayload): Promise<SaveResult> {
  // Editing an existing ticket is not separately capability-gated in the
  // prototype; authentication (via getSessionContext) plus RLS shop-scoping is
  // the boundary. getSessionContext still runs first per C2.
  await getSessionContext();
  const supabase = await createClient();
  try {
    const retailId = await resolveRetailCustomerId(supabase, p.customer, p.phone);
    const { id, ...cols } = ticketRow(p, p.id, retailId);
    const { error } = await supabase
      .from('tickets')
      .update(cols as unknown as TablesUpdate<'tickets'>)
      .eq('id', id);
    if (error) throw new Error(error.message);
    await writeTicketChildren(supabase, p.id, p);
    revalidatePath('/tickets');
    revalidatePath(`/tickets/${p.id}`);
    return { ok: true, id: p.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

export async function saveTicket(p: TicketSavePayload): Promise<SaveResult> {
  return p.isNew ? createTicket(p) : updateTicket(p);
}

export async function updateTicketStatus(ticketId: string, newStatus: string): Promise<void> {
  await getSessionContext(); // C2: authenticate before mutating
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ status: newStatus }).eq('id', ticketId);
  if (error) throw new Error(error.message);
  await supabase.from('ticket_status_history').insert({ ticket_id: ticketId, status: newStatus });
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
}

/**
 * Persist an admin-managed option list (the `Managed*` pickers' `setOptions`).
 * Full-list replace for a `list_key`: the picker owns the complete value list.
 * Only shop-global lists (shop_id null) are managed here, matching the seed.
 */
export async function updateOptionList(listKey: OptionListName, values: string[]): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext(); // C2: authenticate before mutating
  if (!OPTION_LISTS.includes(listKey)) return { ok: false, error: 'invalid list' };
  const supabase = await createClient();
  try {
    await supabase.from('option_lists').delete().eq('list_key', listKey).is('shop_id', null);
    if (values.length) {
      const { error } = await supabase
        .from('option_lists')
        .insert(values.map((value, i) => ({ list_key: listKey, value, shop_id: null, sort_order: i + 1 })));
      if (error) throw new Error(error.message);
    }
    revalidatePath('/tickets');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}
