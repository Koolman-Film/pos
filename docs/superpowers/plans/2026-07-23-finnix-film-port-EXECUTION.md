# Finnix Film Port — Execution Schedule (wave-batched)

> **Companion to `2026-07-23-finnix-film-port.md`.** That file stays the source of truth for *what* each task does (steps, code, tests). This file overrides the *order and batching* only. Where the two disagree on sequencing or on how many times to run `supabase db reset`, **this file wins**.

**Why this exists:** the plan's 22 tasks were written in a readable narrative order, and executing them in that literal order is serial — but the declared `Interfaces:` blocks show most tasks don't depend on their predecessor. This schedule groups them into waves. Critical path drops from **22 serial tasks to 6 waves**.

---

## Wave map

```
Wave 0  Task 1                                     [DONE - commit 4dfbaa0]
          |
Wave 1  Track A: Tasks 2,3,4,5,6 -> reset -> 7     ) all four tracks
        Track B: Task 10  (pure fns, zero deps)    ) run
        Track C: Task 8   (supabase clients)       ) concurrently
        Track D: Task 11  (UI kit, props-only)     )
          |
Wave 2  Task 9 (auth)                              serial, short
          |
Wave 3  Task 12 (layout shell)                     <- SHARED MERGE POINT, serial
          |
Wave 4  Tasks 13,14,15,16,17,18,19                 <- 7 concurrent tracks
          |
Wave 5  Task 20 -> Task 21 -> Task 22              serial, ends at STOP checkpoint
```

---

## Wave 1 — foundation (3 concurrent tracks)

### Track A — database (internally batched)

The plan runs `npx supabase db reset` in Tasks 2, 3, 4, 5, 6 **and** 7 — six full resets, each followed by a separate `vitest run`. The migrations are independent table groups; nothing in 0002–0006 reads a table from another. Collapse to **two** resets:

1. **Author migrations `0001`–`0006` first, applying nothing.** Tasks 2, 3, 4, 5, 6 Step-1/Step-2 SQL only. These may be written concurrently — disjoint files, no cross-references.
   - Skip: Task 2 Step 4, Task 3 Step 2, Task 4 Step 2, Task 5 Step 2, Task 6 Step 2 (the per-task `db reset`).
2. **`npx supabase init && npx supabase start` once**, then **one `npx supabase db reset`** to apply 0001–0006 together.
3. **One batched test run** covering all five schema tests instead of five separate invocations:
   ```bash
   npx vitest run tests/rls/identity.test.ts tests/rls/config_lists.test.ts tests/rls/tickets_schema.test.ts tests/rls/wholesale_schema.test.ts tests/rls/ops_schema.test.ts
   ```
4. **Then Task 7** (RLS policies) in full — it genuinely needs every table to exist. Second and final reset here.
5. **Generate `lib/types/database.ts` at the end of Track A**, once, via `supabase gen types typescript`. Do **not** regenerate it per module in Wave 4 — that file is a Wave-4 write conflict if seven agents touch it.

Commits: keep the plan's per-task commit messages, made in sequence after the batched verification passes.

### Track B — Task 10, pure domain functions

`Interfaces:` declares this consumes **nothing** — `fmt`, `fmtThaiDate`, `thaiBahtText`, `daysFromNow`, `itemNetPrice`, `ticketTotal`, `ticketPaid`, `orderTotal`, `orderPaid` are behavior-for-behavior ports out of `reference/v0.4/finnix-film.html`. No DB, no auth, no scaffold beyond Task 1. It is pure TypeScript + Vitest and blocks Tasks 13, 14, 15 downstream, so starting it in Wave 1 takes it off the critical path entirely.

### Track C — Task 8, Supabase client helpers

Depends only on Task 1. Produces `lib/supabase/{client,server}.ts` and root `proxy.ts`. Note the Next-16 specifics already flagged in Global Constraints: `proxy.ts` not `middleware.ts`, `getAll`/`setAll` only, `setAll`'s second `headers` argument applied to the response.

### Track D — Task 11, shared UI kit

Reads as a Wave 2 task but isn't. Every component in it takes its data **as props** — `ManagedDropdown(props: { options: string[]; setOptions: ... })`, `Badge(props: { statuses: StatusConfig[] })`, and so on. Nothing imports a Supabase client or reads `option_lists`/`statuses` directly; the config tables are wired in by the *module* that renders these, in Wave 4. So the kit depends only on Task 1's jsdom Vitest env and can be built in Wave 1 alongside the rest.

**Wave 1 conflict check:** Track A writes `supabase/**` + `tests/rls/**`, Track B writes `lib/domain/**` + `tests/unit/domain/**`, Track C writes `lib/supabase/**` + `proxy.ts`, Track D writes `components/ui/**` + `tests/unit/components/ui/**`. Disjoint — safe to run concurrently in one working tree.

---

