-- ตรวจสินค้าที่ "ชนิดสินค้า" ไม่อยู่ในรายการตัวเลือกของระบบ
--
-- อาการที่ทำให้ต้องมีไฟล์นี้: ช่องเลือกชนิดสินค้าที่มีค่าไม่ตรงกับตัวเลือกใด ๆ
-- เบราว์เซอร์จะแสดง "ตัวเลือกแรก" แทน ทำให้สินค้าที่เป็น "จอ" อ่านว่า
-- "ฟิล์มกรองแสง" — และถ้ากดบันทึกจากหน้านั้นก่อนที่ระบบจะถูกแก้ ข้อมูลจริง
-- อาจถูกเขียนทับไปแล้ว
--
-- อ่านอย่างเดียวทั้งไฟล์ ไม่มีคำสั่งที่เปลี่ยนข้อมูล
-- (คำสั่งซ่อมอยู่ท้ายไฟล์ และถูก comment ไว้)
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> วางทีละ query แล้วกด Run

-- ---------------------------------------------------------------------------
-- 1) นับรวม: มีกี่รายการ และคิดเป็นกี่ชนิด
-- ---------------------------------------------------------------------------
-- ชื่อคอลัมน์สั้น ๆ เป็นภาษาอังกฤษ เพราะ Postgres ตัดชื่อคอลัมน์ที่ยาวเกิน 63 ไบต์
-- ซึ่งภาษาไทยกินไบต์ละ 3 ตัวอักษร ชื่อไทยยาว ๆ จึงโดนตัดกลางคำ
select
  count(*)                          as products_off_list,
  count(distinct btrim(s.category)) as categories_missing
from pos.stock s
where btrim(coalesce(s.category, '')) <> ''
  and not exists (
    select 1
    from pos.option_lists o
    where o.list_key = 'product_categories'
      and btrim(o.value) = btrim(s.category)
  );

-- ---------------------------------------------------------------------------
-- 2) สรุปรายชนิด — ชนิดไหนหายไปบ้าง มีสินค้ากี่ตัว อยู่สาขาใด
-- ---------------------------------------------------------------------------
select
  btrim(s.category)                  as ชนิดสินค้า,
  count(*)                           as products,
  string_agg(distinct sh.name, ', ') as shops,
  sum(s.qty)                         as qty_total
from pos.stock s
left join pos.shops sh on sh.id = s.shop_id
where btrim(coalesce(s.category, '')) <> ''
  and not exists (
    select 1
    from pos.option_lists o
    where o.list_key = 'product_categories'
      and btrim(o.value) = btrim(s.category)
  )
group by btrim(s.category)
order by count(*) desc;

-- ---------------------------------------------------------------------------
-- 3) รายตัว — เอาไว้ไล่แก้ทีละรายการ
-- ---------------------------------------------------------------------------
select
  s.id,
  s.sku,
  s.name     as product,
  s.category as saved_category,
  sh.name    as shop,
  s.qty
from pos.stock s
left join pos.shops sh on sh.id = s.shop_id
where btrim(coalesce(s.category, '')) <> ''
  and not exists (
    select 1
    from pos.option_lists o
    where o.list_key = 'product_categories'
      and btrim(o.value) = btrim(s.category)
  )
order by s.category, s.name;

-- ---------------------------------------------------------------------------
-- 4) เช็คใบงานด้วย — ticket_items เก็บชนิดสินค้าแยกจาก stock
--    ใบงานเก่าที่ชนิดไม่อยู่ในรายการก็แสดงผิดแบบเดียวกัน
-- ---------------------------------------------------------------------------
select
  btrim(i.category)           as ชนิดสินค้า,
  count(*)                    as item_rows,
  count(distinct i.ticket_id) as tickets,
  min(t.created_at)::date     as first_seen,
  max(t.created_at)::date     as last_seen
from pos.ticket_items i
join pos.tickets t on t.id = i.ticket_id
where btrim(coalesce(i.category, '')) <> ''
  and not exists (
    select 1
    from pos.option_lists o
    where o.list_key = 'product_categories'
      and btrim(o.value) = btrim(i.category)
  )
group by btrim(i.category)
order by count(*) desc;

-- ---------------------------------------------------------------------------
-- 5) เผื่อไว้: ชนิดที่มีช่องว่างหน้า/หลัง ซึ่งทำให้ไม่ตรงกันทั้งที่ตาเห็นเหมือนกัน
--    (' จอ ' กับ 'จอ' คือคนละค่าสำหรับฐานข้อมูล)
-- ---------------------------------------------------------------------------
select s.id, s.sku, s.name, '[' || s.category || ']' as category_with_spaces
from pos.stock s
where s.category <> btrim(s.category)
order by s.name;

-- ===========================================================================
-- คำสั่งซ่อม — อ่านผลด้านบนให้ครบก่อน แล้วค่อยเอา comment ออกทีละอัน
-- ===========================================================================

-- ก) เก็บชนิดที่ค้างอยู่เข้ารายการตัวเลือก (ปลอดภัยที่สุด: ไม่แตะข้อมูลสินค้าเลย
--    แค่ทำให้ชนิดที่มีอยู่จริงกลายเป็นตัวเลือกทางการ)
--    หมายเหตุ: หน้าสต็อกทำสิ่งนี้ให้เองแล้วเมื่อแอดมินแตะช่องหมวดหมู่ครั้งแรก
--    ใช้คำสั่งนี้เมื่ออยากซ่อมทีเดียวทั้งหมดโดยไม่ต้องเปิดทีละรายการ
--
-- insert into pos.option_lists (list_key, value, shop_id, sort_order)
-- select
--   'product_categories',
--   btrim(s.category),
--   null,
--   (select coalesce(max(sort_order), 0) from pos.option_lists
--     where list_key = 'product_categories' and shop_id is null)
--     + row_number() over (order by btrim(s.category))
-- from (
--   select distinct btrim(category) as category
--   from pos.stock
--   where btrim(coalesce(category, '')) <> ''
-- ) s
-- where not exists (
--   select 1 from pos.option_lists o
--   where o.list_key = 'product_categories' and btrim(o.value) = btrim(s.category)
-- );

-- ข) ตัดช่องว่างหน้า/หลังออกจากชนิดสินค้า (ทำหลังจากดูผลข้อ 5 แล้วเท่านั้น)
--
-- update pos.stock set category = btrim(category) where category <> btrim(category);
