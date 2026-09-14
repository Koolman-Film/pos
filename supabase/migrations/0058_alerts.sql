-- supabase/migrations/0058_alerts.sql
--
-- การแจ้งเตือน: จำว่ารับทราบแล้ววันนี้ และผูกเซลล์กับบัญชีเข้าระบบ
--
-- The alerts themselves are not stored anywhere. Every alert is a question
-- asked of the live data — is there a price waiting, a cheque past its date, a
-- bill past due — so an approved discount leaves the bell the moment it is
-- approved, and no table of messages can fall out of step with what is true.
--
-- Two things do have to be remembered, and they are both here:
--
--   1. `alert_acknowledgements` — the shop's rule is "show the day's summary
--      once, let me hide it until tomorrow, and if it is still pending tomorrow
--      show it again". So what is stored is one row per person per day, and the
--      urgent items that were on screen when they pressed รับทราบ, so something
--      urgent that turns up later the same day can still be pointed out.
--      Kept in the database rather than the browser so hiding it on the office
--      computer also hides it on the phone.
--
--   2. `sales_people.user_id` — โหน่ง and เคน log in. A rep should be reminded
--      about the bills for THEIR customers, not every PO in the branch, and the
--      only thing a PO records about its rep is the name. Linking the sales
--      person to their login is what lets the alert find "mine".

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
