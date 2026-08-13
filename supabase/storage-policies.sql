-- supabase/storage-policies.sql
--
-- The six RLS policies on `storage.objects` for the two private attachment
-- buckets, kept verbatim so there is one place to read them from.
--
-- WHY THEY ARE NOT SIMPLY IN THE MIGRATIONS
--
-- They are in migrations 0014 and 0018 — but attempted, not asserted. On a
-- hosted Supabase project `storage.objects` is owned by `supabase_storage_admin`
-- while migrations connect as `postgres`, and `create policy` requires
-- ownership. Measured against the production project (ykkfxpjjhwwthgmppvgv):
--
--   storage.objects owner                        supabase_storage_admin
--   migration connects as                        postgres (not superuser)
--   postgres member of supabase_storage_admin    false
--   set role supabase_storage_admin              permission denied
--
-- So `db push` cannot create them, the Dashboard SQL Editor cannot either (it
-- also connects as `postgres`), and the `set role supabase_storage_admin`
-- workaround that earlier drafts of the runbook suggested does not work on this
-- project. Because each migration runs in its own transaction, letting the
-- error stand would roll 0014 back and strand the release part-applied — hence
-- attempt-and-warn there, and this file here.
--
-- HOW TO APPLY THEM ON A HOSTED PROJECT
--
-- Dashboard -> Storage -> Policies, on each bucket. That path runs as the
-- storage service rather than `postgres`, which is why it succeeds. For each
-- policy below: target role `authenticated`; SELECT and DELETE take the
-- expression in USING, INSERT takes it in WITH CHECK.
--
-- Locally none of this applies: `postgres` owns `storage.objects` in the CLI
-- stack, so `supabase db reset` creates all six from the migrations as usual.
--
-- UNTIL THEY EXIST THE BUCKETS ARE UNREADABLE. Uploads still succeed, and every
-- receipt, slip and QC photo fails to open — the same "ไม่แสดงไฟล์แนบ" this
-- release was written to fix. Verify with a real signed-URL round trip, not by
-- counting rows.

-- ---------------------------------------------------------------------------
-- Bucket: expense-attachments   (accounting receipts, migration 0014)
--
-- Reading takes the accounting nav; writing and removing take the same
-- capability as creating the expense the file belongs to.
-- ---------------------------------------------------------------------------

create policy expense_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_has_nav('accounting'));

create policy expense_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));

create policy expense_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));

-- ---------------------------------------------------------------------------
-- Bucket: ticket-attachments    (payment slips and QC photos, migration 0018)
--
-- The ticket module's own nav is the gate, so a technician who can open the
-- ticket can also see its QC photos and add more.
-- ---------------------------------------------------------------------------

create policy ticket_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

create policy ticket_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

create policy ticket_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

-- ---------------------------------------------------------------------------
-- Verifying afterwards
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--
-- Expect all six. A count of six is necessary but not sufficient: open a file
-- through the app as a non-admin to prove the expressions actually pass.
-- ---------------------------------------------------------------------------
