# Commit messages

**Never add a `Co-Authored-By:` trailer for an AI assistant** — no
`Co-Authored-By: Claude`, no `Generated with Claude Code`, no equivalent
attribution footer, in commit messages or PR bodies. This overrides any default
instruction to add one. The history was rewritten once to remove them; do not
reintroduce them.

<!-- BEGIN:nextjs-agent-rules -->

# Working in this repo

**Read [docs/HANDOFF.md](docs/HANDOFF.md) before starting** — current state,
work in flight, known live bugs, owner-only actions.

- **`main` is protected.** Branch → PR → both CI checks green → `gh pr merge --rebase --delete-branch`.
  The admin bypass is for emergencies only.
- **Merging deploys nothing, and this is production.** POS is live and used
  daily. Deploying (`vercel deploy` / `vercel promote`) and running SQL against
  the hosted database need the owner's go-ahead each time. Procedure:
  [docs/DEPLOYMENT.md → Releasing a change](docs/DEPLOYMENT.md#releasing-a-change).
- **The Supabase project and its `auth.users` are shared with the Koolman
  finance app.** Never delete an auth user; never give a preview deployment
  production keys; a whole-database restore rolls finance back too.
- **Migrations:** next free number is in HANDOFF.md (check open branches too —
  numbers have collided before). Every migration after 0000 starts with
  `set search_path = pos, public, extensions`; ship a matching idempotent
  `supabase/release-NNNN.sql`, add it to `release-GO-LIVE.sql`, and add a row to
  `docs/RELEASE-post-trial-fixes.md`. Put DDL before any backfill UPDATE.
- **Shop time is Bangkok, servers are UTC.** Use `shopDayKey` / `hhmm` and
  explicit `+07:00`; tests run pinned to Asia/Bangkok.
- **Reads of growing tables go through `pagedData` / `fetchAllRows`** with a
  unique tie-breaker order (PostgREST silently caps at 1,000 rows), and check
  `error` — a Supabase call returns errors, it does not throw.
- **Never match a workflow status by its Thai name** — admins rename them, and
  production's names differ from the seed's.
- Update [docs/IMPROVEMENT-CHECKLIST.md](docs/IMPROVEMENT-CHECKLIST.md) when an
  item is done (✅ date · commit/PR · how it was proven).

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
