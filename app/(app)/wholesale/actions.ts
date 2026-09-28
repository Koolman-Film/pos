'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { cleanPhones } from '@/lib/domain/phone';
import { shopDayKey } from '@/lib/domain/format';
import { poOpenedAt } from '@/lib/domain/orders';
import { applyStockMovements, diffQtyMaps, sumQtyMaps, type QtyMap } from '@/lib/stock/movements';

import type { Json } from '@/lib/types/database';
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
  // วันที่เปิด PO: only written when the day actually moved (lib/domain/orders.ts).
  const today = shopDayKey(new Date());
  if (isNew) {
    const openedAt = poOpenedAt(input.openedOn, null, today);
    const { data, error } = await supabase
      .from('orders')
      .insert({
        id: input.id,
        shop_id: input.shop,
        customer_id: input.customerId,
        status: input.status,
        // null, not the empty string: the column is a date, and "no date
        // agreed" is exactly what null means. วันที่ส่งของ the same way — blank
        // means the goods have not gone out, which is not the same as a date.
        due_at: input.dueAt || null,
        delivered_at: input.deliveredAt || null,
        note: input.note ?? '',
        sales_by: input.salesBy ?? '',
        ...(openedAt ? { created_at: openedAt } : {}),
        pay_to_account_id: input.payToAccountId ?? null,
        customer_note: input.customerNote ?? '',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    orderId = data.id;
  } else {
    // Compared with what is STORED, not with what the browser loaded: the
    // form's copy can be stale, and re-writing the same day would still
    // replace the real time of day with noon.
    const { data: current } = await supabase
      .from('orders')
      .select('created_at')
      .eq('id', orderId)
      .maybeSingle();
    const storedDay = current?.created_at ? shopDayKey(new Date(current.created_at)) : '';
    const openedAt = poOpenedAt(input.openedOn, { day: storedDay }, today);
    const { error } = await supabase
      .from('orders')
      .update({
        shop_id: input.shop,
        customer_id: input.customerId,
        status: input.status,
        due_at: input.dueAt || null,
        delivered_at: input.deliveredAt || null,
        note: input.note ?? '',
        sales_by: input.salesBy ?? '',
        ...(openedAt ? { created_at: openedAt } : {}),
        pay_to_account_id: input.payToAccountId ?? null,
        customer_note: input.customerNote ?? '',
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
  /*
    ตารางงวดชำระ — เขียนของมันเอง (migration 0078).

    ไม่ได้ยัดเข้า `save_order_children` เพราะการเพิ่มพารามิเตอร์คือการสร้าง
    ฟังก์ชันใหม่อีกตัว แล้วต้องเลือกระหว่างทิ้งตัวเก่าทันที (แอปรุ่นที่ยังรันอยู่
    ระหว่างดีพลอยจะบันทึก PO ไม่ได้) กับเก็บไว้ทั้งคู่ (ตัวเก่าจะลบตารางงวดทิ้ง
    ทุกครั้งที่ถูกเรียก) — สองการเขียนในคำสั่งเดียวของผู้ใช้ ดีกว่าทั้งสองทาง
  */
  const { error: scheduleErr } = await supabase.rpc('save_order_installments', {
    p_order_id: orderId,
    p_installments: (input.installments ?? []) as unknown as Json,
  });
  if (scheduleErr) throw new Error(scheduleErr.message);

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

  /*
    บันทึก PO ไม่แตะสต๊อกอีกต่อไป (migration 0054).

    It used to: every save recomputed the net quantities and moved the shelf.
    But a PO is typed, priced, argued over and re-saved several times before
    anything leaves the building, and each of those saves took the goods off
    the rack — including for POs that were never delivered at all.

    The shelf moves on the two physical events instead: `recordOrderDelivery`
    takes the goods out, and confirming a return puts them back.
  */
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
    .select('shop_id, stock_deducted_at')
    .eq('id', orderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!order) return { ok: false, error: 'ไม่พบ PO นี้' };

  /*
    คืนของเข้าชั้นเฉพาะ PO ที่เคยตัดสต๊อกไปจริง (migration 0054).

    Stock now leaves on delivery, not on save, so a PO deleted before it
    shipped never took anything — and putting its quantities back would
    invent goods the branch does not have. `stock_deducted_at` is the record
    of whether the shelf ever moved for this PO.
  */
  const net = order.stock_deducted_at ? await storedOrderNetQty(supabase, orderId) : {};

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
    .select('shop_id, stock_deducted_at')
    .eq('id', orderId)
    .not('deleted_at', 'is', null)
    .maybeSingle();
  if (!order) return { ok: false, error: 'ไม่พบ PO นี้ในถังขยะ' };

  // Mirrors the delete: only a PO whose goods had actually left takes them
  // off the shelf again when it comes back out of the bin.
  const net = order.stock_deducted_at ? await storedOrderNetQty(supabase, orderId) : {};

  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', orderId)
    .not('deleted_at', 'is', null);
  if (error) return { ok: false, error: error.message };

  // Back on: the goods leave the shelf again, exactly as they did on delivery.
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
  } catch (e) {
    // Non-fatal on purpose — see the doc comment above — but logged, so a
    // failed return to stock can be found in the server log.
    console.error(
      `[stock] ${sign === -1 ? 'ลบ' : 'กู้คืน'} PO ${orderId} threw while moving stock:`,
      e,
    );
  }
}

/**
 * ตัดสต๊อกของรอบส่งของหนึ่งรอบ (migration 0077).
 *
 * The claim comes first: flipping `stock_deducted_at` from null is what makes
 * this idempotent, so a retried request or a double-clicked button cannot take
 * the same boxes off the shelf twice. Only the call that wins the claim moves
 * anything.
 *
 * Non-fatal on failure, as everywhere else stock is touched — losing the
 * delivery record over a stock lookup is the worse outcome — but the shop is
 * TOLD which products did not move, because silently skipping is how a renamed
 * product stops being deducted with nobody the wiser until a stocktake.
 */
async function deductDeliveryStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deliveryId: number,
  shopId: string,
  orderId: string,
): Promise<string[]> {
  const { data: claimed } = await supabase
    .from('order_deliveries')
    .update({ stock_deducted_at: new Date().toISOString() })
    .eq('id', deliveryId)
    .is('stock_deducted_at', null)
    .select('id');
  if ((claimed ?? []).length === 0) return [];

  const { data: lines } = await supabase
    .from('order_delivery_items')
    .select('item_name, qty')
    .eq('delivery_id', deliveryId);
  const delta = toQtyMap(
    (lines ?? []).map((l) => ({ name: l.item_name ?? '', qty: Number(l.qty) || 0 })),
  );
  if (Object.keys(delta).length === 0) return [];

  try {
    const result = await applyStockMovements(supabase, delta, {
      kind: 'ขายส่ง',
      documentId: orderId,
      by: 'ระบบ (ส่งของ)',
      shopId,
    });
    return result.unmatched;
  } catch (e) {
    console.error(`[stock] delivery ${deliveryId} of ${orderId} threw while deducting stock:`, e);
    return Object.keys(delta);
  }
}

/** ข้อความเตือนตอนตัดสต๊อกไม่สำเร็จ — เก็บถ้อยคำเดิมไว้ที่เดียว. */
const stockWarning = (unmatched: string[], what: string) =>
  unmatched.length > 0
    ? `${what} แต่ตัดสต็อกไม่สำเร็จ: ${unmatched.join(', ')} — ตรวจว่าสินค้ายังอยู่ในทะเบียนของสาขานี้ แล้วปรับสต็อกเอง`
    : undefined;

/** รายการที่รอบส่งของหนึ่งรอบหอบไป. */
export type DeliveryLineInput = { uid: string; name: string; qty: number };

/**
 * บันทึกรอบส่งของหนึ่งรอบ (migration 0077).
 *
 * PO ใบเดียวส่งหลายรอบได้ — ลูกค้าสั่ง 200 ม้วน รับไปก่อน 80 (ร้านแจ้ง 28 ก.ย.
 * 2569). Each round carries its own date, its own evidence and its own
 * quantities: the sale is earned on the day the goods go out, so a PO that
 * straddles two months must not book all of it in the first.
 *
 * ด่านจริงอยู่ที่ `save_order_delivery` — ส่งเกินจำนวนที่สั่ง และหลักฐานที่
 * หายไป ถูกปฏิเสธในฐานข้อมูล เพราะ action นี้เป็น POST ธรรมดาที่ใครก็ยิงได้ (C2).
 * What is checked here as well is only so the person gets a sentence they can
 * act on instead of a database error.
 */
export async function saveOrderDelivery(input: {
  orderId: string;
  /** Client-generated key — a double-clicked button must not send twice. */
  uid: string;
  date: string;
  note: string;
  attachments: string[];
  items: DeliveryLineInput[];
}): Promise<{ ok: boolean; deliveryId?: number; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.hasNav('wholesale')) return { ok: false, error: 'ไม่มีสิทธิ์ในโมดูลขายส่ง' };
  if (!input.date) return { ok: false, error: 'ต้องระบุวันที่ส่งของ' };
  if (!input.note.trim()) {
    return { ok: false, error: 'ต้องกรอกข้อมูลการจัดส่ง (ขนส่ง/เลขพัสดุ/ผู้รับ)' };
  }
  if (input.attachments.length === 0) {
    return { ok: false, error: 'ต้องแนบหลักฐานการจัดส่งอย่างน้อยหนึ่งไฟล์' };
  }
  const lines = input.items.filter((l) => Number(l.qty) > 0);
  if (lines.length === 0) return { ok: false, error: 'ต้องระบุจำนวนที่ส่งอย่างน้อยหนึ่งรายการ' };

  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('shop_id')
    .eq('id', input.orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: 'ไม่พบ PO นี้' };

  const { data: deliveryId, error } = await supabase.rpc('save_order_delivery', {
    p_order_id: input.orderId,
    p_delivery: {
      uid: input.uid,
      date: input.date,
      note: input.note.trim(),
      attachments: input.attachments,
      items: lines.map((l) => ({ uid: l.uid, name: l.name, qty: Number(l.qty) })),
    } as unknown as Json,
  });
  if (error) return { ok: false, error: error.message };

  const unmatched = await deductDeliveryStock(
    supabase,
    Number(deliveryId),
    order.shop_id,
    input.orderId,
  );

  revalidatePath('/wholesale');
  revalidatePath(`/wholesale/${input.orderId}`);
  revalidatePath('/dashboard');
  revalidatePath('/stock');
  revalidatePath('/revenue');
  return {
    ok: true,
    deliveryId: Number(deliveryId),
    error: stockWarning(unmatched, 'บันทึกรอบส่งของแล้ว'),
  };
}

/**
 * ลบรอบส่งของที่บันทึกผิด (migration 0077).
 *
 * ต้องมีสิทธิ์ `wholesale.updateStatus` ทั้งที่นี่และในฐานข้อมูล: การบันทึกส่ง
 * ของใครก็ทำได้ แต่การลบทิ้งคือการเอาของกลับขึ้นชั้นและเปิด PO ที่ปิดไปแล้วกลับมา
 *
 * Stock goes back only when that round had actually taken it out — the function
 * says which, because only the database knows whether the claim had been made.
 */
export async function deleteOrderDelivery(
  deliveryId: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext(); // C2: authenticate before mutating
  if (!session.canDo('wholesale.updateStatus')) {
    return { ok: false, error: 'ไม่มีสิทธิ์ลบรอบส่งของ' };
  }
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('order_deliveries')
    .select('orders(shop_id)')
    .eq('id', deliveryId)
    .maybeSingle();
  const shopId = (order?.orders as { shop_id: string } | null)?.shop_id ?? '';

  const { data: removed, error } = await supabase.rpc('delete_order_delivery', {
    p_delivery_id: deliveryId,
  });
  if (error) return { ok: false, error: error.message };

  const result = (removed ?? {}) as {
    orderId?: string;
    stockDeducted?: boolean;
    items?: { name: string; qty: number }[];
  };
  let unmatched: string[] = [];
  if (result.stockDeducted && shopId) {
    // ติดลบ = ของกลับขึ้นชั้น (`applyStockMovements` ใช้ `-d`)
    const delta = toQtyMap(
      (result.items ?? []).map((l) => ({ name: l.name, qty: -(Number(l.qty) || 0) })),
    );
    try {
      const moved = await applyStockMovements(supabase, delta, {
        kind: 'ขายส่ง',
        documentId: result.orderId ?? '',
        by: 'ระบบ (ลบรอบส่งของ)',
        shopId,
      });
      unmatched = moved.unmatched;
    } catch (e) {
      console.error(`[stock] deleting delivery ${deliveryId} threw while restoring stock:`, e);
      unmatched = Object.keys(delta);
    }
  }

  revalidatePath('/wholesale');
  if (result.orderId) revalidatePath(`/wholesale/${result.orderId}`);
  revalidatePath('/dashboard');
  revalidatePath('/stock');
  revalidatePath('/revenue');
  return { ok: true, error: stockWarning(unmatched, 'ลบรอบส่งของแล้ว') };
}

/**
 * บันทึกวันส่งของ — called when ใบส่งของ is issued (migration 0045).
 *
 * Wholesale sells on credit: the goods go out and the money follows weeks
 * later, so DELIVERY is when the sale is earned. This is the date every
 * wholesale figure will be attributed to, which is why issuing the document
 * writes it rather than leaving it to somebody to remember.
 *
 * ตั้งแต่ 0077 นี่คือ "ส่งของที่ยังค้างอยู่ทั้งหมดในรอบเดียว" — เส้นทางเดิมของ
 * ปุ่มออกใบส่งของ ที่ยังเป็นกรณีที่พบบ่อยที่สุด ส่วนการแบ่งส่งใช้
 * `saveOrderDelivery` ซึ่งเป็นโค้ดชุดเดียวกัน
 *
 * THE DATE is written once, by the first round. A second ใบส่งของ is a reprint
 * — the customer lost theirs — and silently re-dating the sale because a page
 * was printed again would move revenue between months with nobody deciding to.
 */
export async function recordOrderDelivery(
  orderId: string,
  deliveredAt: string,
  deliveryNote: string,
  attachments: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.hasNav('wholesale')) return { ok: false, error: 'ไม่มีสิทธิ์ในโมดูลขายส่ง' };

  const supabase = await createClient();
  const [{ data: items }, { data: rounds }] = await Promise.all([
    supabase.from('order_items').select('uid, name, qty').eq('order_id', orderId),
    supabase
      .from('order_deliveries')
      .select('order_delivery_items(item_uid, qty)')
      .eq('order_id', orderId),
  ]);

  const sent = new Map<string, number>();
  for (const r of rounds ?? []) {
    for (const li of r.order_delivery_items ?? []) {
      const uid = li.item_uid ?? '';
      sent.set(uid, (sent.get(uid) ?? 0) + (Number(li.qty) || 0));
    }
  }
  const remaining = (items ?? [])
    .map((it) => ({
      uid: it.uid ?? '',
      name: it.name,
      qty: (Number(it.qty) || 0) - (sent.get(it.uid ?? '') ?? 0),
    }))
    .filter((l) => l.qty > 0);

  if (remaining.length === 0) {
    return { ok: false, error: 'ส่งครบทุกรายการแล้ว — ไม่มีของที่ยังค้างส่ง' };
  }

  const result = await saveOrderDelivery({
    orderId,
    // เกิดจากเอกสาร ไม่ใช่จากปุ่มในฟอร์ม จึงผูก uid กับวันที่: กดออกใบส่งของ
    // ซ้ำในวันเดียวกันคือการพิมพ์ซ้ำ ไม่ใช่การส่งรอบใหม่
    uid: `doc-${deliveredAt}`,
    date: deliveredAt,
    note: deliveryNote,
    attachments,
    items: remaining,
  });
  return { ok: result.ok, error: result.error };
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

/**
 * อนุมัติการปรับราคา — the same decision, about the same money, as approving a
 * below-standard price, so it is the same capability.
 *
 * Checked here and again inside `approve_order_adjustment`, which is the check
 * that actually holds: this action is a plain POST anyone can send.
 */
export async function approveOrderAdjustment(
  orderId: string,
  uid: string,
  approvedOn: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) {
    return { ok: false, error: 'ไม่มีสิทธิ์อนุมัติการปรับราคา' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_order_adjustment', {
    p_order_id: orderId,
    p_uid: uid,
    p_on: approvedOn,
  });
  if (error) return { ok: false, error: error.message };
  revalidateOrder(orderId);
  return { ok: true };
}

