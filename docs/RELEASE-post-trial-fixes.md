# Release runbook — post-trial fixes (migrations 0012–0017)

Branch: `claude/post-trial-fixes-a16ecc` (pushed to origin)
Commits: `8635f95`, `c67e9a3`, `2ccbb38`, `d3ff858`

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

## 2. Database — six migrations

```bash
npx supabase login                       # personal access token, once
npx supabase link --project-ref <production-ref>
npx supabase db push                     # applies 0012 … 0017 only
```

`supabase/config.toml` currently carries the LOCAL stack id
(`project_id = "branch-porting-performance-e58d15"`); `link` rewrites it. Do not
commit that rewrite unless you mean to.

What each one does. All six are additive — no column is dropped, no row is
deleted, nothing is rewritten in place:

| Migration                       | Change                                                                                                                                                                                                                                                                                        | Risk                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `0012_post_trial_permissions`   | Adds nav `customers` and capabilities `list.delete`, `list.restore`, `customers.edit`; grants `stock.export` to หัวหน้าช่าง. Replaces `reset_permissions_to_defaults()`. Rows are inserted as deltas (`on conflict do nothing`), so permissions an admin re-toggled during the trial survive. | Low                                                             |
| `0013_ticket_soft_delete`       | `tickets.deleted_at` / `deleted_by`, a partial index, and a trigger enforcing `list.delete` / `list.restore`.                                                                                                                                                                                 | Low. Brief `ACCESS EXCLUSIVE` lock while the columns are added. |
| `0014_expense_attachments`      | Private `expense-attachments` storage bucket, `expense_attachments` table + RLS, three policies on `storage.objects`.                                                                                                                                                                         | **See the storage caveat below.**                               |
| `0015_ticket_item_interested`   | `ticket_items.interested` / `interested_price`, and `save_ticket_children` writes them.                                                                                                                                                                                                       | Low                                                             |
| `0016_option_manage_capability` | Capability `options.manage` (admin only). Replaces the reset function again.                                                                                                                                                                                                                  | Low                                                             |
| `0017_ticket_lock`              | `tickets.locked`, a trigger, `save_ticket_children` refuses a locked ticket, capability `list.unlock`.                                                                                                                                                                                        | Low                                                             |

### Storage caveat for 0014

On a hosted project `storage.objects` is owned by `supabase_storage_admin`, not
`postgres`, so `create policy … on storage.objects` can fail with
`must be owner of table objects`. If `db push` stops there, create the three
policies from the dashboard (Storage → Policies → `expense-attachments`) with the
same bodies as the migration, or run them as the owner:

```sql
set role supabase_storage_admin;
-- the three create policy statements from 0014
reset role;
```

Without them the bucket is unreadable: the receipt preview will fail to open even
though the upload succeeded.

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
- **No RLS/e2e coverage yet** for `expense_attachments`, the soft-delete columns,
  `ticket_items.interested` or the lock trigger. The lock trigger was proved by
  hand against a real database, inside a transaction that was rolled back.
