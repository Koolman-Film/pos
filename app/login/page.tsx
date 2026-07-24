import { redirect } from 'next/navigation';

import { resolveSessionContext } from '@/lib/auth/resolveSessionContext';
import { createClient } from '@/lib/supabase/server';

import { login } from './actions';

/**
 * Login screen — ports the prototype's `LoginScreen`
 * (reference/v0.4/finnix-film.html:4285-4320): same centred card, same Thai
 * copy, same error line. The email-only fake picker becomes real Supabase email
 * + password auth, so the prototype's "ยังไม่มีรหัสผ่านจริง — เป็นระบบทดลอง"
 * footnote is dropped (it would now be false).
 *
 * The prototype's theme toggle is intentionally NOT reproduced here: nothing
 * bootstraps `data-theme` on `<html>` yet, so a toggle would have no persisted
 * theme to toggle. It belongs with the app-shell theme wiring (Task 12).
 */

/** `?error=` codes produced by `actions.ts` and `lib/auth/session.ts`. */
const ERROR_MESSAGES: Record<string, string> = {
  missing_email: 'กรุณากรอกอีเมล',
  missing_password: 'กรุณากรอกรหัสผ่าน',
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  no_profile: 'ไม่พบอีเมลนี้ในระบบ กรุณาติดต่อแอดมิน',
  inactive: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน',
};

export default async function LoginPage({
  searchParams,
}: {
  // `searchParams` is a Promise in Next 16 — it must be awaited.
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Send an already-signed-in user straight on. This resolves the FULL session,
  // not just `getUser()`, so a caller who is authenticated but unregistered or
  // suspended stays here and sees why — bouncing them to the app would loop
  // them back through `getSessionContext()`'s redirect.
  const supabase = await createClient();
  const resolved = await resolveSessionContext(supabase);
  if (resolved.ok) redirect('/dashboard');

  const message = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--paper)' }}
    >
      <form action={login} className="card p-7 w-full" style={{ maxWidth: 380 }}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="icon-tile" style={{ background: 'var(--primary)' }}>
            <i className="fa-solid fa-car" style={{ color: '#fff' }} />
          </div>
          <div>
            <p className="text-base font-bold leading-tight">Finnix Film &amp; Central Audio</p>
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ระบบบริหารจัดการร้าน
            </p>
          </div>
        </div>

        <p className="text-sm font-semibold mt-5 mb-3">เข้าสู่ระบบ</p>

        <label className="text-xs" htmlFor="email" style={{ color: 'var(--ink-soft)' }}>
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoFocus
          autoComplete="email"
          required
          placeholder="name@finnixfilm.com"
          className="field w-full text-sm px-3.5 py-2.5 mt-1 mb-3"
        />

        <label className="text-xs" htmlFor="password" style={{ color: 'var(--ink-soft)' }}>
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field w-full text-sm px-3.5 py-2.5 mt-1 mb-1"
        />

        {message && (
          <p className="text-xs mb-2" style={{ color: '#B23A48' }}>
            <i className="fa-solid fa-circle-exclamation mr-1" />
            {message}
          </p>
        )}

        <button type="submit" className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold mt-3">
          เข้าสู่ระบบ
        </button>
      </form>
    </div>
  );
}
