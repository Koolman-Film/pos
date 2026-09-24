import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh for every request.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`: this file must
 * live at the repo root (next to `app/`) and export a function named `proxy`.
 * The proxy always runs on the Node.js runtime — `runtime` is not configurable.
 *
 * This is an *optimistic* check only. Authorization still has to be enforced
 * close to the data (RLS policies + per-Server-Action checks); Server Functions
 * are POSTs to the route that uses them, so a matcher change can silently drop
 * proxy coverage.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        // Second arg `headers` is supplied by @supabase/ssr whenever auth
        // cookies are written; it carries
        // `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`
        // (plus `Expires`/`Pragma`) and MUST be copied onto the response so a
        // CDN never caches one user's session cookie and serves it to another.
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers ?? {}).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  // Must run before the response is produced, otherwise a refresh that lands
  // after the response is committed is lost.
  //
  // `getClaims()`, not `getUser()`. This gate is optimistic by design (see the
  // note above), and `getUser()` costs a network round trip to the auth server
  // on EVERY request — paid before the page has even started, and paid again by
  // `resolveSessionContext()`, which is the real authorization boundary.
  //
  // `getClaims()` is not a weaker check, it is a local one: this project signs
  // tokens with an asymmetric key (ES256), so auth-js verifies the signature
  // with WebCrypto against a cached JWKS instead of asking the server. A forged
  // or tampered token still fails. It calls `getSession()` first, so an expired
  // token is still refreshed here and the new cookie still lands on the
  // response — which is the other half of this proxy's job.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  // Paths reachable WITHOUT a session. `/auth/*` carries the Supabase email-link
  // flow (invite / password-reset callback + the set-password page): the invitee
  // has no session cookie until the callback exchanges their code, so bouncing
  // these to /login would break user provisioning entirely.
  const pathname = request.nextUrl.pathname;
  const isPublicPath = pathname.startsWith('/login') || pathname.startsWith('/auth');

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  /*
    รายงานสำหรับผู้บริหาร on its own host (report.<domain>).

    The owners asked for the daily report at a link of its own, apart from the
    POS. It is the same deployment behind a second domain: sign-in stays here,
    and every other page path is rewritten to /report — including /dashboard,
    where sign-in lands — so nothing but the report can be reached from that
    host. Static files (a dot in the last segment) pass through untouched.
  */
  if (isReportHost(request.headers.get('host')) && !isPublicPath) {
    const last = pathname.split('/').pop() ?? '';
    if (!pathname.startsWith('/report') && !last.includes('.')) {
      const url = request.nextUrl.clone();
      url.pathname = '/report';
      const rewritten = NextResponse.rewrite(url, { request });
      // Keep whatever the session refresh above wrote, or the new token is lost
      // — the cookies, and the no-store headers that must travel with them.
      response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
      for (const key of ['cache-control', 'expires', 'pragma']) {
        const value = response.headers.get(key);
        if (value) rewritten.headers.set(key, value);
      }
      return rewritten;
    }
  }

  return response;
}

/** `report.kool-man.com`, `report.localhost:3000` — any host whose first label is `report`. */
export function isReportHost(host: string | null): boolean {
  return (host ?? '').toLowerCase().startsWith('report.');
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (metadata file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
