'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { getSessionContext } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
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

/** `linked: true` = an existing Koolman login was granted POS access (no email
 * sent); `false` = a new account was invited by email. See `addUser`. */
export type AddUserResult = { ok: true; linked: boolean } | { ok: false; error: string };

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

// Returns the error variant specifically (not the whole union) so it stays
// assignable to result types that add fields to the success case, e.g.
// `AddUserResult`.
function fail(error: unknown): { ok: false; error: string } {
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
): Database['pos']['Tables']['role_permissions']['Insert'][] {
  const rows: Database['pos']['Tables']['role_permissions']['Insert'][] = [];
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
  const dbPatch: Database['pos']['Tables']['shop_info']['Update'] = {};
  if (patch.companyName !== undefined) dbPatch.company_name = patch.companyName;
  if (patch.taxId !== undefined) dbPatch.tax_id = patch.taxId;
  if (patch.address !== undefined) dbPatch.address = patch.address;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.paymentChannels !== undefined) dbPatch.payment_channels = patch.paymentChannels;
  const { error } = await supabase.from('shop_info').update(dbPatch).eq('shop_id', shopId);
  return error ? fail(error) : done();
}

/**
 * เพิ่มสาขาใหม่ หรือแก้ชื่อ/ลำดับของสาขาเดิม (migration 0034).
 *
 * The database decides, not this function: `save_shop` is `security definer`
 * and re-checks that the caller is an admin, so the rule holds for any client,
 * not only for the screen that has the button. Validation of the id lives there
 * too, next to the table it protects.
 *
 * There is no delete. Every ticket, order, expense and stock row points at a
 * shop; a branch that closes is one nobody is given access to.
 */
export async function saveShop(input: {
  id: string;
  name: string;
  sortOrder?: number;
}): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { error } = await supabase.rpc('save_shop', {
    p_id: input.id,
    p_name: input.name,
    p_sort: input.sortOrder ?? undefined,
  });
  if (error) return fail(error);
  // A new branch shows up in the sidebar's shop filter and in every module's
  // scope, so the whole app has to be re-rendered, not just this page.
  revalidatePath('/', 'layout');
  return done();
}

// ---------- users ----------

