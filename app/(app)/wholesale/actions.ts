'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import type { SaveOrderInput } from '@/components/wholesale/types';

/**
 * Wholesale server actions.
 *
 * CORRECTION C2 — proxy auth is optimistic only; UI `canDo(...)` gating is
 * bypassable (Server Functions are plain POSTs to the route that hosts them, so
 * any client can invoke them without ever rendering the button). Therefore
 * EVERY action below re-establishes the session on the server with
 * `getSessionContext()` (which is itself the authorization check — it verifies
 * the caller against the Supabase auth server) and then re-checks the specific
 * capability the mutation requires:
 *   - price approve/reject  →  `wholesale.priceApproval`
 *   - mark bad debt         →  `wholesale.badDebt`
 *   - create a brand-new PO →  `wholesale.createNew`
 * RLS (migration 0007) is the backstop, not the only check.
 */

/** Not exported → an ordinary helper, not itself a Server Action. */
async function setOrderStatusInternal(orderId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) throw new Error(error.message);
  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${orderId}`);
}

/**
 * Persist a PO and all its child rows. Creating a *new* order additionally
 * requires `wholesale.createNew`; editing an existing one only requires a valid
 * session (the sensitive transitions have their own gated actions below).
 */
export async function saveOrder(input: SaveOrderInput, isNew: boolean) {
  const session = await getSessionContext();
  if (isNew && !session.canDo('wholesale.createNew')) {
    throw new Error('ไม่มีสิทธิ์สร้าง PO ใหม่');
  }

  const supabase = await createClient();

  const { error: headerErr } = await supabase.from('orders').upsert({
    id: input.id,
    shop_id: input.shop,
    customer_id: input.customerId,
    status: input.status,
  });
  if (headerErr) throw new Error(headerErr.message);

  // Children are replaced wholesale (delete-then-insert) to mirror the
  // prototype's "the draft IS the truth on save" model.
  const nowIso = new Date().toISOString();

  await supabase.from('order_items').delete().eq('order_id', input.id);
  if (input.items.length) {
    const { error } = await supabase.from('order_items').insert(
      input.items.map((it) => ({
        order_id: input.id,
        name: it.name,
        qty: Number(it.qty) || 0,
        list_price: Number(it.listPrice) || 0,
        requested_price: Number(it.requestedPrice) || 0,
        reason: it.reason || '',
      })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase.from('order_returns').delete().eq('order_id', input.id);
  if (input.returns.length) {
    const { error } = await supabase.from('order_returns').insert(
      input.returns.map((r) => ({
        order_id: input.id,
        item_name: r.item,
        qty: Number(r.qty) || 0,
        reason: r.reason || '',
      })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase.from('order_adjustments').delete().eq('order_id', input.id);
  if (input.adjustments.length) {
    // `adjusted_at` is a NOT NULL timestamptz; the prototype only kept a free
    // Thai display string ("วันนี้"), which is not a valid timestamp, so persist
    // the save time here. (Divergence noted for review.)
    const { error } = await supabase.from('order_adjustments').insert(
      input.adjustments.map((a) => ({
        order_id: input.id,
        amount: Number(a.amount) || 0,
        reason: a.reason || '',
        adjusted_at: nowIso,
      })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase.from('order_payments').delete().eq('order_id', input.id);
  if (input.payments.length) {
    const { error } = await supabase.from('order_payments').insert(
      input.payments.map((p) => ({
        order_id: input.id,
        amount: Number(p.amount) || 0,
        method: p.method,
        paid_at: nowIso,
      })),
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath('/wholesale');
  redirect('/wholesale');
}

/** Approve the discounted price → `รอจัดส่ง`. Gated by `wholesale.priceApproval`. */
export async function approveOrderPrice(orderId: string) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) throw new Error('ไม่มีสิทธิ์อนุมัติราคา');
  await setOrderStatusInternal(orderId, 'รอจัดส่ง');
}

/** Reject the discount → back to `รออนุมัติราคา`. Gated by `wholesale.priceApproval`. */
export async function rejectOrderPrice(orderId: string) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) throw new Error('ไม่มีสิทธิ์อนุมัติราคา');
  await setOrderStatusInternal(orderId, 'รออนุมัติราคา');
}

/**
 * Flag an outstanding balance as bad debt. Gated by `wholesale.badDebt`.
 *
 * The prototype's "แจ้งตัดเป็นหนี้สูญ" button sets the order status to
 * `ค้างชำระ` (finnix-film.html:2879); this reproduces that exactly. (The plan's
 * illustrative excerpt wrote a `ตัดหนี้สูญ` status that does not exist in
 * `ws_statuses`; the prototype is the source of truth, so `ค้างชำระ` is used.)
 */
export async function markOrderBadDebt(orderId: string) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.badDebt')) throw new Error('ไม่มีสิทธิ์แจ้งตัดหนี้สูญ');
  await setOrderStatusInternal(orderId, 'ค้างชำระ');
}

/**
 * Inline status change from the list. Not capability-gated in the prototype (any
 * user may move a PO through the pipeline), but still re-checks the session per
 * C2 so an unauthenticated POST is rejected.
 */
export async function updateOrderStatus(orderId: string, status: string) {
  await getSessionContext();
  await setOrderStatusInternal(orderId, status);
}

/**
 * Create or update a wholesale customer, returning the persisted id. Re-checks
 * the session per C2; not tied to a specific wholesale capability (the prototype
 * lets anyone editing a PO add/edit a customer inline).
 */
export async function saveCustomer(input: {
  id?: number;
  name: string;
  phone: string;
  address: string;
}): Promise<number> {
  await getSessionContext();
  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from('wholesale_customers')
      .update({ name: input.name, phone: input.phone, address: input.address })
      .eq('id', input.id);
    if (error) throw new Error(error.message);
    revalidatePath('/wholesale');
    return input.id;
  }

  const { data, error } = await supabase
    .from('wholesale_customers')
    .insert({ name: input.name, phone: input.phone, address: input.address })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/wholesale');
  return data.id;
}
