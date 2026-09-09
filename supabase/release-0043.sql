-- supabase/release-0043.sql
--
-- ทะเบียนแหล่งเงิน: ยอดตั้งต้น และการโอน/ฝากเงินระหว่างแหล่งเงิน
--
-- รันต่อจาก release-0042.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists / on conflict do nothing /
-- การคัดลอกเงินสดย่อยมี not exists กันซ้ำ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- ทะเบียนแหล่งเงิน: ยอดตั้งต้น และการโอน/ฝากเงินระหว่างแหล่งเงิน
--
-- The dashboard could not say how much money the shop has. It knew what came in
-- against a payment method and what went out against an expense source, both
-- only since the day the system was switched on — so any figure it printed was
-- movement, not a balance. A bank account held money before that day, and the
-- cash the counter takes is banked or moved into เงินสดย่อย without either leg
-- being recorded anywhere.
--
-- Two things fix that, and both are here:
--
--   * `money_accounts` — every place the branch keeps money, with the balance it
--     started from and the date that balance was true. That is the missing
--     opening figure, and it is EDITABLE: a shop that mistypes it, or that
--     reconciles against a statement later, must be able to correct it without
--     inventing a fake transaction.
--
--   * `money_transfers` — moving money between two of those places. Banking the
--     day's cash and topping up เงินสดย่อย are the same operation with different
--     ends, and neither is income or expense: the business is no richer, the
--     money is somewhere else. Recording them as transfers is what stops the
--     same 5,000 baht being counted twice.
--
-- MATCHING EXISTING HISTORY. `ticket_payments.method` and `expenses.source` are
-- free text from option lists ('โอน TTB', 'บัญชีธนาคารสาขา'). Rather than
-- rewrite three tables of live history, an account carries `match_names`: the
-- labels that mean it. Existing rows attach to their account the moment the
-- account names them, and nothing about how the shop records a payment today has
-- to change.

set search_path = pos, public, extensions;

create table if not exists money_accounts (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  -- What the shop calls it: 'Kbank', 'เงินสดหน้าร้าน', 'เงินสดย่อย'.
  name text not null,
  -- 'bank' | 'cash' | 'petty' | 'credit'. Drives the icon and the ordering, not
  -- the arithmetic — every kind is a place money sits.
  kind text not null default 'bank',
  account_no text not null default '',
  opening_balance numeric(12, 2) not null default 0,
  -- The date the opening balance was true. Movements before it belong to
  -- whatever the shop was doing previously and are NOT added on top.
  opened_at date not null default current_date,
  /*
    The labels in `ticket_payments.method` / `order_payments.method` /
    `expenses.source` that mean this account. Empty is fine: a brand-new bank
    account has no history to claim.
  */
  match_names text[] not null default '{}',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

comment on column money_accounts.opening_balance is
  'ยอดตั้งต้น ณ วันที่ opened_at. Editable — correcting it is reconciliation, not a transaction.';
comment on column money_accounts.match_names is
  'ป้ายกำกับใน ticket_payments.method / expenses.source ที่หมายถึงบัญชีนี้.';

create index if not exists money_accounts_shop_idx on money_accounts (shop_id, sort_order)
  where active;

create table if not exists money_transfers (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  /*
    Either end may be null, and that is deliberate rather than sloppy:
      * from null = money arriving from outside the register (the owner putting
        capital in, an opening float nobody had recorded);
      * to null = money leaving it and not becoming an expense — repaying a
        director who fronted cash, or the owner drawing money out. Neither is
        a cost to the business, so forcing it through ค่าใช้จ่าย would inflate
        the expense figure and understate the profit by the same amount.
    Forcing both ends would make the shop invent an account to satisfy the
    schema, and an invented account is worse than an honest blank.
  */
  from_account_id bigint references money_accounts(id) on delete set null,
  to_account_id bigint references money_accounts(id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  moved_at date not null default current_date,
  note text not null default '',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A transfer that goes nowhere is a typo, not a record.
  constraint money_transfers_has_an_end check (
    from_account_id is not null or to_account_id is not null
  ),
  constraint money_transfers_not_circular check (
    from_account_id is null
    or to_account_id is null
    or from_account_id <> to_account_id
  )
);

create index if not exists money_transfers_shop_idx on money_transfers (shop_id, moved_at desc);
create index if not exists money_transfers_from_idx on money_transfers (from_account_id) where from_account_id is not null;
create index if not exists money_transfers_to_idx on money_transfers (to_account_id) where to_account_id is not null;

alter table money_accounts enable row level security;
alter table money_transfers enable row level security;

-- Same shape as every other shop-scoped table: you see and touch your branches.
drop policy if exists money_accounts_rw on money_accounts;
create policy money_accounts_rw on money_accounts for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

drop policy if exists money_transfers_rw on money_transfers;
create policy money_transfers_rw on money_transfers for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/*
  Seed one account per existing source, per branch, so the register is not empty
  on day one and every historical payment already attaches to something.

  Opening balance 0 and `opened_at` = today: the shop types the real figures in
  once, and until it does the card shows what the system genuinely knows rather
  than a number somebody might believe.
*/
insert into money_accounts (shop_id, name, kind, match_names, sort_order)
select s.id, a.name, a.kind, a.match_names, a.sort_order
from shops s
cross join (values
  ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                            1),
  ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
  ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                        3),
  ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],        4)
) as a(name, kind, match_names, sort_order)
on conflict (shop_id, name) do nothing;

