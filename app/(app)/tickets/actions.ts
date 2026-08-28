'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { applyStockMovements, diffQtyMaps, sumQtyMaps, type QtyMap } from '@/lib/stock/movements';
import { ticketPaid, ticketTotal } from '@/lib/domain/tickets';
import type { Database, Json } from '@/lib/types/database';

import { updateOptionListAction } from '../optionListActions';

// Addressed through Database['pos'] rather than the generated TablesInsert/
// TablesUpdate helpers: those derive their default schema from
// `Extract<keyof Database, 'public'>`, which is `never` for a pos-only codegen
// and silently degrades the row types to `unknown`.
type TicketInsert = Database['pos']['Tables']['tickets']['Insert'];
type TicketUpdate = Database['pos']['Tables']['tickets']['Update'];
import type { OptionListName, TicketSavePayload } from '@/components/tickets/types';

export type SaveResult = {
  ok: boolean;
  error?: string;
  id?: string;
  /**
   * The save worked but some materials could not be deducted — the product was
   * renamed or removed since the usage was recorded. Not an error: the ticket is
   * saved. It is a message somebody has to read, because the alternative is
   * stock quietly drifting.
   */
  stockWarning?: string;
};

function stockWarningFor(unmatched: string[]): string | undefined {
  if (unmatched.length === 0) return undefined;
  return `บันทึกใบงานแล้ว แต่ตัดสต็อกไม่ได้ ${unmatched.length} รายการ (ไม่พบสินค้าในสาขานี้): ${unmatched.join(', ')}`;
}

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

// The list of valid option-list keys moved to lib/domain/optionLists.ts — it is
// shared with สต็อกสินค้า, บัญชี and ขายส่ง now, which have their own lists.

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
 *
 * It DOES return the product names it could not find, though. Skipping them in
 * silence is how a renamed product quietly stops being deducted; the caller puts
 * the names in the save result so somebody sees them.
 */
async function syncTicketStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  p: TicketSavePayload,
  before: QtyMap,
  userName: string,
): Promise<string[]> {
  const after = sumQtyMaps(p.items.map((it) => it.actualQty));
  const delta = diffQtyMaps(before, after);
  if (Object.keys(delta).length === 0) return [];
  try {
    const result = await applyStockMovements(supabase, delta, {
      kind: 'ใบงาน',
      documentId: ticketId,
      by: userName || 'ระบบ (ใบงาน)',
      shopId: p.shop,
    });
    return result.unmatched;
  } catch {
    // Intentionally non-fatal; see the note above.
    return [];
  }
}

/**
 * Put a deleted ticket's materials back, or take them out again on restore.
 *
 * Deleting a ticket used to leave the stock deducted: the job was cancelled,
 * the film went back on the shelf, and the system still counted it as used —
 * a shortfall that never came back and that nobody could trace to a deletion.
 *
 * `sign` is -1 to return and +1 to consume again, so restore is the exact
 * inverse of delete. Non-fatal like every other stock sync: the deletion
 * itself already succeeded and is the record of what happened.
 */
