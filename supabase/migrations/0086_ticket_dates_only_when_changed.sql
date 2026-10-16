-- กติกาวันที่ของใบงาน (0085) ตรวจเฉพาะใบใหม่ และตอนที่มีคนแก้วันที่
--
-- 0085 ปฏิเสธทุกการบันทึกของใบที่วันที่ส่งงานอยู่ก่อน (หรือตรงกับ) วันที่รับงาน
-- แต่หน้าจอส่งทั้งสองช่องไปทุกครั้งที่กดบันทึก trigger แบบ `update of` จึงทำงาน
-- ทุกครั้ง แม้ไม่มีใครแตะวันที่เลย ใบที่ผิดมาตั้งแต่ก่อนมีกติกา (production
-- 16 ต.ค. 2569: 27 ใบ ส่วนใหญ่เป็นงานวันเดียวที่เวลาส่งเท่ากับเวลารับ) จึงรับเงิน
-- เปลี่ยนสถานะ หรือแก้อะไรก็ไม่ได้ จนกว่าจะมีคนรู้วันจริง — ซึ่งบางใบไม่มีใครรู้
--
-- หลังไฟล์นี้: ใบใหม่ และการแก้วันที่ ยังต้องถูกกติกาเหมือนเดิม ส่วนการบันทึก
-- ที่ค่าวันที่ไม่เปลี่ยนจากที่เก็บไว้ ผ่านได้ ข้อมูลเก่าไม่ถูกเดาแก้ให้

set search_path = pos, public, extensions;

create or replace function enforce_ticket_dates() returns trigger
language plpgsql
as $$
begin
  -- วันที่ไม่ได้ถูกแก้: ไม่ใช่จังหวะที่จะถามหาวันที่ถูก (0086)
  if tg_op = 'UPDATE'
     and new.drop_off_date is not distinct from old.drop_off_date
     and new.pickup_date is not distinct from old.pickup_date then
    return new;
  end if;

  if new.drop_off_date is not null
     and new.pickup_date is not null
     and new.pickup_date <= new.drop_off_date then
    raise exception 'วันที่ส่งงานต้องอยู่หลังวันที่รับงาน — ถ้าเป็นวันเดียวกัน เวลาส่งงานต้องหลังเวลารับงาน'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
