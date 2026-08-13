'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { applyStockMovements, diffQtyMaps, sumQtyMaps, type QtyMap } from '@/lib/stock/movements';
import { ticketPaid, ticketTotal } from '@/lib/domain/tickets';
import type { Database } from '@/lib/types/database';

// Addressed through Database['pos'] rather than the generated TablesInsert/
// TablesUpdate helpers: those derive their default schema from
// `Extract<keyof Database, 'public'>`, which is `never` for a pos-only codegen
// and silently degrades the row types to `unknown`.
type TicketInsert = Database['pos']['Tables']['tickets']['Insert'];
type TicketUpdate = Database['pos']['Tables']['tickets']['Update'];
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
  'booking_channels',
  'service_types',
  'car_types',
  'car_brands',
  'time_slots',
  'film_positions',
  'wrap_positions',
  'extra_options',
  'slide_types',
  'technicians',
  'product_categories',
  'service_items',
  'payment_methods',
];

async function nextTicketId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shop: string,
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
  phone: string,
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

/**
 * Total actual usage per product currently STORED for a ticket.
 *
 * Must be read before `writeTicketChildren` deletes the rows, because it is the
 * "before" side of the stock delta. A brand-new ticket has no stored rows, so this
 * is `{}` and the whole recorded quantity counts as consumed.
 */
async function storedActualQty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
): Promise<QtyMap> {
  const { data } = await supabase
    .from('ticket_items')
    .select('actual_qty')
    .eq('ticket_id', ticketId);
  return sumQtyMaps((data ?? []).map((r) => r.actual_qty as QtyMap));
}

/**
 * Replace a ticket's items (with their positions) and payments, atomically.
 *
 * The form owns the complete list, so this is a wholesale replacement. It runs as
 * ONE database call — `save_ticket_children` (migration 0011) — rather than a
 * delete followed by a loop of inserts. That matters: the old version issued each
 * statement as its own transaction, so an insert failing part-way left the ticket
 * with some or none of its items and the previous values already deleted. Now
 * either the whole new set lands or nothing changes.
 *
 * RLS still applies — the function is `security invoker`.
 */
async function writeTicketChildren(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  p: TicketSavePayload,
) {
  const { error } = await supabase.rpc('save_ticket_children', {
    p_ticket_id: ticketId,
    p_items: p.items,
    p_payments: p.payments,
  });
  if (error) throw new Error(error.message);
}

/**
 * Move stock to match the actual quantities recorded on this ticket, and log it.
 *
 * The prototype credited the movement to the logged-in user and fell back to
 * `ระบบ (ใบงาน)` when there was none (:1416), so the same fallback applies here.
 * Stock movement must never fail a save that already succeeded — the ticket is the
 * record of what happened, and a stock row that could not be found is a data
 * problem to surface, not a reason to lose the technician's work. So this is
 * called after the write and its own failure is swallowed deliberately.
 */
