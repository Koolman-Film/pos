-- supabase/migrations/0002_permissions.sql
create type permission_type as enum ('nav', 'dashboard_widget', 'module_capability');

create table role_permissions (
  role_id text not null references roles(id) on delete cascade,
  permission_type permission_type not null,
  permission_key text not null,
  allowed boolean not null default false,
  primary key (role_id, permission_type, permission_key)
);

-- nav permissions (spec: DEFAULT_NAV_PERMISSIONS, reference/v0.4/finnix-film.html:176-181)
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
  ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
  ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
  ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

-- dashboard widget + other-capability permissions (DEFAULT_DASHBOARD_PERMISSIONS, lines 196-201)
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
  ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
  ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
  ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

-- module capability permissions (DEFAULT_MODULE_PERMISSIONS, lines 221-226; admin/exec = all true)
insert into role_permissions (role_id, permission_type, permission_key, allowed)
  select r.id, 'module_capability', c.key, true
  from roles r, (values
    ('list.createNew'),('list.printSheet'),('wholesale.createNew'),('wholesale.priceApproval'),
    ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
    ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
    ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
  ) as c(key)
  where r.id in ('admin','exec');

insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','wholesale.createNew',true),
  ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
  ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
  ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
  ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
  ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','wholesale.createNew',false),
  ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
  ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
  ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',false), ('tech','module_capability','commission.addRule',false),
  ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
