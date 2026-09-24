import { logout } from '@/app/login/actions';
import { getSessionContext } from '@/lib/auth/session';

/**
 * รายงานสำหรับผู้บริหาร — the owners' report on its own, without the POS around it.
 *
 * Served at `/report`, and at the root of the report host (see `proxy.ts`), so
 * the owners have one link that opens straight onto the day's figures. It is
 * still the POS behind it: the same sign-in, the same `money` permission
 * (checked by the page), the same data. Only the shell is gone.
 *
 * `app-shell` keeps printing working: the print stylesheet hides it and prints
 * the body-portaled `.print-area`, exactly as inside the POS.
 */
export default async function ReportLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  return (
    <div className="app-shell min-h-screen" style={{ background: 'var(--paper)' }}>
      <header
        className="flex items-center gap-3 px-4 sm:px-6 py-3"
        style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="icon-tile" style={{ background: 'var(--primary)', width: 32, height: 32 }}>
          <i className="fa-solid fa-car text-white text-sm" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm leading-tight">Finnix Film &amp; Central Audio</p>
          <p className="text-xs leading-tight" style={{ color: 'var(--ink-soft)' }}>
            รายงานสำหรับผู้บริหาร
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs hidden sm:inline" style={{ color: 'var(--ink-soft)' }}>
            {session.name}
          </span>
          <form action={logout}>
            <button type="submit" className="btn-outline text-xs px-3 py-2 rounded-lg font-medium">
              <i className="fa-solid fa-right-from-bracket mr-1.5" aria-hidden />
              ออกจากระบบ
            </button>
          </form>
        </div>
      </header>
      <main className="px-4 sm:px-6 py-6 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
