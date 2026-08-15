-- supabase/migrations/0021_stock_film_spec.sql
--
-- ความหนา และ รหัสสี ของฟิล์ม — เก็บที่ตัวสินค้า
--
-- The ใบเซอร์วิส prints ประเภทฟิล์ม / ความหนา / รหัสสี. The first was already
-- derivable from the product's name ("TPU กันรอยเกรดพรีเมียม" is a TPU job), but
-- the other two had nowhere to live and were being retyped on every visit.
--
-- They belong to the PRODUCT, not to the job: "TPU-PR" is one particular film,
-- 195 microns, in one colour. Storing them on `stock` means the shop enters them
-- once when the product is set up, every ticket that sells it inherits them, and
-- every service sheet for that car prints the right numbers without anyone
-- choosing again.
--
-- Text, not numeric: ความหนา carries values like "195ด้าน" that are not numbers,
-- and a รหัสสี is a code.

set search_path = pos, public, extensions;

alter table stock
  add column if not exists film_thickness text not null default '',
  add column if not exists film_colour_code text not null default '';

comment on column stock.film_thickness is
  'ความหนาฟิล์ม เช่น 165 / 195 / 195ด้าน / 215 / 255 — ว่างสำหรับสินค้าที่ไม่ใช่ฟิล์ม';
comment on column stock.film_colour_code is
  'รหัสสีฟิล์ม — ว่างสำหรับสินค้าที่ไม่ใช่ฟิล์ม';
