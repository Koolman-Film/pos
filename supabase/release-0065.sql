-- supabase/release-0065.sql
--
-- ของเก่าที่ 0054 ตกหล่น — PO ที่ตัดสต๊อกไปแล้ว และการรับคืนที่ไม่มี uid
--
-- รันต่อจาก release-0064.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: แตะเฉพาะแถวที่ยังไม่ได้ตั้ง
--
-- ไฟล์นี้แก้สองเรื่องที่ 0054 พลาดกับข้อมูลจริง:
--   * PO ที่สถานะสุดท้ายชื่อ เสร็จสิ้น (ไม่ใช่ ปิดงานแล้ว) และ PO ที่ยังไม่ส่ง
--     แต่ระบบเก่าตัดสต๊อกไปแล้ว ถูกบันทึกว่าตัดสต๊อกแล้ว — ไม่ตัดซ้ำตอนส่ง
--   * การรับคืนเก่าได้ uid ของตัวเอง — บันทึก PO แล้วสถานะรับของคืนไม่หาย
--
-- ถ้าระบบเก่ายังเปิดใช้อยู่ระหว่างรัน 0054 ถึงไฟล์นี้ ไฟล์นี้ตามเก็บให้ด้วย

set search_path = pos, public, extensions;

update orders o
set stock_deducted_at = now()
where o.stock_deducted_at is null
  and (
    o.status not in ('รออนุมัติราคา', 'รอจัดส่ง')
    or exists (
      select 1
        from stock_movements m
       where m.document_id = o.id
         and m.kind = 'ขายส่ง'
    )
  );

update order_returns
set uid = 'r' || id,
    received_at = coalesce(received_at, returned_at),
    stock_returned_at = coalesce(stock_returned_at, now())
where uid = '';

insert into supabase_migrations.schema_migrations(version, name) values ('0065', 'legacy_stock_stamps') on conflict (version) do nothing;
