-- supabase/migrations/0009_reset_permissions_to_defaults.sql
--
-- Restores the "รีเซ็ตค่าเริ่มต้น" button from the prototype's Permissions module
-- (reference/v0.4/finnix-film.html:4033-4039,4047).
--
-- The prototype could implement this in three lines — `setRoles(DEFAULT_ROLES)`,
-- `setNavPermissions(DEFAULT_NAV_PERMISSIONS)`, … — because its defaults were live
-- JavaScript constants sitting next to the state. In the port those defaults exist
-- only as literal INSERTs inside migration 0002, which has already run and is not
-- addressable at runtime.
--
-- So the default matrix becomes a function. It is the SINGLE SOURCE OF TRUTH from
-- here on: the reset action calls it, and `tests/rls/permission_defaults.test.ts`
-- asserts that calling it on an untouched database is a no-op, which is what keeps
-- it honest against 0002.
--
-- Faithful to the prototype's semantics, including the destructive parts:
--   * roles are restored to exactly the four defaults, so CUSTOM ROLES ARE DROPPED
--     (`setRoles(DEFAULT_ROLES)` did precisely that), and `on delete cascade` on
--     role_permissions/app_users.role_id carries their rows with them;
--   * users holding a dropped role are moved to 'admin', mirroring the
--     prototype's `if (!DEFAULT_ROLES.some(r => r.id === role)) setRole('admin')`.
--     The prototype only had to fix up the *current* user because role was UI
--     state; here the row is real and `app_users.role_id` is NOT NULL, so every
--     affected user has to land somewhere.

-- Everything below is created in the `pos` schema, not `public` — see
-- 0000_pos_schema.sql for why. This applies for the rest of the file.
set search_path = pos, public, extensions;

create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker           -- runs as the caller, so RLS still applies
set search_path = pos
as $$
begin
  -- 1. The four default roles, upserted so existing ones keep their identity.
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- 2. Anyone on a soon-to-be-deleted custom role becomes an admin.
  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  -- 3. Drop custom roles (cascades to their role_permissions).
  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  -- 4. Replace the whole matrix for the default roles.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  -- nav (DEFAULT_NAV_PERMISSIONS, prototype :176-181)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

  -- dashboard widgets + other capabilities (DEFAULT_DASHBOARD_PERMISSIONS, :196-201)
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  -- module capabilities: admin + exec get everything (DEFAULT_MODULE_PERMISSIONS, :221-226)
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
end;
$$;

-- Only a caller who holds the `permissions` nav may reset the matrix — the same
-- gate the module's other writes use. Revoking anon leaves no path in for a
-- logged-out caller either.
revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

-- Calling it now is a no-op on a fresh database (the values equal 0002's seed);
-- on a database whose matrix has drifted it realigns it with this function, which
-- is what makes the function authoritative from here on.
select reset_permissions_to_defaults();
