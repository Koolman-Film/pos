'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext, type SessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/types/database';

/**
 * Server actions for the Stock module.
 *
 * BINDING CORRECTION C2 (see docs/superpowers/plans/...-EXECUTION.md):
 * `proxy.ts` refreshes the session but is NOT an authorization boundary — a
 * client can POST any of these actions without ever rendering the gated UI.
 * So every action below independently calls `getSessionContext()` (which itself
 * verifies the caller against Supabase auth) and re-checks the matching
 * `stock.*` capability before mutating. UI gating and RLS (Task 7) are backstops,
 * never the only check.
 *
 * Additionally, the `seeStockPrices` data-visibility gate is enforced here, not
 * only in the UI: a caller without that dashboard widget can neither read nor
 * write `cost` / `sell_price` — those columns are never returned to such a client
 * (page.tsx strips them) and are ignored on write here.
 */

async function requireCapability(cap: string): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session.canDo(cap)) {
    throw new Error(`forbidden: missing capability ${cap}`);
  }
  return session;
}

function assertShopAccess(session: SessionContext, shopId: string): void {
  if (!session.accessibleShopIds.includes(shopId)) {
    throw new Error('forbidden: shop outside caller access');
  }
}

export type AddProductInput =
  | { mode: 'existing'; existingId: number; qty: number; cost: number; reason?: string }
  | {
      mode: 'new';
      newName: string;
      shortName?: string;
      sku?: string;
      category: string;
      shop: string;
      qty: number;
      cost: number;
      sellPrice: number;
    };

export async function addProductAction(input: AddProductInput): Promise<void> {
  const session = await requireCapability('stock.addProduct');
  const canSeePrices = session.hasDashboardWidget('seeStockPrices');
  const supabase = await createClient();

  if (input.mode === 'existing') {
    const { data: row, error } = await supabase
      .from('stock')
      .select('id, qty, cost, shop_id')
      .eq('id', input.existingId)
      .single();
    if (error || !row) throw new Error('stock item not found');
    assertShopAccess(session, row.shop_id);

    // Relative, applied and LOGGED by the database in one statement
    // (migration 0026). Receiving used to change the quantity and write
    // nothing, so a delivery left no trace at all.
    const { error: qtyErr } = await supabase.rpc('move_stock', {
      p_changes: [{ id: row.id, change: Number(input.qty) }] as unknown as Json,
      p_kind: 'รับเข้า',
      p_document_id: '',
      p_by_name: session.name,
      p_note: input.reason ?? '',
    });
    if (qtyErr) throw qtyErr;

    // Cost is a replacement, not a delta, so a plain update is right for it.
    // Only a price-visible caller may move it; otherwise keep it as-is.
    if (canSeePrices && Number(input.cost)) {
      const { error: upErr } = await supabase
        .from('stock')
        .update({ cost: Number(input.cost) })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }
  } else {
    assertShopAccess(session, input.shop);
    const { error } = await supabase.from('stock').insert({
      sku: input.sku?.trim() || `SKU-NEW-${Date.now()}`,
      name: input.newName,
      short_name: input.shortName ?? '',
      category: input.category,
      shop_id: input.shop,
      qty: Number(input.qty),
      min_qty: 5,
      cost: canSeePrices ? Number(input.cost) || 0 : 0,
      sell_price: canSeePrices ? Number(input.sellPrice) || 0 : 0,
    });
    if (error) throw error;
  }
  revalidatePath('/stock');
}

export type BulkImportRow = {
  sku: string;
  name: string;
  shortName: string;
  category: string;
  shop: string;
  qty: number;
  cost: number;
  sellPrice: number;
};

export async function bulkImportAction(rows: BulkImportRow[]): Promise<void> {
  const session = await requireCapability('stock.addProduct');
  const canSeePrices = session.hasDashboardWidget('seeStockPrices');
  const supabase = await createClient();
  const clean = rows.filter(
    (r) => r.name && r.category && session.accessibleShopIds.includes(r.shop),
  );
  if (clean.length === 0) return;
  const base = Date.now();
  const { error } = await supabase.from('stock').insert(
    clean.map((r, i) => ({
      sku: r.sku?.trim() || `SKU-NEW-${base + i}`,
      name: r.name,
      short_name: r.shortName ?? '',
      category: r.category,
      shop_id: r.shop,
      qty: Number(r.qty) || 0,
      min_qty: 5,
      cost: canSeePrices ? Number(r.cost) || 0 : 0,
      sell_price: canSeePrices ? Number(r.sellPrice) || 0 : 0,
    })),
  );
  if (error) throw error;
  revalidatePath('/stock');
}

