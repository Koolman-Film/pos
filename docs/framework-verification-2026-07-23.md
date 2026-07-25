# Framework Verification Report

Verification date: 2026-07-23. Every claim below is backed by a fetched authoritative source (official docs via Context7 MCP, official Next.js/Tailwind docs, or the live npm registry). Nothing here is from training memory.

Snapshot of current versions found:

- **Next.js**: 16.2.x (docs page reports `version: 16.2.11`, `lastUpdated: 2026-03-03`; Context7 `/vercel/next.js` latest indexed v16.2.9). Next.js 16 GA was 2025-10-21.
- **React**: 19.2 (Next.js 16 App Router runs the React 19.2 canary line).
- **Tailwind CSS**: v4 (CSS-first) is what `create-next-app` installs.
- **@supabase/ssr**: current (getAll/setAll API).
- **react-chartjs-2**: 5.3.1 / **chart.js**: 4.5.1 (from npm registry, live).

---

## 1. create-next-app flags + scaffolded stack

**CLAIM:** `npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint` — flags still exist/work; and (implied) it produces a `tailwind.config.ts`.

**VERDICT:** Flags = CORRECT (all still valid). Scaffolded-stack assumptions = PARTIALLY OUTDATED.

**CORRECT CURRENT FORM:**

- All six flags exist and work in the current CLI. Per the official flag table:
  - `--typescript` / `--ts` ✔ (also the default)
  - `--tailwind` ✔ (default)
  - `--app` ✔
  - `--no-src-dir` ✔ — `src/` is NOT the default, so this flag is valid but redundant (it negates via the documented `--no-*` mechanism)
  - `--import-alias "@/*"` ✔ (default alias is `@/*`)
  - `--eslint` ✔ (ESLint is still an available/default linter; Biome is now also an option)
- The command will scaffold **Next.js 16.x + React 19.2 + Tailwind CSS v4**.
- **Turbopack is now the default bundler** (opt out with `--webpack`).
- The new default template also drops an `AGENTS.md`/`CLAUDE.md` (`--agents-md`, default on) and offers a React Compiler prompt (`--react-compiler`, off by default).
- **Tailwind is v4 CSS-first**: there is NO `tailwind.config.ts` by default. Config lives in `globals.css` via `@import "tailwindcss";` plus `@theme { ... }`. If the plan expects a generated `tailwind.config.ts`, that expectation is outdated (see item 4).
- Aside relevant to the plan: `next lint` was removed in Next 16; `next build` no longer runs linting.

**SOURCE:** https://nextjs.org/docs/app/api-reference/cli/create-next-app (version 16.2.11, updated 2026-03-03); https://nextjs.org/blog/next-16 (published 2025-10-21).

---

## 2. Async `cookies()` and Promise `params`/`searchParams`

**CLAIM:** `cookies()` from `next/headers` is async (`await cookies()` correct); `params`/`searchParams` page props are Promises.

**VERDICT:** CORRECT (and now mandatory, not just recommended).

**CORRECT CURRENT FORM:**

- `const cookieStore = await cookies()` is correct. Same for `await headers()` and `await draftMode()`.
- Page/layout props: `params: Promise<{ slug: string }>` and `searchParams` are Promises; resolve with `await`.
- In Next.js 16 the **synchronous** forms were **removed** (they were deprecated-with-warning in 15). So async is no longer optional — sync access of `params`/`searchParams`/`cookies()`/`headers()`/`draftMode()` breaks.
- Codemod available if needed: `npx @next/codemod@canary next-async-request-api`.

**SOURCE:** Context7 `/vercel/next.js/v16.2.9` — `docs/01-app/03-api-reference/03-file-conventions/page.mdx`, `docs/01-app/02-guides/upgrading/version-15.mdx`; and https://nextjs.org/blog/next-16 "Breaking Changes → Removals" (sync `params`/`searchParams` and sync `cookies()`/`headers()`/`draftMode()` now removed).

---

## 3. @supabase/ssr canonical code (browser / server / middleware)

**CLAIM:** getAll/setAll is the recommended cookie API (vs older get/set/remove); asking whether `createServerClient` signature changed.

**VERDICT:** getAll/setAll = CORRECT / still current. Individual `get`/`set`/`remove` = OUTDATED (deprecated; providing only `getAll` without `setAll` now errors for browser client and warns for server client). `createServerClient` core signature = UNCHANGED, but there is a NEW optional second argument to `setAll` (`headers`) and a Next.js-16 file-name change (`middleware.ts` → `proxy.ts`).

