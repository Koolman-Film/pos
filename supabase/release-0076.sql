-- supabase/release-0076.sql
--
-- เลขใบงานออกโดยฐานข้อมูล เหมือนเลข PO (0036)
--
-- รันต่อจาก release-0075.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function และ drop trigger if exists ก่อนสร้าง
-- ไม่แก้ข้อมูลเดิม เลขใบงานที่มีอยู่ไม่เปลี่ยน รูปแบบเลขใหม่เหมือนเดิม (JT-XX-00001)
--
-- ต้องขึ้นโค้ดเวอร์ชันใหม่ตาม โค้ดเดิมยังส่งเลขที่คำนวณเองมา ซึ่งไฟล์นี้เคารพ จึงไม่พัง
-- ระหว่างรอขึ้นโค้ด

set search_path = pos, public, extensions;

create or replace function next_ticket_id(p_shop text)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text := 'JT-' || upper(p_shop) || '-';
  v_seq    integer;
begin
  -- Only rows whose tail is entirely digits count, so an odd hand-made id
  -- (JT-CM-T0066) can neither break the max nor be mistaken for a number.
  select coalesce(max(substr(id, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from tickets
   where id like v_prefix || '%'
     and substr(id, length(v_prefix) + 1) ~ '^[0-9]+$';

  return v_prefix || lpad(v_seq::text, 5, '0');
end;
$$;

revoke all on function next_ticket_id(text) from public, anon;
grant execute on function next_ticket_id(text) to authenticated;

create or replace function assign_ticket_id()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.id is not null and btrim(new.id) <> '' then
    return new;
  end if;

  -- Serialises numbering per branch for the rest of the transaction: the second
  -- of two simultaneous saves waits here and then sees the first one's row.
  perform pg_advisory_xact_lock(hashtext('ticket_id:' || new.shop_id));
  new.id := next_ticket_id(new.shop_id);
  return new;
end;
$$;

revoke all on function assign_ticket_id() from public, anon, authenticated;

drop trigger if exists tickets_assign_id on tickets;
create trigger tickets_assign_id
  before insert on tickets
  for each row
  execute function assign_ticket_id();

insert into supabase_migrations.schema_migrations(version, name) values ('0076', 'ticket_id_in_db') on conflict (version) do nothing;
