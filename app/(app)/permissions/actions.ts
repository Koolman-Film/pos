'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/types/database';
import {
  DASHBOARD_WIDGETS,
  MODULE_CAPABILITIES,
  NAV_ITEMS,
  OTHER_CAPABILITIES,
  colorFromHex,
} from '@/components/permissions/permissionMeta';

/**
 * Server Actions for the Permissions admin module.
 *
 * SECURITY — correction C2 (BINDING). This module mutates authorization data
 * itself, so a missing check here escalates privileges for the whole app. Every
 * exported action funnels through `authorize()` BELOW BEFORE any write:
 *
 *   1. `getSessionContext()` re-verifies the caller against the Supabase auth
 *      server (`auth.getUser()`), redirecting unauthenticated callers to
 *      /login. Server Functions are plain POSTs, reachable without ever
 *      rendering the UI, so the layout's gate and the sidebar hiding the link
 *      are NOT sufficient — this re-check is mandatory.
 *   2. `hasNav('permissions')` — the prototype's own gate for this screen — must
 *      be true. Anyone else is rejected (`fail closed`), never allowed by
 *      default. RLS (migration 0007's `current_user_has_nav('permissions')`
 *      policies) is the backstop, not the only line of defence.
 *
 * The `admin` role is treated as immutable here exactly as in the prototype
 * (finnix-film.html:3997,4001,4005,4024): admin always has full access, so its
 * matrix cells and role deletion are refused server-side too, not just disabled
 * in the UI.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const PERMISSION_TYPES = ['nav', 'dashboard_widget', 'module_capability'] as const;
type PermissionType = (typeof PERMISSION_TYPES)[number];

async function authorize() {
  // Redirects to /login for an unauthenticated / unregistered / suspended caller.
  const session = await getSessionContext();
  // FAIL CLOSED: only a caller who actually holds the `permissions` nav may write.
  if (!session.hasNav('permissions')) {
    throw new Error('forbidden');
  }
  const supabase = await createClient();
  return { session, supabase };
}

function done(): ActionResult {
  revalidatePath('/permissions');
  return { ok: true };
}

function fail(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

// ---------- permission matrix (nav / dashboard_widget / module_capability) ----------

export async function setPermission(
  roleId: string,
  permissionType: string,
  permissionKey: string,
  allowed: boolean,
): Promise<ActionResult> {
  const { supabase } = await authorize();
  // admin is locked to full access — never persist a change against it.
  if (roleId === 'admin') return { ok: true };
  if (!PERMISSION_TYPES.includes(permissionType as PermissionType)) {
    return { ok: false, error: 'invalid permission_type' };
  }
  const { error } = await supabase.from('role_permissions').upsert(
    {
      role_id: roleId,
      permission_type: permissionType as PermissionType,
      permission_key: permissionKey,
      allowed,
    },
    { onConflict: 'role_id,permission_type,permission_key' },
  );
  return error ? fail(error) : done();
}

/** Typed wrappers so client props stay `(roleId, key, allowed)` and the
 * `permission_type` can never be spoofed from the client. */
export async function setModulePermission(roleId: string, key: string, allowed: boolean) {
  return setPermission(roleId, 'module_capability', key, allowed);
}
export async function setNavPermission(roleId: string, key: string, allowed: boolean) {
  return setPermission(roleId, 'nav', key, allowed);
}
export async function setDashboardPermission(roleId: string, key: string, allowed: boolean) {
  return setPermission(roleId, 'dashboard_widget', key, allowed);
}

// ---------- roles ----------

/** Blank permission rows for a brand-new role — matches BLANK_*_PERMISSION_SET
 * (finnix-film.html:202-203,227): every cell off, except the dashboard nav. */
function blankPermissionRows(
  roleId: string,
): Database['public']['Tables']['role_permissions']['Insert'][] {
  const rows: Database['public']['Tables']['role_permissions']['Insert'][] = [];
  for (const n of NAV_ITEMS) {
    rows.push({
      role_id: roleId,
      permission_type: 'nav',
      permission_key: n.id,
      allowed: n.id === 'dashboard',
    });
  }
  for (const w of [...DASHBOARD_WIDGETS, ...OTHER_CAPABILITIES]) {
    rows.push({
      role_id: roleId,
      permission_type: 'dashboard_widget',
      permission_key: w.key,
      allowed: false,
    });
  }
  for (const c of MODULE_CAPABILITIES) {
    rows.push({
      role_id: roleId,
      permission_type: 'module_capability',
      permission_key: c.key,
      allowed: false,
    });
  }
  return rows;
}