export async function updateUser(
  id: string,
  patch: { role?: string; active?: boolean },
): Promise<ActionResult> {
  const { supabase } = await authorize();
  const dbPatch: Database['pos']['Tables']['app_users']['Update'] = {};
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

/**
 * Remove a user's POS access.
 *
 * SHARED AUTH — this database is shared with the Koolman finance app: `pos` and
 * `public` are two schemas in ONE Supabase project, so there is a single
 * `auth.users` table behind both. Every POS user today is also a finance user.
 * Therefore this deletes ONLY the `pos.app_users` profile (which cascades to
 * `user_shop_access`) and must NEVER call `auth.admin.deleteUser` — destroying
 * the shared login would lock the person out of the finance app as well.
 */
export async function deleteUser(id: string): Promise<ActionResult> {
  const { supabase } = await authorize();
  const { count } = await supabase.from('app_users').select('id', { count: 'exact', head: true });
  if ((count ?? 0) <= 1) return { ok: false, error: 'ต้องมีผู้ใช้งานอย่างน้อย 1 คนเสมอ' };
  const { error } = await supabase.from('app_users').delete().eq('id', id);
  return error ? fail(error) : done();
}

// ---------- user provisioning (invite flow, mirrors the finance app) ----------

/**
 * Origin of the currently-deployed app, for the invite-email redirect URL.
 * Read from request headers so it works on local dev, previews, and
 * finnixpos.kool-man.com without an extra env var — same approach as finance.
 */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'finnixpos.kool-man.com';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Find an existing Supabase Auth account by email (pages the admin list). */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Give someone access to the POS app.
 *
 * SHARED AUTH — `pos` and finance's `public` are two schemas in ONE Supabase
 * project, so a single `auth.users` table backs both apps. That produces two
 * distinct cases, and conflating them is dangerous:
 *
 *  1. **The person already has a Koolman login** (they use the finance app).
 *     This is the common case — every current POS user is also a finance user.
 *     We simply LINK: insert a `pos.app_users` profile pointing at their
 *     existing auth id. No invite, no email, no new password — they sign in
 *     with the credentials they already have. Calling `inviteUserByEmail` here
 *     would fail with "already registered", and telling the admin to "delete
 *     them first" would destroy that person's finance access.
 *  2. **Brand-new person** — no auth account anywhere. Then we invite by email
 *     and they set a password via /auth/callback → /auth/accept.
 *
 * Non-admins get their first shop granted so they never start with zero shops.
 * Gated behind `authorize()` (admin only) like every other write here.
 */
export async function addUser(input: {
  email: string;
  name: string;
  roleId: string;
}): Promise<AddUserResult> {
  const { supabase } = await authorize();

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const roleId = input.roleId;
  if (!email || !name) return { ok: false, error: 'กรุณากรอกอีเมลและชื่อผู้ใช้งาน' };

  // Validate the role exists (client sends a role id from the dropdown).
  const { data: role } = await supabase.from('roles').select('id').eq('id', roleId).maybeSingle();
  if (!role) return { ok: false, error: 'ไม่พบบทบาทที่เลือก' };

  const admin = createAdminClient();

  // Already has a POS profile? True duplicate.
  const { data: dupe } = await admin
    .from('app_users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (dupe) return { ok: false, error: 'มีอีเมลนี้ในระบบแล้ว' };

  let userId: string;
  let linkedExisting = false;
  try {
    const existing = await findAuthUserByEmail(admin, email);
    if (existing) {
      // Case 1 — link the existing Koolman login. No invite sent.
      userId = existing.id;
      linkedExisting = true;
    } else {
      // Case 2 — brand-new person: invite by email so they can set a password.
      const origin = await siteOrigin();
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/auth/accept')}`;
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { name },
      });
      if (inviteErr || !invited?.user) {
        return { ok: false, error: inviteErr?.message ?? 'ส่งคำเชิญไม่สำเร็จ' };
      }
      userId = invited.user.id;
    }
  } catch (err) {
    return fail(err);
  }

  const { error: profileErr } = await admin
    .from('app_users')
    .insert({ id: userId, email, name, role_id: roleId, active: true, sees_all_shops: false });
  if (profileErr) {
    // Roll back ONLY an auth account we just created. Never delete a
    // pre-existing login — it belongs to the finance app too.
    if (!linkedExisting) await admin.auth.admin.deleteUser(userId).catch(() => {});
    return fail(profileErr);
  }

  // Admins see every shop by role; everyone else starts with the first shop so
  // they aren't left with zero (matches the "never zero shops" invariant used
  // by setUserAllShops / toggleUserShop above).
  if (roleId !== 'admin') {
    const { data: firstShop } = await admin
      .from('shops')
      .select('id')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstShop) {
      await admin.from('user_shop_access').insert({ user_id: userId, shop_id: firstShop.id });
    }
  }

  revalidatePath('/permissions');
  // `linked` tells the UI which message to show: an existing Koolman login was
  // granted access (no email sent), or a genuine invite is on its way.
  return { ok: true, linked: linkedExisting };
}

/**
 * Resend the invite (or a password-recovery link) for an existing user — for
 * when the original email was lost or the 24h token expired. Mirrors finance:
 * try the invite path first, fall back to password recovery once the account
 * exists in auth.users. Both land on the same /auth/callback → /auth/accept flow.
 */
export async function resendInvite(userId: string): Promise<ActionResult> {
  const { supabase } = await authorize();

  const { data: user } = await supabase
    .from('app_users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (!user) return { ok: false, error: 'ไม่พบผู้ใช้' };

  const admin = createAdminClient();
  const origin = await siteOrigin();
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/auth/accept')}`;

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(user.email, { redirectTo });
  if (!inviteErr) return done();

  const msg = inviteErr.message.toLowerCase();
  if (msg.includes('already') || msg.includes('registered')) {
    const { error: resetErr } = await admin.auth.resetPasswordForEmail(user.email, { redirectTo });
    return resetErr ? { ok: false, error: `ส่งคำเชิญใหม่ไม่สำเร็จ: ${resetErr.message}` } : done();
  }
  return { ok: false, error: `ส่งคำเชิญใหม่ไม่สำเร็จ: ${inviteErr.message}` };
}
