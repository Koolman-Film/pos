-- supabase/migrations/0005_wholesale.sql
create table wholesale_customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default '',
  address text not null default ''
);

create table orders (
  id text primary key,                     -- e.g. 'WS-CM-0091'
  shop_id text not null references shops(id),
  customer_id bigint references wholesale_customers(id),
  status text not null references ws_statuses(key),
  created_at timestamptz not null default now()
);

create table order_items (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  name text not null,
  qty numeric not null,
  list_price numeric not null,
  requested_price numeric not null,
  reason text not null default ''
);

create table order_returns (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  item_name text not null,
  qty numeric not null,
  reason text not null default ''
);

create table order_payments (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  amount numeric not null,
  method text not null,
  paid_at date not null
);

create table order_adjustments (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  amount numeric not null,
  reason text not null default '',
  adjusted_at date not null
);