export async function addRole(name: string, icon: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'empty name' };
  const id = 'role_' + Date.now();
  const { error: roleError } = await supabase.from('roles').insert({ id, name: trimmed, icon });
  if (roleError) return fail(roleError);
  const { error: permError } = await supabase
    .from('role_permissions')
    .insert(blankPermissionRows(id));
  if (permError) return fail(permError);
  return done();
}

export async function renameRole(id: string, name: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'empty name' };
  const { error } = await supabase.from('roles').update({ name: trimmed }).eq('id', id);
  return error ? fail(error) : done();
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  // finnix-film.html:4024 — the admin role can never be removed.
  if (id === 'admin') return { ok: false, error: 'cannot delete admin' };
  const { error } = await supabase.from('roles').delete().eq('id', id);
  return error ? fail(error) : done();
}

/**
 * "รีเซ็ตค่าเริ่มต้น" — restore the four default roles and the whole permission
 * matrix (prototype :4033-4039).
 *
 * The defaults live in the `reset_permissions_to_defaults()` SQL function
 * (migration 0009), not here, because in the port they are database state rather
 * than JS constants. Keeping them in one place means this action cannot drift from
 * what a fresh `db reset` produces.
 *
 * DESTRUCTIVE, exactly as the prototype was: custom roles are dropped and any user
 * holding one becomes an admin. The UI confirms before calling.
 */
export async function resetPermissionsToDefaults(): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { error } = await supabase.rpc('reset_permissions_to_defaults');
  if (error) return fail(error);
  // The reset can change this caller's own nav, so refresh the shell too.
  revalidatePath('/', 'layout');
  return done();
}

// ---------- ticket statuses ----------

export async function addStatus(
  name: string,
  short: string,
  colorHex: string,
): Promise<ActionResult> {
  const { supabase } = await authorize();
  const key = name.trim();
  if (!key) return { ok: false, error: 'empty status' };
  const { data: top } = await supabase
    .from('statuses')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = colorFromHex(colorHex);
  const { error } = await supabase.from('statuses').insert({
    key,
    short: short.trim() || key,
    bg: c.bg,
    text_color: c.text,
    dot: c.dot,
    sort_order: (top?.sort_order ?? 0) + 1,
  });
  return error ? fail(error) : done();
}

export async function updateStatus(
  key: string,
  field: 'short' | 'color',
  value: string,
): Promise<ActionResult> {
  const { supabase } = await authorize();
  const patch =
    field === 'color'
      ? {
          bg: colorFromHex(value).bg,
          text_color: colorFromHex(value).text,
          dot: colorFromHex(value).dot,
        }
      : { short: value };
  const { error } = await supabase.from('statuses').update(patch).eq('key', key);
  return error ? fail(error) : done();
}

export async function deleteStatus(key: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { error } = await supabase.from('statuses').delete().eq('key', key);
  return error ? fail(error) : done();
}

/** Swap a status's `sort_order` with its neighbour (dir -1 up / +1 down). */
export async function moveStatus(key: string, dir: -1 | 1): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { data: rows, error } = await supabase
    .from('statuses')
    .select('key, sort_order')
    .order('sort_order', { ascending: true });
  if (error) return fail(error);
  const list = rows ?? [];
  const idx = list.findIndex((s) => s.key === key);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= list.length) return { ok: true };
  const a = list[idx];
  const b = list[target];
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('statuses').update({ sort_order: b.sort_order }).eq('key', a.key),
    supabase.from('statuses').update({ sort_order: a.sort_order }).eq('key', b.key),
  ]);
  return e1 || e2 ? fail(e1 ?? e2) : done();
}

// ---------- wholesale (PO) statuses ----------

export async function addWsStatus(name: string, colorHex: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const key = name.trim();
  if (!key) return { ok: false, error: 'empty status' };
  const { data: top } = await supabase
    .from('ws_statuses')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = colorFromHex(colorHex);
  const { error } = await supabase.from('ws_statuses').insert({
    key,
    bg: c.bg,
    text_color: c.text,
    dot: c.dot,
    sort_order: (top?.sort_order ?? 0) + 1,
  });
  return error ? fail(error) : done();
}

