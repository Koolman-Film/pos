-- supabase/migrations/0001_identity_and_shops.sql

-- Restore the classic Supabase default privileges for the API roles on `public`.
-- The Postgres 17.6 Supabase image no longer auto-grants SELECT/INSERT/UPDATE/DELETE on
-- newly created public tables to anon/authenticated/service_role (only D/x/t/m), so
-- PostgREST returns 42501 "permission denied for table ..." without this. Row access is
-- still gated by the RLS policies in 0007 — this only restores table-level reachability,
-- which is the model the rest of this schema is written against.
-- Everything below is created in the `pos` schema, not `public` — see
-- 0000_pos_schema.sql for why. This applies for the rest of the file.
set search_path = pos, public, extensions;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

create table shops (
  id text primary key,
  name text not null,
  sort_order int not null default 0
);

create table shop_info (
  shop_id text primary key references shops(id) on delete cascade,
  address text not null default '',
  phone text not null default '',
  company_name text not null default '',
  tax_id text not null default '',
  payment_channels text[] not null default '{}'
);

create table roles (
  id text primary key,
  name text not null,
  icon text not null default 'fa-user'
);

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role_id text not null references roles(id),
  active boolean not null default true,
  sees_all_shops boolean not null default false
);

create table user_shop_access (
  user_id uuid not null references app_users(id) on delete cascade,
  shop_id text not null references shops(id) on delete cascade,
  primary key (user_id, shop_id)
);

insert into shops (id, name, sort_order) values
  ('cm', 'FINNIX FILM เชียงใหม่', 1),
  ('lp', 'FINNIX FILM ลำพูน', 2),
  ('py', 'FINNIX FILM พะเยา', 3),
  ('lpg', 'FINNIX FILM ลำปาง', 4),
  ('ca', 'Central Audio', 5);

insert into shop_info (shop_id, address, phone) values
  ('cm', '4/9 ถนนมหิดล ตำบลป่าแดด อำเภอเมืองเชียงใหม่ จ.เชียงใหม่ 50100', '098-262-5623'),
  ('lp', '', ''), ('py', '', ''), ('lpg', '', ''), ('ca', '', '');

insert into roles (id, name, icon) values
  ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
  ('exec', 'ผู้บริหาร', 'fa-crown'),
  ('sales', 'พนักงานขาย', 'fa-user-tie'),
  ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench');