/** ปฏิเสธการปรับราคา. The row stays: somebody asked, somebody said no. */
export async function rejectOrderAdjustment(
  orderId: string,
  uid: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) {
    return { ok: false, error: 'ไม่มีสิทธิ์อนุมัติการปรับราคา' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('reject_order_adjustment', {
    p_order_id: orderId,
    p_uid: uid,
    p_note: note,
  });
  if (error) return { ok: false, error: error.message };
  revalidateOrder(orderId);
  return { ok: true };
}

/**
 * เพิ่ม/แก้ไขพนักงานขาย (migration 0053).
 *
 * 0047 seeded โหน่ง and เคน with empty phones and gave the shop no screen to
 * fill them in — so the one field the wholesale documents are built around
 * could only be set by editing the database by hand.
 *
 * Gated by `options.manage`, the key that already covers editing the shop’s
 * own reference lists: picking your name off a list is not the same act as
 * editing the list. Checked here and again by the RLS policy, which is where
 * it holds.
 */
export async function saveSalesPerson(input: {
  id?: number;
  shop: string;
  name: string;
  phone: string;
  /**
   * บัญชีเข้าระบบของเซลล์ (0058). `undefined` leaves the link as it is; `null`
   * or an empty string removes it.
   */
  userId?: string | null;
}): Promise<{ ok: boolean; error?: string; name?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('options.manage')) {
    return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขรายชื่อพนักงานขาย' };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'ต้องใส่ชื่อพนักงานขาย' };

  // Only touch the login link when the form actually said something about it.
  const link = input.userId === undefined ? {} : { user_id: input.userId || null };
  // One login is one rep (unique index, 0058) — say it in words, not as a
  // constraint name.
  const friendly = (message: string) =>
    message.includes('sales_people_user_uidx') ? 'บัญชีนี้ผูกกับพนักงานขายคนอื่นอยู่แล้ว' : message;

  const supabase = await createClient();
  if (input.id) {
    /*
      A rename carries the POs with it. `orders.sales_by` stores the NAME
      (0047), so renaming the row alone would orphan every PO that person
      sold — they would read as ไม่ระบุ and drop out of their own totals.
    */
    const { data: before } = await supabase
      .from('sales_people')
      .select('name')
      .eq('id', input.id)
      .maybeSingle();
    const { error } = await supabase
      .from('sales_people')
      .update({ name, phone: cleanPhones(input.phone), ...link })
      .eq('id', input.id);
    if (error) return { ok: false, error: friendly(error.message) };
    if (before?.name && before.name !== name) {
      await supabase
        .from('orders')
        .update({ sales_by: name })
        .eq('shop_id', input.shop)
        .eq('sales_by', before.name);
    }
  } else {
    const { error } = await supabase
      .from('sales_people')
      .insert({ shop_id: input.shop, name, phone: cleanPhones(input.phone), ...link });
    if (error) return { ok: false, error: friendly(error.message) };
  }

  revalidatePath('/wholesale');
  return { ok: true, name };
}

/**
 * อนุมัติ/ปฏิเสธราคา — ทิ้งร่องรอยว่าใครตัดสินใจและเมื่อไหร่ (migration 0051).
 *
 * Used to be a bare status change, which meant a discount could go through
 * and nobody could say afterwards who had agreed to it: the only evidence was
 * a status anyone could have set. The decision now goes through
 * `decide_order_price`, which records the person and the day — and checks the
 * capability in the database, where the check actually holds.
 */
async function decidePrice(orderId: string, approve: boolean) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) throw new Error('ไม่มีสิทธิ์อนุมัติราคา');
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_order_price', {
    p_order_id: orderId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  revalidateOrder(orderId);
}

