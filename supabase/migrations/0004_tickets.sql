-- supabase/migrations/0004_tickets.sql
-- Everything below is created in the `pos` schema, not `public` — see
-- 0000_pos_schema.sql for why. This applies for the rest of the file.
set search_path = pos, public, extensions;

create table retail_customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default ''
);

create table tickets (
  id text primary key,                       -- e.g. 'JT-CM-00214', kept as the human-readable job number
  shop_id text not null references shops(id),
  retail_customer_id bigint references retail_customers(id),
  customer_name text not null,                -- denormalized snapshot, matches prototype's t.customer
  phone text not null default '',
  plate text not null default '',
  car_type text not null default '',
  brand text not null default '',
  model text not null default '',
  color text not null default '',
  service_type text not null default '',
  status text not null references statuses(key),
  booking_channel text not null default '',
  tech_by_category jsonb not null default '{}',   -- {"ฟิล์มกรองแสง": ["ช่างเอก"], ...} — kept as jsonb, not normalized: it's a free-form category→technician-list map edited only through the ticket form, never queried/filtered on independently
  drop_off_date timestamptz not null,
  pickup_date timestamptz not null,
  extras jsonb not null default '{}',             -- {"ประกัน": {"checked": true}, ...} — same rationale as tech_by_category
  created_at timestamptz not null default now()
);

create table ticket_items (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  category text not null,
  booked text not null default '',
  booked_price numeric not null default 0,
  sold text not null default '',
  sold_price numeric not null default 0,
  discount_type text,                              -- 'percent' | 'amount' | null
  discount_value numeric
);

create table ticket_item_positions (
  id bigint generated always as identity primary key,
  ticket_item_id bigint not null references ticket_items(id) on delete cascade,
  position text not null,
  product text not null,
  price numeric not null
);

create table ticket_payments (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  type text not null,
  method text not null,
  amount numeric not null,
  paid_at date not null
);

create table ticket_status_history (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  status text not null,
  changed_at timestamptz not null default now()
);
