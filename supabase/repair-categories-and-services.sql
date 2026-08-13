-- supabase/repair-categories-and-services.sql
--
-- ซ่อมข้อมูลครั้งเดียว รันหลัง release-0019.sql
--
-- ตรวจก่อนรัน: supabase/check-orphan-categories.sql (อ่านอย่างเดียว)
--
-- ไฟล์นี้ทำ 2 อย่าง แยกส่วนกันชัดเจน อ่านทีละส่วนได้
--
--   ส่วน ก — เก็บ "ชนิดสินค้า" ที่มีสินค้าใช้อยู่จริงแต่ไม่อยู่ในรายการตัวเลือก
--            เข้ารายการให้ครบ (เช่น จอ) หลังจากนี้ใบงานถึงจะเลือกชนิดนั้นได้
--
--   ส่วน ข — ย้าย "งานบริการ" จากรายการตัวเลือกเข้าไปเป็นสินค้าในสต็อก
--            เพราะช่องชื่อสินค้าในใบงานดึงจากสต็อกอย่างเดียวแล้ว
--
-- ปลอดภัยเมื่อรันซ้ำ: ทั้งสองส่วนข้ามรายการที่มีอยู่แล้ว
-- ไม่มีการลบหรือแก้ไขข้อมูลเดิม มีแต่การเพิ่ม

set search_path = pos, public, extensions;

-- ===========================================================================
-- ก) ชนิดสินค้าที่ค้างอยู่ -> เข้ารายการตัวเลือก
-- ===========================================================================
insert into option_lists (list_key, value, shop_id, sort_order)
select
  'product_categories',
  s.category,
  null,
  (select coalesce(max(sort_order), 0) from option_lists
    where list_key = 'product_categories' and shop_id is null)
    + row_number() over (order by s.category)
from (
  select distinct btrim(category) as category
  from stock
  where btrim(coalesce(category, '')) <> ''
) s
where not exists (
  select 1 from option_lists o
  where o.list_key = 'product_categories' and btrim(o.value) = s.category
);

-- ===========================================================================
-- ข) งานบริการ -> เป็นสินค้าในสต็อก (ทุกสาขา)
-- ===========================================================================
--
-- ทำไมต้องทุกสาขา: ช่องเลือกสินค้าในใบงานจะขึ้นสินค้าของสาขาอื่นแบบจาง ๆ พร้อม
-- ป้าย "ไม่มีในสาขานี้" ถ้าใส่ให้สาขาเดียว อีก 4 สาขาจะเห็นบริการเป็นของสาขาอื่น
-- ซึ่งไม่จริง — ทุกสาขาให้บริการเหล่านี้ได้เอง
--
-- qty/min_qty = 0 เพราะบริการไม่ใช่ของที่นับสต็อกได้
-- ราคา = 0 ให้พนักงานกรอกราคาจริงในใบงาน (ระบบจะจำราคาต่อประเภทรถให้เอง)
--
-- SKU: SRV-<รหัสสาขา>-<ลำดับ> เช่น SRV-CM-01

insert into stock (sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price)
select
  'SRV-' || upper(sh.id) || '-' || lpad(row_number() over (partition by sh.id order by o.sort_order)::text, 2, '0'),
  o.value,
  o.value,
  'งานบริการ',
  sh.id,
  0,
  0,
  0,
  0
from option_lists o
cross join shops sh
where o.list_key = 'service_items'
  and btrim(coalesce(o.value, '')) <> ''
  and not exists (
    select 1 from stock st
    where st.shop_id = sh.id
      and st.name = o.value
      and st.category = 'งานบริการ'
  );

-- ===========================================================================
-- ตรวจผล
-- ===========================================================================

-- ชนิดสินค้าทั้งหมดในรายการตอนนี้
select value as ชนิดสินค้า, sort_order
from option_lists
where list_key = 'product_categories' and shop_id is null
order by sort_order;

-- ยังมีสินค้าที่ชนิดไม่อยู่ในรายการอีกไหม (ควรเป็น 0)
select count(*) as still_off_list
from stock s
where btrim(coalesce(s.category, '')) <> ''
  and not exists (
    select 1 from option_lists o
    where o.list_key = 'product_categories' and btrim(o.value) = btrim(s.category)
  );

-- งานบริการที่เลือกได้ในใบงาน แยกตามสาขา
select sh.name as สาขา, count(*) as บริการ
from stock st
join shops sh on sh.id = st.shop_id
where st.category = 'งานบริการ'
group by sh.name
order by sh.name;
