-- supabase/release-0085.sql
--
-- วันที่ส่งงาน ต้องไม่อยู่ก่อนวันที่รับงาน
--
-- รันต่อจาก release-0084.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function และ drop/create trigger
--
-- หลังรันไฟล์นี้ ใบงานที่วันที่ส่งงานอยู่ก่อนวันที่รับงาน (หรือเป็นเวลาเดียวกัน
-- เป๊ะ) จะบันทึกไม่ได้ ทั้งจากหน้าจอและจากทุกทางที่เขียนฐานข้อมูล
--
-- ใบเก่าที่ผิดอยู่แล้วไม่ถูกไล่แก้ และยังอ่านได้ตามปกติ — จะถูกขอให้แก้วันที่ก็
-- ต่อเมื่อมีคนกดบันทึกใบนั้นอีกครั้ง ซึ่งเป็นจังหวะเดียวที่มีคนอยู่ตรงนั้นให้
-- แก้ได้จริง (ใช้ trigger ไม่ใช่ check constraint ด้วยเหตุผลนี้)

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

select 'release-0085 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0085', 'pickup_after_dropoff') on conflict (version) do nothing;
