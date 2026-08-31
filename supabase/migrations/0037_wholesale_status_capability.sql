-- supabase/migrations/0037_wholesale_status_capability.sql
--
-- เปลี่ยนสถานะ PO ต้องมีสิทธิ์
--
-- Moving a PO to ปิดงานแล้ว closes it, and moving it back reopens one that was
-- closed. Those are decisions of the same weight as approving a discount or
-- writing off a debt — both of which have always been gated — and leaving the
-- status dropdown open meant the other two could simply be walked around.
--
-- Seeded TRUE for every role that could already do it, which is every role: this
-- changes who CAN be stopped, not what anybody may do today. An admin can now
-- take it away from a role that should not have it.
--
-- `reset_permissions_to_defaults()` is rebuilt to carry the key, because a reset
-- that drops it would quietly un-gate the button again.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.updateStatus', true
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

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
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',false), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),('list.unlock'),
      ('customers.edit'),('options.manage'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',false), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
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
    ('tech','module_capability','wholesale.updateStatus',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',false),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;
