import { Header } from '@/components/layout/Header';
import { MobileNavProvider } from '@/components/layout/MobileNavContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { getSessionContext } from '@/lib/auth/session';

/**
 * The authenticated shell — everything under the `(app)` route group renders
 * inside it. Ports the prototype's signed-in root
 * (reference/v0.4/finnix-film.html:4403-4410).
 *
 * `getSessionContext()` IS the authorization check for this subtree: it
 * verifies the caller against the Supabase auth server and redirects to
 * `/login` for anyone unauthenticated, unregistered or suspended, so no page
 * below here renders without a valid session. It is `cache()`d, so pages may
 * call it again for free. Note this gates *rendering* only — per correction C2,
 * every Server Action must still re-check on its own.
 *
 * SHARED FILE: owned by Task 12, read by all seven Wave 4 module tasks. Module
 * tasks must not edit it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  return (
    // `app-shell` is the print-isolation hook: the `@media print` block in
    // app/globals.css hides this entire subtree so only the body-portaled
    // `.print-area` reaches the page. Do not remove or rename it.
    <div className="app-shell min-h-screen flex" style={{ background: 'var(--paper)' }}>
      {/* Shares the mobile drawer's open state between the header's hamburger
          and the sidebar, which this Server Component cannot hold itself. */}
      <MobileNavProvider>
        <Sidebar hasNav={session.hasNav} />
        <div className="flex-1 min-w-0 flex flex-col">
          <Header name={session.name} roleId={session.roleId} email={session.email} />
          <main className="flex-1 px-4 sm:px-6 py-6 max-w-6xl w-full mx-auto">{children}</main>
        </div>
      </MobileNavProvider>
    </div>
  );
}
