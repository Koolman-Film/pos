import { SidebarNav } from './SidebarNav';
import { NAV_ITEMS } from './navItems';

/**
 * Permission gate for the sidebar.
 *
 * Deliberately a **Server Component**: `hasNav` comes straight off
 * `getSessionContext()` and props crossing into a Client Component must be
 * serializable — a function is not (see
 * node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md,
 * "Props passed to Client Components need to be serializable"). So the gate
 * runs here, on the server, and only the resulting plain array is handed to
 * `SidebarNav`, which owns the `usePathname()` / drawer interactivity.
 *
 * Divergence from the prototype: it rendered every nav item and *disabled* the
 * ones the role lacked, showing a padlock (finnix-film.html:405,434). The port
 * omits them entirely — the plan's test asserts a dashboard-only role cannot
 * even see 'จัดการสิทธิ์'. Advertising modules a user may not open is also how
 * the padlock leaked the shape of the permission model to every role.
 */
export function Sidebar({
  hasNav,
  activePath,
}: {
  hasNav: (navKey: string) => boolean;
  /** Overrides `usePathname()`. Test seam; the app never passes it. */
  activePath?: string;
}) {
  return <SidebarNav items={NAV_ITEMS.filter((item) => hasNav(item.id))} activePath={activePath} />;
}
