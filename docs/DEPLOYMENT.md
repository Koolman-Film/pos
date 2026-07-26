# Deployment runbook (plan Task 22)

**Nothing in this file has been executed.** Every step creates real billed cloud
resources, publishes publicly, or needs an account only you can log into, so the
whole of Task 22 is gated on your explicit go-ahead — that gate holds even under
"full auto", by your own earlier decision.

Tasks 1-21 are complete: the app runs end to end against a real Postgres with RLS
enforced, and the full suite is green (see [Readiness](#readiness) below).

## What is left, in order

Design spec §4 calls for **two** hosted Supabase projects — staging and
production — so a mistake on staging can never touch real shop data.

### 1. Staging Supabase project

```bash
# Create the project in the Supabase dashboard (or via MCP), then:
npx supabase link --project-ref <staging-ref>
npx supabase db push                 # applies migrations 0001-0008
psql "<staging-connection-string>" -f supabase/seed.sql
SUPABASE_SERVICE_ROLE_KEY=<staging-service-key> \
  NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co \
  npx tsx supabase/seed.ts           # the four sample logins
npx supabase gen types typescript --linked > lib/types/database.ts
```

Then point `.env.local` at staging and smoke-test locally before going further.
`git diff lib/types/database.ts` should be empty — a non-empty diff means the
hosted schema and the local one disagree, and that is worth stopping for.

### 2. Production Supabase project

Same migrations, **no seed** — production starts with an empty schema and no
users. In particular do NOT run `supabase/seed.ts` against it: it would create
four accounts sharing the publicly-known password `finnix-staging-2026`.

Create the real users through the Supabase dashboard (or an invite flow), then
insert their `app_users` + `user_shop_access` rows. Every real user needs an
`app_users` row: `lib/auth/session.ts` treats a missing profile as "no access"
and bounces them to login with `no_profile`.

### 3. Vercel

Link the project, then set environment variables per environment:

| Variable                        | Preview / staging   | Production                           |
| ------------------------------- | ------------------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | staging project URL | production project URL               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key    | production anon key                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | staging service key | **only if a server action needs it** |

The service-role key bypasses RLS entirely. Today nothing in `app/` or `lib/`
imports it — it is used only by `supabase/seed.ts` and the e2e helper, neither of
which runs on Vercel. Prefer not setting it in production at all; if a future
feature needs it, keep it server-only and never expose it as `NEXT_PUBLIC_*`.

### 4. Domain and DNS

Add the custom domain in the Vercel project, then create the record Vercel shows
you in Cloudflare. Registration and DNS are **your** actions on your own account
(spec §4) — the exact record type and value come from Vercel's domain screen once
the domain is added.

## Pre-flight checklist

- [ ] `npm test` green — runs everything below in order
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm run format:check` clean
- [ ] `npm run build` succeeds
- [ ] `npm run test:unit` green
- [ ] `npm run test:integration` green (needs a stack with the migrations applied)
- [ ] `npm run test:rls` green (same)
- [ ] `npm run test:e2e` green (needs the seed and a dev/prod server)
- [ ] `npm run test:e2e:visual` green — reseeds first, since the screenshot
      baselines were captured on pristine seed data
- [ ] `lib/types/database.ts` regenerated from the hosted project and diff-clean
- [ ] Production Supabase has **no** seeded sample data and no shared password
- [ ] Auth redirect URLs in the hosted projects include the Vercel domains
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is absent from production unless deliberately needed

## Readiness

As of the last local run on this branch:

| Check                      | Result                      |
| -------------------------- | --------------------------- |
| `tsc --noEmit`             | clean                       |
| `eslint .`                 | clean, 0 errors, 0 warnings |
| `next build`               | succeeds, 13 routes         |
| Unit + RLS (`vitest run`)  | 33 files, 170 tests pass    |
| e2e (`playwright test`)    | 6 specs pass                |
| Routes render for an admin | all 10, no console errors   |

Known items deliberately not done, both recorded in the EXECUTION file:

- The wrap (ฟิล์มกันรอย) QC checklist on the print sheet renders labelled
  placeholder boxes instead of the prototype's three inline base64 car diagrams,
  which would have added ~600KB to the client bundle. Re-add them as `/public`
  assets when you want them on paper.
- `price_matrix`, `film_price_matrix` and `corporate_buyers` ship empty, matching
  the prototype, and are filled in through the app.
