-- supabase/release-0047.sql
--
-- พนักงานขายของโมดูลขายส่ง
--
-- รันต่อจาก release-0046.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists / add column if not exists /
-- create index if not exists / on conflict do nothing
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- พนักงานขายของโมดูลขายส่ง
--
-- Finnix North sells through two people, โหน่ง and เคน, and their documents are
-- meant to carry the shop name and THAT PERSON's phone number — a wholesale
-- customer rings the rep who sold to them, not a branch switchboard.
--
-- WHY A TABLE AND NOT AN OPTION LIST. The design note first put these names in
-- `option_lists`, which is where every other people-list in this system lives
-- (technicians, commission teams). That works while a person is only a name.
-- A phone number printed on a customer's invoice is a second field, and packing
-- two fields into one option value ("โหน่ง · 081-…") makes the phone unsearchable,
-- unvalidatable and impossible to change without editing the name. So: a table.
--
-- `orders.sales_by` still stores the NAME, not a foreign key. โหน่ง and เคน may
-- never have logins, a person can leave while their POs must keep saying who
-- sold them, and every other "who did this" column in this schema
-- (`tickets.tech_by_category`, `service_visits.sales_by`) is a name for exactly
-- those reasons. The table is the picker and the phone book; the PO keeps the
-- name it was sold under.

set search_path = pos, public, extensions;

create table if not exists sales_people (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  name text not null,
  phone text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

comment on table sales_people is
  'พนักงานขายของแต่ละสาขา. The phone is printed on that person''s wholesale documents.';

create index if not exists sales_people_shop_idx on sales_people (shop_id, sort_order) where active;

alter table sales_people enable row level security;

-- Readable by anyone signed in, because a document printed for another branch
-- still has to render the rep's name; writable only within your own branches.
drop policy if exists sales_people_select on sales_people;
create policy sales_people_select on sales_people for select
  using (auth.uid() is not null);

drop policy if exists sales_people_write on sales_people;
create policy sales_people_write on sales_people for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

alter table orders
  -- The NAME, matching `sales_people.name` within the branch. Empty on every
  -- existing PO: nobody recorded who sold them, and assigning them to whoever
  -- is on the list today would put another person's sales in their column.
  add column if not exists sales_by text not null default '';

comment on column orders.sales_by is
  'พนักงานขายที่ขาย PO ใบนี้ — ชื่อ ไม่ใช่ FK. ว่างหมายถึงยังไม่ได้ระบุ.';

create index if not exists orders_sales_by_idx on orders (shop_id, sales_by) where sales_by <> '';

-- โหน่ง และ เคน. Seeded only if Finnix North exists — a database that has not
-- created that branch yet gets nothing, and adding it later is a screen away.
insert into sales_people (shop_id, name, phone, sort_order)
select 'north', p.name, p.phone, p.sort_order
from (values
  ('โหน่ง', '', 1),
  ('เคน', '', 2)
) as p(name, phone, sort_order)
where exists (select 1 from shops where id = 'north')
on conflict (shop_id, name) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0047', 'sales_people') on conflict (version) do nothing;