## Wave 2 — Task 9 (auth)

Unblocked once Track A (`app_users`, `role_permissions`) and Track C (server client) land. Produces `getSessionContext()`, which Wave 3 and every Wave 4 module consume. Writes `app/login/**` + `lib/auth/**`.

---

## Wave 3 — Task 12, the shared merge point (SERIAL — do not parallelize)

This is the one task that must run alone, because it owns every file the Wave 4 modules would otherwise contend over.

**Task 12 must, before Wave 4 starts, pre-register ALL of the following** — even for modules not yet built:

- **All seven nav entries** in `components/layout/Sidebar.tsx`, each already gated by `session.hasNav(key)`. A module that isn't built yet simply renders a route that 404s until its Wave 4 track lands — that is fine and is the point.
- **The `(app)` route group layout** `app/(app)/layout.tsx`, including the `className="app-shell"` on the outermost `<div>` that the print CSS from Task 1 depends on.
- **The root-route redirect** (per commit `faa58a2`).

Getting this right is what makes Wave 4 safe. If Wave 4 agents each had to add their own sidebar entry, all seven would edit `Sidebar.tsx` and collide.

---

## Wave 4 — feature modules (7 concurrent tracks)

Tasks **13, 14, 15, 16, 17, 18, 19**. Every one of them consumes only Tasks 9/10/11/12 plus its own DB tables. **None consumes another.** This is the widest band in the plan and the largest single win available.

Ownership map — each track writes only inside its own paths:

| Task | Owns |
|---|---|
| 13 Dashboard | `components/charts/**`, `components/dashboard/**`, `app/(app)/dashboard/**` |
| 14 Tickets | `components/tickets/**`, `app/(app)/tickets/**` |
| 15 Wholesale | `components/wholesale/**`, `app/(app)/wholesale/**` |
| 16 Stock | `components/stock/**`, `app/(app)/stock/**` |
| 17 Commission | `components/commission/**`, `app/(app)/commission/**` |
| 18 Accounting | `components/accounting/**`, `app/(app)/accounting/**` |
| 19 Permissions | `components/permissions/**`, `app/(app)/permissions/**` |

**Hard rules for every Wave 4 track — these preserve the disjointness:**

1. **Do not edit `components/layout/Sidebar.tsx` or `app/(app)/layout.tsx`.** Wave 3 already registered your nav entry. If something is missing there, stop and report it rather than editing — a concurrent track is reading that file.
2. **Do not edit `lib/types/database.ts`.** Generated once in Wave 1 Track A.
3. **Do not add dependencies / edit `package.json`.** Everything needed (`chart.js`, `react-chartjs-2`, `xlsx`, …) was installed in Task 1 Step 2. A new dep means seven concurrent `package-lock.json` rewrites.
4. **Do not edit `lib/domain/**` or `components/ui/**`.** Those are Wave 1/2 outputs and shared. Need a change? Report it; don't make it.
5. Run only your own task's tests, not the suite. The full suite is Task 21's job.

If tracks run in separate worktrees rather than one tree, they merge cleanly given rules 1–4, since every track's diff is confined to its own directories.

---

## Corrections discovered during execution — BINDING on later waves

These were found by Wave 1 tracks and supersede the main plan where they conflict. Any agent in Wave 2+ must read this section.

### C1 — `StatusPill.colorMap` is a KEYED map, not a flat object
The main plan (Task 11 Interfaces) declares `colorMap: { bg: string; text: string; dot: string }`. That is wrong. The prototype body is `colorMap[label] || {grey}` and all three call sites pass a **label → colour** map (`reference/v0.4/finnix-film.html:3436` stock withdrawals, `:3518` commission, `:3868` accounting). The shipped component accepts either shape, but **Tasks 16, 17, 18 must pass the keyed map**, as the prototype does. Passing a flat object renders every pill grey.

### C2 — Proxy auth is OPTIMISTIC ONLY; every server action must re-check
Next 16's own docs warn that Server Functions are POSTs to the route hosting them, so a `config.matcher` change can silently drop proxy coverage. `proxy.ts` refreshes the session; it is **not** an authorization boundary. Every server action produced in Waves 4-5 (Tasks 14-19) must independently verify the caller's session and capability via `getSessionContext()` before mutating. Do not rely on the proxy or on UI gating alone. RLS (Task 7) is the backstop, not the only check.

Related: `proxy.ts` now defaults to the Node.js runtime and `runtime` is **not configurable** — `export const runtime = 'edge'` throws.

### C3 — `Shop` type has no canonical home yet
`PeriodShopFilter` needs `shopOptions?: Shop[]`; the plan never defines `Shop`. Track D exports `type Shop = { id: string; name: string }` from `components/ui/PeriodShopFilter.tsx` as an interim. Once `lib/types/database.ts` exists (Wave 1 Track A), prefer the generated `shops` row type and re-point it. Also: the prototype's `shopOptions = SHOPS` module constant does not exist in the port — **every call site must explicitly pass `shopOptions={accessibleShops}`** from the session.

