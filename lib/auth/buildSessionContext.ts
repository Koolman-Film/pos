/**
 * Pure permission-resolution logic — no I/O, no Next.js, no Supabase.
 *
 * Ports the prototype's `canDo` / `canSeeAllShops` / `accessibleShops`
 * (reference/v0.4/finnix-film.html:4376,4393) onto the `role_permissions` table.
 *
 * The rules here deliberately mirror the SQL helpers used by the RLS policies in
 * `supabase/migrations/0007_rls_policies.sql` (`current_user_can`,
 * `current_user_has_nav`, `current_user_sees_all_shops`, `current_user_shops`),
 * so the UI gate and the database gate always agree:
 *   - `admin` short-circuits to `true` for every capability/nav key.
 *   - a missing `role_permissions` row means DENIED (never allowed by default).
 *   - "sees all shops" is `role_id = 'admin' OR app_users.sees_all_shops`.
 */

/** One row of `role_permissions`. `permission_type` is a Postgres enum. */
export type PermissionRow = {
  permission_type: string;
  permission_key: string;
  allowed: boolean;
};

/** The `app_users` fields this layer needs, plus the user's `user_shop_access` rows. */
export type Profile = {
  name: string;
  role_id: string;
  sees_all_shops: boolean;
  shop_access: string[];
};

export type SessionContext = {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  seesAllShops: boolean;
  accessibleShopIds: string[];
  canDo: (capabilityKey: string) => boolean;
  hasNav: (navKey: string) => boolean;
  hasDashboardWidget: (widgetKey: string) => boolean;
};

export function buildSessionContext(
  userId: string,
  email: string,
  profile: Profile,
  allShopIds: string[],
  perms: PermissionRow[],
): SessionContext {
  const lookup = (type: string, key: string) =>
    profile.role_id === 'admin' ||
    perms.some((p) => p.permission_type === type && p.permission_key === key && p.allowed);

  // Mirrors the prototype's three-clause `canSeeAllShops`
  // (reference/v0.4/finnix-film.html): admin, OR an explicit per-user grant, OR
  // the role's `seeAllShops` dashboard permission. The third clause is what makes
  // `exec` see every shop — omitting it leaves that seeded permission row dead and
  // silently scopes execs to one shop. Kept as a permission (not an app_users flag)
  // so it stays editable via the Permissions UI, per spec §7.
  // Must stay in sync with `current_user_sees_all_shops()` in migration 0008.
  const seesAllShops = profile.sees_all_shops || lookup('dashboard_widget', 'seeAllShops');

  // Filter the canonical shop list rather than returning `profile.shop_access`
  // verbatim, so the order always matches `shops.sort_order` and an access row
  // pointing at a deleted shop is dropped — same as the prototype's
  // `SHOPS.filter(s => shopAccess.includes(s.id))`.
  const accessibleShopIds = seesAllShops
    ? [...allShopIds]
    : allShopIds.filter((id) => profile.shop_access.includes(id));

  return {
    userId,
    email,
    name: profile.name,
    roleId: profile.role_id,
    seesAllShops,
    accessibleShopIds,
    canDo: (key) => lookup('module_capability', key),
    hasNav: (key) => lookup('nav', key),
    hasDashboardWidget: (key) => lookup('dashboard_widget', key),
  };
}
