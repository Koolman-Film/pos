-- supabase/release-0026.sql
--
-- สมุดบัญชีสต็อก — บันทึกทุกการเคลื่อนไหว พร้อมจำนวนก่อน/หลัง
--
-- รันต่อจาก release-0025.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, add column if not exists, insert แบบ on conflict
--
-- หมายเหตุ: สมุดบัญชีเริ่มนับจากวันที่รันไฟล์นี้ ของเดิมใน withdrawals ไม่มี
-- จำนวนก่อน/หลังให้ย้ายมา จึงปล่อยไว้ที่เดิมเป็นประวัติเก่า
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0026_stock_ledger.sql
--
-- สมุดบัญชีสต็อก — บันทึกทุกการเคลื่อนไหว พร้อมจำนวนก่อน/หลัง
--
-- `withdrawals` was doing two jobs at once. It was the shop's ใบขอเบิก — a
-- request waiting for a manager — and it was also the audit log every automatic
-- movement wrote into, with the reason encoded in a Thai sentence
-- ("ตัดสต็อกจากใบงาน (JT-CM-00216)") and the product identified by NAME. Neither
-- job was done well:
--
--   * รับของเข้า and ปรับสต็อก wrote nothing at all — the two operations that
--     move stock most often left no trace, so "why did this drop from 20 to 8"
--     had no answer.
--   * There was no before/after, so a balance could not be reconstructed for a
--     date.
--   * The product was a name, so a rename detached the history from the product.
--   * "รออนุมัติ" had no approve button anywhere in the app. The pill was
--     decoration.
--
-- So the two jobs split. `stock_movements` is the ledger: one row per movement,
-- keyed by `stock_id`, carrying qty before and after, written by the same
-- function that changes the quantity so the two can never disagree.
-- `withdrawals` goes back to being only the request, and gains a real decision.
--
-- The ledger starts empty. Old `withdrawals` rows stay where they are as the
-- history that existed before this — they carry no before/after to import.

set search_path = pos, public, extensions;

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  -- Kept when a product is deleted: the movement happened, and a ledger that
  -- forgets its own entries is not a ledger.
  stock_id bigint references stock(id) on delete set null,
  -- Snapshot of the name at the time, so a later rename does not rewrite history.
  item_name text not null default '',
  shop_id text not null references shops(id) on delete cascade,

  -- ใบงาน | ขายส่ง | รับเข้า | ปรับสต็อก | เบิกใช้ | คืนจากใบเบิก | ยกเลิกใบงาน | กู้คืนใบงาน
  kind text not null,
  -- The document behind it: JT-CM-00216, an order id, or blank for a count.
  document_id text not null default '',

  -- Signed: negative consumes, positive returns or receives.
  change numeric(12, 2) not null,
  qty_before numeric(12, 2) not null,
  qty_after numeric(12, 2) not null,

  note text not null default '',
  moved_at timestamptz not null default now(),
  moved_by uuid references app_users(id) on delete set null,
  -- The name as well as the id: the prototype credited a person, and a user row
  -- removed later should not blank out who did it.
  moved_by_name text not null default ''
);

comment on table stock_movements is
  'สมุดบัญชีสต็อก — ทุกการเคลื่อนไหวพร้อมจำนวนก่อน/หลัง อ้างอิงสินค้าด้วย id';

create index if not exists stock_movements_stock_idx on stock_movements (stock_id, moved_at desc);
create index if not exists stock_movements_shop_idx on stock_movements (shop_id, moved_at desc);
create index if not exists stock_movements_doc_idx on stock_movements (document_id);