### C4 — `DateTimeField` intentionally DIVERGES from the prototype (timezone fix)
The prototype derives the date with `value.toISOString().slice(0,10)` — UTC. In Asia/Bangkok (UTC+7), any time before 07:00 renders the *previous* calendar day, and `setTime()` then rebuilds the `Date` from that shifted day, silently moving a booking back 24 hours. The port formats from **local** date parts instead. Identical behavior for mid-day values, correct at the edges. Covered by a regression test for the 02:00 case. This is a deliberate, logged deviation under the "visual/UX bugs may be fixed" clause — flagged for human review because it touches booking dates.

### C5 — Domain layer reproduces three prototype defects on purpose
`thaiBahtText` on a negative amount yields `"undefined…"`; on ≥10^12 it drops a `ล้าน` group; `orderTotal` prices a return off the **first** matching item name (duplicate names mis-price). All faithfully ported under the unchanged-business-logic rule and deliberately NOT asserted as correct in tests. Do not "fix" these in a module task — they need a product decision.

### C7 — `seesAllShops` MUST include the role permission (business-logic bug, fix pending)
The prototype computes `canSeeAllShops = admin || shopAccess === 'all' || dashboardPermissions[role].seeAllShops`. Task 7's `current_user_sees_all_shops()` implements only the first two clauses, and `lib/auth/buildSessionContext.ts:50` mirrors that same gap. The seed sets `dashboard_widget/seeAllShops = true` for `exec`, and `app_users.sees_all_shops` defaults to `false` — so **every exec user is silently shop-scoped**, contradicting the prototype, and the seeded permission row is dead data.

This violates the Global Constraint that business functionality must exactly match the prototype. Fix in BOTH places (migration `0008` + the TS builder) by adding the third clause, reading `role_permissions` where `permission_type='dashboard_widget' and permission_key='seeAllShops'`. Fixing it in the DB rather than by flipping `app_users.sees_all_shops` in the Task 20 seed is deliberate: it keeps the behavior config-as-data and editable through the Permissions UI, per spec §7.

### C8 — test environment hazards
- `tests/rls/*` and any test making real `@supabase/*` network calls should run under the **node** Vitest environment, not the project-default jsdom (jsdom applies browser CORS and its `URL` is rejected by `node:fs`). Use a `// @vitest-environment node` docblock or a per-directory environment.
- Env var names are inconsistent: `tests/rls/*` reads `SUPABASE_URL`/`SUPABASE_ANON_KEY` while `.env.local` defines `NEXT_PUBLIC_SUPABASE_*`. Tests should accept either and fall back to parsing `.env.local`.
- Expect transient sub-second failures if the suite runs while `supabase db reset` is restarting containers. Not a test defect — relevant to Task 21.

### C9 — Task 12 owns theme bootstrapping
Nothing currently sets `data-theme` on `<html>`. `app/globals.css` defines the full `html[data-theme="dark"]` token set (Task 1) but no code writes the attribute, so dark mode is unreachable. The prototype's login screen has a theme toggle; it was intentionally not ported in Task 9 because there was nothing to persist into. **Task 12 must wire theme bootstrapping** (attribute on `<html>`, persistence, no-flash-on-load script in `app/layout.tsx`) and decide whether the login screen also gets a toggle.

### C10 — login error codes, not raw error text
Plan Task 9 Step 3 specified `?error=${error.message}`, which renders raw (English, attacker-influenceable) Supabase error text inside the login card. Superseded: use fixed codes (`missing_email`, `missing_password`, `invalid_credentials`, `no_profile`, `inactive`) mapped to Thai copy. Unknown codes render nothing. Apply the same rule anywhere else errors reach a URL.

### C6 — `fmt` / `fmtThaiDate` require full-ICU Node
The Buddhist-era assertion (`15 ก.ค. 2569`) and comma grouping depend on a full-ICU runtime. If these fail in Task 21/CI, fix the Node build — do not weaken the assertions.

---

## Wave 5 — serial finish

Task 20 (staging seed) → Task 21 (full suite + Playwright e2e, including the print-isolation e2e that verifies the Task 1 / Task 12 `.app-shell` + portal split) → **Task 22 (deployment checkpoint — STOP for explicit human confirmation; creates real billed cloud resources, per the plan's Global Constraints).**

---

## What this changes vs. running the plan literally

| | Literal order | Wave-batched |
|---|---|---|
| Critical path | 22 serial tasks | 6 waves |
| `supabase db reset` | 6× | 2× |
| Schema test invocations | 5 separate | 1 batched |
| Widest parallel band | 1 | 7 (Wave 4) |

Behavior, task content, tests, and the Task 22 safety gate are all unchanged — this is purely a scheduling and batching change.
