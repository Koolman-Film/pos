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
| `SUPABASE_SERVICE_ROLE_KEY`     | staging service key | **required** (user provisioning)     |

The service-role key bypasses RLS entirely, so keep it server-only and never
expose it as `NEXT_PUBLIC_*`. It **is** now required in production: creating a
login is an Auth Admin API call (`inviteUserByEmail`), which the RLS-bound
client cannot make. It is read by `lib/supabase/admin.ts`, used by the
`addUser` / `resendInvite` / `deleteUser` actions in
`app/(app)/permissions/actions.ts` (all gated admin-only behind `authorize()`),
plus `supabase/seed.ts` and the e2e helper.

### Shared project with the Koolman finance app — read before touching users

POS does **not** have its own Supabase project. It shares one project with the
Koolman finance app: `pos` (31 tables) and finance's `public` (15 tables) are two
schemas in the **same** database, which means **one `auth.users` table serves both
apps**. As of 2026-07-27 all 11 POS users are also finance users — the same login.

Consequences that are easy to get wrong:

- **Never call `auth.admin.deleteUser` to remove someone from POS.** That destroys
  the shared login and locks them out of the finance app too. Removing POS access
  means deleting only the `pos.app_users` row (it cascades to `user_shop_access`).
  `deleteUser` in `app/(app)/permissions/actions.ts` does exactly this.
- **Adding a user usually sends no email.** Most new POS users already have a
  Koolman login, so `addUser` links their existing `auth.users` id to a new
  `pos.app_users` profile and they sign in with their current password.
  `inviteUserByEmail` is used only for someone with no Koolman account at all.
- Finance's `public.users` has **no** FK to `auth.users`, so deleting an auth user
  orphans their finance profile rather than cleaning it up.

### Auth settings for the invite path

Hosted Supabase project → **Authentication → URL Configuration**:

- **Site URL**: the deployed origin (e.g. `https://finnixpos.kool-man.com`).
  Note this is shared with finance — changing it affects both apps.
- **Redirect URLs** must include `https://<pos-domain>/auth/callback**`.
  Supabase silently **discards** a `redirectTo` that is not on this allow-list and
  falls back to the Site URL — the invite email still arrives but drops the
  invitee on the site root instead of the set-password page. Verified locally:
  before allow-listing, `redirect_to` came back as the bare origin.
- **SMTP** (Authentication → Emails) is needed only for the genuinely-new-person
  path. If the project is still on Supabase's built-in sender it is rate-limited
  to a handful of emails per hour and is not suitable for production; linking an
  existing Koolman account is unaffected either way. Local dev captures mail in
  Mailpit.

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
- [ ] Auth redirect URLs also include `https://<domain>/auth/callback**` (invite flow)
- [ ] SMTP configured **if** you need to invite people with no Koolman login
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set (server-only) — required for user provisioning
- [ ] Nothing in POS calls `auth.admin.deleteUser` — the login is shared with finance

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
