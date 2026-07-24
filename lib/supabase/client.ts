import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/lib/types/database';

/**
 * Supabase client for **Client Components**.
 *
 * `createBrowserClient` manages auth cookies via `document.cookie` on its own —
 * do not pass a custom `cookies` option here. Session refreshes performed on the
 * server are handled by `proxy.ts` at the repo root.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
