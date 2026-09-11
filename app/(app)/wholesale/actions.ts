'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { applyStockMovements, diffQtyMaps, sumQtyMaps, type QtyMap } from '@/lib/stock/movements';

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

  // Net quantity per product currently STORED for this PO — sold minus returned,
  // exactly the prototype's origSold/origReturned pair (:2694-2701). Must be read
  // before the delete-then-insert below wipes the rows, because it is the "before"
  // side of the stock delta.
  // Nothing is stored yet for a new PO, and its id is about to change.
  const before = isNew ? {} : await storedOrderNetQty(supabase, input.id);

  /*
    The PO number comes from the database (migration 0036), not the browser.

    It used to be `'WS-NEW-' + random(1000..9999)`, chosen client-side and kept
    as the primary key — which collides at about 112 POs, and the upsert below
    then overwrote the earlier PO's header and replaced all of its children.
    The trigger swaps a `WS-NEW-%` placeholder for the next number in that
    branch's series, under a lock, so two people raising a PO at the same
    moment cannot be handed the same one.
  */
  let orderId = input.id;
  if (isNew) {
    const { data, error } = await supabase
      .from('orders')
      .insert({
        id: input.id,
        shop_id: input.shop,
        customer_id: input.customerId,
        status: input.status,
        // null, not the empty string: the column is a date, and "no date
        // agreed" is exactly what null means.
        due_at: input.dueAt || null,
        sales_by: input.salesBy ?? '',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    orderId = data.id;
  } else {
    const { error } = await supabase
      .from('orders')
      .update({
        shop_id: input.shop,
        customer_id: input.customerId,
        status: input.status,
        due_at: input.dueAt || null,
        sales_by: input.salesBy ?? '',
      })
      .eq('id', orderId);
    if (error) throw new Error(error.message);
  }

  // Replace all four child tables in ONE atomic call (`save_order_children`,
  // migration 0011). Previously each delete and each insert was its own
  // transaction, so a failure part-way through left the PO holding a partial set
  // of items/returns/adjustments/payments with the originals already deleted.
  // RLS still applies — the function is `security invoker`.
  //
  // `adjusted_at` / `paid_at` are NOT NULL dates and the prototype only kept a
  // free-text Thai display string ("วันนี้"), so the save date is persisted.
  const savedOn = new Date().toISOString().slice(0, 10);
  const { error: childErr } = await supabase.rpc('save_order_children', {
    p_order_id: orderId,
    p_items: input.items,
    p_returns: input.returns,
    p_adjustments: input.adjustments,
    p_payments: input.payments,
    p_saved_on: savedOn,
  });
  if (childErr) throw new Error(childErr.message);

  // Move stock to match the new net quantities and log it (prototype :2702-2712).
  // Sold goes out of stock, returned comes back, so the net is what matters.
  // Non-fatal: the PO is already saved, and losing the sale over a stock lookup
  // would be the worse failure.
  const after = orderNetQty(
    input.items.map((it) => ({ name: it.name, qty: Number(it.qty) || 0 })),
    input.returns.map((r) => ({ name: r.item, qty: Number(r.qty) || 0 })),
  );
  const delta = diffQtyMaps(before, after);
  let unmatched: string[] = [];
  if (Object.keys(delta).length > 0) {
    try {
      const result = await applyStockMovements(supabase, delta, {
        kind: 'ขายส่ง',
        documentId: orderId,
        // The prototype always credited the system here, never the user (:2709).
        by: 'ระบบ (ขายส่ง)',
        shopId: input.shop,
      });
      unmatched = result.unmatched;
    } catch {
      // Saving the PO must not fail over a stock lookup — but the shop has to
      // be TOLD, which is what the message below is for. Silently swallowing
      // it left goods leaving the shelf with the count unchanged and nobody
      // any the wiser until a stocktake months later.
      unmatched = Object.keys(delta);
    }
  }

  revalidatePath('/wholesale');
  revalidatePath('/stock');
  redirect(
    unmatched.length > 0
      ? `/wholesale?stock=${encodeURIComponent(unmatched.join(', '))}`
      : '/wholesale',
  );
}

/** Net = sold - returned, per product. */
function orderNetQty(
  sold: { name: string; qty: number }[],
  returned: { name: string; qty: number }[],
): QtyMap {
  return diffQtyMaps(sumQtyMaps([toQtyMap(returned)]), sumQtyMaps([toQtyMap(sold)]));
}

function toQtyMap(rows: { name: string; qty: number }[]): QtyMap {
  const map: QtyMap = {};
  for (const r of rows) {
    if (!r.name) continue;
    map[r.name] = (map[r.name] ?? 0) + r.qty;
  }
  return map;
}

/** The stored net-per-product for a PO, read straight from its child tables. */
async function storedOrderNetQty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<QtyMap> {
  const [{ data: items }, { data: returns }] = await Promise.all([
    supabase.from('order_items').select('name, qty').eq('order_id', orderId),
    supabase.from('order_returns').select('item_name, qty').eq('order_id', orderId),
  ]);
  return orderNetQty(
    (items ?? []).map((i) => ({ name: i.name, qty: Number(i.qty) || 0 })),
    (returns ?? []).map((r) => ({ name: r.item_name, qty: Number(r.qty) || 0 })),
  );
}

/**
 * ลบ PO — a soft delete (migration 0040), the wholesale twin of `deleteTicket`.
 *
 * The row keeps its PO number and all four child tables; it simply stops
 * appearing in the list and in every figure derived from it. A holder of
 * `wholesale.restore` sees it in ถังขยะ and can put it back.
 *
 * Unlike a ticket, the goods go back on the shelf. A PO deducts stock the
 * moment it is saved, so a PO that should never have existed did not take
 * anything off the shelf, and leaving the deduction behind would make the count
 * wrong in the one module whose whole job is moving goods.
 *
 * The capability is re-checked here per C2 AND enforced by a trigger in the
 * database, because `orders_rw` lets any member of the branch update the row.
 */
export async function deleteOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.delete')) return { ok: false, error: 'ไม่มีสิทธิ์ลบ PO' };
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('shop_id')
    .eq('id', orderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!order) return { ok: false, error: 'ไม่พบ PO นี้' };

  // Read the net BEFORE flagging the row: the reversal is its exact negation.
  const net = await storedOrderNetQty(supabase, orderId);

  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString(), deleted_by: session.userId })
    .eq('id', orderId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: error.message };

  await moveOrderStock(supabase, orderId, order.shop_id, net, -1);

  revalidatePath('/wholesale');
  revalidatePath('/stock');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** กู้คืน PO — the other half of `deleteOrder`, gated by `wholesale.restore`. */
