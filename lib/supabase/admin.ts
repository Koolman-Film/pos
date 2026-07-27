import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types/database';

/**
 * **Service-role** Supabase client for privileged, admin-only server work:
 * provisioning logins through the Auth admin API (`auth.admin.*`) and deleting
 * auth users. This mirrors the Koolman finance app's `supabaseAdmin()`.
 *
 * SECURITY — the service-role key bypasses RLS entirely. NEVER import this into
 * a Client Component, and never expose the key to the browser. Only call it from
 * Server Actions that have ALREADY verified the caller is an admin (e.g. behind
 * `authorize()` in the permissions actions). It reads its key from the
 * server-only `SUPABASE_SERVICE_ROLE_KEY` env var, which must be set on the
 * deployment.
 *
 * `persistSession`/`autoRefreshToken` are off: this client is stateless per
 * request and must never touch the cookie store. It is scoped to the `pos`
 * schema like the other clients, so `.from('app_users')` resolves correctly;
 * the `auth.admin.*` methods hit the GoTrue admin endpoints directly and are
 * unaffected by the schema setting.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set to ' +
        'provision user logins. Set it as a server env var on the deployment.',
    );
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
