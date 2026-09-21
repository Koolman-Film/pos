import {
  ACTIVITY_MODULES,
  entitiesOf,
  type ActivityAction,
  type ActivityEntry,
  type ActivityModule,
} from '@/lib/domain/activity';
import type { createClient } from '@/lib/supabase/server';

/**
 * ประวัติการใช้งาน — one page of `activity_log` (migration 0061).
 *
 * Unlike the money screens this does NOT read every row: the log grows with
 * every save anybody makes and is read newest-first, a page at a time. The
 * filters narrow it on the server, and "ก่อนหน้านี้" walks back by id, which is
 * stable while new rows keep arriving at the top — an offset would shift under
 * the reader and repeat or skip rows.
 *
 * RLS already limits the table to admins; the page checks too, so nobody else
 * is shown an empty screen that implies there is nothing to see.
 */

export const ACTIVITY_PAGE_SIZE = 300;

export type ActivityFilter = {
  /** `YYYY-MM-DD`, a shop day. */
  from?: string;
  to?: string;
  shop?: string;
  module?: ActivityModule;
  /** An app_users id, or 'system' for writes with no signed-in user. */
  actor?: string;
  /** Part of a document number: JT-CM-00214, WS-, POS-CM-… */
  doc?: string;
  /** Show rows older than this id. */
  before?: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Next calendar day of a `YYYY-MM-DD`, for an exclusive upper bound. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Read the filter out of the URL, dropping anything malformed. */
export function parseActivityFilter(
  params: Record<string, string | string[] | undefined>,
): ActivityFilter {
  const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');
  const moduleName = str('module');
  const before = Number(str('before'));
  return {
    from: DAY.test(str('from')) ? str('from') : undefined,
    to: DAY.test(str('to')) ? str('to') : undefined,
    shop: str('shop') || undefined,
    module: (ACTIVITY_MODULES as readonly string[]).includes(moduleName)
      ? (moduleName as ActivityModule)
      : undefined,
    actor: str('actor') || undefined,
    doc: str('doc') || undefined,
    before: Number.isInteger(before) && before > 0 ? before : undefined,
  };
}

export async function loadActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: ActivityFilter,
): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> {
  let q = supabase
    .from('activity_log')
    .select('id, at, tx, actor_name, shop_id, entity, record_id, doc_ref, action, changes')
    .order('id', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE + 1);

  // Shop days are Bangkok days: a save at 00:30 belongs to the day it was made
  // at the counter, not to the UTC day before.
  if (f.from) q = q.gte('at', `${f.from}T00:00:00+07:00`);
  if (f.to) q = q.lt('at', `${nextDay(f.to)}T00:00:00+07:00`);
  if (f.shop) q = q.eq('shop_id', f.shop);
  if (f.module) q = q.in('entity', entitiesOf(f.module));
  if (f.actor === 'system') q = q.is('actor', null);
  else if (f.actor) q = q.eq('actor', f.actor);
  // `%` and `_` typed into the box are meant literally, not as wildcards.
  if (f.doc) q = q.ilike('doc_ref', `%${f.doc.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.before) q = q.lt('id', f.before);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    hasMore: rows.length > ACTIVITY_PAGE_SIZE,
    entries: rows.slice(0, ACTIVITY_PAGE_SIZE).map((r) => ({
      id: r.id,
      at: r.at,
      tx: Number(r.tx),
      actorName: r.actor_name,
      shop: r.shop_id,
      entity: r.entity,
      recordId: r.record_id,
      docRef: r.doc_ref,
      action: r.action as ActivityAction,
      changes: (r.changes ?? {}) as Record<string, unknown>,
    })),
  };
}