export async function restoreOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.restore')) return { ok: false, error: 'ไม่มีสิทธิ์กู้คืน PO' };
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('shop_id')
    .eq('id', orderId)
    .not('deleted_at', 'is', null)
    .maybeSingle();
  if (!order) return { ok: false, error: 'ไม่พบ PO นี้ในถังขยะ' };

  const net = await storedOrderNetQty(supabase, orderId);

  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', orderId)
    .not('deleted_at', 'is', null);
  if (error) return { ok: false, error: error.message };

  // Back on: the goods leave the shelf again, exactly as they did on save.
  await moveOrderStock(supabase, orderId, order.shop_id, net, 1);

  revalidatePath('/wholesale');
  revalidatePath('/stock');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Put a PO's whole net quantity through stock in one direction.
 *
 * `sign` is 1 to consume (the PO is on) and -1 to give back (it is off). Non-
 * fatal for the same reason the save path is: the delete is already recorded,
 * and refusing to delete over a stock lookup would leave the shop with a PO it
 * cannot get rid of.
 */
async function moveOrderStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  shopId: string,
  net: QtyMap,
  sign: 1 | -1,
) {
  const delta: QtyMap = {};
  for (const [name, qty] of Object.entries(net)) {
    if (qty !== 0) delta[name] = qty * sign;
  }
  if (Object.keys(delta).length === 0) return;
  try {
    await applyStockMovements(supabase, delta, {
      kind: sign === -1 ? 'ลบ PO ขายส่ง' : 'กู้คืน PO ขายส่ง',
      documentId: orderId,
      by: 'ระบบ (ขายส่ง)',
      shopId,
    });
  } catch {
    // Swallowed on purpose — see the doc comment above.
  }
}

