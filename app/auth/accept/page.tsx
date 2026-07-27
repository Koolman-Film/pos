import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { AcceptInviteForm } from './AcceptInviteForm';

/**
 * Landing page after Supabase Auth confirms an invite/recovery token and the
 * session cookie is set (via /auth/callback). The invitee sets a password to
 * finish activating their account. Their name/role were assigned by the admin
 * at invite time (see `addUser`), so this step is password-only.
 */
export default async function AcceptInvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The callback exchange failed or the link expired — send them somewhere they
  // can ask the admin to resend.
  if (!user) redirect('/login?error=invite_expired');

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--paper)' }}
    >
      <div className="card p-7 w-full" style={{ maxWidth: 420 }}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="icon-tile" style={{ background: 'var(--primary)' }}>
            <i className="fa-solid fa-car" style={{ color: '#fff' }} />
          </div>
          <div>
            <p className="text-base font-bold leading-tight">ยินดีต้อนรับสู่ Finnix Film</p>
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ตั้งรหัสผ่านเพื่อเริ่มใช้งานระบบ
            </p>
          </div>
        </div>
        <AcceptInviteForm email={user.email ?? ''} />
      </div>
    </div>
  );
}
