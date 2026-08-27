# Release runbook — post-trial fixes (migrations 0012–0030)

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

## 2. Database — nine migrations

```bash
npx supabase login                       # personal access token, once
npx supabase link --project-ref <production-ref>
npx supabase db push                     # applies 0012 … 0030 only
```

### No CLI? Paste the files instead

In this order, from the dashboard → SQL Editor. Each is guarded so that running
it twice changes nothing, and each records its versions in
`supabase_migrations.schema_migrations` so a later `db push` skips them.

| Order | File                                          | Needs                                               |
| ----- | --------------------------------------------- | --------------------------------------------------- |
| 0     | `supabase/release-0030.sql`                   | a normal connection — **run this first, see below** |
| 1     | `supabase/release-0012-0018.sql`              | a normal connection                                 |
| 2     | `supabase/storage-policies.sql`               | **owner of `storage.objects`** — see below          |
| 3     | `supabase/release-0019.sql`                   | a normal connection                                 |
| 4     | `supabase/release-0020.sql`                   | a normal connection                                 |
| 5     | `supabase/release-0021.sql`                   | a normal connection                                 |
| 6     | `supabase/release-0022.sql`                   | a normal connection                                 |
| 7     | `supabase/release-0023.sql`                   | a normal connection                                 |
| 8     | `supabase/release-0024.sql`                   | a normal connection                                 |
| 9     | `supabase/release-0025.sql`                   | a normal connection                                 |
| 10    | `supabase/release-0026.sql`                   | a normal connection                                 |
| 11    | `supabase/release-0027.sql`                   | a normal connection                                 |
| 12    | `supabase/release-0028.sql`                   | a normal connection                                 |
| 13    | `supabase/release-0029.sql`                   | a normal connection                                 |
| 14    | `supabase/repair-categories-and-services.sql` | a normal connection                                 |

`release-0019.sql` is separate because 0019 was written after the first file had
already been handed over. If nothing has been run yet, running all fifteen in order
is still correct.

`release-0030.sql` is numbered 0 because it is the one file that is urgent and
depends on nothing: it adds the missing indexes that make the live site slow, it
creates no table and changes no data, and every statement in it is skipped when
its table is not in the database yet. Run it on its own, today, whatever else has
or has not been run. It is safe to run again afterwards in numerical order.

The last step is a one-time DATA repair, not schema. It folds every ชนิดสินค้า that
products actually use into `product_categories` (so a product whose category was
never on the list can be sold again), and moves the `service_items` list into
`stock` as งานบริการ products for every shop — Book งาน picks product names from
stock only now, so a service that is not a stock row cannot be selected. Read
`supabase/check-orphan-categories.sql` first; it is read-only and tells you what
step 4 is about to change.

Use these OR the CLI above, not both — though running both would be harmless.

`supabase/config.toml` currently carries the LOCAL stack id
(`project_id = "branch-porting-performance-e58d15"`); `link` rewrites it. Do not
commit that rewrite unless you mean to.

What each one does. All are additive — no column is dropped and no row is
deleted. Only 0019 rewrites anything in place, and only to fill in a new column:

