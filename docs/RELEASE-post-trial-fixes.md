# Release runbook — post-trial fixes (migrations 0012–0019)

Branch: `claude/post-trial-fixes-a16ecc` (pushed to origin)

This is the batch that came out of the shop's trial run. [DEPLOYMENT.md](./DEPLOYMENT.md)
is the first-launch runbook; this file only covers what shipping THIS batch to an
environment that is already live needs.

Everything below has been applied to a local Supabase and verified there. Nothing
has been run against a hosted project — that needs an account only you can log
into, and the production database is shared with the Koolman finance app (see the
warning in DEPLOYMENT.md), so it is worth doing deliberately rather than fast.

## 1. Merge

```bash
# Open the PR GitHub offered on push:
#   https://github.com/Koolman-Film/pos/pull/new/claude/post-trial-fixes-a16ecc
```

Merging to `main` is what triggers the Vercel production deploy. Do the database
work FIRST (step 2) — the new code reads columns that do not exist yet, so a
deploy that lands before the migrations will 500 on the ticket list, the
dashboard and the accounting page.

## 2. Database — eight migrations

```bash
npx supabase login                       # personal access token, once
npx supabase link --project-ref <production-ref>
npx supabase db push                     # applies 0012 … 0019 only
```

### No CLI? Paste the files instead

In this order, from the dashboard → SQL Editor. Each is guarded so that running
it twice changes nothing, and each records its versions in
`supabase_migrations.schema_migrations` so a later `db push` skips them.

| Order | File                             | Needs                                      |
| ----- | -------------------------------- | ------------------------------------------ |
| 1     | `supabase/release-0012-0018.sql` | a normal connection                        |
| 2     | `supabase/storage-policies.sql`  | **owner of `storage.objects`** — see below |
| 3     | `supabase/release-0019.sql`      | a normal connection                        |

`release-0019.sql` is separate because 0019 was written after the first file had
already been handed over. If nothing has been run yet, running all three in order
is still correct.

Use these OR the CLI above, not both — though running both would be harmless.

`supabase/config.toml` currently carries the LOCAL stack id
(`project_id = "branch-porting-performance-e58d15"`); `link` rewrites it. Do not
commit that rewrite unless you mean to.

What each one does. All are additive — no column is dropped and no row is
deleted. Only 0019 rewrites anything in place, and only to fill in a new column:

| Migration                       | Change                                                                                                                                                                                                                                                                                        | Risk                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `0012_post_trial_permissions`   | Adds nav `customers` and capabilities `list.delete`, `list.restore`, `customers.edit`; grants `stock.export` to หัวหน้าช่าง. Replaces `reset_permissions_to_defaults()`. Rows are inserted as deltas (`on conflict do nothing`), so permissions an admin re-toggled during the trial survive. | Low                                                             |
| `0013_ticket_soft_delete`       | `tickets.deleted_at` / `deleted_by`, a partial index, and a trigger enforcing `list.delete` / `list.restore`.                                                                                                                                                                                 | Low. Brief `ACCESS EXCLUSIVE` lock while the columns are added. |
| `0014_expense_attachments`      | Private `expense-attachments` storage bucket, `expense_attachments` table + RLS, three policies on `storage.objects`.                                                                                                                                                                         | **See the storage caveat below.**                               |
| `0015_ticket_item_interested`   | `ticket_items.interested` / `interested_price`, and `save_ticket_children` writes them.                                                                                                                                                                                                       | Low                                                             |
| `0016_option_manage_capability` | Capability `options.manage` (admin only). Replaces the reset function again.                                                                                                                                                                                                                  | Low                                                             |
| `0017_ticket_lock`              | `tickets.locked`, a trigger, `save_ticket_children` refuses a locked ticket, capability `list.unlock`.                                                                                                                                                                                        | Low                                                             |
| `0018_ticket_attachments`       | Private `ticket-attachments` storage bucket, `ticket_payments.attachments`, and `save_ticket_children` writes the slips.                                                                                                                                                                      | **Same storage caveat as 0014.**                                |
| `0019_expense_doc_no`           | `expenses.doc_no` (เลขที่เอกสาร POS-LPG-6908001), a unique index, `next_expense_doc_no()`, and a BEFORE INSERT trigger that issues the number. Backfills existing expenses per shop per month, oldest first.                                                                                  | Low. Writes `doc_no` on every existing expense row once.        |

### Storage policies for 0014 and 0018 — depends which path you take

The six policies on `storage.objects` need the table's owner, and which role you
get depends on how the SQL is delivered.

