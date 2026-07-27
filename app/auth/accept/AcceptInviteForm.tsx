'use client';

import { useState, useTransition } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Sets the invitee's password against Supabase Auth. This must be a browser
 * call (`supabase.auth.updateUser`) because it needs the session established by
 * /auth/callback. On success we hard-navigate to /dashboard so the server sees
 * the session cookie.
 */
export function AcceptInviteForm({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (password !== confirm) {
      setError('รหัสผ่านไม่ตรงกัน');
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        setError(pwErr.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
        return;
      }
      window.location.replace('/dashboard');
    });
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
        อีเมล
      </label>
      <input
        type="email"
        value={email}
        readOnly
        className="field text-sm px-3 py-2 w-full mb-3"
        style={{ color: 'var(--ink-soft)' }}
      />

      <label className="text-xs" htmlFor="accept-password" style={{ color: 'var(--ink-soft)' }}>
        รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)
      </label>
      <input
        id="accept-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        autoFocus
        className="field text-sm px-3 py-2 w-full mb-3"
      />

      <label className="text-xs" htmlFor="accept-confirm" style={{ color: 'var(--ink-soft)' }}>
        ยืนยันรหัสผ่าน
      </label>
      <input
        id="accept-confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        className="field text-sm px-3 py-2 w-full mb-4"
      />

      {error && (
        <p className="text-sm mb-3" style={{ color: 'var(--primary)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn-primary text-sm px-4 py-2.5 rounded-xl font-semibold w-full disabled:opacity-60"
      >
        {pending ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านและเข้าสู่ระบบ'}
      </button>
    </form>
  );
}
