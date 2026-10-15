-- supabase/migrations/0085_pickup_after_dropoff.sql
--
-- วันที่ส่งงาน ต้องไม่อยู่ก่อนวันที่รับงาน
--
-- "วันที่ส่งงาน จะเป็นวันที่ก่อนรับงานไม่ได้ ต้องเป็นวันเดียวกันหรือหลังวันที่
-- รับงานเท่านั้น เวลาก็เช่นกันหากเป็นวันเดียวกัน เวลาส่งงานต้องหลังจากเวลา
-- รับงานเท่านั้น" (ร้านขอ 15 ต.ค. 2569)
--
-- ทั้งสองช่องเก็บเป็น timestamptz อยู่แล้ว การเทียบค่าตรง ๆ จึงครอบทั้งวันและ
-- เวลาในกฎข้อเดียว ไม่ต้องแยกสองเงื่อนไข
--
-- ทำไมอยู่ที่ฐานข้อมูล ไม่ใช่แค่หน้าจอ
-- -------------------------------------
-- วันที่คู่นี้ไม่ได้ถูกใช้แค่แสดงผล: รายการใบงานกรองงานที่ "คาบช่วงที่เลือก"
-- จากมัน (0015 ฝั่งแอป) ปฏิทินงานวางใบงานลงวันจากมัน และรายงานรายได้รับรู้
-- ยอดขายตามวันรับงาน ช่วงเวลาที่กลับหัวจึงไม่ใช่แค่ดูแปลก มันทำให้ใบงานหนึ่งใบ
-- ตอบคำถาม "อยู่ในช่วงไหน" คนละคำตอบในแต่ละหน้าจอ
--
-- ของเดิมไม่ถูกไล่แก้
-- --------------------
-- ไม่ได้ใส่เป็น check constraint เพราะใบที่บันทึกไว้ก่อนหน้านี้แล้วผิดกติกาจะ
-- ทำให้ทั้งตารางย้ายไม่ได้ ใช้ trigger แทน: ตรวจเฉพาะค่าที่กำลังจะเขียนลงไป
-- ใบเก่าที่ผิดอยู่จึงยังอ่านได้ตามปกติ และจะถูกขอให้แก้วันที่ก็ต่อเมื่อมีคน
-- กดบันทึกใบนั้นอีกครั้ง — ซึ่งเป็นจังหวะเดียวที่มีคนอยู่ตรงนั้นให้แก้ได้จริง

set search_path = pos, public, extensions;

create or replace function enforce_ticket_dates() returns trigger
language plpgsql
as $$
begin
  if new.drop_off_date is not null
     and new.pickup_date is not null
     and new.pickup_date <= new.drop_off_date then
    raise exception 'วันที่ส่งงานต้องอยู่หลังวันที่รับงาน — ถ้าเป็นวันเดียวกัน เวลาส่งงานต้องหลังเวลารับงาน'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_dates_order on tickets;
create trigger tickets_dates_order
  before insert or update of drop_off_date, pickup_date on tickets
  for each row execute function enforce_ticket_dates();

select '0085 done' as status;
