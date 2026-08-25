import type { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/types/database';

/**
 * Automatic stock movement — the port of the prototype's two inline stock-sync
 * blocks (reference/v0.4/finnix-film.html:1409-1421 for job tickets, :2700-2712
 * for wholesale orders).
 *
 * WHY THIS IS SERVER-SIDE. The prototype adjusted stock in the browser on every
 * keystroke, which was fine when the "database" was a `useState` array owned by
 * one tab. With a real database that approach is wrong twice over: a write per
 * keystroke, and two technicians editing two jobs that share a product would each
 * compute a delta from their own stale copy and the later save would clobber the
 * earlier one. So the delta is computed and applied here, once, inside the save.
 *
 * WHEN IT RUNS. The prototype applied the change the instant the number changed;
 * the port applies it when the ticket or order is saved. The net effect after
 * saving is identical — this is the same adaptation the rest of the port makes
 * (the draft is client state, persistence happens on save) and is the only
 * sensible reading of "immediately" once there is a save button.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * What a movement could not do.
 *
 * `unmatched` are product names with no stock row at that shop — usually a
 * product renamed after the ticket recorded its usage. The movement is still
 * logged, but the quantity could not be deducted, and the caller is expected to
 * tell somebody rather than let it pass.
 */
export type StockMovementResult = { unmatched: string[] };

/** Product name -> quantity. The shape of `ticket_items.actual_qty`. */
export type QtyMap = Record<string, number>;

export type StockMovementSource = {
  /** Human-readable origin, e.g. 'ใบงาน' or 'ขายส่ง'. */
  kind: string;
  /** The document id, e.g. 'JT-CM-00214'. */
  documentId: string;
  /** Who to credit. The prototype used the current user, else `ระบบ (<kind>)`. */
  by: string;
  /** Shop whose stock is affected. */
  shopId: string;
};

/**
 * Sum a list of per-product maps into one total per product. Used because a
 * ticket's quantities live per item, and the same product can appear on more than
 * one item of the same job.
 */
export function sumQtyMaps(maps: (QtyMap | null | undefined)[]): QtyMap {
  const total: QtyMap = {};
  for (const map of maps) {
    for (const [name, qty] of Object.entries(map ?? {})) {
      const n = Number(qty);
      if (!name || !Number.isFinite(n) || n === 0) continue;
      total[name] = (total[name] ?? 0) + n;
    }
  }
  return total;
}

/**
 * Per-product difference between two totals, omitting zeros. Products present in
 * only one side are handled: a product dropped from the ticket returns its whole
 * quantity to stock.
 */
export function diffQtyMaps(before: QtyMap, after: QtyMap): QtyMap {
  const delta: QtyMap = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[name] ?? 0) - (before[name] ?? 0);
    if (d !== 0) delta[name] = d;
  }
  return delta;
}

/**
 * Apply per-product deltas to `stock.qty` at one shop and append the matching
 * `withdrawals` audit rows.
 *
 * A positive delta means more was consumed, so stock goes DOWN by that amount —
 * the prototype's `qty: s.qty - delta`. Stock is deliberately NOT clamped at zero:
 * the prototype did not clamp, and a negative figure is a real signal that the
 * shop counted wrong or forgot to receive a delivery. Hiding it would be worse
 * than showing it.
 *
 * A product with no matching stock row at this shop cannot be decremented, and is
 * RETURNED to the caller instead. There is nothing honest to write in a ledger
 * about a quantity that never moved; what matters is that a human is told, which
 * is what `unmatched` is for.
 */
export async function applyStockMovements(
  supabase: Supabase,
  delta: QtyMap,
  source: StockMovementSource,
): Promise<StockMovementResult> {
  const entries = Object.entries(delta).filter(([, d]) => d !== 0);
  if (entries.length === 0) return { unmatched: [] };

  const names = entries.map(([name]) => name);
  const { data: rows } = await supabase
    .from('stock')
    .select('id, name, qty')
    .eq('shop_id', source.shopId)
    .in('name', names)
    // Deterministic when a branch still carries two rows under one name: the
    // oldest wins, every time. Migration 0025 adds a unique index so this can
    // only matter on data that predates it.
    .order('id', { ascending: true });

  const byName = new Map<string, { id: number; name: string; qty: number }>();
  for (const r of rows ?? []) if (!byName.has(r.name)) byName.set(r.name, r);

  /*
    The arithmetic AND the ledger entry happen in the DATABASE, in one statement
    (migration 0026).

    Reading `qty` and writing back `qty - d` is a lost update the moment two
    people save at once: both read 10, both write 8, and the shop is one short
    with two successful writes to show for it. Writing the log separately is the
    same class of mistake — it is how a movement ends up with no entry, or an
    entry whose before/after disagrees with what actually happened.
  */
  const changes = entries
    .map(([name, d]) => ({ id: byName.get(name)?.id, change: -d }))
    .filter((c): c is { id: number; change: number } => typeof c.id === 'number');

  if (changes.length > 0) {
    await supabase.rpc('move_stock', {
      p_changes: changes as unknown as Json,
      p_kind: source.kind,
      p_document_id: source.documentId,
      p_by_name: source.by,
      p_note: '',
    });
  }
  // Names with no product at this shop. Nothing moved, so there is nothing to put
  // in the ledger; the caller has to SAY so instead — silently skipping is how a
  // renamed product stops being deducted without anyone noticing.
  return { unmatched: names.filter((n) => !byName.has(n)) };
}
