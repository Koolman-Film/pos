-- ===========================================================================
-- ONE-SHOT RELEASE SCRIPT — migrations 0012 to 0018, in order
--
-- For running this batch against a hosted project WITHOUT the Supabase CLI:
-- open the project dashboard, go to SQL Editor, paste this whole file, Run.
--
-- Generated from supabase/migrations/0012_*.sql … 0018_*.sql, which remain the
-- source of truth. The only differences are guards that make every statement
-- safe to run twice (add column if not exists, drop policy before create, …),
-- so a partial run can simply be repeated. It also records each version in
-- supabase_migrations.schema_migrations, so a later  knows
-- these are done and does not try to apply them again.
--
-- If a  line fails with
-- "must be owner of table objects", run this file as the storage owner:
--   set role supabase_storage_admin;  … reset role;
-- or create those six policies from Storage → Policies in the dashboard.
--
-- Everything here is additive: no column is dropped, no row is deleted.
-- ===========================================================================

set search_path = pos, public, extensions;

-- ===== 0012_post_trial_permissions =====
-- supabase/migrations/0012_post_trial_permissions.sql
--
-- Permission-matrix changes asked for after the trial run. `reset_permissions_to_defaults()`
-- (migration 0009) is the single source of truth for the defaults, so a change to
-- the matrix means replacing that function and re-running it — which is exactly
-- what this migration does. `tests/integration/permissionDefaults.test.ts` keeps
-- the function and the seeded rows in agreement.
--
-- What changes:
--
--   1. tech (หัวหน้าช่าง) gains `stock.export`. The lead technician is the person
--      who actually walks the shelves, and the Excel/PDF buttons on the stock
--      toolbar were the one control on that screen they could not see.
--
--   2. Two new ticket capabilities: `list.delete` and `list.restore`. Deleting a
--      ticket is a soft delete (migration 0013), so the pair is "who may bin a
--      ticket" and "who may pull it back out". Sales may delete but not restore;
--      admin/exec get both through the blanket rule below.
--
--   3. A new `customers` nav entry for the ทะเบียนลูกค้า module, plus
--      `customers.edit` for adding/editing/removing a customer record. Tech does
--      not get the nav — same reasoning as ขายส่ง/บัญชี.

set search_path = pos, public, extensions;

create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker           -- runs as the caller, so RLS still applies
set search_path = pos
as $$
begin
  -- 1. The four default roles, upserted so existing ones keep their identity.
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- 2. Anyone on a soon-to-be-deleted custom role becomes an admin.
  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  -- 3. Drop custom roles (cascades to their role_permissions).
  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  -- 4. Replace the whole matrix for the default roles.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  -- nav (DEFAULT_NAV_PERMISSIONS, prototype :176-181, plus `customers`)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

  -- dashboard widgets + other capabilities (DEFAULT_DASHBOARD_PERMISSIONS, :196-201)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  -- module capabilities: admin + exec get everything (DEFAULT_MODULE_PERMISSIONS, :221-226)
  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

-- Apply the three changes to the LIVE matrix as deltas rather than by calling
-- the function. Migration 0009 could call it because it was aligning a matrix
-- that had never been touched; by now an admin may have re-toggled permissions
-- for a real shop, and `reset_permissions_to_defaults()` would silently throw
-- all of that away (it deletes and re-inserts every row, and drops custom
-- roles). `on conflict do nothing` also makes this migration re-runnable.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','nav','customers',true),
  ('exec','nav','customers',true),
  ('sales','nav','customers',true),
  ('tech','nav','customers',false),
  ('admin','module_capability','list.delete',true),
  ('exec','module_capability','list.delete',true),
  ('sales','module_capability','list.delete',true),
  ('tech','module_capability','list.delete',false),
  ('admin','module_capability','list.restore',true),
  ('exec','module_capability','list.restore',true),
  ('sales','module_capability','list.restore',false),
  ('tech','module_capability','list.restore',false),
  ('admin','module_capability','customers.edit',true),
  ('exec','module_capability','customers.edit',true),
  ('sales','module_capability','customers.edit',true),
  ('tech','module_capability','customers.edit',false)