/*
  เงินสดย่อย top-ups become transfers INTO the petty account.

  `petty_cash` stays exactly as it is — บัญชี/ค่าใช้จ่าย reads and writes it, and
  its ledger is a screen the shop uses. This copies each top-up across so the
  balance arithmetic has one place to look, with `from` left null because the
  original rows never recorded where the money came from.
*/
insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note)
select
  p.shop_id,
  null,
  (select a.id from money_accounts a where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย'),
  p.amount,
  p.entry_at::date,
  case when coalesce(p.note, '') = '' then 'เติมเงินสดย่อย' else p.note end
from petty_cash p
where p.type = 'เติมเงิน'
  and exists (select 1 from money_accounts a where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย')
  -- Guarded so a re-run cannot double the shop’s petty cash. The release copy
  -- of this file is run by hand from the SQL editor, where "did that go
  -- through?" is answered by running it again.
  --
  -- Matched on the DESTINATION rather than on `from_account_id is null`: once a
  -- shop says where a top-up came from, that earlier version had nothing to
  -- recognise and copied the row a second time.
  and not exists (
    select 1 from money_transfers t
    where t.shop_id = p.shop_id
      and t.moved_at = p.entry_at::date
      and t.amount = p.amount
      and t.to_account_id = (
        select a.id from money_accounts a
        where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย'
      )
  );

/*
  การกระทบยอด — what was actually counted, against what the system says.

  This is the register's real job: the shop counts the drawer and reads the bank
  statement, and the difference from the computed balance is the thing worth
  looking at. Recorded rather than corrected, on purpose — silently editing the
  opening balance to make a difference disappear destroys the only evidence that
  it happened. A row here says "on this date we counted this much", and the
  screen shows the gap.
*/
create table if not exists money_reconciliations (
  id bigint generated always as identity primary key,
  account_id bigint not null references money_accounts(id) on delete cascade,
  counted_at date not null default current_date,
  counted_balance numeric(12, 2) not null,
  /** What the system said at the moment of counting, kept so the gap survives
      later edits to older transactions. */
  system_balance numeric(12, 2) not null,
  note text not null default '',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists money_reconciliations_account_idx
  on money_reconciliations (account_id, counted_at desc);

alter table money_reconciliations enable row level security;

drop policy if exists money_reconciliations_rw on money_reconciliations;
create policy money_reconciliations_rw on money_reconciliations for all
  using (
    account_id in (
      select a.id from money_accounts a where a.shop_id in (select current_user_shops())
    )
  )
  with check (
    account_id in (
      select a.id from money_accounts a where a.shop_id in (select current_user_shops())
    )
  );

insert into supabase_migrations.schema_migrations(version, name) values ('0043', 'money_accounts') on conflict (version) do nothing;
