-- supabase/migrations/0040_order_soft_delete.sql
--
-- ลบ PO ขายส่งได้ — แบบย้ายเข้าถังขยะ
--
-- A PO raised by mistake could not be removed at all. There was no delete of any
-- kind in the wholesale module, so the branch's very first PO — WS-NORTH-0001 —
-- sits in the list forever, and the only way past it was to leave a 0-baht order
-- in ทั้งหมด and in every figure derived from it.
--
-- A SOFT delete, for the same reasons ใบงาน got one in 0013:
--   * `on delete cascade` on the four child tables would take the items, the
--     returns, the price-approval reasons and the RECORDED PAYMENTS with it, and
--     nothing could bring them back;
--   * the PO number is issued by the database (0036) and must stay issued. A
--     deleted WS-CM-0001 is not handed out again, so restoring it cannot collide
--     with a PO raised in the meantime.
--
-- Stock IS rewound by the delete action, unlike 0013's original position: a
-- wholesale PO deducts goods on save, and a PO that should not exist did not
-- take goods off the shelf. Restoring deducts them again.

set search_path = pos, public, extensions;

alter table orders
  add column deleted_at timestamptz,
  add column deleted_by uuid references app_users(id);

-- Every list query filters on this and the bin is the rare case, so index the
-- live rows rather than the whole column — the same shape as tickets_live_idx.
create index orders_live_idx on orders (shop_id) where deleted_at is null;

comment on column orders.deleted_at is
  'Soft-delete flag. NULL = live. Set by ลบ PO (capability wholesale.delete), cleared by กู้คืน (capability wholesale.restore).';

-- The capability check lives in the database, not only in the server action.
-- `orders_rw` lets anyone with the branch update the row, so without this a
-- caller lacking wholesale.delete could still flip the flag through PostgREST.
create or replace function enforce_order_delete_capability()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null and not current_user_can('wholesale.delete') then
      raise exception 'ไม่มีสิทธิ์ลบ PO' using errcode = '42501';
    end if;
    if new.deleted_at is null and not current_user_can('wholesale.restore') then
      raise exception 'ไม่มีสิทธิ์กู้คืน PO' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_delete_capability
  before update of deleted_at on orders
  for each row execute function enforce_order_delete_capability();

-- Seeded to match ใบงาน exactly: whoever may delete a job may delete a PO, and
-- putting one back is an admin/ผู้บริหาร decision. Nothing is granted to a role
-- that could not already remove a record of the same weight.
insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.delete', r.id in ('admin', 'exec', 'sales')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.restore', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

-- `reset_permissions_to_defaults()` is rebuilt to carry both new keys. A reset
-- that dropped them would leave the delete button ungoverned — the same failure
-- the coverage guard in tests/unit/components/permissions exists to catch.
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

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;