**CORRECT CURRENT FORM:**

(a) Browser client — `utils/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Signature (current): `createBrowserClient<Database>(supabaseUrl, supabaseKey, options?)` where `options` may include `cookies`, `cookieOptions`, `cookieEncoding: 'raw' | 'base64url'`, `isSingleton`. Passing a cookie handler requires BOTH `getAll` and `setAll` — supplying only `getAll` (or deprecated `get`/`remove`) throws.

(b) Server client used in Server Components / Server Actions / Route Handlers — `utils/supabase/server.ts` (note `await cookies()`):

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore when
            // middleware/proxy is refreshing the session.
          }
        },
      },
    },
  );
}
```

The `try/catch` is the canonical Server-Component guard (Server Components cannot write cookies). If you omit `setAll` entirely on a server client, the library no longer throws — it installs a warning stub advising you to check middleware/route-handlers/server-actions.

(c) Session-refresh middleware. IMPORTANT Next.js 16 change: `middleware.ts` is deprecated and renamed to **`proxy.ts`** (exported function `proxy`, runs on Node.js runtime). `middleware.ts` still works for now but is deprecated. The Supabase pattern itself is unchanged except cookie plumbing:

```ts
// proxy.ts  (formerly middleware.ts)
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // NOTE the SECOND arg `headers` — new in current @supabase/ssr
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Refresh the session — use getUser(), do not trust getSession() alone in middleware
  await supabase.auth.getUser();
  return response;
}
```

**What changed vs older (pre-cutoff) knowledge:**

- `getAll`/`setAll` remain THE recommended API; the older per-cookie `get`/`set`/`remove` are deprecated.
- `setAll` now takes an optional **second `headers` argument**. When auth cookies are written, the library passes `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache`. Applying these to the response prevents a CDN/reverse-proxy from caching one user's session token and serving it to another user — a real security fix. Older middleware snippets that implement `setAll(cookiesToSet)` (one arg) still compile but skip this hardening.
- `createServerClient(url, key, { cookies, cookieOptions?, cookieEncoding? })` core signature unchanged; default `cookieEncoding` is `base64url`.
- Framework-level rename: middleware → `proxy.ts` in Next.js 16.

**SOURCE:** Context7 `/supabase/ssr` — `src/types.ts` (`SetAllCookies` type with `headers` arg + JSDoc), `src/cookies.ts` (Server-Component warning stub), `src/createServerClient.ts`, `src/createBrowserClient.ts`, `_autodocs/api-reference-createServerClient.md`, `_autodocs/configuration.md`, `_autodocs/errors.md`. Next.js proxy rename: https://nextjs.org/blog/next-16.

---

## 4. Tailwind v4 custom variables + custom utility classes

**CLAIM:** how to define CSS variables + custom utilities like `.card` / `.btn-primary`; does `@tailwind base; @tailwind components; @tailwind utilities;` still work or must it be `@import "tailwindcss";`; do `:root {}` custom props still work.

**VERDICT:** If the plan uses the three `@tailwind` directives + a JS/TS config = OUTDATED for v4. `:root {}` custom properties = UNCHANGED (still work as before).

**CORRECT CURRENT FORM (Tailwind v4, CSS-first):**

- Entry: **`@import "tailwindcss";`** at the top of `globals.css`. The v3 trio `@tailwind base; @tailwind components; @tailwind utilities;` is replaced and not used in v4.
- Design tokens that should generate utilities go in **`@theme`**:
  ```css
  @import 'tailwindcss';

  @theme {
    --color-brand-500: oklch(0.84 0.18 117.33);
    --radius-lg: 0.75rem;
    --font-display: 'Satoshi', sans-serif;
  }
  ```
- Plain CSS custom properties that should NOT generate utilities: keep them in `:root {}` exactly as before — unchanged:
  ```css
  :root {
    --page-gutter: 1.5rem;
  }
  ```
- Component-style classes (`.card`, `.btn-primary`) via `@layer components` (utilities can still override them):
  ```css
  @layer components {
    .card {
      background-color: var(--color-white);
      border-radius: var(--radius-lg);
      padding: --spacing(6);
      box-shadow: var(--shadow-xl);
    }
    .btn-primary {
      background-color: var(--color-brand-500);
      color: white;
    }
  }
  ```