| Migration                       | Change                                                                                                                                                                                                                                                                                                                               | Risk                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `0012_post_trial_permissions`   | Adds nav `customers` and capabilities `list.delete`, `list.restore`, `customers.edit`; grants `stock.export` to หัวหน้าช่าง. Replaces `reset_permissions_to_defaults()`. Rows are inserted as deltas (`on conflict do nothing`), so permissions an admin re-toggled during the trial survive.                                        | Low                                                                                         |
| `0013_ticket_soft_delete`       | `tickets.deleted_at` / `deleted_by`, a partial index, and a trigger enforcing `list.delete` / `list.restore`.                                                                                                                                                                                                                        | Low. Brief `ACCESS EXCLUSIVE` lock while the columns are added.                             |
| `0014_expense_attachments`      | Private `expense-attachments` storage bucket, `expense_attachments` table + RLS, three policies on `storage.objects`.                                                                                                                                                                                                                | **See the storage caveat below.**                                                           |
| `0015_ticket_item_interested`   | `ticket_items.interested` / `interested_price`, and `save_ticket_children` writes them.                                                                                                                                                                                                                                              | Low                                                                                         |
| `0016_option_manage_capability` | Capability `options.manage` (admin only). Replaces the reset function again.                                                                                                                                                                                                                                                         | Low                                                                                         |
| `0017_ticket_lock`              | `tickets.locked`, a trigger, `save_ticket_children` refuses a locked ticket, capability `list.unlock`.                                                                                                                                                                                                                               | Low                                                                                         |
| `0018_ticket_attachments`       | Private `ticket-attachments` storage bucket, `ticket_payments.attachments`, and `save_ticket_children` writes the slips.                                                                                                                                                                                                             | **Same storage caveat as 0014.**                                                            |
| `0019_expense_doc_no`           | `expenses.doc_no` (เลขที่เอกสาร POS-LPG-6908001), a unique index, `next_expense_doc_no()`, and a BEFORE INSERT trigger that issues the number. Backfills existing expenses per shop per month, oldest first.                                                                                                                         | Low. Writes `doc_no` on every existing expense row once.                                    |
| `0020_service_visits`           | `service_visits` + `service_visit_points` for ใบเซอร์วิส, their RLS policies, and `save_service_visit()`. Two new tables; nothing existing is touched.                                                                                                                                                                               | Low. Purely additive.                                                                       |
| `0021_service_film_product`     | ใบเซอร์วิส records the film as one `service_visits.film_product` (ชื่อสินค้า) instead of ประเภท/ความหนา/รหัสสี — each SKU states its thickness in the name. Carries the three old columns forward before dropping them, replaces `save_service_visit()`, and drops the `stock.film_*` columns that only ever existed in development. | Low. Additive then narrowing; no visit loses its film.                                      |
| `0022_extras_after_lock`        | ใบงานที่ปิดงานแล้วยังแก้ ข้อมูลเพิ่มเติม ได้: `enforce_ticket_lock` lets an update through when `extras` is the only column that moved, and `save_ticket_extras()` is the one write path the app uses for it. Everything else on a locked ticket stays frozen.                                                                       | Low. Narrows the lock; adds one function.                                                   |
| `0023_insurance`                | ประกันเป็นบันทึกของตัวเอง: `insurance_plans` (ตารางราคา), `insurance_policies` (หนึ่งแถวต่อการขาย เก็บสำเนาของแผน) และ `insurance_claims`, พร้อม `save_insurance_policy()`. ย้ายรายการ ประกัน ที่อยู่ใน `ticket_items` เดิมมาเป็นกรมธรรม์แล้วลบทิ้ง และตัดครึ่งประกันออกจาก `save_ticket_extras`.                                    | ปานกลาง — ยอดรวมของใบงานที่เคยมีบรรทัดประกันจะลดลง และไปนับเป็นรายได้ประกันตามวันที่เดิมแทน |
| `0024_revenue_report`           | `ticket_documents` — บันทึกว่าออกใบเสร็จ/ใบกำกับภาษี/ใบเสนอราคาให้ใครแล้ว (หนึ่งแถวต่อชนิดเอกสารต่อใบงาน พิมพ์ซ้ำไม่นับใหม่) พร้อม `record_ticket_document()` และเปิดเมนู `revenue` ให้ admin/exec.                                                                                                                                  | ต่ำ. เพิ่มล้วน — ประวัติเริ่มนับจากวันที่รัน ไม่มีข้อมูลย้อนหลัง                            |
| `0025_stock_integrity`          | `apply_stock_deltas()` — ให้ฐานข้อมูลบวกลบจำนวนสต็อกเอง แทนที่จะอ่านมาคำนวณในเบราว์เซอร์แล้วเขียนทับ (บันทึกพร้อมกันสองคนแล้วตัวเลขหาย) และ unique index (สาขา, ชื่อสินค้า) — ข้ามพร้อม NOTICE ถ้ายังมีชื่อซ้ำ                                                                                                                       | ต่ำ. เพิ่ม function + index; ไม่แก้ข้อมูลเดิม                                               |
| `0026_stock_ledger`             | `stock_movements` — สมุดบัญชีสต็อก ทุกการเคลื่อนไหวพร้อมจำนวนก่อน/หลัง อ้างสินค้าด้วย id, `move_stock()` / `count_stock()` ที่ย้ายของและลงบัญชีในคำสั่งเดียว, `withdrawals` ได้คอลัมน์ตัดสินใจ และ capability `stock.approveWithdraw`                                                                                                | ต่ำ. เพิ่มล้วน — สมุดบัญชีเริ่มนับจากวันที่รัน                                              |
| `0027_stock_batches`            | `stock_batches` — รับของแต่ละรอบเป็นล็อตของตัวเอง พร้อมผู้ขาย/เลขที่ใบส่งของ, `stock_movement_batches` เก็บว่าตัดจากล็อตไหนราคาเท่าไหร่, `receive_stock()` และ `move_stock()` ตัดแบบ FIFO พร้อมคิดต้นทุน, `stock.cost` กลายเป็นค่าเฉลี่ยถ่วงน้ำหนักที่คำนวณเอง                                                                       | ปานกลาง — ของที่มีอยู่กลายเป็น "ล็อตยกมา" ล็อตเดียว และ `cost` เลิกพิมพ์เอง                 |
| `0028_stock_transfer`           | `transfer_stock()` — โอนสต็อกระหว่างสาขาเป็นการกระทำเดียว ตัด FIFO ที่ต้นทาง แล้วสร้างล็อตปลายทางด้วยต้นทุนเดิม ลงสมุดบัญชีทั้งสองฝั่ง                                                                                                                                                                                               | ต่ำ. เพิ่ม function อย่างเดียว                                                              |
| `0029_film_price_per_shop`      | `film_price_matrix.shop_id` — ราคาฟิล์ม/กันรอย ตั้งแยกรายสาขาได้ NULL = ราคากลางใช้ทุกสาขา เดิมมีราคาเดียวใช้ร่วมกันทุกสาขา แก้ของสาขาหนึ่งแล้วอีกสี่สาขาเปลี่ยนตามโดยไม่มีใครรู้                                                                                                                                                    | ต่ำ. เพิ่มคอลัมน์ที่เป็น NULL ได้ แถวเดิมเป็นราคากลางทั้งหมด                                |
| `0030_hot_path_indexes`         | ดัชนีของตารางลูก (ticket_items / ticket_payments / order_items …) และคอลัมน์ที่ใช้เรียงลำดับ — ตารางชุดแรกไม่เคยมีดัชนีเลยนอกจาก primary key หน้าที่แสดงรายการใบงานจึงสแกนตารางลูกทั้งตารางหนึ่งรอบต่อใบงานหนึ่งใบ วัดที่ 2,000 ใบงาน: 4,033 ms → 25 ms                                                                              | ต่ำมาก. เพิ่มดัชนีอย่างเดียว ไม่แตะข้อมูล                                                   |

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
