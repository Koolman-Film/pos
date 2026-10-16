# Handoff

_Last updated 2026-10-16. Update this file at the end of every working session._

## Where things stand

- **Production** (`finnixpos.kool-man.com`) runs `main` at `593fbe9` (deployment
  `pos-qb5y9mqvj`), and its database has every migration through **0085**. On 2026-10-16
  the production schema matched a migrations-built database on all six schema categories
  (`supabase/snippets/fingerprint.sql`).
- **16 Oct release (PR #9, fai's `service-schedule-compact`):** 0077–0085 — delivery
  rounds, installments, delivery integrity, returns tied to lines, automatic PO status,
  ticket MEMO, insurance payment evidence, Finnix amounts, delivery-after-intake rule.
  Applied one file per transaction with `npx supabase db query --linked -f`, rehearsed
  first on a production-shaped 0076 database (the original 0077/0080 failed there and
  were fixed before release).
- **Backup and revert for that release:** schema `pos_backup_20261016` holds the 11
  touched tables and every pos function/trigger/policy definition at 0076.
  `supabase/snippets/revert-0077-0085.sql` restores 0076 behaviour from it (proven
  locally to restore functions and triggers byte-identically). App rollback:
  `vercel promote pos-1cd367gec-vivatchais-projects.vercel.app --yes`.
- **Data fix after the release:** 16 POs that were marked delivered before rounds
  existed got one full round (`supabase/snippets/fix-legacy-po-rounds-2026-10-16.sql`),
  so 0081 keeps their status. Only WS-FN-0007 changed: เสร็จสิ้น → ค้างชำระ (฿3,000
  unpaid), agreed by the owner. No stock moved; revenue dates unchanged.
- **CI** is green on `main`. Local 2026-10-16: 1,341 unit, 84 integration, 29 e2e;
  RLS 137/149 locally — the 12 failures are local PostgREST masking error messages
  ("Something went wrong") and also fail on the old `main`; CI passes all of them.
- **1.5** (POs failing with `invalid input syntax for type numeric: ""`): no occurrences
  in the Vercel logs 9–16 Oct. Whether it is actually fixed was not checked.

## Open after the 16 Oct release

**fai's should-fix list** (from the review of PR #9, not yet done):

- 0081 matches PO statuses by Thai name (`order_auto_status`, `lib/domain/orders.ts`,
  `WholesaleDetail.tsx`) — against the repo rule. Store the role on `ws_statuses`.
- `saveOrder` always writes the client's `status`; after a partial delivery a sales user
  without `wholesale.updateStatus` can't save the PO.
- `deductDeliveryStock`, `confirmOrderReturn`, `storedOrderShelfEffect` ignore Supabase
  `error`s; stock claim + movement should be one RPC.
- `apply_order_auto_status` is SECURITY DEFINER, granted to `authenticated`, with no shop
  check and no row lock; `save_order_children` / `delete_order_delivery` don't lock the
  order row; delivery tables allow direct DML that bypasses the RPC guards.
- UTC day keys: `actions.ts` `p_saved_on`, dashboard default month; `revenue/data.ts`
  `soldAt` slices a UTC timestamp.
- Unpriced 'รับแทน' lines save `finnix_amount = 0` and later flip to branch revenue.
- Memo load ignores `error`; unused `inSelectedPeriod` in `TicketList.tsx` (lint).
- The 0084 backfill relies on `current_user_can()` returning NULL (not false) outside the
  app, which skips the 0066 lock guard. It worked; it is fragile.

**Data the shop should look at:**

- 19 open tickets have pickup ≤ drop-off. Since 0085 they can't be saved until the date
  is corrected in the form; **0086** (PR open, not released) lets them save as long as
  the dates are not touched. The 7 active ones were sent to the shop on 16 Oct (`select id from pos.tickets where pickup_date <= drop_off_date
and deleted_at is null and not locked`). 8 more are locked.
- 4 POs whose status disagrees with their data and will be re-derived on next edit:
  WS-FN-0004 (เสร็จสิ้น, nothing paid → ค้างชำระ), WS-FN-0042 (delivered, still
  รออนุมัติราคา → ค้างชำระ), WS-FN-0041 (delivered, total 0, รอจัดส่ง → เสร็จสิ้น),
  WS-FN-0020 (pending price adjustment, รอจัดส่ง → รออนุมัติราคา).

**fai's branch:** `claude/service-schedule-compact` landed as PR #9 rebased, so its
commits are on `main` under new hashes. fai should reset that branch to `main` (not
merge `main` into it) before continuing.

**Migration numbers:** prod is at 0085. **The next free number is 0087** (0086 is on an open PR).

## Owner actions pending (not code)

| When                  | What                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| now (was due ~30 Sep) | Drop the snapshot `pos_backup_20260923` on production (`drop schema pos_backup_20260923 cascade;`). It is irreversible, so the owner confirms it.      |
| now (was due ~4 Oct)  | Drop `pos_backup_20260927` the same way.                                                                                                               |
| ~23 Oct               | Drop `pos_backup_20261016` once the 16 Oct release has run a week without trouble. Until then it is the revert path.                                   |
| now                   | Decide what to do with the empty POs WS-FN-0043 … 0047 (see 1.5).                                                                                      |
| once                  | Re-run any revenue report or export taken between ~17:00 and ~22:45 on 27 Sep (1.4).                                                                   |
| once                  | The bookkeeper records payments for the 11 insurance policies sold before 0071 (฿48,000).                                                              |
| once                  | Decide with fai whether to delete `claude/service-schedule-compact` (its work is on `main` via PR #9). The two merged branches were deleted on 16 Oct. |
| sometime              | Supabase Auth: turn on leaked-password protection; align the password minimum (2.11).                                                                  |
| before Phase 2        | Decide D1 (editing confirmed payments), and give the go-ahead for Phase 2.                                                                             |

## Next steps, in order

1. Watch the Vercel logs for a few days after the 16 Oct release.
2. fai's should-fix list above, starting with the Thai-name status matching and the
   stale `status` written by `saveOrder`.
3. Confirm 1.5 is fixed (or fix it), then **3.14**: stop logging expected rejections as
   errors.
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
- 30 Sep: handoff written.
- 16 Oct: fai's branch reviewed, fixed and released as 0077–0085 (PR #9); legacy-PO
  delivery rounds backfilled.

For the detail of each migration, see [RELEASE-post-trial-fixes.md](./RELEASE-post-trial-fixes.md).
For each checklist item's proof, see the ✅ lines in the checklist.
