'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Email + password sign-in.
 *
 * Replaces the prototype's fake email-only picker (finnix-film.html:4285-4320)
 * with real Supabase Auth, while keeping its two rejection cases: an address
 * that is not registered in `app_users`, and a suspended account.
 *
 * Failures redirect back to `/login?error=<code>`; only codes travel in the URL
 * (never a raw error message), so `app/login/page.tsx` decides the wording and
 * nothing arbitrary can be planted in the login card via a crafted link.
 * `redirect()` throws, so it is never called from inside a `try`.
 */
export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email) redirect('/login?error=missing_email');
  if (!password) redirect('/login?error=missing_password');

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // Supabase deliberately returns the same error for an unknown address and a
  // wrong password; do not try to tell them apart, that is an enumeration leak.
  if (error || !data.user) redirect('/login?error=invalid_credentials');

  // Authenticating is not the same as being registered by an admin. Re-check
  // the `app_users` row here rather than letting a half-valid session through
  // to the app shell.
  const { data: profile } = await supabase
    .from('app_users')
    .select('active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect('/login?error=no_profile');
  }

  if (!profile.active) {
    await supabase.auth.signOut();
    redirect('/login?error=inactive');
  }

  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
