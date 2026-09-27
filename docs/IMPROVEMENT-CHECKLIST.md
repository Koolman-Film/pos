# Improvement checklist

Created 2026-09-23 from a five-area review (security, data integrity, performance,
code quality, testing/ops) after the 0053–0065 production release. Every item was
found in the code with file:line evidence; the top findings were re-verified by hand
and against production.

**Ground rule:** the phases are behaviour-preserving. Anything that would change what
staff see or can do is listed under [Decisions](#decisions-needed-behaviour-changes)
instead, and waits for a yes.

**Legend** — Effort: **S** < half a day · **M** 1–2 days · **L** several days.
Behaviour: **none** = invisible to staff · **fix** = only wrong results become right.

---

## Phase 0 — Fix this week

- [ ] **0.1 Script injection / open redirect in the auth callback** · S · none
  - Evidence: `app/auth/callback/page.tsx:36` reads `?next=` unchecked; `:61`, `:66`, `:91`,
    `:98` pass it to `window.location.replace()`. A logged-in user opening
    `/auth/callback?next=javascript:…` runs attacker code as themselves; `?next=https://evil…`
    is a phishing redirect. **Live in production.**
  - Fix: follow `next` only when it starts with a single `/` (not `//`, not `/\`); otherwise
    `/dashboard`. The app itself only ever sends `/auth/accept`
    (`permissions/actions.ts:595,626`).
  - Done when: unit test proves `javascript:`, `//evil.com`, `/\evil.com`, `https://…` all land
    on `/dashboard`, and `/auth/accept` still works (invite flow).

- [ ] **0.2 Make CI actually block** · S · none
  - Evidence: `.github/workflows/ci.yml` runs the full suite on every push, but `main` has **no
    branch protection** (GitHub API: "Branch not protected"). The developer branch was red on
    11 Sep and 21–22 Sep with nobody acting on it; the popup and seed breakages would have
    been caught on day one.
  - Fix: protect `main` — PRs only, required checks `types, lint, format, unit, build` and
    `integration, RLS, e2e`; turn on failure e-mail for both people. Change the push trigger
    to `branches: [main]` so PR branches don't run twice.
  - Needs: the developer's agreement to work through PRs.
  - Done when: a direct push to `main` is refused and a red PR cannot be merged.

- [ ] **0.3 Run tests in the shop's time zone** · S · none
  - Evidence: CI runners use UTC. `WholesaleDetail.test.tsx:1163` compares against the Bangkok
    date while `todayValue()` (`lib/domain/now.ts:22`) uses the process time zone, so the test
    fails every day 00:00–07:00 Bangkok. `main` run of 3cc33a9 is red for this reason only.
  - Fix: set `TZ=Asia/Bangkok` for vitest (config `env` / CI job env).
  - Done when: `TZ=UTC` and `TZ=Asia/Bangkok` runs both pass at 06:00 Bangkok, and CI on
    `main` is green.

- [ ] **0.4 Stop swallowing stock-movement failures** · S · none (server log only)
  - Evidence: `lib/stock/movements.ts:131` ignores the `move_stock` result; `:104` ignores the
    product-lookup error. Supabase returns errors instead of throwing, so the callers' `catch`
    never fires (`tickets/actions.ts:170,207`, `wholesale/actions.ts:297`). A failed move
    reports "saved", stock drifts, and cost of goods (`revenue/data.ts:101`) is understated.
    `recordOrderDelivery` stamps `stock_deducted_at` before moving (`wholesale/actions.ts:~374`),
    so a failed delivery move is never retried.
  - Fix: check `error` in both places and log it server-side; return it through the existing
    `unmatched` warning path. Showing it to staff is Decision D2.
  - Done when: unit test in `tests/unit/lib/stock/movements.test.ts` where `rpc` returns
    `{ error }` asserts the error is logged and surfaced to the caller.

- [ ] **0.5 Rejecting a withdrawal twice returns stock twice** · S · fix
  - Evidence: `stock/actions.ts:472` guards with `.eq('status','รออนุมัติ')` but never checks
    whether a row was updated; two managers pressing at once both return the stock.
  - Fix: `.select('id')` on the update and stop if nothing came back.
  - Done when: an integration test that calls `decideWithdrawal` twice moves stock once.

- [ ] **0.6 Deleting one expense deletes a receipt other expenses share** · S · fix
  - Evidence: one uploaded file is linked to every line of a multi-line expense
    (`accounting/actions.ts:67`); deleting an expense (`:235`) or one attachment (`:129`)
    removes the storage object unconditionally.
  - Fix: remove the object only when no other `expense_attachments` row references its path.
  - Done when: integration test — two expenses share a file, delete one, the other's file
    still opens.

- [ ] **0.7 Upgrade vulnerable dependencies** · S · none
  - Evidence: `npm audit --omit=dev` — `next 16.2.11` critical (image-optimizer AVIF RCE,
    GHSA-2xp9; low real exposure: no `next/image`, runs on Vercel). `xlsx 0.18.5` prototype
    pollution + ReDoS, no npm fix; used for exports and one in-browser import
    (`StockModule.tsx:499-502`).
  - Fix: `next` → latest 16.3.x (pinned exactly). SheetJS → 0.20.3 from the
    cdn.sheetjs.com tarball (same API).
  - Done when: `npm audit --omit=dev` clean; full suite green; one export and the stock bulk
    import tried by hand.

- [ ] **0.8 Security headers** · S · none
  - Evidence: `next.config.ts` sets no headers — the app can be framed (clickjacking of admin
    buttons), no nosniff, no referrer policy.
  - Fix: `headers()` with `Content-Security-Policy: frame-ancestors 'none'`,
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`. Full CSP later (the inline theme script
    needs a nonce).
  - Done when: `curl -I` on production shows the headers; e2e suite green.

- [ ] **0.9 Pin `search_path` on `current_user_sees_all_shops`** · S · none
  - Evidence: re-created in `0008:26-27` without `set search_path`, which dropped 0007's
    setting. Every other SECURITY DEFINER function pins it.
  - Fix: migration `alter function pos.current_user_sees_all_shops() set search_path = pos;`
    (+ release file).
  - Done when: `pg_proc.proconfig` shows the setting on production.

---

## Phase 1 — Before fixed deadlines

- [ ] **1.1 Reads silently capped at 1,000 rows** · S · fix · **deadline ≈ November**
  - Evidence: PostgREST `max_rows = 1000` (`supabase/config.toml:19`; hosted default is the
    same). Unpaged reads return an arbitrary 1,000 with no error:
    - `customers/data.ts` (both queries) and `retail_customers` in `tickets/data.ts:235` —
      **475 customers today**, first to break
    - `tickets/data.ts:94` `loadTicketList`
    - `revenue/data.ts:86-103` — tickets, policies, tax documents, `stock_movements` (334 now)
      summed as money
    - `dashboard/page.tsx:193` insurance policies
    - `accounting/page.tsx:62-69` expenses (281) and petty cash
    - `stock/page.tsx:131` withdrawals; `wholesale/data.ts:253`
  - Fix: `fetchAllRows` (`lib/supabase/fetchAll.ts`) with a stable `order`.
  - Done when: an integration test seeds > 1,000 rows for one list and gets all of them.

- [ ] **1.2 Ticket numbers collide past 1,000 per branch** · S–M · none · **deadline ≈ late Jan 2027**
  - Evidence: `nextTicketId` (`tickets/actions.ts:55-67`) reads existing ids unpaged and
    unordered. Chiang Mai has 319 tickets in 58 days (~5.5/day). Past 1,000 the max is taken
    from an arbitrary subset → duplicate key → ticket creation fails. Two simultaneous creates
    also collide today.
  - Fix: number tickets in the database with a locked trigger, the way POs already are
    (migration 0036, `next_order_id`). Same `JT-XX-00000` format.
  - Done when: integration test creates tickets concurrently and past 1,000 without collision.

- [ ] **1.3 Production error reporting** · S–M · none
  - Evidence: one `console.error` in the codebase (`lib/alerts/load.ts:31`); 138 server-action
    paths return `{ ok:false }` silently; 55 reads ignore `error` (a failed read renders as
    zero); no `instrumentation.ts`, no error tracker, no health route.
  - Fix: `reportActionError(action, e)` in every catch; `onRequestError` in `instrumentation.ts`
    (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`);
    optional Sentry; log (don't render) read errors.
  - Done when: a forced failure in a server action appears in Vercel logs with action name and
    user id.

---

## Phase 2 — Database enforces what the screens enforce

Staff can call the Supabase API directly with their own login
(`lib/supabase/client.ts`). Each item mirrors an existing server-action check in the DB so
the API cannot skip it. **Every rule needs a test proving the real screen path still works**
(`deleteExpense`, `deleteServiceVisit`, `deleteProductAction`, `deleteMoneyTransfer`,
`save_*_children` delete-and-reinsert).

- [ ] **2.1 Payment / approval status only through the approval functions** · M · none
  - Evidence: `order_payments_rw` / `order_adjustments_rw` are branch-only `for all`
    (`0007:105-110`) with no guarding trigger — `update order_payments set status='รับเงินแล้ว'`
    bypasses `confirm_order_payment`'s `wholesale.confirmPayment` check. Same for
    `orders.price_decision`.
  - Fix: before-update triggers rejecting status/approval column changes unless made by the
    SECURITY DEFINER functions (or service_role).
- [ ] **2.2 Block permanent deletes the app never does** · M · none
  - Evidence: `for all` policies allow hard DELETE on `tickets`, `orders`, `expenses`, `stock`,
    `money_transfers`; soft-delete capability checks (`0013:55`, `0040`) and the ticket lock
    (`0017:49`) fire on UPDATE only — a locked, paid ticket can be hard-deleted.
  - Fix: restrictive DELETE policies scoped to the paths the app really uses.
- [ ] **2.3 Capability checks inside stock and document functions** · S · none
  - Evidence: `count_stock`, `move_stock`, `transfer_stock` never check `stock.adjustStock` /
    `stock.withdraw`; `record_ticket_document` checks nothing (VAT / รับแทน rules live only in
    `tickets/actions.ts:754-786`).
- [ ] **2.4 Shared-project exposure (finance users)** · S–M · none for POS users
  - Evidence: policies that only require `authenticated` (`0007:137-193`, `0047:45`) are open to
    every login in the shared Supabase project — customer names/phones, company tax IDs,
    POS staff e-mails/roles, price tables, option lists, commission rules without a shop
    (`0007:121`). Film prices are admin-only in the app (`stock/actions.ts:329`) but writable
    by any login. Check whether public sign-up is enabled in production (it is locally,
    `config.toml:186,231`).
  - Fix: `current_user_is_pos()` (active `app_users` row) in those policies; write policies get
    the action's capability.
- [ ] **2.5 Storage scoped by branch, not just menu** · S · none (check first)
  - Evidence: bucket policies check nav only (`0014:83-88`, `0018:128-133`, `0055:70-75`) while
    paths are per-branch — branch A can list/open/delete branch B's slips and receipts.
    `addExpenseAttachments` accepts any path (`accounting/actions.ts:97`).
  - Fix: first path segment must be in `current_user_shops()`. **First** list existing objects
    under the `'unknown'` fallback folder (`AttachmentField.tsx:57`) — they would become
    admin-only.
- [ ] **2.6 Duplicate-uid guard for discounts and returns** · S · none
  - Evidence: 0049's uid-dupe check + unique index cover `order_payments` only
    (`0064:124`); the replay it prevents still works on `order_adjustments` and
    `order_returns`.
  - Fix: same check in `save_order_children` + partial unique indexes `(order_id, uid)`.
- [ ] **2.7 Shop dates in SQL use Bangkok, not UTC** · S · fix
  - Evidence: DB time zone is UTC, so 00:00–07:00 Bangkok records the previous day:
    `ticket_documents.issued_at default current_date` (`0024:29`) — **a tax invoice issued early
    on the 1st lands in last month's VAT period**; `price_decided_at` (`0052:69`); stock lot
    dates (`0027:175`, `0028:137`, also FIFO order); fallbacks in `0048:232`, `0051:250`,
    `0054:295`, `0060:145`; app side `wholesale/actions.ts:124` (`toISOString()`, while `:65`
    of the same function uses `shopDayKey`).
  - Fix: `(now() at time zone 'Asia/Bangkok')::date`, as `0056:130` already does.
- [ ] **2.8 Workflow statuses cannot be renamed or deleted** · S · none
  - Evidence: `renameWsStatus` (`permissions/actions.ts:329`, UI `PermissionsModule.tsx:746`)
    can rename the four workflow statuses the code and trigger `0055:124-150` depend on
    (same bug class as เสร็จสิ้น). Ticket `ส่งมอบแล้ว` drives `shouldLock`; `ค้างชำระ` drives
    alerts and dashboard counts.
  - Fix: refuse rename/delete of those keys in the action and in a DB trigger.
- [ ] **2.9 Wholesale customer edits need a capability** · S · none
  - Evidence: wholesale `saveCustomer` (`wholesale/actions.ts:744-750`) only checks sign-in;
    retail requires `customers.edit`.
- [ ] **2.10 Cost prices reach users who may not see them** · S · none
  - Evidence: `loadDetailRegistries` sends stock `cost` for every branch to the ticket screen;
    stock page strips it only for users without price rights (`stock/page.tsx:64-66`); the API
    returns it directly regardless.
- [ ] **2.11 Server-side password rule** · S · none
  - Evidence: 8-character minimum is client-only; Supabase minimum is 6 locally. Check the
    production auth setting and align.

- [ ] **2.12 User-facing DB errors must use 400-class SQLSTATEs** · S · none _(found 2026-09-27)_
  - PostgREST maps `P0002`, `55000` (and other non-`P0001` `P0*`/`5*` codes) to HTTP 500, and
    PostgREST 14.x replaces every 500 body with plain text `Something went wrong` — verified
    locally: `save_service_visit` with a bad id returns that instead of
    `ไม่พบใบเซอร์วิสที่ต้องการแก้ไข`. Affected: `P0002` ×16 (11 live since before 0066),
    `55000` ×2 (0066 `save_ticket_tech`, 0073 `save_ticket_item_finnix_docs`). If production's
    PostgREST is or becomes 14.x, staff see the generic text instead of the instruction.
  - Fix: re-raise those with `22023` / `P0001` (→ HTTP 400, message kept); new migration only.
  - Done when: an RLS test asserts the Thai message for each, on the local 14.x stack.

- [ ] **2.13 Activity history misses the per-line columns added after 0061** · S · none _(found 2026-09-27)_
  - `activity_collection('ticket', …)` (0061) snapshots a fixed list of `ticket_items` fields;
    `revenue_kind` (0068) and `finnix_doc_no` (0073) are not on it, so switching a line between
    รายได้/รับแทน or entering a PEAK number leaves no row in ประวัติการใช้งาน. Seen in
    production: 0068's backfill of 18 lines logged nothing.
  - Fix: add both fields to the snapshot (new migration; re-seed `activity_snapshots` for
    tickets with `on conflict do update`). Any future column on a logged child table needs the
    same.

---

## Phase 3 — Release process and operations

- [ ] **3.1 CI: every release file creates what its migration creates** · S
  - A prototype comparison script exists from the review; it flags exactly the old
    `release-0043.sql` gap. Allow-list 0038/0039 (no release file by design).
- [ ] **3.2 Generate `release-GO-LIVE.sql` by script; CI fails on diff** · S
  - Move the hand-added 0038/0039 stamp block (≈ GO-LIVE:2898-2909, 5b85677) into
    `release-0038-0039.sql`; build from the ordered list in `docs/RELEASE-post-trial-fixes.md`.
- [ ] **3.3 CI: migration number collisions** · S
  - Fail on duplicate numbers, or a new migration not above `main`'s newest.
- [ ] **3.4 Schema fingerprint script** · M
  - Commit the prod-vs-local md5 comparison of functions / triggers / policies as
    `supabase/snippets/fingerprint.sql`; run after every production release; in CI, compare the
    migrations-built DB with a release-files-built DB.
- [ ] **3.5 CI: regenerate `lib/types/database.ts` and fail on diff** · S
- [ ] **3.6 Connect Vercel to git through a `production` branch** · M
  - Release = apply SQL → fingerprint → fast-forward `production`. Today `vercel --prod`
    uploads the working tree (can ship uncommitted code). **Preview deploys must not get
    production keys** (the DB is shared with finance) — see Decision D6.
  - Fix `docs/RELEASE-post-trial-fixes.md:21` (claims merging to main deploys).
- [ ] **3.7 `/api/health` + uptime monitor** · S
  - Read-only DB ping, returns the build commit.
- [ ] **3.8 POS-schema dump before each manual release** · S
  - `pg_dump --schema=pos` (or the in-DB snapshot used on 2026-09-23). Daily backups roll
    finance back too.
- [ ] **3.9 Retire the visual suite; make `npm test` passable** · S
  - Baselines 210 commits stale, macOS-only, masking selectors match nothing
    (`visual.spec.ts:79-83`), 19 of 38 PNGs orphaned; `npm test` ends with it so it can never
    pass. Keep at most one print-sheet screenshot generated in CI.
- [ ] **3.10 Test coverage for recent features** · M
  - Smoke: `routes-smoke.spec.ts:18-29` misses `/money`, `/activity`, `/revenue`, `/customers`.
  - E2E: delivery with evidence upload, return confirm, petty-cash top-up, claim via service
    visit, activity log, Excel/PDF exports.
  - RLS/integration: storage `wholesale_attachments_*`, `activity_snapshots`,
    `enforce_pay_to_account_shop` (0062), `sales_people_write` (0053), the 0043 transfer guard,
    stock-out on PO delivery (`wholesale/actions.ts:380-398`, no test at all).
  - Template: the 22 rolled-back production checks run on 2026-09-23.
- [ ] **3.11 Docs and local setup** · S
  - `README.md` is still the create-next-app template; `docs/UPDATING.md:27`,
    `docs/DEPLOYMENT.md:21` say "0001–0008"; `UPDATING.md:41` hardcodes a worktree Kong name;
    `DEPLOYMENT.md:3` says nothing is deployed; `db push` instructions don't work (stale
    password); non-default API port 54351; `db:reset` relies on `sleep 6` (`package.json:22`)
    — replace with a health wait / Kong restart.
  - Add `.remember/` and `.claude/` (except `launch.json`) to `.gitignore`.
- [ ] **3.12 One Supabase CLI version everywhere** · S · none _(found 2026-09-27)_
  - CI pins CLI 2.109.1 (`ci.yml:89`); local was 2.117 (PostgREST 14.5). The two stacks behave
    differently (see 2.12), so a test can pass in CI and fail locally or vice versa. Pin the
    same version in `package.json` (`supabase` devDependency) and CI, and upgrade together.
  - `playwright.config.ts:27` hardcodes port 3000 — read `E2E_PORT` so e2e can run while a
    dev server is up.
- [ ] **3.13 Release doc is missing rows for 0066–0073** · S · none _(found 2026-09-27)_
  - `docs/RELEASE-post-trial-fixes.md` describes every migration through 0065 and 0074, but
    the service-schedule branch added none for 0066–0073.

---

## Phase 4 — Performance

Worth doing now:

- [ ] **4.1 Remove double reloads after ticket saves** · S · none
  - `saveTicketExtras` (`tickets/actions.ts:414-415`) and `unlockTicket` (`:457-458`) already
    `revalidatePath`; `TicketDetail.tsx:293,306` then `router.refresh()` again.
- [ ] **4.2 Run independent queries in parallel** · S · none
  - Ticket detail: 6 sequential round trips → 2 (`tickets/data.ts:611-612`, `:397→444`,
    `:536→545`, `[id]/page.tsx:48`). Stock page ~8 sequential awaits (`stock/page.tsx:57→218`).
    Revenue (`revenue/data.ts:256`), wholesale detail (`wholesale/data.ts:295`).
- [ ] **4.3 Load heavy libraries on demand** · S · none
  - `WholesaleList.tsx:6` imports `xlsx` eagerly (+139 KB gzip on `/wholesale`) — use
    `await import('xlsx')` like the other four places. `lib/storage/attachments.ts:1` pulls the
    Supabase browser client (58 KB gzip) into four screens — import at upload time.
- [ ] **4.4 Notification bell** · S–M · none
  - `NotificationBell.tsx:78-118` polls through a Server Action (queued ahead of saves, one per
    tab) every 5 min even in hidden tabs. Move to a GET route handler; skip the timer while
    hidden.
- [ ] **4.5 Customers page is O(customers × tickets)** · S–M · none
  - `customers/data.ts:76-79` — index tickets by customer id and name|phone.
- [ ] **4.6 Smaller payloads** · S · none
  - Dashboard sends every ticket with full status history; the calendar uses the last entry
    (`dashboard/page.tsx:772-780`, `JobCalendar.tsx:85-95`). Wholesale detail loads every PO to
    list products bought (`wholesale/data.ts:313`) — select `id, customer_id, order_items(name)`.
- [ ] **4.7 Small DB tweaks** · S · none
  - `activity_log_admin_read` (`0061:90`) → `(select current_user_role()) = 'admin'`; index
    `service_visits(received_at)`.

When data grows (≈ 10k tickets):

- [ ] **4.8 Server-side paging/search for the ticket list** (`tickets/data.ts:91`) · M · changes
      UX — decide then.
- [ ] **4.9 Dashboard totals in SQL** (views/functions) · L · numbers must be proven identical.
- [ ] **4.10 `activity_log` cost and retention** · M
  - Deferred per-row triggers rebuild the whole document snapshot per touched child row
    (≈ N² per save); full before/after arrays; no retention. Run the snapshot once per
    transaction. Retention period is Decision D5.
- [ ] **4.11 List rendering** · M · none
  - No `useMemo`/`useDeferredValue`/virtualisation in big lists; `TicketList` renders visible
    rows twice (screen + hidden print copy, `:509`); the 2,600-line print sheet re-renders on
    every keystroke (`TicketDetail.tsx:340`) — memoise, don't remove (Ctrl+P prints it).

---

## Phase 5 — Code quality (behaviour-preserving; tests first)

- [ ] **5.1 One Excel export helper** · S · fix
  - Seven copies of the per-shop workbook code; `revenue/actions.ts:26` misses the backslash
    `accounting/actions.ts:260` strips from sheet names. → `lib/export/xlsx.ts`.
- [ ] **5.2 Named status constants** · S · none
  - PO status names hardcoded 17× outside `lib/domain/orders.ts` (e.g. `lib/alerts/build.ts:96-128`,
    `WholesaleDetail.tsx:592-600`, `dashboard/page.tsx:745`).
- [ ] **5.3 One `shopName` helper** · S · none
  - Six copies; `AccountingModule.tsx:242` uses `||` where the rest use `??`.
- [ ] **5.4 Error boundary + one `ActionResult` type** · S · none
  - No `error.tsx` anywhere in `app/`; `stock/actions.ts` throws (12 places) while
    `StockModule.tsx` catches in one of eleven awaited calls. Add `app/(app)/error.tsx` now;
    migrate stock to `{ ok, error }` when its UX is touched.
- [ ] **5.5 Remove `any` / needless casts** · S · none
  - `StockModule.tsx:124-133` types four actions as `any` — this hid Decision D8.
    `{ locked: true } as unknown as TicketUpdate` casts at `tickets/actions.ts:304,356,454,475`
    are unnecessary. `accounting/actions.ts:9-15` imports types from a `'use client'` component
    → `components/accounting/types.ts`.
- [ ] **5.6 Check unchecked writes** · S · none
  - `tickets/actions.ts:247,324` (status history), `:302-305` (lock flag),
    `optionListActions.ts:43`, `permissions/actions.ts:428`, `wholesale/actions.ts:584`.
- [ ] **5.7 Domain logic out of components** · S · none
  - `components/dashboard/moneyFlow.ts` (526 lines), `receivables.ts` → `lib/domain`.
    Ticket lock rule (`tickets/actions.ts:266`) → `lib/domain/tickets.ts` + unit tests.
    `WholesaleDetail.tsx:736-752` re-implements `orderTotal` — export a breakdown instead.
- [ ] **5.8 Split the largest components** · M each · none
  - Characterisation tests **first**:
    - `PrintJobSheet.tsx` (2,617) — one component per print type; HTML snapshot per type
      (`offsite`, `insurance` have no tests today).
    - `WholesaleDetail.tsx` (2,608) — print section (~1915–2310) into its own component
      (73 tests guard it).
    - `StockModule.tsx` (2,380, 33 `useState`) — import parsing (`:504-521`) as a pure function.
    - `dashboard/page.tsx` — 12 queries into `dashboard/data.ts` like other modules.
    - `PermissionsModule.tsx` (1,157) — only 6 tests; write more before touching.
- [ ] **5.9 Atomic multi-write actions** · M–L · none
  - Header and children commit separately in `createTicket`, `updateTicket`, `saveOrder`
    (new PO), `addExpense` (+ attachments), `withdrawAction`, `decideWithdrawal` — a failure
    leaves half-saved documents and a retry duplicates. Fold each into one RPC.
- [ ] **5.10 Money columns get CHECKs; race-free customer de-dupe** · S–M · none
  - Money columns are plain `numeric` without CHECK (`0004`/`0005`/`0006`; only
    `money_transfers` has one, `0043:84`). Retail customer de-duplication is app-only (race).
- [ ] **5.11 Dead code** · S · none
  - `components/charts/BarChart.tsx`, `DoughnutChart.tsx` are imported only by tests.

---

## Decisions needed (behaviour changes)

- [ ] **D1 Editing a confirmed payment / approved discount.** A confirmed ฿1,000 payment can be
      edited to ฿100,000 and stays รับเงินแล้ว (`WholesaleDetail.tsx:2391`, `:1513`;
      `save_order_children` keeps status by uid, takes amount from the form). Options: lock the
      amount once confirmed, or reset to pending when it changes. No-change alternative: an
      `activity_log` report of edited confirmed rows.
- [ ] **D2 Show stock-movement failures to staff?** (0.4 only logs them.)
- [ ] **D3 Round money comparisons to satang.** `shouldLock` (`tickets/actions.ts:277`) and
      receivables (`receivables.ts:48`) compare raw decimals; some price/discount combinations
      leave ~1e-11 unpaid, so the ticket never locks and shows a phantom receivable. Tickets that
      should lock would start locking. **Check production for affected tickets first.**
- [ ] **D4 Deleting a delivered PO.** `storedOrderNetQty` (`wholesale/actions.ts:168`) returns
      unconfirmed returns too, and ignores post-delivery item edits. Reverse only what
      `stock_movements` actually recorded for the PO?
- [ ] **D5 Login captcha** (server-side sign-in means Supabase rate limits see Vercel's IPs), and
      **activity history retention** period.
- [ ] **D6 Preview deploys:** separate staging Supabase project (cost) or previews off / behind
      Vercel Authentication.
- [ ] **D7 Branch protection workflow** — the developer works through PRs (needed for 0.2).
- [ ] **D8 "จำนวนครั้ง Service" field** is collected in the add-product form (`StockModule.tsx:424,1575`),
      the import parser (`:519`) and the template (`:488`), but no action sends it and no column
      stores it. Wire it up or remove it.

---

## Checked and fine (no action)

- Every server action verifies the user (`getSessionContext()` → `getUser()` + `app_users.active`)
  before mutating; CSRF origin check on; service-role key only in `permissions/actions.ts`
  behind `authorize()`, never deletes shared auth users.
- All 49 tables have RLS; SECURITY DEFINER functions (except 0.9) pin `search_path`; payment /
  approval / price / petty-cash functions check capability and shop; privileged functions
  revoked from `anon`; `activity_log` trigger-written, admin-read.
- Buckets private, 10 MB, image/PDF only; upload names sanitised + UUID-prefixed.
- No `dangerouslySetInnerHTML` beyond the constant theme script; `.env*` excluded from git and
  Vercel uploads; no secrets in history.
- Migration ↔ release files (0019–0065): no remaining drift after the 0043 fix; latest versions
  of redefined functions keep every earlier guard.
- `lib/types/database.ts` is current; RLS helper calls evaluate once per query, not per row
  (except 4.7); `revalidatePath` breadth costs nothing (no caching in use).
- Old wholesale payments/discounts without a uid: **0 rows in production** (3 payments,
  1 discount, all carry uids) — no backfill needed.
