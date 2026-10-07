-- supabase/release-0082.sql
--
-- MEMO ของใบงาน — ช่องคุยกันภายใน ที่รู้ว่าใครพิมพ์ไว้และพิมพ์เมื่อไหร่
--
-- รันต่อจาก release-0081.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists, create or replace function
-- และ drop/create trigger กับ policy
--
-- หลังรันไฟล์นี้ หน้าใบงานมีกล่อง MEMO เพิ่มขึ้นมาหนึ่งกล่อง เขียนข้อความต่อกัน
-- เป็นเส้นได้ พร้อมชื่อคนเขียนและวันเวลาที่ฐานข้อมูลประทับเอง
--
-- ข้อความใน MEMO ไม่ถูกพิมพ์ลงเอกสารใด ๆ — ไม่ใบงานติดตั้ง ไม่ใบงานขาย ไม่
-- ใบเสนอราคา ใบกำกับภาษี หรือใบเสร็จ เห็นเฉพาะในระบบ
--
-- ทำไมไม่ใช้ช่อง "หมายเหตุ" ที่มีอยู่: หมายเหตุเป็นกล่องเดียวที่ทุกคนเขียนทับกัน
-- เหลือแต่ของคนที่บันทึกล่าสุด และมันถูกพิมพ์ลงใบงานทุกใบกับใบเสนอราคา
--
-- สิทธิ์: เห็นใบงานไหน ก็อ่านและเขียน MEMO ของใบนั้นได้ · แก้ข้อความที่ส่งไปแล้ว
-- ไม่ได้เลย · ลบได้เฉพาะข้อความของตัวเอง หรือแอดมิน
--
-- ใบงานที่ล็อกแล้วยังเขียน MEMO ได้ — MEMO ไม่ใช่ตัวเลขของใบงาน

set search_path = pos, public, extensions;

create table if not exists ticket_memos (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  body text not null,
  -- ใครเขียน. null = เขียนจากฝั่งระบบ ไม่ใช่คน
  author uuid references auth.users(id),
  /*
    ชื่อ ณ ตอนที่เขียน ไม่ใช่ join ตอนอ่าน.

    เหตุผลเดียวกับ activity_log.actor_name (0061): คนลาออกแล้วถูกลบ หรือเปลี่ยน
    ชื่อในระบบ ข้อความเก่าต้องยังอ่านรู้เรื่องว่าตอนนั้นใครพูด
  */
  author_name text not null default '',
  created_at timestamptz not null default now()
);

comment on table ticket_memos is
  'MEMO ของใบงาน — ข้อความภายใน หนึ่งแถวต่อหนึ่งข้อความ เขียนเพิ่มอย่างเดียว ไม่พิมพ์ลงเอกสาร (0082).';
comment on column ticket_memos.author_name is
  'ชื่อผู้เขียน ณ ตอนที่เขียน — trigger ประทับให้ ไม่รับจากหน้าจอ';

-- อ่านเรียงตามเวลาเสมอ (ช่องแชทไม่มีการเรียงแบบอื่น)
create index if not exists ticket_memos_ticket_idx
  on ticket_memos (ticket_id, created_at, id);

/*
  ผู้เขียนและเวลา มาจากฐานข้อมูล ไม่ใช่จาก payload.

  เขียนทับค่าที่ส่งมาเสมอ ไม่ใช่เติมเมื่อว่าง — ถ้าเติมเมื่อว่าง การส่งชื่อคนอื่น
  มาก็ยังผ่าน และช่องนี้ก็เลิกตอบคำถามที่มันถูกสร้างมาตอบ
*/
create or replace function stamp_ticket_memo() returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  new.author := auth.uid();
  new.author_name := coalesce((select name from app_users where id = auth.uid()), 'ระบบ');
  new.created_at := now();
  -- ระบุอักขระเอง: btrim ปริยายตัดแต่ช่องว่าง ข้อความที่มีแต่ Enter กับ Tab
  -- จึงรอดด่านข้างล่างไปเป็นข้อความเปล่าในเส้น (เจอตอนเขียนเทสต์ RLS)
  new.body := btrim(new.body, E' \t\r\n');
  if new.body = '' then
    raise exception 'ข้อความว่าง บันทึกไม่ได้';
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_memos_stamp on ticket_memos;
create trigger ticket_memos_stamp
  before insert on ticket_memos
  for each row execute function stamp_ticket_memo();

/*
  สิทธิ์ — เห็นใบงานไหน ก็อ่านและเขียน MEMO ของใบนั้นได้ ผูกผ่านสาขาของใบงาน
  แบบเดียวกับ ticket_items และ service_visits (0007, 0020)

  ไม่มี policy สำหรับ update และถอน privilege ออกด้วย: ข้อความที่คนอื่นอ่านไป
  แล้วถูกแก้เงียบ ๆ ทีหลัง ทำให้เส้นทั้งเส้นเชื่อถือไม่ได้ พิมพ์ผิดก็ลบแล้วพิมพ์
  ใหม่ ซึ่งคนอื่นเห็นว่าเกิดอะไรขึ้น

  ลบได้เฉพาะข้อความของตัวเอง หรือแอดมิน — ของตัวเองเพราะพิมพ์ผิดเป็นเรื่องปกติ
  และแอดมินเพราะต้องมีคนลบข้อความที่ไม่ควรอยู่ได้ เมื่อคนเขียนไม่อยู่แล้ว
*/
alter table ticket_memos enable row level security;

drop policy if exists ticket_memos_select on ticket_memos;
create policy ticket_memos_select on ticket_memos for select to authenticated
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

drop policy if exists ticket_memos_insert on ticket_memos;
create policy ticket_memos_insert on ticket_memos for insert to authenticated
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

drop policy if exists ticket_memos_delete on ticket_memos;
create policy ticket_memos_delete on ticket_memos for delete to authenticated
  using (
    ticket_id in (select id from tickets where shop_id in (select current_user_shops()))
    and (author = auth.uid() or current_user_role() = 'admin')
  );

revoke all on ticket_memos from anon;
revoke update on ticket_memos from authenticated;
grant select, insert, delete on ticket_memos to authenticated;

select 'release-0082 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0082', 'ticket_memos') on conflict (version) do nothing;
