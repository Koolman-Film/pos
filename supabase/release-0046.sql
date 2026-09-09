-- supabase/release-0046.sql
--
-- เติมวันส่งของย้อนหลังให้ PO ที่ส่งของไปแล้ว
--
-- รันต่อจาก release-0045.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: อัปเดตเฉพาะแถวที่ delivered_at ยังว่าง รันซ้ำแล้วไม่ทับของเดิม
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- เติมวันส่งของย้อนหลังให้ PO ที่ส่งของไปแล้ว
--
-- 0045 added `orders.delivered_at` and left it NULL for existing rows, on the
-- grounds that inventing a date puts real revenue in a month it did not happen.
-- The shop weighed that against the alternative and chose the backfill: a PO
-- already marked จัดส่งแล้ว WAS delivered, and leaving it dateless means it never
-- appears in ยอดขาย at all — which is not a smaller error than being a few days
-- out, it is the whole sale missing.
--
-- WHAT DATE IS USED. `created_at`, read on the shop's clock. It is the only date
-- these rows carry, and for wholesale it is close: a PO is raised when the order
-- is agreed and the goods follow within days. It is NOT the delivery date, and
-- anyone reconciling a month should know that — hence this file, and the note in
-- the release runbook.
--
-- ONLY rows past delivery, and only rows with no date. A PO still at
-- รออนุมัติราคา or รอจัดส่ง has genuinely not been delivered, and stamping it
-- would book revenue for goods still on the shelf.

set search_path = pos, public, extensions;

update orders
set delivered_at = (created_at at time zone 'Asia/Bangkok')::date
where delivered_at is null
  and status in ('จัดส่งแล้ว', 'ค้างชำระ', 'ปิดงานแล้ว');

insert into supabase_migrations.schema_migrations(version, name) values ('0046', 'backfill_delivered_at') on conflict (version) do nothing;
