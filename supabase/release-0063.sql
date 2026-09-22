-- supabase/release-0063.sql
--
-- หมายเหตุ 2 แบบบน PO: สำหรับลูกค้า (พิมพ์ลงเอกสาร) และสำหรับร้าน (ไม่พิมพ์)
--
-- รันต่อจาก release-0062.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists ไม่แก้ข้อมูลเดิม หมายเหตุที่เขียน
-- ไว้แล้วยังเป็นหมายเหตุสำหรับร้านเหมือนเดิม ไม่ไปโผล่บนเอกสารลูกค้า

set search_path = pos, public, extensions;

alter table orders
  add column if not exists customer_note text not null default '';

comment on column orders.customer_note is
  'หมายเหตุสำหรับลูกค้า — พิมพ์ลงใบแจ้งหนี้ ใบส่งของ ใบเสร็จ และใบรับคืน (0063).';
comment on column orders.note is
  'หมายเหตุสำหรับร้าน — ภายในเท่านั้น ไม่พิมพ์ลงเอกสาร (0054, ความหมายยืนยันใน 0063).';

insert into supabase_migrations.schema_migrations(version, name) values ('0063', 'order_customer_note') on conflict (version) do nothing;
