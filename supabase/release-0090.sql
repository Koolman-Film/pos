-- supabase/release-0090.sql
--
-- "มีอะไรใหม่": จำว่าแต่ละคนอ่านข่าวการเปลี่ยนแปลงถึงรุ่นไหนแล้ว
--
-- รันต่อจาก release-0089.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists, drop policy ก่อน create
--
-- ระบบเปลี่ยนแทบทุกสัปดาห์ และยังไม่เคยมีใครบอกพนักงานสักเรื่อง ทุกคนเจอของ
-- ใหม่เอาเองตอนกำลังทำงานอยู่ (ร้านขอ 17 พ.ย. 2569, docs/DESIGN-whats-new.md)
--
-- ตัวข่าวไม่ได้อยู่ในฐานข้อมูล มันอยู่ในโค้ด (`lib/releaseNotes.ts`) เพราะข้อความ
-- อธิบายโค้ดรุ่นนั้น มันจึงควรขึ้นและถอยกลับไปพร้อมกับโค้ด ข่าวที่เก็บในฐานข้อมูล
-- จะประกาศฟีเจอร์ที่ยังไม่ได้ขึ้น หรือค้างอยู่หลังถอยรุ่นกลับ
--
-- สิ่งเดียวที่ต้องจำคือ "ใครอ่านถึงไหนแล้ว" และมันต้องอยู่ในฐานข้อมูล ไม่ใช่ใน
-- เบราว์เซอร์ เพราะเครื่องหน้าร้านใช้ร่วมกันหลายคน — คนแรกที่กดปิดจะปิดแทนทุกคน
-- ที่มาใช้เครื่องนั้นต่อ เหตุผลเดียวกับที่ 0058 ตัดสินใจไว้แล้วสำหรับการแจ้งเตือน
--
-- สองเลข ไม่ใช่เลขเดียว:
--
--   `seen_release`      อ่านจริงแล้วถึงรุ่นไหน — คุมจุดสีบนเมนูชื่อผู้ใช้
--   `dismissed_release` กด "ไว้ก่อน" บนแถบของรุ่นไหนแล้ว — คุมแค่แถบ
--
-- ถ้าใช้เลขเดียว การกด "ไว้ก่อน" ตอนลูกค้ายืนรออยู่ จะนับเป็น "อ่านแล้ว" แล้ว
-- ข่าวก็หายไปทั้งหมดโดยที่ยังไม่มีใครอ่าน ซึ่งเป็นสิ่งที่ฟีเจอร์นี้มีไว้กันพอดี

set search_path = pos, public, extensions;

create table if not exists user_notice_state (
  user_id uuid primary key default auth.uid()
    references app_users(id) on delete cascade,
  seen_release int not null default 0,
  dismissed_release int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table user_notice_state is
  'แต่ละคนอ่านข่าว "มีอะไรใหม่" ถึงรุ่นไหน และปิดแถบแจ้งของรุ่นไหนแล้ว (0090).';
comment on column user_notice_state.seen_release is
  'เปิดหน้า "มีอะไรใหม่" อ่านจริงถึงรุ่นนี้ — 0 = ยังไม่เคยอ่านอะไรเลย.';
comment on column user_notice_state.dismissed_release is
  'กด "ไว้ก่อน" บนแถบของรุ่นนี้แล้ว — จุดสีบนเมนูยังอยู่ จนกว่าจะเปิดอ่านจริง.';

alter table user_notice_state enable row level security;

-- ของตัวเองเท่านั้น ไม่มีใครต้องอ่าน และปลอมแล้วก็ไม่ได้อะไร ว่าคนอื่นอ่านข่าว
-- ถึงไหนแล้ว
drop policy if exists user_notice_state_own on user_notice_state;
create policy user_notice_state_own on user_notice_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on user_notice_state to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0090', 'notice_state') on conflict (version) do nothing;
