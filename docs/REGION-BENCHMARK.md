# Vercel region benchmark — 2026-07-28

Why `vercel.json` pins `"regions": ["hnd1"]`, with measured numbers.

## Symptom

Production (`finnixpos.kool-man.com`) was reported as very slow. Pages took
seconds to load once signed in.

## Root cause

`vercel.json` did not set `regions`, so functions ran in Vercel's default
**`iad1` (US East, Virginia)** while the Supabase database is in
**`ap-northeast-1` (Tokyo)** and the users are in Thailand.

The giveaway is the `x-vercel-id` response header, whose form is
`<edge>::<function>::<id>`:

```
x-vercel-id: sin1::iad1::whzws-…     ← entered at the Singapore edge, EXECUTED in Virginia
```

Every auth and database call therefore crossed the Pacific twice. An
authenticated page load makes roughly **five sequential** round trips, so the
cost multiplies:

| #   | Round trip                                            | Where                            |
| --- | ----------------------------------------------------- | -------------------------------- |
| 1   | `auth.getUser()` — runs on **every** request          | `proxy.ts`                       |
| 2   | `auth.getUser()`                                      | `lib/auth/resolveSessionContext` |
| 3   | `app_users` lookup (needs the user id, so sequential) | same                             |
| 4   | `Promise.all([shops, role_permissions])`              | same                             |
| 5   | the page's own query batch                            | e.g. dashboard `Promise.all`     |

The application code is **not** at fault — those batches are already
parallelised with `Promise.all`, and step 3 genuinely depends on step 2. This
was purely geography.

## Method

A temporary probe route deployed to preview URLs pinned to one region at a time,
measuring from inside each region:

- **`tokyoRest`** — a real PostgREST query against the production database
  (`/rest/v1/shops?select=id&limit=1` with `Accept-Profile: pos`, using the
  public anon key so RLS returns an empty set). 1 warm-up + 7 samples, sequential.
  **This is the only number that matters** — see Caveats.

Regions tested: `sin1` Singapore, `hnd1` Tokyo, `icn1` Seoul, `hkg1` Hong Kong,
`bom1` Mumbai, and `iad1` US East for the "before" baseline.

## Results

Median round trip to the Tokyo database, measured from each function region. The
"×5" column models one authenticated page load using the five sequential trips
above.

| Function region              | DB round trip | ×5 per page | vs best |
| ---------------------------- | ------------- | ----------- | ------- |
| **`hnd1` Tokyo — in use**    | **23.5 ms**   | **~118 ms** | —       |
| `sin1` Singapore             | 90.3 ms       | ~452 ms     | 3.8×    |
| `hkg1` Hong Kong             | 102.4 ms      | ~512 ms     | 4.4×    |
| `icn1` Seoul                 | 127.2 ms      | ~636 ms     | 5.4×    |
| `bom1` Mumbai                | 430.3 ms      | ~2,150 ms   | 18×     |
| `iad1` US East — old default | 654.6 ms      | ~3,270 ms   | **28×** |

**`hnd1` wins by a wide margin**; nothing else is within 3.8×. Co-locating the
function with the database beats moving it closer to the users, because the DB
leg is paid ~5× per page while the user leg is paid once.

Fixing this took the database round trip from **654.6 ms to 23.5 ms** — about
**3.1 seconds** of dead network time removed from every authenticated page load.

## Should the database move to Singapore instead?

No. Measured from Thailand, the Tokyo and Singapore Supabase origins are only
~7 ms apart (42 ms vs 35 ms median). A `sin1` function with a Singapore database
would land within ~10 ms of the current setup, while requiring migration of a
live production database that the Koolman finance app also depends on. Not worth
it. The current configuration is at the optimum.

## Caveats — two measurements that looked fine and were worthless

Recorded because both are easy traps to fall into again.

1. **Unauthenticated "pings" never reach the database.** The probe also timed
   plain `GET /rest/v1/` (no API key) to Tokyo and Singapore. Every region
   returned ~10–20 ms, which is nonsense — those requests terminate at the
   Cloudflare edge sitting in front of Supabase and never travel to the origin.
   The same trap appears when measuring from a laptop: `curl`'s `time_connect`
   to `<ref>.supabase.co` reports ~21 ms from Thailand for _both_ Tokyo and
   Singapore, for the same reason. Only a request that must be served by
   PostgREST (i.e. authenticated with the anon key) measures the real distance.

2. **Per-region user-leg TTFB was unusable.** Each region's numbers came from a
   freshly created preview deployment, so every measurement included a cold
   start (0.94–1.5 s, with no sensible ordering). Comparing user legs would need
   warmed deployments.

Also note unauthenticated requests to the app itself cannot reveal this problem
at all: with no session cookie, `auth.getUser()` returns locally without any
network call, so `/login` looks fine while signed-in pages crawl.

## Reproducing

1. Add a route under `app/api/<name>/route.ts` with `export const dynamic = 'force-dynamic'`
   that times the `tokyoRest` fetch above and returns `process.env.VERCEL_REGION`.
   **Do not name the folder with a leading underscore** — `app/api/_latency/` is a
   _private folder_ in the App Router and is excluded from routing, so it 404s.
2. Allow the path in `proxy.ts`'s `isPublicPath`, or the probe is redirected to
   `/login`.
3. For each region: set `regions` in `vercel.json`, `vercel deploy` (preview —
   **never** `--prod`), then curl the probe.
4. Preview URLs are behind Vercel Authentication by default and return
   `302 → vercel.com/sso-api`. Disabling it is an account setting; **re-enable it
   immediately afterwards**.
5. Delete the preview deployments (`vercel remove <url> --yes`) and discard the
   probe. None of it belongs on `main`.