**`supabase db push` creates them. Nothing further to do.** The CLI opens its
migration connection with a privileged login role (the `Initialising login
role...` line in its output), which can act as the owner. Confirmed on the
production project: after the push, all six exist with the right roles and
expressions.

**The SQL Editor path cannot.** `storage.objects` is owned by
`supabase_storage_admin`, and the Dashboard SQL Editor — like any `postgres`
connection — is not a member of it. Measured on the production project
(`ykkfxpjjhwwthgmppvgv`):

| Check                                         | Value                    |
| --------------------------------------------- | ------------------------ |
| `storage.objects` owner                       | `supabase_storage_admin` |
| `postgres` is superuser                       | false                    |
| `postgres` member of `supabase_storage_admin` | false                    |
| `set role supabase_storage_admin`             | `permission denied`      |

So pasting `supabase/release-0012-0018.sql` would stop on those six statements —
and on their `drop policy if exists` guards, which need ownership too. The
`set role supabase_storage_admin` recipe this section used to recommend does not
work here: the grant it depends on is not present. (`supabase_admin` is the
superuser that can, but it is not a role you are given.)

Because a hard failure would roll 0014 back and strand the batch part-applied,
both the migrations and the release script now _attempt_ the six and downgrade a
missing privilege to a warning. If you took the SQL Editor path and saw:

```
WARNING:  SKIPPED a storage.objects policy …
```

then create the six by hand from Dashboard → Storage → Policies on
`expense-attachments` and `ticket-attachments`, which runs as the storage service
rather than `postgres`. The statements are in
[`supabase/storage-policies.sql`](../supabase/storage-policies.sql) with the role
and USING/WITH CHECK placement for each.

Either way, verify:

```sql
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
```

Expect six. Until they exist the buckets are unreadable: uploads still succeed,
but every receipt, slip and QC photo fails to open — the same "ไม่แสดงไฟล์แนบ"
this release exists to fix. Six rows is necessary but not sufficient; open a file
in the app to prove the expressions actually pass.

### After the push

```bash
npx supabase gen types typescript --linked > lib/types/database.ts
git diff lib/types/database.ts     # expect: no change
```

The types were hand-edited to match these migrations. A non-empty diff means the
hosted schema and this branch disagree — stop and read it.

## 3. Verify on the deployed app

In this order, as an admin:

1. **Book งาน** — the status chips read from the live `statuses` table. This shop
   uses ออกใบงานแล้ว / ยกเลิกนัด, which had no chips before; they should appear
   with real counts, and the counts should follow the period filter.
2. **Dashboard** — the same numbers as those chips for the same period.
3. **ทะเบียนลูกค้า** — new menu entry; it should list the shop's real customers
   with their vehicles and job history.
4. **บัญชี** — add an expense with a receipt, then re-open it and preview the
   file. This exercises the bucket, the RLS policies and the signed URL together.
5. **A ticket** — open one, check the product picker searches by short name, then
   set a ticket to ส่งมอบแล้ว with full payment and confirm it locks.
6. **A ticket's files** — attach a slip to a payment row and a QC photo, save,
   reopen, and preview both. Same three moving parts as step 4 but against the
   `ticket-attachments` bucket, which has its own policies.

## 4. Known follow-ups, not blockers

- **Old closed tickets are not locked.** The flag is set on save, so tickets
  finished before this release stay editable until someone saves them. To lock
  them in one go (check the count first):

  ```sql
  -- how many would be affected
  select count(*) from pos.tickets t
   where t.status = 'ส่งมอบแล้ว' and t.deleted_at is null and not t.locked;
  ```

  The paid-in-full half of the condition involves per-item discounts, which live
  in TypeScript (`lib/domain/tickets.ts`) — a SQL version would be a second copy
  free to drift. Ask for a one-off script if you want this; it should be written
  against the real data and reviewed, not guessed.

- **Playwright visual snapshots are stale.** The sidebar has one more entry, the
  ticket form is reordered and the installation sheet is now a table, so most
  images differ. Regenerate with `npm run test:e2e:update-snapshots` (it resets
  the LOCAL database — it does not touch anything hosted).
- **Wholesale PO attachments are still filenames.** The same defect the ticket
  slips had; deliberately left for now, since nobody reported it during the
  trial. `components/wholesale/WholesaleDetail.tsx` is the one remaining caller
  that stores `File.name`.
- **No RLS/e2e coverage yet** for `expense_attachments`, the soft-delete columns,
  `ticket_items.interested` or the lock trigger. The lock trigger was proved by
  hand against a real database, inside a transaction that was rolled back.
