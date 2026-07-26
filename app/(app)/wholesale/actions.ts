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
  const before = await storedOrderNetQty(supabase, input.id);

  const { error: headerErr } = await supabase.from('orders').upsert({
    id: input.id,
    shop_id: input.shop,
    customer_id: input.customerId,
    status: input.status,
  });
  if (headerErr) throw new Error(headerErr.message);

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
    p_order_id: input.id,
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
  if (Object.keys(delta).length > 0) {
    try {
      await applyStockMovements(supabase, delta, {
        kind: 'ขายส่ง',
        documentId: input.id,
        // The prototype always credited the system here, never the user (:2709).
        by: 'ระบบ (ขายส่ง)',
        shopId: input.shop,
      });
    } catch {
      // Deliberately swallowed; see above.
    }
  }

  revalidatePath('/wholesale');
  revalidatePath('/stock');
  redirect('/wholesale');
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
