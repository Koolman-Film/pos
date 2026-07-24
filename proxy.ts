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
    }
  );

  // Must run before the response is produced, otherwise a refresh that lands
  // after the response is committed is lost.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
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