export async function updateWsStatusColor(key: string, colorHex: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const c = colorFromHex(colorHex);
  const { error } = await supabase
    .from('ws_statuses')
    .update({ bg: c.bg, text_color: c.text, dot: c.dot })
    .eq('key', key);
  return error ? fail(error) : done();
}

export async function renameWsStatus(oldKey: string, newKeyRaw: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const newKey = newKeyRaw.trim();
  if (!newKey || newKey === oldKey) return { ok: true };
  const { error } = await supabase.from('ws_statuses').update({ key: newKey }).eq('key', oldKey);
  return error ? fail(error) : done();
}

export async function deleteWsStatus(key: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { error } = await supabase.from('ws_statuses').delete().eq('key', key);
  return error ? fail(error) : done();
}

// ---------- shop info (used for printed financial documents) ----------

export async function updateShopInfo(
  shopId: string,
  patch: Partial<{
    companyName: string;
    taxId: string;
    address: string;
    phone: string;
    paymentChannels: string[];
  }>,
): Promise<ActionResult> {
  const { supabase } = await authorize();
  const dbPatch: Database['public']['Tables']['shop_info']['Update'] = {};
  if (patch.companyName !== undefined) dbPatch.company_name = patch.companyName;
  if (patch.taxId !== undefined) dbPatch.tax_id = patch.taxId;
  if (patch.address !== undefined) dbPatch.address = patch.address;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.paymentChannels !== undefined) dbPatch.payment_channels = patch.paymentChannels;
  const { error } = await supabase.from('shop_info').update(dbPatch).eq('shop_id', shopId);
  return error ? fail(error) : done();
}

// ---------- users ----------

export async function updateUser(
  id: string,
  patch: { role?: string; active?: boolean },
): Promise<ActionResult> {
  const { supabase } = await authorize();
  const dbPatch: Database['public']['Tables']['app_users']['Update'] = {};
  if (patch.role !== undefined) dbPatch.role_id = patch.role;
  if (patch.active !== undefined) dbPatch.active = patch.active;
  const { error } = await supabase.from('app_users').update(dbPatch).eq('id', id);
  return error ? fail(error) : done();
}

/** Grant/revoke "all shops". Turning it off drops to a single shop, matching the
 * prototype's `shopAccess: 'all' -> [SHOPS[0].id]` (finnix-film.html:3922). */
export async function setUserAllShops(id: string, all: boolean): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { error: uErr } = await supabase
    .from('app_users')
    .update({ sees_all_shops: all })
    .eq('id', id);
  if (uErr) return fail(uErr);
  if (all) return done();
  const { data: firstShop } = await supabase
    .from('shops')
    .select('id')
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstShop) return done();
  await supabase.from('user_shop_access').delete().eq('user_id', id);
  const { error } = await supabase
    .from('user_shop_access')
    .insert({ user_id: id, shop_id: firstShop.id });
  return error ? fail(error) : done();
}

/** Toggle one shop for a user. Refuses to drop the last shop, mirroring the
 * prototype's "if next.length===0 keep" guard (finnix-film.html:3929). */
export async function toggleUserShop(id: string, shopId: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { data: rows, error } = await supabase
    .from('user_shop_access')
    .select('shop_id')
    .eq('user_id', id);
  if (error) return fail(error);
  const current = (rows ?? []).map((r) => r.shop_id);
  if (current.includes(shopId)) {
    if (current.length <= 1) return { ok: true }; // never leave zero shops
    const { error: dErr } = await supabase
      .from('user_shop_access')
      .delete()
      .eq('user_id', id)
      .eq('shop_id', shopId);
    return dErr ? fail(dErr) : done();
  }
  const { error: iErr } = await supabase
    .from('user_shop_access')
    .insert({ user_id: id, shop_id: shopId });
  return iErr ? fail(iErr) : done();
}

export async function deleteUser(id: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { count } = await supabase.from('app_users').select('id', { count: 'exact', head: true });
  if ((count ?? 0) <= 1) return { ok: false, error: 'ต้องมีผู้ใช้งานอย่างน้อย 1 คนเสมอ' };
  const { error } = await supabase.from('app_users').delete().eq('id', id);
  return error ? fail(error) : done();
}