on conflict (role_id, permission_type, permission_key) do nothing;

-- The one existing key whose default changes: หัวหน้าช่าง may now export stock.
update role_permissions
   set allowed = true
 where role_id = 'tech'
   and permission_type = 'module_capability'
   and permission_key = 'stock.export';

insert into supabase_migrations.schema_migrations(version, name) values ('0012', 'post_trial_permissions') on conflict (version) do nothing;

-- ===== 0013_ticket_soft_delete =====
-- supabase/migrations/0013_ticket_soft_delete.sql
--
-- "ลบใบงาน" from the ticket screen, as a SOFT delete.
--
-- A ticket is the record of money taken, stock consumed and commission earned,
-- and the delete button is one tap away from a list row, so a hard delete is the
-- wrong default: `on delete cascade` would take items, positions, payments and
-- the status history with it and nothing could bring them back. Instead the row
-- is flagged and disappears from every list; a caller holding `list.restore`
-- (แอดมิน/ผู้บริหาร) can see the bin and put it back.
--
-- Two consequences worth stating:
--   * a deleted ticket still holds its job number, so `JT-CM-00053` is not
--     handed out again — restoring it cannot collide with a newer ticket;
--   * stock movements already written for the ticket are NOT rewound. Deleting
--     is "this ticket should not appear", not "undo everything it did"; a wrong
--     stock figure is corrected in สต็อก → ปรับสต็อก, where it is logged.

set search_path = pos, public, extensions;

alter table tickets
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references app_users(id);

-- Every list query filters on this, and the bin view is the rare case, so index
-- the live rows rather than the whole column.
create index if not exists tickets_live_idx on tickets (shop_id) where deleted_at is null;

comment on column tickets.deleted_at is
  'Soft-delete flag. NULL = live. Set by the ลบใบงาน action (capability list.delete), cleared by กู้คืน (capability list.restore).';

-- The capability check lives in the database, not only in the server action:
-- `tickets_rw` already lets anyone with the shop and the `list` nav update a
-- ticket, so without this a caller lacking `list.delete` could still flip the
-- flag by hand through PostgREST.
create or replace function enforce_ticket_delete_capability()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null and not current_user_can('list.delete') then
      raise exception 'ไม่มีสิทธิ์ลบใบงาน' using errcode = '42501';
    end if;
    if new.deleted_at is null and not current_user_can('list.restore') then
      raise exception 'ไม่มีสิทธิ์กู้คืนใบงาน' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_delete_capability on tickets;
create trigger tickets_delete_capability
  before update of deleted_at on tickets
  for each row execute function enforce_ticket_delete_capability();

insert into supabase_migrations.schema_migrations(version, name) values ('0013', 'ticket_soft_delete') on conflict (version) do nothing;

-- ===== 0014_expense_attachments =====
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

create table if not exists expense_attachments (
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

create index if not exists expense_attachments_expense_idx on expense_attachments (expense_id);

-- Same shop scoping as `expenses` itself, and writing additionally requires the
-- accounting nav — mirroring how `tickets`/`orders` are written.
alter table expense_attachments enable row level security;
drop policy if exists expense_attachments_rw on expense_attachments;
create policy expense_attachments_rw on expense_attachments for all
  using (expense_id in (select id from expenses where shop_id in (select current_user_shops())))
  with check (
    expense_id in (select id from expenses where shop_id in (select current_user_shops()))
    and current_user_has_nav('accounting')
  );

-- Storage-side policies. `storage.objects` already has RLS enabled by Supabase;
-- these add the bucket's rules on top. Uploads and removals ride on the same
-- capability as creating the expense they belong to.
drop policy if exists expense_attachments_object_read on storage.objects;
create policy expense_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_has_nav('accounting'));

drop policy if exists expense_attachments_object_insert on storage.objects;
create policy expense_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));

drop policy if exists expense_attachments_object_delete on storage.objects;
create policy expense_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expense-attachments' and pos.current_user_can('accounting.addExpense'));

insert into supabase_migrations.schema_migrations(version, name) values ('0014', 'expense_attachments') on conflict (version) do nothing;

