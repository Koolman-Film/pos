-- supabase/release-0057.sql
--
-- ยอดขายของ PO เป็นของเซลล์ที่เลือก และบันทึกว่าใครเปิด PO
--
-- รันต่อจาก release-0056.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create or replace function /
-- drop trigger if exists. ไม่มีการแก้ข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * PO ใหม่ของสาขาที่มีพนักงานขาย (Finnix North) ต้องเลือกเซลล์เจ้าของยอดขาย
--   * ระบบบันทึกเองว่าใครเปิด PO และแก้ไม่ได้ — เปิดแทนกันได้ ยอดยังเป็นของเซลล์
--   * PO เก่าที่บันทึกไว้โดยไม่มีเซลล์ ยังแก้ไขได้ตามเดิม

set search_path = pos, public, extensions;

alter table orders
  add column if not exists created_by uuid
    references app_users(id) on delete set null
    default auth.uid();

comment on column orders.created_by is
  'ผู้ใช้ที่เปิด PO — ตั้งจากผู้ที่ล็อกอินตอนสร้าง แก้ไม่ได้ (0057). ยอดขายเป็นของ sales_by ไม่ใช่คนนี้.';

/*
  security definer so the rep lookup does not depend on the caller being able
  to read `sales_people`; nothing here widens what the caller can write, it only
  refuses rows.

  service_role passes untouched, as in 0052: seeds and repair scripts have no
  session to take `created_by` from, and backfilling history is exactly what
  they are for.
*/
create or replace function enforce_order_sales_attribution()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- ใครเปิด PO — from the session, never from the payload, and fixed for good.
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;

  if coalesce(trim(new.sales_by), '') = ''
     and (tg_op = 'INSERT' or coalesce(trim(old.sales_by), '') <> '')
     and exists (
       select 1 from sales_people p
       where p.shop_id = new.shop_id and p.active
     ) then
    raise exception 'ต้องเลือกพนักงานขายเจ้าของยอดขายของ PO นี้';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_sales_attribution on orders;
create trigger orders_sales_attribution
  before insert or update on orders
  for each row
  execute function enforce_order_sales_attribution();

insert into supabase_migrations.schema_migrations(version, name) values ('0057', 'order_sales_attribution') on conflict (version) do nothing;
