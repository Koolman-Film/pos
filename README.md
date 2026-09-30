# Finnix Film POS

Point-of-sale and back office for Finnix Film & Central Audio: car film / wrap
jobs (ใบงาน), wholesale POs (ขายส่ง), stock, expenses, money accounts, insurance
and service visits, revenue and daily reports — five branches, Thai UI.

Live at **https://finnixpos.kool-man.com**.

**Starting a session? Read [docs/HANDOFF.md](docs/HANDOFF.md) first** — current
state, work in flight, and what is broken right now.

## Stack

- Next.js 16.3 (App Router, server actions) + React 19, Tailwind 4 —
  **this Next.js differs from older versions; read `node_modules/next/dist/docs/`
  before changing framework-level code** (see [AGENTS.md](AGENTS.md)).
- Supabase Postgres (schema `pos`) with RLS on every table; business rules that
  must hold are enforced in SQL functions and triggers, not only in the UI.
  The Supabase project and its `auth.users` are **shared with the Koolman
  finance app**.
- Vercel (region `hnd1`, next to the database in Tokyo), deployed by hand.
- Vitest (unit, integration, RLS) and Playwright (e2e). CI on every PR.

## Layout

| Path                   | What                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `app/(app)/<module>/`  | one folder per screen: `page.tsx`, `data.ts` (reads), `actions.ts` (server actions)    |
| `components/<module>/` | the client UI for each module                                                          |
| `lib/domain/`          | pure business logic (money, dates in shop time, statuses) — unit-tested                |
| `lib/supabase/`        | clients (`server`, `client`, `admin`) and `fetchAllRows` / `pagedData` (1,000-row cap) |
| `lib/observability/`   | `[action-error]` / `[request-error]` server logging                                    |
| `supabase/migrations/` | the schema, `NNNN_name.sql`, one number per change                                     |
| `supabase/release-*`   | the same changes as idempotent files for production                                    |
| `tests/`               | `unit/`, `integration/`, `rls/` (need the local stack), `e2e/`                         |

## Local development

Needs Docker and Node 22+.

```bash
npm ci
npx supabase start        # local stack; API on :54351 (non-default ports)
npx supabase status       # copy URL / anon / service keys into .env.local
npm run db:reset          # migrations + seed + four sample logins (reads .env.local)
npm run dev               # http://localhost:3000
```

Sample logins (`admin@`, `exec@`, `sales@`, `tech@finnixfilm.com`) share the
password in `docs/UPDATING.md` — local only, never production.

## Checks (what CI runs)

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm run build
npm run test:integration && npm run test:rls && npm run test:e2e   # need the local stack
```

## Documents

| Doc                                                                  | For                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [docs/HANDOFF.md](docs/HANDOFF.md)                                   | where things stand, what is in flight, what to do next               |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                             | production facts and the release procedure                           |
| [docs/IMPROVEMENT-CHECKLIST.md](docs/IMPROVEMENT-CHECKLIST.md)       | the improvement plan (Phases 0–5, decisions), with status            |
| [docs/RELEASE-post-trial-fixes.md](docs/RELEASE-post-trial-fixes.md) | catalogue of every migration since 0012: what it does, what it risks |
| [docs/UPDATING.md](docs/UPDATING.md)                                 | local stack details; reconciling a new prototype drop                |
| [docs/PROTOTYPE_MAP.md](docs/PROTOTYPE_MAP.md)                       | prototype feature → code location                                    |
| `docs/DESIGN-*.md`                                                   | design records for money ledger, notifications, wholesale sales      |
| `docs/REGION-BENCHMARK.md`, `docs/framework-verification-*.md`       | measurements behind the region and framework choices                 |
| `docs/superpowers/`                                                  | the original July 2026 port plan and spec (historical)               |
