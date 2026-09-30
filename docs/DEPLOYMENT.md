# Deployment and releases

**Status 2026-09-30:** POS is live at **https://finnixpos.kool-man.com**, used
daily by five branches. Production runs `main` at `6c9c8a8` (Vercel deployment
`pos-1cd367gec`, promoted 2026-09-28) on a database with every migration through
**0076** applied. Current work in flight and open problems:
[HANDOFF.md](./HANDOFF.md).

| Piece    | Where                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| App      | Vercel project `pos`, team `vivatchais-projects`; functions pinned to `hnd1` (Tokyo)                                |
| Domain   | `finnixpos.kool-man.com` (DNS at Cloudflare, owner's account)                                                       |
| Database | Supabase project `koolman-finance` (`ykkfxpjjhwwthgmppvgv`, `ap-northeast-1`), schema `pos` — **shared, see below** |
| Code     | `github.com/Koolman-Film/pos`, `main` protected (PR + both CI checks)                                               |

## Releasing a change

This is the procedure every release since 0053 has used. It exists because two
shortcuts don't work: **Vercel is not connected to git** (merging ships nothing),
and **`supabase db push` fails** (the stored database password is stale).

### 0. Before

- The change is merged to `main` through a PR, and CI on `main` is green
  (`gh run list --branch main --limit 1`).
- Every migration has a matching `supabase/release-NNNN.sql` (same objects,
  idempotent, ends by stamping `NNNN` into `supabase_migrations.schema_migrations`),
  and `supabase/release-GO-LIVE.sql` includes it.
- **Reproduce any backfill against data shaped like production.** Local
  `db reset` and CI build the schema before seeding, so a backfill that only
  fails on real rows passes every test (release 0068 did exactly that — see
  [Hard-won lessons](#hard-won-lessons)).
- For a risky data change, snapshot the POS schema first:
  `create schema pos_backup_YYYYMMDD` + `create table … as table pos.…` for the
  affected tables. Supabase's daily backup restores the **whole** database,
  which would roll the finance app back too. Drop the snapshot about a week later.

### 1. Build without going live

```bash
vercel link --project pos --scope vivatchais-projects --yes   # once; .vercel is gitignored
git switch main && git pull && git status                     # must be clean: Vercel uploads the working tree
vercel deploy --prod --skip-domain --yes
```

`--skip-domain` builds a production deployment without moving
`finnixpos.kool-man.com`, so the new code does not meet the old schema (or the
reverse) while SQL is being applied. The first attempt once failed with no
detail; a plain retry worked.

### 2. Apply the SQL

One `release-NNNN.sql` per call through the Supabase MCP `execute_sql`, in
number order, so a failure rolls back just that file. (The Dashboard SQL Editor
also works — it runs a pasted file as one transaction.) The MCP can also create
`storage.objects` policies, which the SQL Editor cannot.

### 3. Verify the database

- **Fingerprint:** run [`supabase/snippets/fingerprint.sql`](../supabase/snippets/fingerprint.sql)
  on production and on a local DB built with `npm run db:reset`. Every category
  except `rp` (permission data admins edit) must match. On 2026-09-30 all six
  schema categories matched.
- **Behaviour, as a real role, rolled back:** in one `do $$ … $$` block,
  `perform set_config('request.jwt.claims', '{"sub":"<user uuid>","role":"authenticated"}', true);`
  then `set local role authenticated;`, exercise the change, and **end with
  `raise exception 'rollback'`** so it can never commit.
- `get_advisors` (security) — nothing new compared with before the release.

### 4. Go live and check

```bash
vercel promote <deployment-url> --yes      # ~2 s
vercel alias ls | grep finnixpos           # points at the new deployment
curl -sI https://finnixpos.kool-man.com/login | head -1
```

Then check the Vercel runtime errors for the project (MCP `get_runtime_errors`,
or search the logs for `[request-error]` / `[action-error]`), and open a page the
release touched.

**Rollback:** `vercel promote <previous-deployment-url>` puts the old code back
in seconds. SQL has no automatic rollback — which is why each release file is
applied and verified on its own.

## Hard-won lessons

- **Deferred triggers + DDL (55006).** Since 0061, `ticket_items`,
  `ticket_payments`, `order_*`, `service_visit_points`, `insurance_claims`,
  `option_lists` and `user_shop_access` carry deferred `activity_log_lines`
  triggers. A release that UPDATEs rows there and then runs `CREATE INDEX` /
  `ALTER TABLE` on the same table in one transaction fails — **only when the
  UPDATE touched rows**. Put DDL before the backfill.
- **Never match a workflow status by name.** Production closes POs as
  `เสร็จสิ้น`, not the seed's `ปิดงานแล้ว`; admins can rename statuses.
- **Dropping a column:** grep the whole repo for it first. 0073 dropped
  `tickets.finnix_doc_no` while the revenue report still selected it; PostgREST
  returned an error the code ignored, and retail revenue showed as nothing for
  six hours (checklist 1.4).
- **Every migration after 0000 must start with `set search_path = pos, public, extensions`.**
  The Supabase CLI sends `seed.sql` on the search path the last migration left
  (a unit test enforces this).
- **Time zone.** Vercel runs in UTC, the shop in Bangkok. Use `shopDayKey` /
  `hhmm` (`lib/domain`) and an explicit `+07:00`, never local getters or
  `toISOString().slice(0, 10)` for a shop date.

## Shared project with the Koolman finance app — read before touching users

POS does **not** have its own Supabase project. It shares one project with the
Koolman finance app: `pos` and finance's `public` are two schemas in the **same**
database, which means **one `auth.users` table serves both apps**. As of
2026-07-27 all 11 POS users are also finance users — the same login.

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
- Supabase's security advisor lists finance's `public` tables and the
  `pos_backup_*` snapshots alongside `pos`; only `pos` findings are ours.
- **Preview deployments must never get production keys** — a preview would be
  writing to the finance app's database (Decision D6).

## Environment variables (Vercel)

| Variable                        | Notes                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | production project URL                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production anon key                                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | **required**, server-only (never `NEXT_PUBLIC_*`) — used by `lib/supabase/admin.ts` for user provisioning, behind admin `authorize()` |

`.vercelignore` keeps `.env*`, `/supabase/`, `/tests/`, `/docs/` and local
tooling out of the upload. Every pattern there is anchored with a leading `/` —
an unanchored `supabase/` once excluded `lib/supabase/` and broke the build.

## Auth settings for the invite path

Hosted Supabase project → **Authentication → URL Configuration**:

- **Site URL**: `https://finnixpos.kool-man.com`. Shared with finance — changing
  it affects both apps.
- **Redirect URLs** must include `https://finnixpos.kool-man.com/auth/callback**`.
  Supabase silently **discards** a `redirectTo` that is not on this allow-list and
  falls back to the Site URL — the invite email still arrives but drops the
  invitee on the site root instead of the set-password page.
- **SMTP** (Authentication → Emails) is needed only for the genuinely-new-person
  path. Supabase's built-in sender is rate-limited to a handful of emails per
  hour; linking an existing Koolman account is unaffected. Local dev captures
  mail in Mailpit.
- Open (advisor, 2026-09-28): leaked-password protection is off, and the
  password minimum is enforced only in the browser (checklist 2.11).

## Function region must stay in Tokyo (`hnd1`)

`vercel.json` pins `"regions": ["hnd1"]`. Without it Vercel defaults to `iad1`
(US East) while Supabase is in `ap-northeast-1` (Tokyo), so every auth/DB call
crosses the Pacific twice — and an authenticated page load makes roughly five
_sequential_ round trips (`proxy.ts`'s `getUser` on every request, then
`resolveSessionContext`'s `getUser` → `app_users` → `shops`/`role_permissions`,
then the page's own batch). Diagnose the region from the `x-vercel-id` header,
which reads `<edge>::<function>::<id>`.

Measured round trip to the database from each candidate region (full method,
results and caveats in [REGION-BENCHMARK.md](./REGION-BENCHMARK.md)):

| Function region              | DB round trip | ×5 per page |
| ---------------------------- | ------------- | ----------- |
| **`hnd1` Tokyo — in use**    | **23.5 ms**   | **~118 ms** |
| `sin1` Singapore             | 90.3 ms       | ~452 ms     |
| `hkg1` Hong Kong             | 102.4 ms      | ~512 ms     |
| `icn1` Seoul                 | 127.2 ms      | ~636 ms     |
| `bom1` Mumbai                | 430.3 ms      | ~2,150 ms   |
| `iad1` US East — old default | 654.6 ms      | ~3,270 ms   |

Tokyo beats Singapore even though the users are in Thailand: the DB leg is paid
~5x per page while the user leg is paid once, and from Thailand the two Supabase
regions are only ~7 ms apart anyway. The Koolman finance app pins `hnd1` for the
same reason and shares this database. Moving the database to Singapore would gain
~10 ms and require migrating a live DB the finance app depends on — don't.

## Known gaps on paper

- The wrap (ฟิล์มกันรอย) QC checklist on the print sheet renders labelled
  placeholder boxes instead of the prototype's three inline base64 car diagrams
  (~600 KB of client bundle). Re-add them as `/public` assets when wanted.
- The first launch (summer 2026) followed the plan in
  `docs/superpowers/plans/2026-07-23-finnix-film-port.md`, Task 22. A separate
  staging project was planned there but never created; see Decision D6.
