/**
 * The sidebar's navigation registry — a direct port of the prototype's
 * `NAV_ITEMS` (reference/v0.4/finnix-film.html:167-175), with a `href` added
 * because the port navigates by URL instead of by `setView(item.id)`.
 *
 * `id` is the permission key checked against `role_permissions` where
 * `permission_type = 'nav'` (see `SessionContext.hasNav`). Keep the ids exactly
 * as the prototype/seed spell them — in particular the tickets module is
 * `list`, not `tickets`.
 *
 * SHARED FILE: every module route registers here, once, in Task 12. Module
 * tasks must NOT add entries of their own — see the Wave 4 rules in
 * docs/superpowers/plans/2026-07-23-finnix-film-port-EXECUTION.md.
 */
export type NavItem = {
  /** `role_permissions.permission_key` for `permission_type = 'nav'`. */
  id: string;
  label: string;
  /** Font Awesome icon class, e.g. `fa-gauge-high`. */
  icon: string;
  href: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'dashboard', label: 'แดชบอร์ด', icon: 'fa-gauge-high', href: '/dashboard' },
  { id: 'list', label: 'Book งาน', icon: 'fa-clipboard-list', href: '/tickets' },
  { id: 'wholesale', label: 'ขายส่ง', icon: 'fa-truck-fast', href: '/wholesale' },
  { id: 'stock', label: 'สต็อกสินค้า', icon: 'fa-boxes-stacked', href: '/stock' },
  { id: 'commission', label: 'ค่าคอมมิชชั่น', icon: 'fa-percent', href: '/commission' },
  { id: 'accounting', label: 'บัญชี/ค่าใช้จ่าย', icon: 'fa-file-invoice-dollar', href: '/accounting' },
  { id: 'permissions', label: 'จัดการสิทธิ์', icon: 'fa-user-shield', href: '/permissions' },
];

/**
 * Which nav entry a pathname belongs to.
 *
 * Replaces the prototype's `view==='new'||view==='detail' ? 'list' : view`
 * special case (finnix-film.html:4405): sub-routes such as `/tickets/new` or
 * `/tickets/<id>` keep their parent module highlighted. The longest matching
 * `href` wins, so a future nested module cannot be shadowed by a shorter one.
 */
export function resolveActiveNavId(
  items: readonly NavItem[],
  pathname: string
): string | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.id;
}