/**
 * บันทึกวันส่งของ — called when ใบส่งของ is issued (migration 0045).
 *
 * Wholesale sells on credit: the goods go out and the money follows weeks
 * later, so DELIVERY is when the sale is earned. This is the date every
 * wholesale figure will be attributed to, which is why issuing the document
 * writes it rather than leaving it to somebody to remember.
 *
 * Written ONCE. A second ใบส่งของ is a reprint — the customer lost theirs —
 * and silently re-dating the sale because a page was printed again would move
 * revenue between months with nobody deciding to. Changing a delivery date that
 * is wrong is a deliberate edit, not a side effect of pressing print.
 *
 * Moves the PO to จัดส่งแล้ว at the same time, since that is what has happened.
 */
export async function recordOrderDelivery(
  orderId: string,
  deliveredAt: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.hasNav('wholesale')) return { ok: false, error: 'ไม่มีสิทธิ์ในโมดูลขายส่ง' };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .update({ delivered_at: deliveredAt, status: 'จัดส่งแล้ว' })
    .eq('id', orderId)
    .is('delivered_at', null)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // No row updated means it already had a delivery date. Not an error: the
  // document prints either way, and the first date stands.
  if ((data ?? []).length > 0) {
    revalidatePath('/wholesale');
    revalidatePath(`/wholesale/${orderId}`);
    revalidatePath('/dashboard');
  }
  return { ok: true };
}

/**
 * ยืนยันว่าเงินเข้าจริง — the step that turns a reported payment into money.
 *
 * Gated by `wholesale.confirmPayment` HERE and again inside
 * `confirm_order_payment`, which is the check that actually holds: this action
 * is a plain POST anyone can send (CORRECTION C2). `clearedOn` is the date the
 * money landed, not today — a cheque banked on Friday and credited on Monday
 * belongs to Monday, and only the person holding the statement knows which.
 */
export async function confirmOrderPayment(
  orderId: string,
  uid: string,
  clearedOn: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.confirmPayment')) {
    return { ok: false, error: 'ไม่มีสิทธิ์ยืนยันการรับเงิน' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('confirm_order_payment', {
    p_order_id: orderId,
    p_uid: uid,
    p_on: clearedOn,
  });
  if (error) return { ok: false, error: error.message };
  revalidateOrder(orderId);
  return { ok: true };
}

/**
 * เช็คเด้ง. The debt returns on its own — `orderPaid` counts only รับเงินแล้ว —
 * and the receipt already in the customer’s hands is left on the record.
 */
export async function bounceOrderPayment(
  orderId: string,
  uid: string,
  bouncedOn: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.confirmPayment')) {
    return { ok: false, error: 'ไม่มีสิทธิ์บันทึกเช็คเด้ง' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('bounce_order_payment', {
    p_order_id: orderId,
    p_uid: uid,
    p_on: bouncedOn,
    p_note: note,
  });
  if (error) return { ok: false, error: error.message };
  revalidateOrder(orderId);
  return { ok: true };
}

/** Money moved: the PO, the list, the dashboard and the money register all shift. */
function revalidateOrder(orderId: string) {
  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${orderId}`);
  revalidatePath('/dashboard');
  revalidatePath('/money');
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
 * Inline status change from the list.
 *
 * Gated, unlike in the prototype. Moving a PO to ปิดงานแล้ว closes it, and
 * moving it back reopens one that was closed — decisions of the same weight as
 * approving a price or writing off a debt, both of which have always been
 * gated. Leaving this one open meant the other two could be walked around.
 */
export async function updateOrderStatus(orderId: string, status: string) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.updateStatus')) throw new Error('ไม่มีสิทธิ์เปลี่ยนสถานะ PO');
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