export async function adjustStockAction(input: {
  id: number;
  counted: number;
  note?: string;
}): Promise<void> {
  const session = await requireCapability('stock.adjustStock');
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('stock')
    .select('id, shop_id')
    .eq('id', input.id)
    .single();
  if (error || !row) throw new Error('stock item not found');
  assertShopAccess(session, row.shop_id);

  // A count is absolute, and the difference against what the system held is
  // the movement. `count_stock` reads that difference inside the statement
  // (migration 0026) — a stock count used to overwrite the number and leave
  // no record of what it corrected.
  const { error: upErr } = await supabase.rpc('count_stock', {
    p_id: row.id,
    p_counted: Number(input.counted),
    p_by_name: session.name,
    p_note: input.note ?? '',
  });
  if (upErr) throw upErr;
  revalidatePath('/stock');
}

export async function withdrawAction(input: {
  id: number;
  qty: number;
  type: string;
}): Promise<void> {
  const session = await requireCapability('stock.withdraw');
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('stock')
    .select('id, name, qty, shop_id')
    .eq('id', input.id)
    .single();
  if (error || !row) throw new Error('stock item not found');
  assertShopAccess(session, row.shop_id);

  const qty = Number(input.qty);
  /*
    The item physically leaves the shelf now, so the stock moves now. The
    approval that follows is a MANAGER REVIEWING it, not a gate the goods wait
    behind — and rejecting it returns the stock (see decideWithdrawal).

    `stock_id` is stored so that return finds the right row even if the product
    is renamed in between; the old row recorded only the name.
  */
  const { error: insErr } = await supabase.from('withdrawals').insert({
    item: row.name,
    stock_id: row.id,
    shop_id: row.shop_id,
    qty,
    type: input.type,
    withdrawn_by: session.name,
    withdrawn_at: new Date().toISOString(),
    status: 'รออนุมัติ',
  });
  if (insErr) throw insErr;

  // NOT clamped at zero. Every other path already refused to clamp for the
  // same reason: a negative figure means the shop counted wrong or missed a
  // delivery, and a floor of zero makes that error permanent instead of
  // visible.
  const { error: upErr } = await supabase.rpc('move_stock', {
    p_changes: [{ id: row.id, change: -qty }] as unknown as Json,
    p_kind: 'เบิกใช้',
    p_document_id: input.type,
    p_by_name: session.name,
    p_note: '',
  });
  if (upErr) throw upErr;
  revalidatePath('/stock');
}

export async function saveProductAction(input: {
  id: number;
  name: string;
  shortName?: string;
  sku: string;
  category: string;
  qty: number;
  min: number;
  cost?: number;
  sellPrice?: number;
}): Promise<void> {
  const session = await requireCapability('stock.editDelete');
  const canSeePrices = session.hasDashboardWidget('seeStockPrices');
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('stock')
    .select('id, shop_id')
    .eq('id', input.id)
    .single();
  if (error || !row) throw new Error('stock item not found');
  assertShopAccess(session, row.shop_id);

  // Price columns are only writable by a price-visible caller; otherwise the
  // existing cost/sell_price are preserved untouched (C2). The conditional
  // spread keeps the object assignable to the generated `stock` Update type.
  const patch = {
    name: input.name,
    short_name: input.shortName ?? '',
    sku: input.sku,
    category: input.category,
    qty: Number(input.qty),
    min_qty: Number(input.min),
    ...(canSeePrices
      ? { cost: Number(input.cost) || 0, sell_price: Number(input.sellPrice) || 0 }
      : {}),
  };
  const { error: upErr } = await supabase.from('stock').update(patch).eq('id', row.id);
  if (upErr) throw upErr;
  revalidatePath('/stock');
}

export async function deleteProductAction(id: number): Promise<void> {
  const session = await requireCapability('stock.editDelete');
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('stock')
    .select('id, shop_id')
    .eq('id', id)
    .single();
  if (error || !row) throw new Error('stock item not found');
  assertShopAccess(session, row.shop_id);
  const { error: delErr } = await supabase.from('stock').delete().eq('id', row.id);
  if (delErr) throw delErr;
  revalidatePath('/stock');
}