-- ===== 0015_ticket_item_interested =====
-- supabase/migrations/0015_ticket_item_interested.sql
--
-- Persist สินค้าที่สนใจ (the cheer-up baseline) on a ticket item.
--
-- The field has been in the form since the port — you pick the product the
-- customer originally came in for, its price fills in, and the item shows the
-- difference against what was actually sold. None of it survived a save:
-- `ticket_items` had no column for it and `serializeTicket` did not send it, so
-- reopening the ticket showed an empty picker and the cheer-up figure with it.
-- The trial run reported exactly that ("ข้อมูลหายไป").
--
-- Same shape as the `booked`/`booked_price` pair next to it, including the
-- not-null defaults, so an item that never had one reads as "not specified"
-- rather than NULL.

set search_path = pos, public, extensions;

alter table ticket_items
  add column if not exists interested text not null default '',
  add column if not exists interested_price numeric not null default 0;

comment on column ticket_items.interested is
  'สินค้าที่ลูกค้าสนใจตอนแรก — the baseline the cheer-up difference is measured from. Empty when not specified.';

-- `save_ticket_children` replaces a ticket''s items wholesale, so the two new
-- columns have to be written there or every save would silently reset them to
-- their defaults. Rest of the body is unchanged from migration 0011.
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
begin
  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0015', 'ticket_item_interested') on conflict (version) do nothing;

-- ===== 0016_option_manage_capability =====
-- supabase/migrations/0016_option_manage_capability.sql
--
-- `options.manage` — who may add or remove entries in the admin-managed option
-- lists (จองผ่าน, ประเภทรถ, ยี่ห้อรถ, ตำแหน่งติดตั้ง, บริการเสริม, ช่าง,
-- วิธีชำระเงิน, …).
--
-- The prototype let anyone extend these inline, and the trial run showed the
-- cost: the shared time-slot list filled with "16.00", "17.0", "12.00" typed by
-- whoever was booking, and every shop and ticket in the database sees the mess.
-- Selecting from a list is part of the job; changing what the list contains is
-- administration.
--
-- ADMIN ONLY by default, so this key is deliberately NOT in the
-- "admin + exec get everything" block — ผู้บริหาร does not maintain the
-- taxonomies either. An admin can still grant it to any role from จัดการสิทธิ์.

set search_path = pos, public, extensions;

create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker           -- runs as the caller, so RLS still applies
set search_path = pos
as $$
begin
  -- 1. The four default roles, upserted so existing ones keep their identity.
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- 2. Anyone on a soon-to-be-deleted custom role becomes an admin.
  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  -- 3. Drop custom roles (cascades to their role_permissions).
  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  -- 4. Replace the whole matrix for the default roles.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  -- nav (DEFAULT_NAV_PERMISSIONS, prototype :176-181, plus `customers`)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

  -- dashboard widgets + other capabilities (DEFAULT_DASHBOARD_PERMISSIONS, :196-201)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  -- module capabilities: admin + exec get everything (DEFAULT_MODULE_PERMISSIONS, :221-226)
  -- EXCEPT options.manage, handled separately below.
  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

-- Delta only, for the same reason as migration 0012: never wipe a live matrix.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','module_capability','options.manage',true),
  ('exec','module_capability','options.manage',false),
  ('sales','module_capability','options.manage',false),
  ('tech','module_capability','options.manage',false)
on conflict (role_id, permission_type, permission_key) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0016', 'option_manage_capability') on conflict (version) do nothing;

-- ===== 0017_ticket_lock =====
-- supabase/migrations/0017_ticket_lock.sql
--
-- ล็อกใบงานที่ปิดงานแล้ว.
--
-- A ticket that has been handed over AND paid in full is a closed record: it is
-- what the commission run, the revenue figures and any later dispute are read
-- from. Leaving it editable means a number can move months after the money did.
--
-- WHEN: the server action sets `locked` on save, when the ticket is
-- "ส่งมอบแล้ว" and `ticketPaid >= ticketTotal`. That condition is deliberately
-- evaluated in TypeScript, where `lib/domain/tickets.ts` already owns the
-- discount maths — re-implementing percent/amount discounts in SQL would be a
-- second copy free to drift from the first. The database's job here is to
-- enforce the FLAG, not to recompute the rule.
--
-- WHO CAN REOPEN: `list.unlock`, admin only. Unlocking is a normal update that
-- clears the flag, so the same trigger covers it.
--
-- The trigger is what makes this real: `tickets_rw` lets any member of the shop
-- update the row, so a UI-only lock could be walked around with a direct
-- PostgREST call.

