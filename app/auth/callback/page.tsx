'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Handles Supabase Auth's email-link callbacks (invite, password reset, magic
 * link). Ported from the Koolman finance app's `/auth/callback`.
 *
 * Supabase delivers the token one of two ways:
 *   - `?code=...` (PKCE, modern)
 *   - `#access_token=...&refresh_token=...` (implicit, legacy)
 * The fragment never reaches the server, so this MUST be a client page.
 *
 * Re-click resilience: the underlying token is single-use. If the invitee opens
 * the link twice, the second exchange fails — but if a session is already
 * present from the first click we forward them on instead of erroring.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell />}>
      <CallbackInner />
    </Suspense>
  );
}

function CallbackInner() {
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handle() {
      const supabase = createClient();
      const next = search.get('next') ?? '/dashboard';

      // Supabase-side errors first (expired / malformed / wrong project).
      const supabaseErr = search.get('error_description') ?? search.get('error');
      const errorCode = search.get('error_code');
      if (supabaseErr || errorCode) {
        const expired =
          errorCode === 'otp_expired' ||
          (supabaseErr ?? '').toLowerCase().includes('expired') ||
          (supabaseErr ?? '').toLowerCase().includes('invalid');
        setError(
          expired
            ? 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ'
            : (supabaseErr ?? 'ลิงก์ไม่ถูกต้อง'),
        );
        return;
      }

      // PKCE flow: ?code=...
      const code = search.get('code');
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (!exErr) {
          // Full reload so the server-rendered destination sees the freshly
          // written session cookie (Next's router raced the cookie write).
          window.location.replace(next);
          return;
        }
        const { data: session } = await supabase.auth.getSession();
        if (session.session) {
          window.location.replace(next);
          return;
        }
        setError('ลิงก์นี้ถูกใช้ไปแล้ว — หากตั้งรหัสผ่านยังไม่เสร็จ กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ');
        return;
      }

      // Implicit flow: #access_token=...&refresh_token=...
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setErr) {
          setError(setErr.message || 'ตั้งค่า session ไม่สำเร็จ');
          return;
        }
        window.location.replace(next);
        return;
      }

      // Naked /auth/callback hit (e.g. re-opened after a successful exchange).
      const { data: session } = await supabase.auth.getSession();
      if (session.session) {
        window.location.replace(next);
        return;
      }

      setError('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
    }

    handle();
  }, [search]);

  return <CallbackShell error={error} />;
}

function CallbackShell({ error }: { error?: string | null } = {}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--paper)' }}
    >
      <div className="card p-7 w-full" style={{ maxWidth: 380 }}>
        <p className="text-base font-bold leading-tight mb-3">กำลังตรวจสอบลิงก์…</p>
        {error ? (
          <div className="flex flex-col gap-3">
            <p
              className="text-sm flex items-start gap-2 rounded-md p-2.5"
              style={{ color: 'var(--primary)', background: 'var(--primary-soft)' }}
            >
              <i className="fa-solid fa-circle-exclamation mt-0.5" />
              {error}
            </p>
            <a href="/login" className="text-sm underline" style={{ color: 'var(--primary)' }}>
              กลับไปหน้าเข้าสู่ระบบ
            </a>
          </div>
        ) : (
          <p className="text-sm flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}>
            <i className="fa-solid fa-spinner fa-spin" />
            กำลังตรวจสอบและเตรียมระบบ…
          </p>
        )}
      </div>
    </div>
  );
}
