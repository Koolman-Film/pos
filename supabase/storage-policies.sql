-- supabase/storage-policies.sql
--
-- The six RLS policies on `storage.objects` for the two private attachment
-- buckets, kept verbatim so there is one place to read them from.
--
-- WHEN YOU NEED THIS FILE
--
-- Usually you do not. These six live in migrations 0014 and 0018, and
-- `supabase db push` creates them: the CLI opens its migration connection with
-- a privileged login role that can act as the owner of `storage.objects`.
-- Verified on the production project — after a push, all six are present.
--
-- You need this file when the SQL reaches the database as `postgres` instead:
-- the Dashboard SQL Editor, a direct psql/PostgREST connection, or the
-- paste-and-run `release-0012-0018.sql`. `storage.objects` is owned by
-- `supabase_storage_admin`, and measured on production (ykkfxpjjhwwthgmppvgv):
--
--   storage.objects owner                        supabase_storage_admin
--   postgres is superuser                        false
--   postgres member of supabase_storage_admin    false
--   set role supabase_storage_admin              permission denied
--
-- so `create policy` — and `drop policy`, which needs ownership too — raises
-- `must be owner of table objects`. `supabase_admin` is the superuser that can,
-- but it is not a role you are handed.
--
-- Because each migration runs in its own transaction, letting that error stand
-- would roll 0014 back and strand the release part-applied. So the migrations
-- and the release script attempt the six and downgrade a missing privilege to a
-- warning — which is what makes this file necessary as the fallback.
--
-- HOW TO APPLY THEM BY HAND
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
