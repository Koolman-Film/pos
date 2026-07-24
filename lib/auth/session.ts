import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { resolveSessionContext } from './resolveSessionContext';
import type { SessionContext } from './buildSessionContext';

export type { SessionContext } from './buildSessionContext';

/**
 * The application's Data Access Layer entry point: every Server Component,
 * layout, page and Server Action starts here.
 *
 * Calling this IS the authorization check — it verifies the caller against the
 * Supabase auth server via `getUser()` (see `resolveSessionContext`), so a
 * Server Action needs nothing else before it consults `canDo(...)`. Do NOT
 * treat `proxy.ts` or UI gating as the check: Server Functions are POSTs to the
 * route that hosts them, so proxy coverage can be lost by a `matcher` change,
 * and any client can POST an action without ever rendering the UI that hides it.
 *
 * Wrapped in React `cache()` so the three queries it runs are de-duplicated
 * across a single request/render pass — the layout, the page and any leaf
 * component can each call it freely.
 *
 * Never returns for an unauthenticated/unregistered/suspended caller: it
 * redirects to `/login` (throwing `NEXT_REDIRECT`), so callers can rely on the
 * returned context being a real, currently-valid session. Because it throws,
 * never call it inside a `try` block that swallows the redirect.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const resolved = await resolveSessionContext(supabase);

  if (!resolved.ok) {
    redirect(
      resolved.reason === 'unauthenticated' ? '/login' : `/login?error=${resolved.reason}`
    );
  }

  return resolved.session;
});
