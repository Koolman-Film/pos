-- supabase/migrations/0014_expense_attachments.sql
--
-- Real attachments on an expense (ใบเสร็จ/สลิป).
--
-- The add-expense panel has always had a file input, but there was nowhere to
-- put a file: `expenses` has no attachment column and the port only kept the
-- selected file NAMES in React state, so pressing บันทึก threw the evidence away.
-- The trial run reported it as "ไม่แสดงไฟล์แนบ", which is the visible half of
-- the same problem.
--
-- Files go to a PRIVATE storage bucket — a receipt carries a shop's spending and
-- sometimes a customer's details, so it must not be readable by URL alone. The
-- app hands out short-lived signed URLs instead (`getExpenseAttachmentUrl`).
--
-- The `expense_attachments` table is what makes an object discoverable: the
-- bucket only knows paths, and RLS on it cannot express "the caller may see this
-- shop's expenses". The row carries the shop scoping through its expense.

set search_path = pos, public, extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-attachments',
  'expense-attachments',
  false,
  10485760,  -- 10 MB: a phone photo of a receipt, not a scan archive
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

create table expense_attachments (
  id bigint generated always as identity primary key,
  expense_id bigint not null references expenses(id) on delete cascade,
  -- Path within the bucket, e.g. 'cm/9f2c…-slip.jpg'. Unique so the same object
  -- cannot be registered twice against one expense.
  storage_path text not null,
  file_name text not null,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references app_users(id),
  unique (expense_id, storage_path)
);

create index expense_attachments_expense_idx on expense_attachments (expense_id);

-- Same shop scoping as `expenses` itself, and writing additionally requires the
-- accounting nav — mirroring how `tickets`/`orders` are written.
alter table expense_attachments enable row level security;
create policy expense_attachments_rw on expense_attachments for all
  using (expense_id in (select id from expenses where shop_id in (select current_user_shops())))
  with check (
    expense_id in (select id from expenses where shop_id in (select current_user_shops()))
    and current_user_has_nav('accounting')
  );

-- Storage-side policies. `storage.objects` already has RLS enabled by Supabase;
-- these add the bucket's rules on top. Uploads and removals ride on the same
-- capability as creating the expense they belong to.
create policy expense_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_has_nav('accounting'));

create policy expense_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));

create policy expense_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));
