import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types/database';

import { buildSessionContext, type SessionContext } from './buildSessionContext';

/**
 * Why the session is not usable, when it isn't.
 *
 * These double as the `?error=` codes on `/login` — see `app/login/page.tsx`,
 * which maps each one to its Thai message. Codes (not messages) travel in the
 * URL so nobody can inject arbitrary text into the login card.
 */
export type SessionFailureReason = 'unauthenticated' | 'no_profile' | 'inactive';

export type ResolvedSession =
  | { ok: true; session: SessionContext }
  | { ok: false; reason: SessionFailureReason };

/**
 * Resolve a full `SessionContext` from an authenticated Supabase client.
 *
 * Split out of `getSessionContext()` so it holds no Next.js imports: it takes
 * the client as an argument and *returns* a failure instead of redirecting.
 * That makes the real authorization path directly testable against a live
 * Postgres + GoTrue without stubbing `next/headers` or `next/navigation`.
 *
 * SECURITY — this is the authorization boundary, so it must be safe to call as
 * the *sole* check inside a Server Action:
 *
 *   - `auth.getUser()`, never `auth.getSession()`. `getSession()` only decodes
 *     the cookie, which the client controls; `getUser()` revalidates the token
 *     against the Supabase auth server. A user deleted, banned or logged out
 *     server-side is rejected here even though their cookie still parses.
 *   - `proxy.ts` is an OPTIMISTIC refresh only, NOT an authorization boundary:
 *     Server Functions are POSTs to whichever route hosts them, so a `matcher`
 *     change can silently drop proxy coverage. Never rely on it for auth.
 *   - `app_users.active` is re-checked on every call, so suspending an account
 *     takes effect on the account's next request instead of at token expiry.
 *   - The queries below run through the caller's own RLS-scoped client, so this
 *     never sees more than the signed-in user is allowed to see.
 */
export async function resolveSessionContext(
  supabase: SupabaseClient<Database>
): Promise<ResolvedSession> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { ok: false, reason: 'unauthenticated' };

  const { data: profileRow } = await supabase
    .from('app_users')
    .select('name, role_id, active, sees_all_shops, user_shop_access(shop_id)')
    .eq('id', user.id)
    .maybeSingle();

  // Authenticated against GoTrue but never registered by an admin.
  if (!profileRow) return { ok: false, reason: 'no_profile' };
  // Ported from the prototype's suspended-account branch (finnix-film.html:4293).
  if (!profileRow.active) return { ok: false, reason: 'inactive' };

  const [{ data: shops }, { data: perms }] = await Promise.all([
    supabase.from('shops').select('id').order('sort_order'),
    supabase
      .from('role_permissions')
      .select('permission_type, permission_key, allowed')
      .eq('role_id', profileRow.role_id),
  ]);

  return {
    ok: true,
    session: buildSessionContext(
      user.id,
      // `app_users.email` is the admin-registered address; `user.email` is the
      // one that actually authenticated. They are kept in sync by the
      // Permissions module, and the authenticated one is the truthful answer.
      user.email ?? '',
      {
        name: profileRow.name,
        role_id: profileRow.role_id,
        sees_all_shops: profileRow.sees_all_shops,
        shop_access: (profileRow.user_shop_access ?? []).map((a) => a.shop_id),
      },
      (shops ?? []).map((s) => s.id),
      perms ?? []
    ),
  };
}
