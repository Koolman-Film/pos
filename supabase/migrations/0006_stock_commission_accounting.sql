-- supabase/migrations/0006_stock_commission_accounting.sql
create table stock (
  id bigint generated always as identity primary key,
  sku text not null unique,
  name text not null,
  short_name text not null default '',
  category text not null,
  shop_id text not null references shops(id),
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  cost numeric not null default 0,
  sell_price numeric not null default 0
);

create table withdrawals (
  id bigint generated always as identity primary key,
  item text not null,
  shop_id text not null references shops(id),
  qty numeric not null,
  type text not null,
  withdrawn_by text not null,
  withdrawn_at date not null,
  status text not null default 'รออนุมัติ'
);

create table commission_rules (
  id bigint generated always as identity primary key,
  category text not null,
  name text not null,
  type text not null,                    -- 'percent_of_sale' | 'fixed_per_job'
  value numeric not null,
  shop_id text references shops(id),     -- null = 'all'
  active boolean not null default true
);

create table commission_rule_teams (
  commission_rule_id bigint not null references commission_rules(id) on delete cascade,
  team_member text not null,
  primary key (commission_rule_id, team_member)
);

create table expenses (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id),
  description text not null,
  category text not null,
  source text not null,
  amount numeric not null,
  status text not null,                  -- 'จ่ายแล้ว' | 'รอจ่าย'
  paid_at date,
  due_at date
);

create table petty_cash (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id),
  type text not null,                    -- 'เติมเงิน' | ...
  amount numeric not null,
  entry_at date not null,
  note text not null default ''
);