async function reverseTicketStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  shopId: string,
  sign: 1 | -1,
  userName: string,
): Promise<void> {
  const stored = await storedActualQty(supabase, ticketId);
  const delta: QtyMap = {};
  for (const [name, qty] of Object.entries(stored)) {
    if (qty) delta[name] = qty * sign;
  }
  if (Object.keys(delta).length === 0) return;
  try {
    await applyStockMovements(supabase, delta, {
      kind: sign === -1 ? 'ยกเลิกใบงาน' : 'กู้คืนใบงาน',
      documentId: ticketId,
      by: userName || 'ระบบ (ใบงาน)',
      shopId,
    });
  } catch {
    // Intentionally non-fatal; see syncTicketStock.
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
    revenue_kind: p.revenueKind,
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
    const unmatched = await syncTicketStock(supabase, id, p, {}, session.name);
    revalidatePath('/tickets');
    revalidatePath(`/tickets/${id}`);
    return { ok: true, id, stockWarning: stockWarningFor(unmatched) };
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
    const unmatched = await syncTicketStock(supabase, p.id, p, before, session.name);
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
    return { ok: true, id: p.id, stockWarning: stockWarningFor(unmatched) };
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
  const { data: ticket } = await supabase
    .from('tickets')
    .select('shop_id')
    .eq('id', ticketId)
    .maybeSingle();

  const { error } = await supabase
    .from('tickets')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: session.userId,
    } as unknown as TicketUpdate)
    .eq('id', ticketId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: error.message };

  // The job is off; its materials go back on the shelf.
  if (ticket?.shop_id) {
    await reverseTicketStock(supabase, ticketId, ticket.shop_id, -1, session.name);
  }
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
 * บันทึกเฉพาะ ข้อมูลเพิ่มเติม (extras) — the one part of a ticket that stays open
 * after it is closed.
 *
 * A delivered-and-paid ticket is frozen so its numbers cannot move (migration
 * 0017), but the job itself carries on: the car comes back for service, and the
 * customer may take ประกัน afterwards (its own record — see saveInsurancePolicy).
 * Those live in ข้อมูลเพิ่มเติม, so that
 * block alone stays editable — through this action, which can write nothing
 * else. `save_ticket_extras` and the lock trigger enforce that in the database;
 * this function only decides WHO may call it.
 */