- Reusable single-purpose utilities via the new `@utility` directive (variant-aware):
  ```css
  @utility content-auto {
    content-visibility: auto;
  }
  ```
- No `tailwind.config.js/ts` is required (and `create-next-app` does not generate one). A JS config can still be opted into via `@config`, but the default/idiomatic path is CSS-first.

**SOURCE:** https://tailwindcss.com/docs/adding-custom-styles (v4 — `@import "tailwindcss"`, `@layer components`, `@utility`, `@theme`); https://tailwindcss.com/docs/theme (`@theme` vs `:root` guidance).

---

## 5. react-chartjs-2 + chart.js — React 19 compatibility

**CLAIM:** react-chartjs-2 + chart.js current/maintained and React 19 compatible; concern about peer-dependency issues with React 19.

**VERDICT:** OUTDATED concern — the React 19 peer-dep problem is FIXED. No peer issues now.

**CORRECT CURRENT FORM (from live npm registry, 2026-07-23):**

- `react-chartjs-2@5.3.1` — `peerDependencies`: `react: "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"` and `chart.js: "^4.1.1"`. React 19 is now explicitly in range, so `npm install` produces no peer warning and needs no `--legacy-peer-deps`.
- `chart.js@4.5.1` — current.
- Both are maintained and compatible with React 19 / Next.js 16. (The old `^16 || ^17 || ^18` range that excluded React 19, and the corresponding GitHub issue, are resolved in 5.3.x.)

**SOURCE:** `https://registry.npmjs.org/react-chartjs-2/latest` and `https://registry.npmjs.org/chart.js/latest` (fetched live 2026-07-23).

---

## 6. Vitest + React Testing Library with React 19

**CLAIM:** any setup gotchas (e.g. which `@testing-library/react` version is needed for React 19).

**VERDICT:** CORRECT that there's a version gotcha — you need a React-19-capable `@testing-library/react` (v16+). Otherwise setup is standard.

**CORRECT CURRENT FORM:**

- Install: `vitest`, `@testing-library/react` (**v16+ is the React 19-compatible line**; v15 and earlier target React 18), `@testing-library/dom` (peer of RTL 16, install explicitly), `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom` (or `happy-dom`).
- `vitest.config.ts`: `test.environment: 'jsdom'`, `globals: true`, `setupFiles: './test/setup.ts'`. Use the `@vitejs/plugin-react` (or SWC) plugin.
- Setup file: `import '@testing-library/jest-dom/vitest'` and run `cleanup()` after each test (`afterEach(cleanup)`) if `globals`/auto-cleanup is not configured.
- Main React-19 gotcha is purely the RTL major version (must be 16+); with that in place there are no special React-19-only workarounds needed for typical component tests.

**SOURCE:** Web search across 2026 Vitest + RTL + React 19 setup guides (LogRocket / DEV / johal.in "React 19 Unit Tests: Vitest & Testing Library"), corroborating `@testing-library/react` v16 as the React 19 requirement. (Note: item 6 is the one relying on aggregated guides rather than a single canonical doc page; the RTL-v16-for-React-19 requirement is well established and consistent across sources.)

---

## Summary of outdated claims

| #   | Item                        | Status                                 | Most important correction                                                                                 |
| --- | --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | create-next-app flags/stack | Flags OK; stack assumption outdated    | Scaffolds Next 16 + React 19 + **Tailwind v4 (no `tailwind.config.ts`)**, Turbopack default               |
| 2   | async cookies/params        | Correct                                | Now **mandatory** in Next 16 (sync removed)                                                               |
| 3   | @supabase/ssr               | getAll/setAll correct; details changed | `setAll` gains a 2nd `headers` arg (cache-control security); Next 16 renames `middleware.ts` → `proxy.ts` |
| 4   | Tailwind v4 CSS             | `@tailwind` directives outdated        | Use `@import "tailwindcss";` + `@theme`/`@layer components`/`@utility`; `:root {}` unchanged              |
| 5   | react-chartjs-2 + chart.js  | Concern outdated (fixed)               | 5.3.1 peer deps include `react ^19`; no peer issue                                                        |
| 6   | Vitest + RTL React 19       | Correct (version gotcha)               | Need `@testing-library/react` **v16+** for React 19                                                       |
