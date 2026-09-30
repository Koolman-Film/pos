# Handoff

_Last updated 2026-09-30. Update this file at the end of every working session._

## Where things stand

- **Production** (`finnixpos.kool-man.com`) runs `main` at `6c9c8a8`, and its database has
  every migration through **0076**. On 2026-09-30 the production schema matched a
  migrations-built database on all six schema categories (`supabase/snippets/fingerprint.sql`).
- **Since the 28 Sep deploy:** 29 real tickets were numbered by the database (0076). Each
  branch continued exactly from its old series, with no gaps and no duplicates.
- **CI** is green on `main`. Local results on 2026-09-27: 1,115 unit, 84 integration,
  102 RLS and 29 e2e tests. Two RLS tests fail only on a newer local PostgREST; see
  checklist 2.12 and 3.12.
- **Improvement plan** ([IMPROVEMENT-CHECKLIST.md](./IMPROVEMENT-CHECKLIST.md)):
  - Phase 0 and items 1.1–1.4 are done and deployed.
  - **1.5 is open and urgent.**
  - Phase 2 has not started. It waits for the owner's go-ahead.

## Do first: 1.5, new wholesale POs fail to save (live)

Finnix North staff have been unable to save some new POs since at least 28 Sep:

- **The error:** `invalid input syntax for type numeric: ""`, logged 22 times, most recently
  30 Sep 11:13 Bangkok.
- **The cause:** a cleared qty or price field in the PO form reaches `save_order_children`
  as `""`.
- **The side effect:** the PO header is saved first, in a separate step, so every failed
  attempt leaves an empty PO. There are 23 so far. Five of them are still live in the list
  as รออนุมัติราคา: **WS-FN-0043 … 0047**.

Full evidence and the fix are in checklist **1.5**. The fix is small:

- coerce the numeric inputs;
- add a regression test;
- ship through a PR and deploy with the owner's OK.

Ask the owner before touching the five empty POs.

## In flight: the developer's branch

`origin/claude/service-schedule-compact` (by fai.phairin, last pushed 28 Sep) has 3 commits
that are not on `main`, and **no PR yet**:

- **0077** `order_deliveries`: a wholesale PO can be delivered in several rounds, with
  revenue on each round's date.
- **0078** `order_installments`: wholesale payment in installments, with an alert per
  installment, and invoices that print the schedule.
- a fix to how wholesale receivables and overdue amounts are counted.

The branch already contains `main` and brings its own `release-0077/0078.sql` and
GO-LIVE update. To land it:

1. The developer opens a PR, and CI must pass.
2. Review it with the lessons in [DEPLOYMENT.md → Hard-won lessons](./DEPLOYMENT.md#hard-won-lessons)
   in mind. It rewrites `wholesale/actions.ts` (it will conflict with the 1.5 fix) and
   `revenue/data.ts` (recall 1.4). Check any backfill against production-shaped data.
3. Release 0077, then 0078, then deploy the app.

**Migration numbers:** 0077 and 0078 are taken by that branch. **The next free number
is 0079.**

## Owner actions pending (not code)

| When                  | What                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| now (was due ~30 Sep) | Drop the snapshot `pos_backup_20260923` on production (`drop schema pos_backup_20260923 cascade;`). It is irreversible, so the owner confirms it.                                                                                 |
| ~4 Oct                | Drop `pos_backup_20260927` the same way.                                                                                                                                                                                          |
| now                   | Decide what to do with the empty POs WS-FN-0043 … 0047 (see 1.5).                                                                                                                                                                 |
| once                  | Re-run any revenue report or export taken between ~17:00 and ~22:45 on 27 Sep (1.4).                                                                                                                                              |
| once                  | The bookkeeper records payments for the 11 insurance policies sold before 0071 (฿48,000).                                                                                                                                         |
| once                  | Delete the merged branches `claude/post-trial-fixes-a16ecc` and `claude/daily-financial-report-de4a25` (0 commits ahead of `main`) once the developer agrees. **Not** `claude/service-schedule-compact`, which has unmerged work. |
| sometime              | Supabase Auth: turn on leaked-password protection; align the password minimum (2.11).                                                                                                                                             |
| before Phase 2        | Decide D1 (editing confirmed payments), and give the go-ahead for Phase 2.                                                                                                                                                        |

## Next steps, in order

1. **1.5** hotfix, above.
2. Review and release the developer's 0077/0078 branch.
3. **3.14**: stop logging expected rejections as errors. They are 30 of the 52 failures
   logged on 28–30 Sep and bury real ones.
4. **Phase 2**, database guardrails, starting with 2.1 and 2.2. Every new rule needs a test
   proving the real screen path still works.
5. The rest of Phase 3 (release-process automation), then Phases 4–5.

## How to work here

- **Rules:** [AGENTS.md](../AGENTS.md). It is short, so read all of it.
- **Release procedure:** [DEPLOYMENT.md → Releasing a change](./DEPLOYMENT.md#releasing-a-change).
- **Local stack:** [UPDATING.md](./UPDATING.md) and the [README](../README.md).
- **Tools that worked:**
  - Supabase MCP (`execute_sql`, `get_advisors`) against project `ykkfxpjjhwwthgmppvgv`.
    It returns only the last statement's result.
  - Vercel MCP `get_runtime_errors` (project `prj_qF6aD38GUvyq6wr2xYdoKJUnNWbY`, team
    `team_lFqNcIr6Y3qUGheXeTViHmAS`).
  - The `vercel` CLI.
  - `gh`.
- **Error logs:** since 1.3, failures reach the Vercel logs tagged `[request-error]` /
  `[action-error]`. **Check them at the start of a session.** That is how 1.5 was found.

## History, briefly

- Jul–Aug 2026: ported from the HTML prototype and launched.
- Aug to mid-Sep: post-trial fixes (0012–0065), money and wholesale modules.
- 23 Sep: release of 0053–0065 and a five-area review, which produced the checklist.
- 27 Sep:
  - releases 0066–0076;
  - Phase 0 and items 1.1–1.4;
  - branch protection turned on;
  - SheetJS vendored.
- 30 Sep: this handoff.

For the detail of each migration, see [RELEASE-post-trial-fixes.md](./RELEASE-post-trial-fixes.md).
For each checklist item's proof, see the ✅ lines in the checklist.
