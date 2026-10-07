-- supabase/migrations/0082_ticket_memos.sql
--
-- MEMO ของใบงาน — ช่องคุยกันภายใน ที่รู้ว่าใครพิมพ์ไว้และพิมพ์เมื่อไหร่
--
-- "ให้เพิ่มช่อง MEMO: เป็นคล้ายๆช่องแชทที่ระบุชื่อคนแชทกับวันที่กำกับ เพื่อให้
-- เห็นว่าใครได้พิมพ์ข้อมูลของใบงานนี้ไว้บ้าง โดยที่ข้อความในmemo จะไม่แสดงใน
-- เอกสาร จะเห็นเฉพาะในระบบเท่านั้น" (ร้านขอ 7 ต.ค. 2569)
--
-- ทำไมไม่ใช้ช่อง "หมายเหตุ" ที่มีอยู่
-- -----------------------------------
-- หมายเหตุเป็นช่องเดียวที่ทุกคนเขียนทับกันได้ ใครแก้ล่าสุดก็เหลือแต่ของคนนั้น
-- และมันถูกพิมพ์ลงใบงานทุกใบกับใบเสนอราคา คนละงานกับสิ่งที่ร้านขอ: บันทึกที่
-- ต่อกันเป็นเส้น รู้ว่าใครพูด พูดเมื่อไหร่ และลูกค้าไม่เห็น
--
-- หนึ่งข้อความ = หนึ่งแถว
-- -----------------------
-- ลูกของใบงานตัวอื่น (รายการสินค้า การรับเงิน) ถูก `save_ticket_children` ลบทิ้ง
-- แล้วเขียนใหม่ทั้งชุดทุกครั้งที่กดบันทึก ซึ่งใช้กับข้อความไม่ได้เด็ดขาด — การ
-- กดบันทึกของคนหนึ่งจะลบข้อความของอีกคนที่พิมพ์ระหว่างนั้น และเวลากับชื่อคนเขียน
-- จะถูกตั้งใหม่ทุกรอบ ตารางนี้จึงเขียนเพิ่มอย่างเดียว ผ่าน action ของตัวเอง
-- ไม่เกี่ยวกับปุ่มบันทึกใบงาน
--
-- ชื่อกับเวลา ไม่รับจากหน้าจอ
-- ---------------------------
-- trigger เป็นคนประทับ ไม่ใช่ client — ประเด็นทั้งหมดของช่องนี้คือ "ใครพิมพ์"
-- ถ้าค่าที่ตอบคำถามนั้นมาจาก payload ที่แก้ได้ ก็ตอบไม่ได้จริง
--
-- ไม่พิมพ์ลงเอกสาร
-- ----------------
-- ไม่มีที่ไหนในฝั่งพิมพ์อ่านตารางนี้ และ `loadTicket` ส่งมันมาคนละ field กับ
-- หมายเหตุ เอกสารทั้งสามใบจึงไม่มีทางหยิบไปโดยบังเอิญ มีเทสต์ยืนยันไว้
--
-- ไม่เข้าประวัติการใช้งาน
-- -----------------------
-- ด้วยเหตุผลเดียวกับที่ 0061 ไม่ดัก ticket_status_history — ตารางนี้เป็นบันทึก
-- ประวัติอยู่แล้วในตัว ดักซ้ำจะได้สองบรรทัดต่อหนึ่งข้อความ
--
-- ใบงานที่ล็อกแล้ว ยังเขียน MEMO ได้
-- ----------------------------------
-- ด่านล็อก (0017) กันไม่ให้ตัวเลขของใบงานที่ปิดไปแล้วขยับ MEMO ไม่ใช่ตัวเลขของ
-- ใบงาน และคำถามที่ต้องคุยกันเรื่องงานที่ปิดไปแล้วก็ยังมี (ลูกค้าโทรกลับมาถาม)
-- เหตุผลเดียวกับที่ประกันไม่ติดด่านล็อก

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

select '0082 done' as status;
