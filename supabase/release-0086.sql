-- supabase/release-0086.sql
--
-- กติกาวันที่ของใบงาน ตรวจเฉพาะใบใหม่ และตอนที่มีคนแก้วันที่
--
-- รันต่อจาก release-0085.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function อย่างเดียว ไม่แตะข้อมูล
--
-- หลังรันไฟล์นี้ ใบเก่าที่วันที่ผิดมาแต่เดิมบันทึกเรื่องอื่นได้ตามปกติ ส่วนใบใหม่
-- และการแก้วันที่ ยังถูกกติกาของ 0085 เหมือนเดิม

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

select 'release-0086 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0086', 'ticket_dates_only_when_changed') on conflict (version) do nothing;