export async function setFilmPriceAction(input: {
  category: string;
  product: string;
  position: string;
  carType: string;
  price: number;
}): Promise<void> {
  // The film-price matrix is admin-only in the prototype (reference :3134).
  const session = await getSessionContext();
  if (session.roleId !== 'admin') {
    throw new Error('forbidden: film pricing is admin-only');
  }
  const supabase = await createClient();
  const price = Number(input.price) || 0;
  const { data: existing } = await supabase
    .from('film_price_matrix')
    .select('id')
    .eq('category', input.category)
    .eq('product', input.product)
    .eq('position', input.position)
    .eq('car_type', input.carType)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('film_price_matrix')
      .update({ price })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('film_price_matrix').insert({
      category: input.category,
      product: input.product,
      position: input.position,
      car_type: input.carType,
      price,
    });
    if (error) throw error;
  }
  revalidatePath('/stock');
}

/**
 * แผนประกัน — the branch price list behind the ประกัน picker on a ticket.
 *
 * A plan is only ever a STARTING POINT: selling one copies its price and cover
 * onto the policy (migration 0023), so editing a plan here changes what the next
 * sale offers and nothing that has already been sold. That is why this can be a
 * plain edit with no versioning.
 *
 * Gated on `stock.editDelete` — the same capability that lets someone change a
 * product's price, which is the same kind of decision.
 */
export async function saveInsurancePlanAction(input: {
  id?: number;
  shop?: string | null;
  name: string;
  price: number;
  bigPieces: number;
  smallPieces: number;
  months: number;
  terms?: string;
  active?: boolean;
}): Promise<void> {
  await requireCapability('stock.editDelete');
  const supabase = await createClient();
  const row = {
    shop_id: input.shop || null,
    name: input.name.trim(),
    price: Number(input.price) || 0,
    big_pieces: Number(input.bigPieces) || 0,
    small_pieces: Number(input.smallPieces) || 0,
    months: Number(input.months) || 0,
    terms: input.terms?.trim() ?? '',
    active: input.active ?? true,
  };
  const { error } = input.id
    ? await supabase.from('insurance_plans').update(row).eq('id', input.id)
    : await supabase.from('insurance_plans').insert(row);
  if (error) throw error;
  revalidatePath('/stock');
  // The ticket's ประกัน picker reads this list.
  revalidatePath('/tickets');
}

/** ลบแผนประกัน. Policies already sold keep their own copy, so nothing is lost. */
export async function deleteInsurancePlanAction(id: number): Promise<void> {
  await requireCapability('stock.editDelete');
  const supabase = await createClient();
  const { error } = await supabase.from('insurance_plans').delete().eq('id', id);
  if (error) throw error;
  revalidatePath('/stock');
  revalidatePath('/tickets');
}

/**
 * อนุมัติ / ไม่อนุมัติใบเบิก.
 *
 * The status pill existed from the start and nothing could ever change it — a
 * withdrawal sat at "รออนุมัติ" for good. This is the decision it was waiting
 * for.
 *
 * The goods already left the shelf when the withdrawal was recorded, so
 * approving moves no stock. REJECTING does: it puts the quantity back and writes
 * that return to the ledger, which is the only honest reading of "ไม่อนุมัติ" —
 * the shop is saying the item should not have gone.
 *
 * Gated on `stock.approveWithdraw` (migration 0026), separate from
 * `stock.withdraw`, so a หัวหน้าช่าง can take stock without signing off their
 * own request.
 */
export async function decideWithdrawalAction(input: {
  id: number;
  approve: boolean;
}): Promise<void> {
  const session = await requireCapability('stock.approveWithdraw');
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from('withdrawals')
    .select('id, item, stock_id, shop_id, qty, status')
    .eq('id', input.id)
    .single();
  if (error || !row) throw new Error('withdrawal not found');
  assertShopAccess(session, row.shop_id);
  // Deciding twice would return the stock twice. The first decision stands.
  if (row.status !== 'รออนุมัติ') throw new Error('ใบเบิกนี้ตัดสินไปแล้ว');

  const { error: upErr } = await supabase
    .from('withdrawals')
    .update({
      status: input.approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ',
      decided_at: new Date().toISOString(),
      decided_by: session.userId,
    })
    .eq('id', row.id)
    // Re-checked in the WHERE as well as above: two managers pressing at once
    // must not both get through.
    .eq('status', 'รออนุมัติ');
  if (upErr) throw upErr;

  if (!input.approve && row.stock_id) {
    const { error: moveErr } = await supabase.rpc('move_stock', {
      p_changes: [{ id: row.stock_id, change: Number(row.qty) }] as unknown as Json,
      p_kind: 'คืนจากใบเบิก',
      p_document_id: String(row.id),
      p_by_name: session.name,
      p_note: 'ไม่อนุมัติใบเบิก',
    });
    if (moveErr) throw moveErr;
  }

  revalidatePath('/stock');
}
