import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/lib/types/database';

/**
 * Supabase client for **Server Components, Server Actions and Route Handlers**.
 *
 * `cookies()` is async in Next 16 (the synchronous form was removed), so this
 * factory is async and must be awaited at every call site.
 *
 * Never cache/share the returned client across requests — create a new one per
 * render, per the `@supabase/ssr` contract.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // `getAll`/`setAll` only — the per-cookie `get`/`set`/`remove` handlers
        // are deprecated in @supabase/ssr and miss auth edge cases.
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, which cannot write cookies — safe
            // to ignore because `proxy.ts` refreshes the session on every
            // request, so the refreshed cookies land on the next response.
          }
        },
      },
    }
  );
}