/**
 * ยืนยันว่าได้รับสินค้าคืนแล้ว — และคืนของเข้าชั้นตรงนี้ (migration 0054).
 *
 * Recording that a customer WILL return something and having it back on the
 * rack are two different facts, days apart. Only the second one may move the
 * shelf, or the count says the goods are here while they are still on a lorry.
 *
 * The stock movement is dated now — the day somebody confirmed it — not
 * `returned_at`, which is the business date the sale is reduced on and is
 * routinely backdated by agreement with the customer.
 */
export async function confirmOrderReturn(
  orderId: string,
  uid: string,
  receivedOn: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.updateStatus')) {
    return { ok: false, error: 'ไม่มีสิทธิ์ยืนยันการรับคืนสินค้า' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('confirm_order_return', {
    p_order_id: orderId,
    p_uid: uid,
    p_on: receivedOn,
  });
  if (error) return { ok: false, error: error.message };

  /*
    Claimed the same way the delivery is: the row that flips
    `stock_returned_at` from null is the one that moves stock, so a second
    confirmation — or a re-save in between — cannot put the goods back twice.
  */
  const { data: claimed } = await supabase
    .from('order_returns')
    .update({ stock_returned_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('uid', uid)
    .is('stock_returned_at', null)
    .select('item_name, qty');

  let unmatched: string[] = [];
  const rows = claimed ?? [];
  if (rows.length > 0) {
    const { data: order } = await supabase
      .from('orders')
      .select('shop_id')
      .eq('id', orderId)
      .maybeSingle();
    if (order) {
      // Negative: the goods come BACK, so the shelf goes up.
      const delta = toQtyMap(rows.map((r) => ({ name: r.item_name, qty: -(Number(r.qty) || 0) })));
      if (Object.keys(delta).length > 0) {
        try {
          const result = await applyStockMovements(supabase, delta, {
            kind: 'รับคืนขายส่ง',
            documentId: orderId,
            by: 'ระบบ (รับคืน)',
            shopId: order.shop_id,
          });
          unmatched = result.unmatched;
        } catch (e) {
          console.error(`[stock] return on ${orderId} threw while restocking:`, e);
          unmatched = Object.keys(delta);
        }
      }
    }
  }

  revalidateOrder(orderId);
  revalidatePath('/stock');
  return {
    ok: true,
    error:
      unmatched.length > 0
        ? `ยืนยันรับคืนแล้ว แต่คืนสต็อกไม่สำเร็จ: ${unmatched.join(', ')} — ปรับสต็อกเอง`
        : undefined,
  };
}

/** Approve the discounted price → `รอจัดส่ง`. Gated by `wholesale.priceApproval`. */
export async function approveOrderPrice(orderId: string) {
  await decidePrice(orderId, true);
}

/** Reject the discount → back to `รออนุมัติราคา`. Gated by `wholesale.priceApproval`. */
export async function rejectOrderPrice(orderId: string) {
  await decidePrice(orderId, false);
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
      .update({ name: input.name, phone: cleanPhones(input.phone), address: input.address })
      .eq('id', input.id);
    if (error) throw new Error(error.message);
    revalidatePath('/wholesale');
    return input.id;
  }

  const { data, error } = await supabase
    .from('wholesale_customers')
    .insert({ name: input.name, phone: cleanPhones(input.phone), address: input.address })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/wholesale');
  return data.id;
}