async function syncTicketStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  p: TicketSavePayload,
  before: QtyMap,
  userName: string,
): Promise<void> {
  const after = sumQtyMaps(p.items.map((it) => it.actualQty));
  const delta = diffQtyMaps(before, after);
  if (Object.keys(delta).length === 0) return;
  try {
    await applyStockMovements(supabase, delta, {
      kind: 'ใบงาน',
      documentId: ticketId,
      by: userName || 'ระบบ (ใบงาน)',
      shopId: p.shop,
    });
  } catch {
    // Intentionally non-fatal; see the note above.
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
      .insert(ticketRow(p, id, retailId) as unknown as TicketInsert);
    if (error) throw new Error(error.message);
    await writeTicketChildren(supabase, id, p);
    await supabase.from('ticket_status_history').insert({ ticket_id: id, status: p.status });
    // A new ticket has no stored quantities, so everything recorded is consumed.
    await syncTicketStock(supabase, id, p, {}, session.name);
    revalidatePath('/tickets');
    revalidatePath(`/tickets/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

/**
 * Is this ticket a closed record — ส่งมอบแล้ว and paid in full?
 *
 * Evaluated here rather than in SQL because `lib/domain/tickets.ts` already owns
 * the percent/amount discount maths; a second copy in a trigger would be free to
 * disagree with the totals the rest of the app shows. Migration 0017 enforces
 * the resulting flag, which is the part that has to be un-walk-around-able.
 */
function shouldLock(p: TicketSavePayload): boolean {
  if (p.status !== 'ส่งมอบแล้ว') return false;
  const forTotals = {
    items: p.items.map((i) => ({
      soldPrice: i.soldPrice,
      discountType: (i.discountType ?? undefined) as 'percent' | 'amount' | undefined,
      discountValue: i.discountValue ?? undefined,
    })),
    payments: p.payments.map((pay) => ({ amount: pay.amount })),
  };
  const total = ticketTotal(forTotals);
  return total > 0 && ticketPaid(forTotals) >= total;
}

export async function updateTicket(p: TicketSavePayload): Promise<SaveResult> {
  // Editing an existing ticket is not separately capability-gated in the
  // prototype; authentication (via getSessionContext) plus RLS shop-scoping is
  // the boundary. getSessionContext still runs first per C2.
  const session = await getSessionContext();
  const supabase = await createClient();
  try {
    const retailId = await resolveRetailCustomerId(supabase, p.customer, p.phone);
    // Read the stored quantities BEFORE writeTicketChildren deletes the rows.
    const before = await storedActualQty(supabase, p.id);
    const { id, ...cols } = ticketRow(p, p.id, retailId);
    const { error } = await supabase
      .from('tickets')
      .update(cols as unknown as TicketUpdate)
      .eq('id', id);
    if (error) throw new Error(error.message);
    await writeTicketChildren(supabase, p.id, p);
    await syncTicketStock(supabase, p.id, p, before, session.name);
    // Closing the ticket is the LAST thing that happens, after the children are
    // written — `save_ticket_children` refuses to touch a locked ticket, so
    // setting the flag any earlier would block the same save that sets it.
    if (shouldLock(p)) {
      await supabase
        .from('tickets')
        .update({ locked: true } as unknown as TicketUpdate)
        .eq('id', p.id);
    }
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
  // The dashboard's recent-jobs list carries this same status dropdown (C13), and
  // its status bars and job calendar are derived from status too, so a change made
  // there has to invalidate it or the row snaps back to the stale value.
  revalidatePath('/dashboard');
}

/**
 * ลบใบงาน — a soft delete (migration 0013). The row keeps its job number and all
 * its children; it simply stops appearing in the lists. `list.restore` holders
 * see it in the bin and can put it back.
 *
 * The capability is re-checked here per C2 AND enforced by a trigger in the
 * database, because `tickets_rw` lets any shop member update the row.
 */
export async function deleteTicket(ticketId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('list.delete')) return { ok: false, error: 'ไม่มีสิทธิ์ลบใบงาน' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('tickets')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: session.userId,
    } as unknown as TicketUpdate)
    .eq('id', ticketId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * A one-minute signed URL for a slip or QC photo on a ticket.
 *
 * The `ticket-attachments` bucket is private (migration 0018), so this is the
 * only way to open one. Authentication is re-checked here per C2 and storage
 * RLS checks the `list` nav again when the URL is redeemed.
 */
export async function getTicketAttachmentUrl(
  path: string,
): Promise<{ url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('ticket-attachments')
    .createSignedUrl(path, 60);
  if (error) return { error: error.message };
  return { url: data?.signedUrl };
}

/**
 * ปลดล็อกใบงาน — reopen a closed ticket for editing, gated on `list.unlock`
 * (admin). The ticket re-locks by itself on the next save if it still qualifies,
 * so this is "let me fix this one thing", not a permanent switch.
 */
export async function unlockTicket(ticketId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('list.unlock')) return { ok: false, error: 'ไม่มีสิทธิ์ปลดล็อกใบงาน' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('tickets')
    .update({ locked: false } as unknown as TicketUpdate)
    .eq('id', ticketId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/** กู้คืนใบงาน — the other half of `deleteTicket`, gated on `list.restore`. */
export async function restoreTicket(ticketId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('list.restore')) return { ok: false, error: 'ไม่มีสิทธิ์กู้คืนใบงาน' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('tickets')
    .update({ deleted_at: null, deleted_by: null } as unknown as TicketUpdate)
    .eq('id', ticketId)
    .not('deleted_at', 'is', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Persist an admin-managed option list (the `Managed*` pickers' `setOptions`).
 * Full-list replace for a `list_key`: the picker owns the complete value list.
 * Only shop-global lists (shop_id null) are managed here, matching the seed.
 */
export async function updateOptionList(
  listKey: OptionListName,
  values: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  // These lists are shared by every shop and every ticket, so extending one is
  // an administrative act, not part of filling in a job. The pickers hide their
  // add/remove controls without this capability; this is the actual gate.
  if (!session.canDo('options.manage')) {
    return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขรายการตัวเลือก (เฉพาะแอดมิน)' };
  }
  if (!OPTION_LISTS.includes(listKey)) return { ok: false, error: 'invalid list' };
  const supabase = await createClient();
  try {
    await supabase.from('option_lists').delete().eq('list_key', listKey).is('shop_id', null);
    if (values.length) {
      const { error } = await supabase.from('option_lists').insert(
        values.map((value, i) => ({
          list_key: listKey,
          value,
          shop_id: null,
          sort_order: i + 1,
        })),
      );
      if (error) throw new Error(error.message);
    }
    revalidatePath('/tickets');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}
