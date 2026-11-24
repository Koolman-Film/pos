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

/**
 * รับของเข้า. `supplier` and `docNo` are captured here because receiving is the
 * only moment anyone knows them, and a lot without them cannot be traced back
 * to the delivery it came from (migration 0027).
 */
/**
 * หนึ่งบรรทัดของใบส่งของ — รับเข้าหลายตัวในใบเดียว (ร้านขอ 24 พ.ย. 2569).
 *
 * เหมือน `AddProductInput` ทุกอย่าง ยกเว้นไม่มี `supplier`/`docNo` เพราะสอง
 * อย่างนั้นเป็นของใบ ไม่ใช่ของบรรทัด — ถ้าปล่อยให้แต่ละบรรทัดถือเอง มันจะเพี้ยน
 * กันเองได้ แล้วใบส่งของใบเดียวจะกลายเป็นหลายใบในสายตาของประวัติสต็อก
 */
export type ReceiveLineInput =
  | { mode: 'existing'; existingId: number; qty: number; cost: number }
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
      min?: number;
      unitSize?: number;
      unitLabel?: string;
    };

export type ReceiveDeliveryResult =
  | { ok: true; received: number }
  /** `received` = กี่บรรทัดที่เข้าไปแล้วก่อนจะพัง — ของที่เข้าไปแล้วไม่ถูกถอนคืน. */
  | { ok: false; received: number; error: string };

/**
 * รับของทั้งใบส่งของในครั้งเดียว.
 *
 * ใบส่งของใบหนึ่งมีสินค้าหลายตัวเป็นปกติ ของเดิมรับได้ทีละตัว คนจึงต้องพิมพ์
 * ชื่อผู้ขายกับเลขที่ใบส่งของซ้ำทุกรอบ — พิมพ์ผิดรอบเดียว ล็อตนั้นก็หลุดจาก
 * ใบของมันไปเงียบ ๆ แล้วตอนไล่ย้อนว่าของล็อตนี้มาจากใบไหนก็หาไม่เจอ
 *
 * ตรวจทุกบรรทัดให้ครบก่อนลงมือ — บรรทัดที่ 5 ที่สะกดสาขาผิด ไม่ควรถูกเจอหลัง
 * จากบรรทัดที่ 1-4 เข้าสต็อกไปแล้ว
 *
 * ไม่ใช่ transaction เดียว: การรับของแต่ละบรรทัดเป็น RPC คนละครั้ง ถ้าพังกลาง
 * ทางของที่เข้าไปแล้วจะอยู่ต่อ ฟังก์ชันนี้จึงบอกกลับไปว่าเข้าไปแล้วกี่บรรทัด
 * แทนที่จะโยน error เปล่า ๆ ให้คนเดาเอง
 */
