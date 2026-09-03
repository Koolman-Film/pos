-- supabase/revert-0031-0041.sql
--
-- ทางถอยกลับของ 0031-0041 — ใช้เมื่อจำเป็นเท่านั้น
--
-- ลำดับที่ควรใช้จริง:
--   1. ถอย CODE ที่ Vercel ก่อนเสมอ (rollback ทันที ไม่เสียข้อมูล). สคีมานี้
--      เข้ากันได้กับโค้ดเก่าอยู่แล้ว — คอลัมน์ใหม่ทุกตัวเป็น NOT NULL ที่มี
--      DEFAULT ไม่มีคอลัมน์หรือฟังก์ชันไหนถูกลบ และฟังก์ชันใหม่ก็ชื่อใหม่ทั้งหมด
--      โค้ดเก่าจึงทำงานบนสคีมาใหม่ได้ตามปกติ
--   2. รันไฟล์นี้เฉพาะเมื่อต้องถอยสคีมาจริง ๆ เท่านั้น
--
-- ข้อมูลที่จะหายเมื่อรันไฟล์นี้ (ยอมรับก่อนรัน):
--   - tickets.revenue_kind   ใบงานไหนเป็น "รับแทน Finnix"
--   - expenses.expense_kind  ค่าใช้จ่ายไหนจ่ายแทน Finnix
--   - shop_info.vat_registered  สาขาไหนจดทะเบียน VAT
--   - orders.deleted_at         PO ไหนถูกลบไว้ (จะกลับมาเป็น PO ปกติ)
--   - insurance_claims รับ-ส่ง  วันเวลารับ-ส่งรถของการเคลม
--
-- สิ่งที่จงใจไม่ถอย เพราะถอยแล้วเสียมากกว่าได้:
--   - แถวสิทธิ์ที่ 0033/0037 เพิ่มไว้ — ไม่มีโค้ดเก่าอ่าน จึงไม่มีผล และการลบ
--     ทิ้งอาจลบค่าที่แอดมินตั้งเองไปด้วย
--   - on update cascade บน FK ของ orders (0036) — ปลอดภัยกว่าของเดิม

set search_path = pos, public, extensions;

-- ---- 0041: วันเวลารับ-ส่งของการเคลม ---------------------------------------
drop index if exists insurance_claims_received_idx;
alter table insurance_claims
  drop column if exists received_at,
  drop column if exists received_time,
  drop column if exists delivered_at,
  drop column if exists delivered_time;

create or replace function save_insurance_policy(
  p_id bigint,
  p_ticket_id text,
  p_policy jsonb,
  p_claims jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
begin
  if p_id is null then
    insert into insurance_policies (
      ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
      sold_at, starts_at, ends_at, notes, created_by
    ) values (
      p_ticket_id,
      coalesce(p_policy->>'plate', ''),
      coalesce(p_policy->>'planName', ''),
      coalesce((p_policy->>'price')::numeric, 0),
      coalesce((p_policy->>'bigPieces')::int, 0),
      coalesce((p_policy->>'smallPieces')::int, 0),
      coalesce(p_policy->>'terms', ''),
      coalesce((p_policy->>'soldAt')::date, current_date),
      (p_policy->>'startsAt')::date,
      (p_policy->>'endsAt')::date,
      coalesce(p_policy->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update insurance_policies set
      plate        = coalesce(p_policy->>'plate', ''),
      plan_name    = coalesce(p_policy->>'planName', ''),
      price        = coalesce((p_policy->>'price')::numeric, 0),
      big_pieces   = coalesce((p_policy->>'bigPieces')::int, 0),
      small_pieces = coalesce((p_policy->>'smallPieces')::int, 0),
      terms        = coalesce(p_policy->>'terms', ''),
      sold_at      = coalesce((p_policy->>'soldAt')::date, current_date),
      starts_at    = (p_policy->>'startsAt')::date,
      ends_at      = (p_policy->>'endsAt')::date,
      notes        = coalesce(p_policy->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  delete from insurance_claims where policy_id = v_id;
  insert into insurance_claims (policy_id, claimed_at, big_used, small_used, detail, technician, created_by)
  select
    v_id,
    coalesce((c->>'claimedAt')::date, current_date),
    coalesce((c->>'bigUsed')::int, 0),
    coalesce((c->>'smallUsed')::int, 0),
    coalesce(c->>'detail', ''),
    coalesce(c->>'technician', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) as c
  -- A claim that used nothing and says nothing is an empty row on the form.
  where coalesce((c->>'bigUsed')::int, 0) > 0
     or coalesce((c->>'smallUsed')::int, 0) > 0
     or coalesce(c->>'detail', '') <> '';

  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

-- ---- 0040: ลบ PO แบบกู้คืนได้ ----------------------------------------------
drop trigger if exists orders_delete_capability on orders;
drop function if exists enforce_order_delete_capability();
drop index if exists orders_live_idx;
alter table orders
  drop column if exists deleted_at,
  drop column if exists deleted_by;

-- ---- 0036: เลขที่ PO อัตโนมัติ -------------------------------------------
drop trigger if exists orders_assign_id on orders;
drop function if exists assign_order_id();
drop function if exists next_order_id(text);

-- ---- 0034: เพิ่ม/แก้สาขาในแอป --------------------------------------------
drop function if exists save_shop(text, text, integer);

-- ---- 0035 / 0032 / 0031: คอลัมน์ใหม่ --------------------------------------
alter table shop_info drop column if exists vat_registered;

drop index if exists expenses_paid_for_finnix_idx;
alter table expenses drop column if exists expense_kind;

drop index if exists tickets_held_idx;
alter table tickets drop column if exists revenue_kind;

-- ---- 0038 / 0037 / 0033: คืนฟังก์ชันรีเซ็ตสิทธิ์กลับเป็นรุ่นก่อน 0031 (คือของ 0026)
--      0038 แก้แค่ตัวฟังก์ชัน ไม่ได้แตะข้อมูล การคืนกลับเป็นรุ่น 0026 จึงครอบคลุมทั้งสาม
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

-- ---- ถอนทะเบียน migration ------------------------------------------------
delete from supabase_migrations.schema_migrations
 where version in ('0031','0032','0033','0034','0035','0036','0037','0038','0039','0040','0041');