set search_path = pos, public, extensions;

alter table tickets
  add column if not exists locked boolean not null default false;

comment on column tickets.locked is
  'Closed record (ส่งมอบแล้ว + ชำระครบ). Blocks edits to the ticket and its children until a list.unlock holder clears it.';

create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  -- Anything at all on a locked ticket — including clearing the flag — needs the
  -- capability. `old.locked` is what matters: a save that is in the act of
  -- locking the ticket must still be allowed through.
  if old.locked and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_lock_guard on tickets;
create trigger tickets_lock_guard
  before update on tickets
  for each row execute function enforce_ticket_lock();

-- The children are replaced wholesale by `save_ticket_children`, which is where
-- items, positions and payments would otherwise change without the tickets row
-- being touched at all.
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

-- `list.unlock`: admin only, like options.manage.
--
-- It has to go into `reset_permissions_to_defaults()` as well as the live
-- matrix, or the "รีเซ็ตค่าเริ่มต้น" button would delete the key and lock every
-- closed ticket permanently. Only the two admin-only lines below differ from
-- migration 0016's copy of this function.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys: maintaining the option lists, and reopening a closed ticket.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    ('sales','module_capability','list.unlock',false),
    ('tech','module_capability','list.unlock',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

-- Delta insert so a live matrix keeps whatever the shop has re-toggled.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','module_capability','list.unlock',true),
  ('exec','module_capability','list.unlock',false),
  ('sales','module_capability','list.unlock',false),
  ('tech','module_capability','list.unlock',false)
on conflict (role_id, permission_type, permission_key) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0017', 'ticket_lock') on conflict (version) do nothing;

-- ===== 0018_ticket_attachments =====
-- supabase/migrations/0018_ticket_attachments.sql
--
-- Real files for the two attachment points on a ticket: the transfer slip on a
-- payment row, and the QC photos taken before installation.
--
-- Both were the same defect the expense receipts had (migration 0014): the form
-- accepted files and kept only their NAMES in React state. The slip was worse —
-- `ticket_payments` had no column at all, so it did not even survive the save;
-- `qcPhotos` at least persisted, as a list of names pointing at nothing.
--
-- These are the shop's evidence that money arrived and that a car had a scratch
-- before it was touched, so they belong in storage, not in a string.
--
-- Own bucket rather than reusing `expense-attachments`: a ticket is readable by
-- anyone with the `list` nav (a technician included), an expense receipt only by
-- the accounting roles. One bucket would have to satisfy the looser of the two.

set search_path = pos, public, extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,  -- 10 MB, same as the receipts: a phone photo, not a scan archive
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

-- The slip lives with its payment row, which `save_ticket_children` replaces
-- wholesale — an array on the row keeps it attached to the payment it belongs to
-- without a second table to keep in step.
alter table ticket_payments
  add column if not exists attachments text[] not null default '{}';

comment on column ticket_payments.attachments is
  'Storage paths in the `ticket-attachments` bucket — the transfer slips for this payment.';

create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at, attachments)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date),
    -- `jsonb_array_elements_text` over an absent key yields no rows, which
    -- aggregates to NULL — coalesce keeps the NOT NULL default shape.
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(pay->'attachments', '[]'::jsonb))),
      '{}'
    )
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

-- Storage policies: the ticket module's own nav is the gate, so a technician who
-- can open the ticket can also see the QC photos on it and add more.
drop policy if exists ticket_attachments_object_read on storage.objects;
create policy ticket_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

drop policy if exists ticket_attachments_object_insert on storage.objects;
create policy ticket_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

drop policy if exists ticket_attachments_object_delete on storage.objects;
create policy ticket_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

insert into supabase_migrations.schema_migrations(version, name) values ('0018', 'ticket_attachments') on conflict (version) do nothing;