export async function receiveDeliveryAction(input: {
  supplier?: string;
  docNo?: string;
  reason?: string;
  lines: ReceiveLineInput[];
}): Promise<ReceiveDeliveryResult> {
  const session = await requireCapability('stock.addProduct');
  const canSeePrices = session.hasDashboardWidget('seeStockPrices');
  const supabase = await createClient();

  const lines = (input.lines ?? []).filter((l) =>
    l.mode === 'new' ? !!l.newName?.trim() : !!l.existingId,
  );
  if (lines.length === 0) return { ok: false, received: 0, error: 'ยังไม่ได้เลือกสินค้าสักรายการ' };

  // ด่านตรวจก่อนลงมือ — สิทธิ์สาขาของทุกบรรทัด และสินค้าเดิมต้องมีอยู่จริง
  const existingIds = lines.flatMap((l) => (l.mode === 'existing' ? [l.existingId] : []));
  const shopOf = new Map<number, string>();
  if (existingIds.length) {
    const { data: rows, error } = await supabase
      .from('stock')
      .select('id, shop_id')
      .in('id', existingIds);
    if (error) return { ok: false, received: 0, error: error.message };
    for (const r of rows ?? []) shopOf.set(r.id, r.shop_id);
    const missing = existingIds.find((id) => !shopOf.has(id));
    if (missing) return { ok: false, received: 0, error: 'ไม่พบสินค้าที่เลือกไว้บางรายการ' };
  }
  /*
    สิทธิ์สาขาตอบกลับเป็นข้อความ ไม่ใช่โยนทิ้ง.

    `assertShopAccess` โยน error ซึ่งถูกสำหรับ action ที่ทำทีละอย่าง แต่ที่นี่
    คนกรอกมาทั้งใบแล้ว การโยนทิ้งทำให้เขาเห็นแค่หน้าจอค้าง ไม่รู้ว่าบรรทัดไหน
    ผิด — บอกไปว่าบรรทัดที่เท่าไหร่ จะได้แก้ตรงนั้นโดยไม่ต้องกรอกใหม่ทั้งใบ
  */
  for (const [i, l] of lines.entries()) {
    const shop = l.mode === 'new' ? l.shop : shopOf.get(l.existingId)!;
    try {
      assertShopAccess(session, shop);
    } catch {
      return {
        ok: false,
        received: 0,
        error: `รายการที่ ${i + 1}: ไม่มีสิทธิ์รับของเข้าสาขานี้`,
      };
    }
  }

  const supplier = (input.supplier ?? '').trim();
  const docNo = (input.docNo ?? '').trim();
  let received = 0;

  for (const l of lines) {
    try {
      if (l.mode === 'existing') {
        const { error } = await supabase.rpc('receive_stock', {
          p_stock_id: l.existingId,
          p_qty: Number(l.qty),
          p_unit_cost: canSeePrices ? Number(l.cost) || 0 : 0,
          p_supplier: supplier,
          p_doc_no: docNo,
          p_by_name: session.name,
          p_note: input.reason ?? '',
        });
        if (error) throw error;
      } else {
        /*
          สร้างเปล่าก่อน แล้วค่อยรับเข้า (migration 0027).

          สินค้าที่เกิดมาพร้อมจำนวน จะมีของอยู่บนชั้นที่ไม่มีล็อตไหนรองรับ และ
          มีต้นทุนก้อนเดียวที่ 0027 ตั้งใจกำจัดทิ้ง
        */
        const { data: created, error } = await supabase
          .from('stock')
          .insert({
            sku: l.sku?.trim() || `SKU-NEW-${Date.now()}-${received}`,
            name: l.newName.trim(),
            short_name: l.shortName ?? '',
            category: l.category,
            shop_id: l.shop,
            qty: 0,
            min_qty: Number(l.min) || 5,
            cost: 0,
            sell_price: canSeePrices ? Number(l.sellPrice) || 0 : 0,
            unit_size: Math.max(0, Number(l.unitSize) || 0),
            unit_label: (l.unitLabel ?? '').trim(),
          })
          .select('id')
          .single();
        if (error) throw error;
        if (created && Number(l.qty) > 0) {
          const { error: recErr } = await supabase.rpc('receive_stock', {
            p_stock_id: created.id,
            p_qty: Number(l.qty),
            p_unit_cost: canSeePrices ? Number(l.cost) || 0 : 0,
            p_supplier: supplier,
            p_doc_no: docNo,
            p_by_name: session.name,
            p_note: 'ล็อตแรกของสินค้าใหม่',
          });
          if (recErr) throw recErr;
        }
      }
      received += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ';
      revalidatePath('/stock');
      return {
        ok: false,
        received,
        error:
          received > 0
            ? `รับเข้าแล้ว ${received} รายการ แล้วติดที่รายการที่ ${received + 1}: ${message}`
            : message,
      };
    }
  }

  revalidatePath('/stock');
  return { ok: true, received };
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
  min?: number;
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
      min_qty: Number(r.min) || 5,
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
  /** ปริมาณต่อหน่วยที่ขาย — 0 = ไม่ได้ระบุ (migration 0088). */
  unitSize?: number;
  unitLabel?: string;
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
    // ฟอร์มนี้คือทางเดียวที่สินค้าเก่าจะได้ขนาดต่อหน่วย — มันเกิดมาพร้อม 0 ทุกตัว
    unit_size: Math.max(0, Number(input.unitSize) || 0),
    unit_label: (input.unitLabel ?? '').trim(),
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
  /** '' or omitted = ราคากลางทุกสาขา (migration 0029). */
  shop?: string;
}): Promise<void> {
  // The film-price matrix is admin-only in the prototype (reference :3134).
  const session = await getSessionContext();
  if (session.roleId !== 'admin') {
    throw new Error('forbidden: film pricing is admin-only');
  }
  const supabase = await createClient();
  const price = Number(input.price) || 0;
  // NULL means ราคากลาง for every branch; a shop id overrides it for that one
  // (migration 0029). The same product legitimately sells for different money
  // at different branches, and one shared row silently rewrote them all.
  const shop = input.shop || null;
  if (shop && !session.accessibleShopIds.includes(shop)) {
    throw new Error('forbidden: shop out of scope');
  }

  const query = supabase
    .from('film_price_matrix')
    .select('id')
    .eq('category', input.category)
    .eq('product', input.product)
    .eq('position', input.position)
    .eq('car_type', input.carType);
  const { data: existing } = await (
    shop ? query.eq('shop_id', shop) : query.is('shop_id', null)
  ).maybeSingle();
  // Clearing a branch cell DROPS the override instead of storing 0, so the
  // branch goes back to the ราคากลาง rather than quoting nothing. A blank
  // ราคากลาง has no such fallback, so it is stored as written.
  const clearing = Boolean(shop) && price <= 0;
  if (existing) {
    const { error } = clearing
      ? await supabase.from('film_price_matrix').delete().eq('id', existing.id)
      : await supabase.from('film_price_matrix').update({ price }).eq('id', existing.id);
    if (error) throw error;
  } else if (!clearing) {
    const { error } = await supabase.from('film_price_matrix').insert({
      category: input.category,
      product: input.product,
      position: input.position,
      car_type: input.carType,
      shop_id: shop,
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

  const { data: decided, error: upErr } = await supabase
    .from('withdrawals')
    .update({
      status: input.approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ',
      decided_at: new Date().toISOString(),
      decided_by: session.userId,
    })
    .eq('id', row.id)
    // Re-checked in the WHERE as well as above: two managers pressing at once
    // must not both get through.
    .eq('status', 'รออนุมัติ')
    .select('id');
  if (upErr) throw upErr;
  // …and the WHERE only helps if somebody looks at what it matched. Both
  // requests pass the check above; only the one whose UPDATE changed the row
  // may go on to move stock, or a rejection returns the goods twice.
  if ((decided ?? []).length === 0) throw new Error('ใบเบิกนี้ตัดสินไปแล้ว');

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

/**
 * โอนสต็อกระหว่างสาขา.
 *
 * Moving stock between branches had no operation: the shop withdrew at one and
 * added at the other, which left two unrelated records and let the goods arrive
 * at a price somebody typed from memory. `transfer_stock` (migration 0028) does
 * it as one act — FIFO out of the source, the same lots and the same unit costs
 * in at the destination, both ends in the ledger pointing at each other.
 *
 * Gated on `stock.editDelete`: deciding that a branch's inventory belongs
 * somewhere else is the same level of authority as changing a product, and it is
 * already the manager-level key in this module.
 *
 * BOTH shops are re-checked against the caller's access. RLS would scope the
 * reads, but the function writes to the destination too, and a caller must not
 * be able to push stock into a branch they cannot see.
 */
export async function transferStockAction(input: {
  id: number;
  toShop: string;
  qty: number;
  note?: string;
}): Promise<void> {
  const session = await requireCapability('stock.editDelete');
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from('stock')
    .select('id, shop_id')
    .eq('id', input.id)
    .single();
  if (error || !row) throw new Error('stock item not found');
  assertShopAccess(session, row.shop_id);
  assertShopAccess(session, input.toShop);

  const { error: moveErr } = await supabase.rpc('transfer_stock', {
    p_from_stock_id: row.id,
    p_to_shop_id: input.toShop,
    p_qty: Number(input.qty),
    p_by_name: session.name,
    p_note: input.note ?? '',
  });
  if (moveErr) throw moveErr;

  revalidatePath('/stock');
}