alter table stock_movements enable row level security;
drop policy if exists stock_movements_rw on stock_movements;
create policy stock_movements_rw on stock_movements for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/**
 * เปลี่ยนจำนวนสต็อก พร้อมลงบัญชีในคำสั่งเดียว.
 *
 * Supersedes `apply_stock_deltas` (0025), which moved the quantity correctly but
 * left the logging to the caller — so a caller that forgot, or a caller added
 * later, produced a silent movement. Doing both here means an unlogged movement
 * is not expressible.
 *
 * `p_changes` is `[{"id": 12, "change": -2}, ...]`; `change` is added to `qty`.
 * The before/after come out of the same UPDATE, so they are the real values at
 * that instant even when two callers land together.
 *
 * Still not clamped at zero — see 0025. A negative figure is a signal.
 */
create or replace function move_stock(
  p_changes jsonb,
  p_kind text,
  p_document_id text,
  p_by_name text,
  p_note text default ''
)
returns void
language sql
security invoker
set search_path = pos
as $$
  with c as (
    select x.id, x.change
      from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(id bigint, change numeric)
     where x.id is not null and coalesce(x.change, 0) <> 0
  ),
  upd as (
    update stock s
       set qty = s.qty + c.change
      from c
     where s.id = c.id
    returning s.id, s.name, s.shop_id, s.qty as qty_after, c.change as change
  )
  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, moved_by, moved_by_name, note
  )
  select
    u.id, u.name, u.shop_id, p_kind, coalesce(p_document_id, ''),
    u.change, u.qty_after - u.change, u.qty_after,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  from upd u;
$$;

revoke all on function move_stock(jsonb, text, text, text, text) from public, anon;
grant execute on function move_stock(jsonb, text, text, text, text) to authenticated;

/**
 * ปรับสต็อกตามผลนับจริง.
 *
 * A count is an ABSOLUTE figure, not a delta — the shelf holds what it holds. The
 * difference is read inside the statement, so the ledger records the movement
 * that actually happened rather than one derived from a number the client read a
 * moment earlier.
 *
 * A count that matches what the system already holds writes nothing: it is not a
 * movement, and a ledger full of zero-change rows is harder to read than one
 * without them.
 */
create or replace function count_stock(
  p_id bigint,
  p_counted numeric,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
  v_name text;
  v_shop text;
begin
  select qty, name, shop_id into v_before, v_name, v_shop
    from stock where id = p_id for update;
  if not found or v_before = p_counted then
    return;
  end if;

  update stock set qty = p_counted where id = p_id;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, moved_by, moved_by_name, note
  ) values (
    p_id, v_name, v_shop, 'ปรับสต็อก', '',
    p_counted - v_before, v_before, p_counted,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  );
end;
$$;

revoke all on function count_stock(bigint, numeric, text, text) from public, anon;
grant execute on function count_stock(bigint, numeric, text, text) to authenticated;

-- ใบขอเบิก gets a real decision, and a link to the product it took.
alter table withdrawals
  add column if not exists stock_id bigint references stock(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references app_users(id) on delete set null;

comment on column withdrawals.stock_id is
  'สินค้าที่เบิก — อ้างด้วย id เพื่อให้การคืนของตอนไม่อนุมัติหาแถวถูก แม้ชื่อจะถูกแก้';

-- อนุมัติ/ไม่อนุมัติใบเบิก. Requesting one is `stock.withdraw`; signing it off is
-- a manager's decision and gets its own key, so a หัวหน้าช่าง can take stock
-- without also being able to approve their own withdrawal.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','module_capability','stock.approveWithdraw',true),
  ('exec','module_capability','stock.approveWithdraw',true),
  ('sales','module_capability','stock.approveWithdraw',false),
  ('tech','module_capability','stock.approveWithdraw',false)
on conflict (role_id, permission_type, permission_key) do nothing;

-- And into the reset, or "รีเซ็ตค่าเริ่มต้น" would delete the key and nobody
-- could approve a withdrawal again. Only the four new lines differ from 0024's
-- copy of this function.
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
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

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
    ('admin','module_capability','stock.approveWithdraw',true),
    ('exec','module_capability','stock.approveWithdraw',true),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.approveWithdraw',false),
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

insert into supabase_migrations.schema_migrations(version, name) values ('0026', 'stock_ledger') on conflict (version) do nothing;
