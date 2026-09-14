-- supabase/release-0058.sql
--
-- การแจ้งเตือน: จำว่ารับทราบแล้ววันนี้ และผูกเซลล์กับบัญชีเข้าระบบ
--
-- รันต่อจาก release-0057.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists / add column if not exists /
-- drop policy if exists / create index if not exists. ไม่มีการแก้ข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * กระดิ่งมุมขวาบนนับเรื่องที่ต้องจัดการจริง และมีหน้าต่างสรุปวันละครั้ง
--   * ผูกบัญชีเข้าระบบของโหน่ง/เคนกับชื่อเซลล์ได้ที่หน้า PO (ปุ่มแก้ไขพนักงานขาย)
--     เพื่อให้เซลล์เห็นเฉพาะกำหนดชำระของลูกค้าตัวเอง

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. รับทราบแล้ววันนี้
-- ---------------------------------------------------------------------------

create table if not exists alert_acknowledgements (
  user_id uuid not null default auth.uid()
    references app_users(id) on delete cascade,
  -- The SHOP's calendar day (Asia/Bangkok), sent by the server. "Tomorrow"
  -- starts at midnight in the shop, not at 07:00 when UTC rolls over.
  acked_on date not null,
  -- Urgent items on screen at the moment of pressing รับทราบ. An urgent item
  -- not in this list is new since, and earns a small reminder.
  acked_keys text[] not null default '{}',
  acked_at timestamptz not null default now(),
  primary key (user_id, acked_on)
);

comment on table alert_acknowledgements is
  'ผู้ใช้กด "รับทราบ · ซ่อนถึงพรุ่งนี้" ของหน้าต่างสรุปการแจ้งเตือนวันไหนแล้ว (0058).';

alter table alert_acknowledgements enable row level security;

-- Your own acknowledgements only — nobody needs to read, or can usefully
-- forge, whether somebody else has seen their reminders.
drop policy if exists alert_acknowledgements_own on alert_acknowledgements;
create policy alert_acknowledgements_own on alert_acknowledgements
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on alert_acknowledgements to authenticated;

-- ---------------------------------------------------------------------------
-- 2. เซลล์ ↔ บัญชีเข้าระบบ
-- ---------------------------------------------------------------------------

alter table sales_people
  add column if not exists user_id uuid
    references app_users(id) on delete set null;

comment on column sales_people.user_id is
  'บัญชีเข้าระบบของเซลล์คนนี้ — ใช้กรองการแจ้งเตือนกำหนดชำระให้เห็นเฉพาะลูกค้าของตัวเอง (0058).';

-- One login is one person. Two sales-people rows pointing at the same account
-- would make "my customers" mean two people's customers.
create unique index if not exists sales_people_user_uidx
  on sales_people (user_id)
  where user_id is not null;

insert into supabase_migrations.schema_migrations(version, name) values ('0058', 'alerts') on conflict (version) do nothing;