export async function saveTicketExtras(input: {
  ticketId: string;
  extras: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.hasNav('list')) return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขใบงาน' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_ticket_extras', {
    p_ticket_id: input.ticketId,
    p_extras: input.extras as Json,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${input.ticketId}`);
  return { ok: true };
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
  const { data: ticket } = await supabase
    .from('tickets')
    .select('shop_id')
    .eq('id', ticketId)
    .maybeSingle();

  const { error } = await supabase
    .from('tickets')
    .update({ deleted_at: null, deleted_by: null } as unknown as TicketUpdate)
    .eq('id', ticketId)
    .not('deleted_at', 'is', null);
  if (error) return { ok: false, error: error.message };

  // Back on: the materials are consumed again, exactly as before.
  if (ticket?.shop_id) {
    await reverseTicketStock(supabase, ticketId, ticket.shop_id, 1, session.name);
  }
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
/**
 * Kept as the ticket module's own entry point (TicketDetail types its prop as
 * `OptionListName`), but the write itself lives in one place now — สต็อกสินค้า,
 * บัญชี and ขายส่ง need exactly the same thing and used to do none of it.
 */
export async function updateOptionList(
  listKey: OptionListName,
  values: string[],
): Promise<{ ok: boolean; error?: string }> {
  return updateOptionListAction(listKey, values);
}

/**
 * ข้อมูลนิติบุคคล for a tax invoice — "บันทึกข้อมูลนี้ไว้ใช้ครั้งถัดไป".
 *
 * The button said exactly that and did not do it: the buyer went into React
 * state and was gone on reload, so the same company's address and tax id got
 * retyped for every invoice.
 *
 * Gated on the Book งาน nav rather than a capability of its own — anyone who can
 * reach the ticket and issue the document is the person who has these details in
 * front of them.
 */
export async function saveCorporateBuyer(input: {
  name: string;
  address: string;
  taxId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.hasNav('list')) return { ok: false, error: 'ไม่มีสิทธิ์บันทึกข้อมูลนิติบุคคล' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'กรุณากรอกชื่อนิติบุคคลก่อนบันทึก' };
  const row = { name, address: input.address.trim(), tax_id: input.taxId.trim() };

  const supabase = await createClient();
  try {
    // The picker keys buyers by name, so saving the same company twice has to
    // update it rather than leave two rows the dropdown cannot tell apart.
    const { data: existing } = await supabase
      .from('corporate_buyers')
      .select('id')
      .eq('name', name)
      .limit(1)
      .maybeSingle();
    const { error } = existing?.id
      ? await supabase.from('corporate_buyers').update(row).eq('id', existing.id)
      : await supabase.from('corporate_buyers').insert(row);
    if (error) throw new Error(error.message);
    revalidatePath('/tickets');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

/**
 * รุ่นรถ → ยี่ห้อ + ประเภทรถ, so the next ticket for the same model fills those
 * two in by itself. The form has always taught this registry; it just taught it
 * to a React array that lived until the page reloaded.
 *
 * Keyed on the model name, case-insensitively, which is how `onModelChange`
 * looks it up.
 */
export async function saveCarModel(input: {
  model: string;
  brand: string;
  carType: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.hasNav('list')) return { ok: false, error: 'ไม่มีสิทธิ์บันทึกทะเบียนรุ่นรถ' };

  const model = input.model.trim();
  const brand = input.brand.trim();
  const carType = input.carType.trim();
  // A half-filled row would autofill blanks over a later ticket's real values.
  if (!model || !brand || !carType) return { ok: true };

  const supabase = await createClient();
  try {
    const { data: existing } = await supabase
      .from('car_models')
      .select('id')
      .ilike('model', model)
      .limit(1)
      .maybeSingle();
    const { error } = existing?.id
      ? await supabase.from('car_models').update({ brand, car_type: carType }).eq('id', existing.id)
      : await supabase.from('car_models').insert({ model, brand, car_type: carType });
    if (error) throw new Error(error.message);
    revalidatePath('/tickets');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

/**
 * บันทึกใบเซอร์วิส — one visit the car actually made (migration 0020).
 *
 * The visit and its ten จุดพิเศษ rows go through `save_service_visit` in a single
 * call, so a visit can never be stored without the points written on it, and a
 * NEW visit takes its `visit_no` under a lock rather than from a number the
 * browser guessed — two people filing at once get 3 and 4, not two 3s.
 *
 * A LOCKED ticket is fine here: a car comes back to be serviced long after it
 * was delivered and paid for, and the lock is there to stop the MONEY moving,
 * not to stop the shop recording what it did afterwards.
 */
export async function saveServiceVisit(input: {
  id?: number;
  ticketId: string;
  visit: Record<string, unknown>;
  points: { seq: number; position: string; detail: string; note: string }[];
}): Promise<{ ok: boolean; error?: string; id?: number }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  // The Book งาน nav is the gate, the same one that lets someone edit the ticket
  // at all — there is no separate "edit" capability, only createNew/delete/
  // restore/unlock/printSheet.
  if (!session.hasNav('list')) {
    return { ok: false, error: 'ไม่มีสิทธิ์บันทึกใบเซอร์วิส' };
  }

  const supabase = await createClient();
  try {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id')
      .eq('id', input.ticketId)
      .maybeSingle();
    if (!ticket) return { ok: false, error: 'ไม่พบใบงานนี้' };
    // `p_id` is nullable in SQL — a null means "issue the next visit_no" — but
    // the generated Args type has no way to express that, hence the cast.
    const { data, error } = await supabase.rpc('save_service_visit', {
      p_id: (input.id ?? null) as number,
      p_ticket_id: input.ticketId,
      p_visit: input.visit as Json,
      p_points: input.points as unknown as Json,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/tickets');
    return { ok: true, id: (data as number) ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}

/**
 * Removes a recorded visit. The points cascade with it.
 *
 * Deliberately NOT renumbering the visits after it: "ครั้งที่ 3" is what was
 * printed and handed to a customer, and shuffling the ones above it down would
 * make every sheet already in a folder disagree with the system.
 */
export async function deleteServiceVisit(id: number): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('list.delete')) {
    return { ok: false, error: 'ไม่มีสิทธิ์ลบใบเซอร์วิส (เฉพาะผู้ที่ลบใบงานได้)' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('service_visits').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  return { ok: true };
}

/**
 * บันทึกกรมธรรม์ประกัน พร้อมการเคลมทั้งหมดในครั้งเดียว.
 *
 * No `locked` check, unlike everything else that writes to a ticket: ประกัน is
 * routinely bought months after delivery, and a policy is not part of the
 * ticket's numbers — it carries its own `soldAt`, which is the date the revenue
 * belongs to. That is the whole reason it is a record of its own.
 */
export async function saveInsurancePolicy(input: {
  id?: number;
  ticketId: string;
  policy: Record<string, unknown>;
  claims: Record<string, unknown>[];
}): Promise<{ ok: boolean; error?: string; id?: number }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.hasNav('list')) return { ok: false, error: 'ไม่มีสิทธิ์บันทึกประกัน' };

  const supabase = await createClient();
  try {
    // `p_id` is nullable in SQL — null means "issue a new policy" — but the
    // generated Args type cannot express that, hence the cast.
    const { data, error } = await supabase.rpc('save_insurance_policy', {
      p_id: (input.id ?? null) as number,
      p_ticket_id: input.ticketId,
      p_policy: input.policy as Json,
      p_claims: input.claims as unknown as Json,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    return { ok: true, id: (data as number) ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกประกันไม่สำเร็จ' };
  }
}

/** ลบกรมธรรม์ — the claims cascade with it. Same gate as deleting a ใบเซอร์วิส. */
export async function deleteInsurancePolicy(id: number): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('list.delete')) {
    return { ok: false, error: 'ไม่มีสิทธิ์ลบประกัน (เฉพาะผู้ที่ลบใบงานได้)' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('insurance_policies').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/tickets');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * บันทึกว่าออกเอกสารการเงินให้ลูกค้าแล้ว (migration 0024).
 *
 * Issuing a ใบเสร็จ or a ใบกำกับภาษี used to be a print and nothing more — the
 * type and the buyer's นิติบุคคล details lived in React state until the screen
 * closed. Nobody could answer "which sales did we issue a tax invoice for",
 * which is the question the accountant asks every month, so โมดูลรายได้ reads
 * this table.
 *
 * Called on the way to the printer. A failure must not stop the print: the
 * document is what the customer is standing there waiting for, and a missing
 * row is a reporting gap, not a lost sale.
 */
export async function recordTicketDocument(input: {
  ticketId: string;
  docType: string;
  docNo: string;
  buyerName: string;
  buyerTaxId: string;
  buyerAddress: string;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.hasNav('list')) return { ok: false, error: 'ไม่มีสิทธิ์ออกเอกสาร' };
  const supabase = await createClient();

  /*
    ใบกำกับภาษีออกไม่ได้ถ้าใบงานเป็น "รับแทน Finnix" (migration 0031).

    The ticket screen hides the button, but the button is not the rule: this is
    a Server Action, and any client can POST to it without ever rendering that
    screen. A tax invoice asserts that THIS shop made the sale, so issuing one
    for money it is only holding would put a document into its tax position for
    revenue it never earned — checked here, against the stored ticket.
  */
  if (input.docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน') {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('revenue_kind')
      .eq('id', input.ticketId)
      .maybeSingle();
    if (ticket?.revenue_kind === 'รับแทน') {
      return {
        ok: false,
        error: 'ใบงานนี้เป็นเงินรับแทน Finnix จึงออกใบกำกับภาษีไม่ได้',
      };
    }
  }

  const { error } = await supabase.rpc('record_ticket_document', {
    p_ticket_id: input.ticketId,
    p_doc_type: input.docType,
    p_doc_no: input.docNo,
    p_buyer_name: input.buyerName,
    p_buyer_tax_id: input.buyerTaxId,
    p_buyer_address: input.buyerAddress,
    p_amount: input.amount,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/revenue');
  return { ok: true };
}
