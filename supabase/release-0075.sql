-- supabase/release-0075.sql
--
-- ปักหมุด search_path ให้ current_user_sees_all_shops อีกครั้ง
--
-- รันต่อจาก release-0074.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: alter function … set เขียนค่าเดิมซ้ำได้ และส่วนตรวจสอบอ่านอย่างเดียว
--
-- ไม่เปลี่ยนการทำงานของฟังก์ชัน เปลี่ยนเฉพาะการตั้งค่า search_path ที่หายไปตั้งแต่ 0008

alter function pos.current_user_sees_all_shops() set search_path = pos;

-- Every SECURITY DEFINER function in pos must pin its search_path. Fails the
-- migration rather than letting another one slip through the same way.
do $$
declare
  v_missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pos'
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
     );
  if v_missing is not null then
    raise exception 'SECURITY DEFINER functions without a pinned search_path: %', v_missing;
  end if;
end $$;

insert into supabase_migrations.schema_migrations(version, name) values ('0075', 'pin_search_path') on conflict (version) do nothing;
