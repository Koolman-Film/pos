-- supabase/release-GO-LIVE.sql
--
-- ไฟล์เดียวจบ สำหรับขึ้นระบบจริง
--
-- รวม release-0019 ถึง release-0066 และ repair-categories-and-services.sql
-- ไว้ในไฟล์เดียว ตามลำดับที่ระบุไว้ใน docs/RELEASE-post-trial-fixes.md เพื่อไม่ต้อง
-- เปิดทีละไฟล์แล้ววางทีละครั้งใน SQL Editor สามสิบกว่ารอบ ซึ่งพลาดลำดับได้ง่าย
--
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--
-- ปลอดภัยเมื่อรันซ้ำ ทุกไฟล์ที่รวมมาเขียนแบบ if not exists / on conflict do
-- nothing / create or replace อยู่แล้ว และแต่ละไฟล์บันทึกเวอร์ชันของตัวเองลง
-- supabase_migrations.schema_migrations ทำให้ db push ครั้งต่อไปข้ามให้เอง
-- ถ้าเคยรันบางไฟล์ไปแล้ว รันไฟล์นี้ทับได้เลย ส่วนที่เคยรันจะไม่เปลี่ยนอะไร
--
-- ไม่ได้รวมไว้ในไฟล์นี้ สามอย่าง
--   1. release-0012-0018.sql   — ชุดแรก ขึ้นระบบไปแล้ว
--   2. release-0030.sql        — ดัชนีเร่งความเร็ว ที่ให้รันแยกก่อนตั้งแต่แรก
--   3. storage-policies.sql    — ต้องใช้สิทธิ์เจ้าของ storage.objects
--                                รันรวมกับไฟล์นี้ไม่ได้ ต้องรันแยกตามเดิม
--
-- ไฟล์นี้สร้างจากไฟล์ต้นทางโดยตรง ไม่ได้แก้เนื้อใน — ถ้าต้นทางเปลี่ยน ให้สร้างใหม่


-- ==========================================================================
-- supabase/release-0019.sql
-- ==========================================================================

-- supabase/release-0019.sql
--
-- ไฟล์เสริมสำหรับรันบน production ต่อจาก release-0012-0018.sql
-- (ถ้ายังไม่ได้รันไฟล์นั้น ให้รันไฟล์นั้นก่อน แล้วค่อยรันไฟล์นี้)
--
-- เพิ่มเลขที่เอกสารค่าใช้จ่าย เช่น POS-LPG-6908001
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์/ดัชนีแบบ if not exists, สร้างฟังก์ชันแบบ
-- create or replace, และการเติมเลขย้อนหลังแตะเฉพาะแถวที่ยังไม่มีเลข
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0019_expense_doc_no.sql
--
-- เลขที่เอกสารค่าใช้จ่าย — POS-LPG-6908001
--
--   POS   คงที่
--   LPG   รหัสสาขา (shop_id ตัวใหญ่)
--   69    ปี พ.ศ. สองหลักท้าย (2569)
--   08    เดือน
--   001   ลำดับที่ นับใหม่ทุกเดือนของแต่ละสาขา
--
-- Assigned by a BEFORE INSERT trigger rather than by the application, for two
-- reasons. The number must never change once issued — it is on a document
-- somebody filed — so it cannot be recomputed from a date the row can still
-- edit. And two people entering an expense for the same shop in the same month
-- at the same moment must not both be handed 001; the trigger takes a
-- transaction-scoped advisory lock on the prefix, which the application cannot
-- do across an RPC boundary.
--
-- One number per expense ROW. A submission with several lines is several
-- expenses — each has its own amount, category and status — so each gets its
-- own reference.

set search_path = pos, public, extensions;

alter table expenses
  add column if not exists doc_no text;

comment on column expenses.doc_no is
  'เลขที่เอกสาร e.g. POS-LPG-6908001 — ออกโดย trigger ตอน insert ห้ามแก้ภายหลัง';

-- Partial: rows predating this migration keep a NULL until the backfill below,
-- and NULLs must not collide with each other.
create unique index if not exists expenses_doc_no_key
  on expenses (doc_no)
  where doc_no is not null;

/**
 * The next unused number for a shop and a date.
 *
 * `security definer` so the count is over every row, not only the ones the
 * caller's RLS policy lets them see — a Lampang number must not be reissued
 * just because the person entering it cannot read Lampang's other expenses.
 */
create or replace function next_expense_doc_no(p_shop text, p_date date)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text;
  v_seq    integer;
begin
  -- พ.ศ. = ค.ศ. + 543, สองหลักท้าย
  v_prefix := 'POS-' || upper(p_shop) || '-'
              || to_char(((extract(year from p_date)::int + 543) % 100), 'FM00')
              || to_char(p_date, 'MM');

  -- Everything AFTER the prefix is the sequence. Matching a trailing run of
  -- digits instead would swallow the year and month too — there is no separator
  -- before the sequence, so '…-6908002' reads as 6,908,002 and the next number
  -- comes out as 6908003, which does not fit three digits.
  select coalesce(max(substr(doc_no, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from expenses
   where doc_no like v_prefix || '%'
     and substr(doc_no, length(v_prefix) + 1) ~ '^[0-9]+$';

  -- lpad, not to_char('FM000'): a shop that passes 999 expenses in one month
  -- gets 1000, where the fixed three-digit format would render '###'.
  return v_prefix || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function next_expense_doc_no(text, date) from public, anon;
grant execute on function next_expense_doc_no(text, date) to authenticated;

create or replace function assign_expense_doc_no()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_date date;
begin
  if new.doc_no is not null and btrim(new.doc_no) <> '' then
    return new;  -- an explicit number (the backfill, a data migration) wins
  end if;

  -- The document's own date: when it was paid, or when it falls due.
  v_date := coalesce(new.paid_at, new.due_at, current_date);

  -- Serialise number generation for this shop+month. Transaction-scoped, so it
  -- is released when the insert commits and never leaks.
  perform pg_advisory_xact_lock(hashtext('expense_doc_no:' || new.shop_id || ':' || to_char(v_date, 'YYYYMM')));

  new.doc_no := next_expense_doc_no(new.shop_id, v_date);
  return new;
end;
$$;

drop trigger if exists expenses_assign_doc_no on expenses;
create trigger expenses_assign_doc_no
  before insert on expenses
  for each row
  execute function assign_expense_doc_no();

-- Backfill, oldest first, so the running order matches the order the expenses
-- were actually entered. Numbered per shop and per month, exactly as new rows
-- will be. Runs once; rows that already carry a number are left alone.
with numbered as (
  select
    e.id,
    'POS-' || upper(e.shop_id) || '-'
      || to_char(((extract(year from coalesce(e.paid_at, e.due_at, current_date))::int + 543) % 100), 'FM00')
      || to_char(coalesce(e.paid_at, e.due_at, current_date), 'MM')
      || lpad(
           row_number() over (
             partition by
               e.shop_id,
               to_char(coalesce(e.paid_at, e.due_at, current_date), 'YYYYMM')
             order by coalesce(e.paid_at, e.due_at, current_date), e.id
           )::text,
           3,
           '0'
         ) as doc_no
  from expenses e
  where e.doc_no is null
)
update expenses e
   set doc_no = n.doc_no
  from numbered n
 where e.id = n.id;

insert into supabase_migrations.schema_migrations(version, name) values ('0019', 'expense_doc_no') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0020.sql
-- ==========================================================================

-- supabase/release-0020.sql
--
-- ใบเซอร์วิส ลูกค้าหน้าร้าน — ตารางเก็บประวัติการเข้าเซอร์วิสของรถแต่ละคัน
--
-- รันต่อจาก release-0019.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, create or replace function,
-- drop policy if exists ก่อน create
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0020_service_visits.sql
--
-- ใบเซอร์วิส ลูกค้าหน้าร้าน — one row per visit the car actually made.
--
-- The ticket already records the ENTITLEMENT (extras."Service".serviceCount, e.g.
-- 10 visits) and a single next-visit date. What it never recorded was the visits
-- themselves, so the shop could not answer "รถคันนี้เซอร์วิสไปกี่ครั้งแล้ว, วันไหน,
-- ทำอะไรไปบ้าง" — which is the whole reason this table exists.
--
-- Counted against the TICKET (`visit_no` runs 1..N per ticket, so "ครั้งที่ 2/10"
-- is answerable) and also readable per CAR: `plate` is a snapshot, indexed, so a
-- car's history survives across separate tickets and stays right even if the
-- ticket's plate is later corrected.

set search_path = pos, public, extensions;

create table if not exists service_visits (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  -- 1..N within the ticket. The unique constraint is what stops two people
  -- filing "ครั้งที่ 3" for the same job.
  visit_no integer not null,
  -- Snapshot of the vehicle, so the per-car history does not depend on the
  -- ticket still saying the same thing.
  plate text not null default '',

  received_at date,                       -- วันรับรถ
  received_time text not null default '', -- เวลารับรถ
  delivered_at date,                      -- วันส่งมอบรถ
  delivered_time text not null default '',-- เวลาส่งมอบรถ

  sales_by text not null default '',      -- เซลล์รับรถ
  qc_by text not null default '',         -- QC ผู้รับผิดชอบ
  technicians jsonb not null default '[]',-- ทีมช่าง — names from the technicians list

  film_type text not null default '',        -- TPU | PET
  film_thickness text not null default '',   -- 165 | 195 | 195ด้าน | 215 | 255
  film_colour_code text not null default '', -- รหัสสี

  -- Tri-state on purpose: null means nobody has said yet, which is different
  -- from "ลูกค้าไม่รอ" and from "งานไม่ปกติ".
  customer_waits boolean,                 -- ลูกค้า รอ / ไม่รอ
  overall_ok boolean,                     -- เช็คสภาพงาน รอบคันปกติ

  -- { "หน้าจอ1": "ปกติ", "Sunroof": "ผิดปกติ", ... } — a free-form map rather
  -- than a column per part, because the paper form's list is the shop's and will
  -- change without a schema migration behind it.
  checks jsonb not null default '{}',

  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  unique (ticket_id, visit_no)
);

comment on table service_visits is
  'ใบเซอร์วิส — หนึ่งแถวต่อการเข้าเซอร์วิสหนึ่งครั้ง นับต่อใบงาน ดูประวัติต่อคันได้ผ่าน plate';

-- The per-car history view ("รถทะเบียนนี้เคยเซอร์วิสรวมกี่ครั้ง") reads by plate
-- across every ticket, so it needs its own index.
create index if not exists service_visits_plate_idx on service_visits (plate, received_at desc);
create index if not exists service_visits_ticket_idx on service_visits (ticket_id, visit_no);

-- จุดพิเศษลูกค้าต้องการแก้ไข — the ten numbered rows on the form. Its own table
-- rather than more jsonb: this is the part the shop reads back later ("ครั้งก่อน
-- แก้อะไรไป"), so it should be queryable.
create table if not exists service_visit_points (
  id bigint generated always as identity primary key,
  visit_id bigint not null references service_visits(id) on delete cascade,
  seq integer not null,
  "position" text not null default '',
  detail text not null default '',
  note text not null default '',
  unique (visit_id, seq)
);

comment on table service_visit_points is
  'จุดพิเศษลูกค้าต้องการแก้ไข ของการเซอร์วิสแต่ละครั้ง (สูงสุด 10 จุดตามฟอร์ม)';

-- RLS: scoped through the parent ticket's shop, exactly like ticket_items and
-- ticket_payments (migration 0007). A service visit is part of the job.
alter table service_visits enable row level security;
drop policy if exists service_visits_rw on service_visits;
create policy service_visits_rw on service_visits for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table service_visit_points enable row level security;
drop policy if exists service_visit_points_rw on service_visit_points;
create policy service_visit_points_rw on service_visit_points for all
  using (visit_id in (
    select v.id from service_visits v join tickets t on t.id = v.ticket_id
    where t.shop_id in (select current_user_shops())
  ))
  with check (visit_id in (
    select v.id from service_visits v join tickets t on t.id = v.ticket_id
    where t.shop_id in (select current_user_shops())
  ));

/**
 * Save a visit and its ten points together.
 *
 * One function so a visit can never end up stored without the points the
 * technician wrote on it — the same reason `save_ticket_children` exists. A new
 * visit (p_id null) takes the next `visit_no` for the ticket under a
 * transaction-scoped lock, so two people filing at once get 3 and 4 rather than
 * both getting 3 and one of them failing on the unique constraint.
 */
create or replace function save_service_visit(
  p_id bigint,
  p_ticket_id text,
  p_visit jsonb,
  p_points jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
  v_no integer;
begin
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('service_visit:' || p_ticket_id));
    select coalesce(max(visit_no), 0) + 1 into v_no
      from service_visits where ticket_id = p_ticket_id;

    insert into service_visits (
      ticket_id, visit_no, plate, received_at, received_time, delivered_at, delivered_time,
      sales_by, qc_by, technicians, film_type, film_thickness, film_colour_code,
      customer_waits, overall_ok, checks, notes, created_by
    ) values (
      p_ticket_id,
      v_no,
      coalesce(p_visit->>'plate', ''),
      (p_visit->>'receivedAt')::date,
      coalesce(p_visit->>'receivedTime', ''),
      (p_visit->>'deliveredAt')::date,
      coalesce(p_visit->>'deliveredTime', ''),
      coalesce(p_visit->>'salesBy', ''),
      coalesce(p_visit->>'qcBy', ''),
      coalesce(p_visit->'technicians', '[]'::jsonb),
      coalesce(p_visit->>'filmType', ''),
      coalesce(p_visit->>'filmThickness', ''),
      coalesce(p_visit->>'filmColourCode', ''),
      (p_visit->>'customerWaits')::boolean,
      (p_visit->>'overallOk')::boolean,
      coalesce(p_visit->'checks', '{}'::jsonb),
      coalesce(p_visit->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update service_visits set
      plate            = coalesce(p_visit->>'plate', ''),
      received_at      = (p_visit->>'receivedAt')::date,
      received_time    = coalesce(p_visit->>'receivedTime', ''),
      delivered_at     = (p_visit->>'deliveredAt')::date,
      delivered_time   = coalesce(p_visit->>'deliveredTime', ''),
      sales_by         = coalesce(p_visit->>'salesBy', ''),
      qc_by            = coalesce(p_visit->>'qcBy', ''),
      technicians      = coalesce(p_visit->'technicians', '[]'::jsonb),
      film_type        = coalesce(p_visit->>'filmType', ''),
      film_thickness   = coalesce(p_visit->>'filmThickness', ''),
      film_colour_code = coalesce(p_visit->>'filmColourCode', ''),
      customer_waits   = (p_visit->>'customerWaits')::boolean,
      overall_ok       = (p_visit->>'overallOk')::boolean,
      checks           = coalesce(p_visit->'checks', '{}'::jsonb),
      notes            = coalesce(p_visit->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบใบเซอร์วิสที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  -- Replace the points wholesale; the form owns all ten rows at once.
  delete from service_visit_points where visit_id = v_id;
  insert into service_visit_points (visit_id, seq, "position", detail, note)
  select
    v_id,
    coalesce((pt->>'seq')::int, 0),
    coalesce(pt->>'position', ''),
    coalesce(pt->>'detail', ''),
    coalesce(pt->>'note', '')
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) as pt
  -- An empty row is a row the technician left blank; storing ten blanks per
  -- visit would bury the ones that say something.
  where coalesce(pt->>'position', '') <> ''
     or coalesce(pt->>'detail', '') <> ''
     or coalesce(pt->>'note', '') <> '';

  return v_id;
end;
$$;

revoke all on function save_service_visit(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_service_visit(bigint, text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0020', 'service_visits') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0021.sql
-- ==========================================================================

-- supabase/release-0021.sql
--
-- ใบเซอร์วิส: บันทึกฟิล์มที่ใช้เป็นชื่อสินค้า (ความหนาอยู่ในชื่อสินค้าอยู่แล้ว)
--
-- รันต่อจาก release-0020.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add/drop column if exists, create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0021_service_film_product.sql
--
-- ใบเซอร์วิส: บันทึกฟิล์มที่ใช้เป็น "ชื่อสินค้า" ไม่ต้องแยก ประเภท/ความหนา/รหัสสี
--
-- 0020 gave a visit three fields — film_type, film_thickness, film_colour_code —
-- copied from the shop's paper form. They were never the shop's data model: each
-- ฟิล์มกันรอย SKU already states its thickness in the product NAME, so those
-- three fields asked for the same fact a third time and let two sheets for one
-- car disagree.
--
-- One field now: the product name the ticket sold. It is a snapshot, so
-- reprinting an old sheet still shows the film that was fitted that day even
-- after the ticket is edited or the product renamed.
--
-- `stock.film_thickness` / `stock.film_colour_code` (0021_stock_film_spec, which
-- only ever reached a development database) go away for the same reason. Dropped
-- `if exists`, so this is correct whether or not that file was ever run.

set search_path = pos, public, extensions;

alter table stock
  drop column if exists film_thickness,
  drop column if exists film_colour_code;

alter table service_visits
  add column if not exists film_product text not null default '';

comment on column service_visits.film_product is
  'ชื่อสินค้าฟิล์มที่ใช้ ณ วันที่เซอร์วิส — ความหนาอยู่ในชื่อสินค้าอยู่แล้ว';

-- Carry forward whatever the three old columns held, so a visit recorded before
-- this migration does not print an empty ฟิล์มที่ใช้ line.
--
-- Guarded, and executed dynamically, because the three columns are DROPPED ten
-- lines below. On a second run they are already gone, and a plain `update`
-- naming them fails to PARSE — which aborts the whole script, not just this
-- statement. That is what makes the ceremony worth it: this file has to be safe
-- to paste into a database that has already had it pasted once.
do $backfill$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'pos' and table_name = 'service_visits' and column_name = 'film_type'
  ) then
    execute $sql$
      update service_visits
         set film_product = trim(
               concat_ws(' ', nullif(film_type, ''), nullif(film_thickness, ''), nullif(film_colour_code, ''))
             )
       where film_product = ''
         and (film_type <> '' or film_thickness <> '' or film_colour_code <> '')
    $sql$;
  end if;
end
$backfill$;

alter table service_visits
  drop column if exists film_type,
  drop column if exists film_thickness,
  drop column if exists film_colour_code;

-- Same function as 0020 with the film columns replaced; everything else is
-- unchanged, including the advisory lock that hands out `visit_no`.
create or replace function save_service_visit(
  p_id bigint,
  p_ticket_id text,
  p_visit jsonb,
  p_points jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
  v_no integer;
begin
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('service_visit:' || p_ticket_id));
    select coalesce(max(visit_no), 0) + 1 into v_no
      from service_visits where ticket_id = p_ticket_id;

    insert into service_visits (
      ticket_id, visit_no, plate, received_at, received_time, delivered_at, delivered_time,
      sales_by, qc_by, technicians, film_product,
      customer_waits, overall_ok, checks, notes, created_by
    ) values (
      p_ticket_id,
      v_no,
      coalesce(p_visit->>'plate', ''),
      (p_visit->>'receivedAt')::date,
      coalesce(p_visit->>'receivedTime', ''),
      (p_visit->>'deliveredAt')::date,
      coalesce(p_visit->>'deliveredTime', ''),
      coalesce(p_visit->>'salesBy', ''),
      coalesce(p_visit->>'qcBy', ''),
      coalesce(p_visit->'technicians', '[]'::jsonb),
      coalesce(p_visit->>'filmProduct', ''),
      (p_visit->>'customerWaits')::boolean,
      (p_visit->>'overallOk')::boolean,
      coalesce(p_visit->'checks', '{}'::jsonb),
      coalesce(p_visit->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update service_visits set
      plate            = coalesce(p_visit->>'plate', ''),
      received_at      = (p_visit->>'receivedAt')::date,
      received_time    = coalesce(p_visit->>'receivedTime', ''),
      delivered_at     = (p_visit->>'deliveredAt')::date,
      delivered_time   = coalesce(p_visit->>'deliveredTime', ''),
      sales_by         = coalesce(p_visit->>'salesBy', ''),
      qc_by            = coalesce(p_visit->>'qcBy', ''),
      technicians      = coalesce(p_visit->'technicians', '[]'::jsonb),
      film_product     = coalesce(p_visit->>'filmProduct', ''),
      customer_waits   = (p_visit->>'customerWaits')::boolean,
      overall_ok       = (p_visit->>'overallOk')::boolean,
      checks           = coalesce(p_visit->'checks', '{}'::jsonb),
      notes            = coalesce(p_visit->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบใบเซอร์วิสที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  -- Replace the points wholesale; the form owns all ten rows at once.
  delete from service_visit_points where visit_id = v_id;
  insert into service_visit_points (visit_id, seq, "position", detail, note)
  select
    v_id,
    coalesce((pt->>'seq')::int, 0),
    coalesce(pt->>'position', ''),
    coalesce(pt->>'detail', ''),
    coalesce(pt->>'note', '')
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) as pt
  -- An empty row is a row the technician left blank; storing ten blanks per
  -- visit would bury the ones that say something.
  where coalesce(pt->>'position', '') <> ''
     or coalesce(pt->>'detail', '') <> ''
     or coalesce(pt->>'note', '') <> '';

  return v_id;
end;
$$;

revoke all on function save_service_visit(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_service_visit(bigint, text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0021', 'service_film_product') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0022.sql
-- ==========================================================================

-- supabase/release-0022.sql
--
-- ใบงานที่ปิดงานแล้ว: ยังแก้ "ข้อมูลเพิ่มเติม" ได้ (เซอร์วิส / ประกัน)
--
-- รันต่อจาก release-0021.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function ทั้งสองตัว
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0022_extras_after_lock.sql
--
-- ใบงานที่ปิดงานแล้ว: ยังแก้ "ข้อมูลเพิ่มเติม" ได้
--
-- 0017 froze a delivered-and-paid ticket because commission, revenue and any
-- later dispute are read from it. That is still right for the money — but the
-- job does not end at delivery. The car comes back to be serviced, sometimes
-- for years, and the customer may take out ประกัน afterwards. Freezing the
-- ข้อมูลเพิ่มเติม block along with the rest meant the shop had to have an admin
-- unlock a closed ticket to write down a service visit, which is the opposite of
-- what the lock is for.
--
-- So the lock narrows to what it actually protects: the numbers. `extras` (the
-- ข้อมูลเพิ่มเติม jsonb) becomes editable on a locked ticket; every other column,
-- every item, every payment stays frozen.
--
-- Two pieces:
--   1. `enforce_ticket_lock` lets an update through when `extras` is the ONLY
--      column that changed. Column-by-column via `to_jsonb`, so a future column
--      is frozen by default rather than accidentally let through.
--   2. `save_ticket_extras()` is the only write path the app uses for this. It
--      cannot touch anything else, so "the extras section is open" can never
--      widen into "the ticket is open".

set search_path = pos, public, extensions;

create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if old.locked and not current_user_can('list.unlock') then
    -- ข้อมูลเพิ่มเติม only. `- 'extras'` drops that one key from both sides, so
    -- this is true exactly when nothing else moved — including `locked` itself,
    -- which is why this cannot be used to quietly reopen the ticket.
    if to_jsonb(new) - 'extras' = to_jsonb(old) - 'extras' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

/**
 * บันทึกเฉพาะ ข้อมูลเพิ่มเติม — ใช้ได้แม้ใบงานถูกล็อกแล้ว.
 *
 * `p_insurance` mirrors the ประกัน tick onto the auto-added ประกัน line, because
 * the tick and that line are one decision made in one place. The line is created
 * at ราคา 0: recording that the customer took ประกัน is an extra, but PRICING it
 * is revenue, and revenue on a closed ticket still needs `list.unlock`. Removing
 * it is likewise refused once someone has priced it — that would be deleting
 * money from a closed record.
 */
create or replace function save_ticket_extras(
  p_ticket_id text,
  p_extras jsonb,
  p_insurance boolean
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  update tickets set extras = coalesce(p_extras, '{}'::jsonb) where id = p_ticket_id;
  if not found then
    raise exception 'ไม่พบใบงานนี้' using errcode = 'P0002';
  end if;

  if p_insurance then
    if not exists (
      select 1 from ticket_items
       where ticket_id = p_ticket_id and category = 'ประกัน' and sold = 'ประกัน'
    ) then
      insert into ticket_items (ticket_id, category, booked, booked_price, sold, sold_price)
      values (p_ticket_id, 'ประกัน', 'ประกัน', 0, 'ประกัน', 0);
    end if;
  else
    delete from ticket_items
     where ticket_id = p_ticket_id
       and category = 'ประกัน'
       and sold = 'ประกัน'
       and coalesce(sold_price, 0) = 0
       and coalesce(booked_price, 0) = 0;
  end if;
end;
$$;

revoke all on function save_ticket_extras(text, jsonb, boolean) from public, anon;
grant execute on function save_ticket_extras(text, jsonb, boolean) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0022', 'extras_after_lock') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0023.sql
-- ==========================================================================

-- supabase/release-0023.sql
--
-- ประกันฟิล์มกันรอย — แผนราคา, กรมธรรม์ที่ขาย, และการเคลม
--
-- รันต่อจาก release-0022.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, insert แบบ guard ด้วย not exists
--
-- หมายเหตุ: ไฟล์นี้ย้ายรายการ "ประกัน" ที่อยู่ในสินค้าของใบงานเดิม ไปเป็นกรมธรรม์
-- แล้วลบออกจาก ticket_items — ยอดใบงานเดิมจะลดลงเท่าค่าประกัน และไปโผล่เป็น
-- รายได้ประกันตามวันที่ของใบงานนั้นแทน ยอดรวมของกิจการเท่าเดิม
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0023_insurance.sql
--
-- ประกันฟิล์มกันรอย — แผนราคา, กรมธรรม์ที่ขาย, และการเคลม
--
-- Insurance used to be a line on the ticket: ticking ประกัน added a ticket_item
-- at ราคา 0 and the shop typed a price into it. That tied the money to the
-- TICKET's date, which broke the way the shop actually sells it — the cover can
-- be bought with the install, or months later when the ticket is closed and its
-- revenue belongs to a period that has already been reported. Pricing it after
-- the fact meant reopening a closed record and moving last month's sales.
--
-- So insurance becomes its own record with its own วันที่ขาย. A policy is never
-- part of a ticket's total, whenever it was sold — one rule instead of two, and
-- the closed ticket is never touched. Revenue reads from `sold_at`, so a policy
-- sold today lands in today's figures no matter how old the job is.
--
-- Three tables:
--   insurance_plans    — ตารางราคาประกัน the branch maintains
--   insurance_policies — one row per sale, holding a SNAPSHOT of the plan
--   insurance_claims   — each time the customer uses the cover
--
-- The snapshot is the point of the middle table. Editing a plan's price or its
-- ความคุ้มครอง must never reach backwards into a policy already sold; what the
-- customer bought is what was true the day they bought it.

set search_path = pos, public, extensions;

/**
 * ตารางราคาประกัน — what the counter picks from.
 *
 * Cover is counted, not described: "ครอบคลุม 2 ชิ้นใหญ่, 20 ชิ้นเล็ก" is two
 * numbers, and storing them as numbers is what lets the shop answer "เหลือกี่
 * ชิ้น" after a claim. `terms` carries anything else the plan says.
 */
create table if not exists insurance_plans (
  id bigint generated always as identity primary key,
  -- null = ทุกสาขา, mirroring commission_rules.shop_id.
  shop_id text references shops(id) on delete cascade,
  name text not null,
  price numeric(12, 2) not null default 0,
  big_pieces integer not null default 0,   -- ชิ้นใหญ่
  small_pieces integer not null default 0, -- ชิ้นเล็ก
  months integer not null default 12,      -- ระยะเวลาคุ้มครอง
  terms text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0
);

comment on table insurance_plans is
  'แผนประกันฟิล์มกันรอย — ราคาและความคุ้มครองตั้งต้น แก้ไขได้ตลอด ไม่กระทบกรมธรรม์ที่ขายไปแล้ว';

/**
 * กรมธรรม์ที่ขายแล้ว.
 *
 * `ticket_id` says which job it came from; `plate` is a snapshot so the per-car
 * history survives across separate tickets and stays right even if the ticket's
 * plate is later corrected — the same reasoning as service_visits.
 *
 * Every plan field is copied in, not referenced. A plan is a price list; a
 * policy is a contract.
 */
create table if not exists insurance_policies (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  plate text not null default '',

  plan_name text not null default '',
  price numeric(12, 2) not null default 0,
  big_pieces integer not null default 0,
  small_pieces integer not null default 0,
  terms text not null default '',

  -- The revenue date. Deliberately its own column rather than created_at: a
  -- policy written up the morning after is still yesterday's sale.
  sold_at date not null default current_date,
  starts_at date,
  ends_at date,

  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null
);

comment on table insurance_policies is
  'ประกันที่ขายแล้ว — หนึ่งแถวต่อหนึ่งการขาย รับรู้รายได้ตาม sold_at ไม่รวมในยอดใบงาน';

-- "ประกันของรถคันนี้" and "ใกล้หมดอายุใน 30 วัน" are the two questions asked of
-- this table, and neither reads by ticket.
create index if not exists insurance_policies_plate_idx on insurance_policies (plate, ends_at desc);
create index if not exists insurance_policies_ends_idx on insurance_policies (ends_at);
create index if not exists insurance_policies_ticket_idx on insurance_policies (ticket_id);
create index if not exists insurance_policies_sold_idx on insurance_policies (sold_at);

/** การเคลม — each time the cover is used, counted against the policy. */
create table if not exists insurance_claims (
  id bigint generated always as identity primary key,
  policy_id bigint not null references insurance_policies(id) on delete cascade,
  claimed_at date not null default current_date,
  big_used integer not null default 0,
  small_used integer not null default 0,
  detail text not null default '',
  technician text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null
);

comment on table insurance_claims is
  'การเคลมประกันแต่ละครั้ง — หักจำนวนชิ้นออกจากความคุ้มครองของกรมธรรม์';

create index if not exists insurance_claims_policy_idx on insurance_claims (policy_id, claimed_at desc);

-- RLS. Plans are branch configuration, readable by anyone signed in and scoped
-- to the shops the caller can see; policies and claims hang off the ticket's
-- shop exactly like ticket_items and service_visits.
alter table insurance_plans enable row level security;
drop policy if exists insurance_plans_read on insurance_plans;
create policy insurance_plans_read on insurance_plans for select
  using (shop_id is null or shop_id in (select current_user_shops()));
drop policy if exists insurance_plans_write on insurance_plans;
create policy insurance_plans_write on insurance_plans for all
  using (current_user_can('stock.editDelete'))
  with check (current_user_can('stock.editDelete'));

alter table insurance_policies enable row level security;
drop policy if exists insurance_policies_rw on insurance_policies;
create policy insurance_policies_rw on insurance_policies for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table insurance_claims enable row level security;
drop policy if exists insurance_claims_rw on insurance_claims;
create policy insurance_claims_rw on insurance_claims for all
  using (policy_id in (
    select p.id from insurance_policies p join tickets t on t.id = p.ticket_id
    where t.shop_id in (select current_user_shops())
  ))
  with check (policy_id in (
    select p.id from insurance_policies p join tickets t on t.id = p.ticket_id
    where t.shop_id in (select current_user_shops())
  ));

/**
 * บันทึกกรมธรรม์พร้อมการเคลมทั้งหมด.
 *
 * One call so a policy can never be stored without the claims recorded against
 * it — the same reason `save_ticket_children` and `save_service_visit` exist.
 * Claims are replaced wholesale because the form owns the whole list.
 *
 * Nothing here checks `tickets.locked`: selling ประกัน months after delivery is
 * the normal case, and a policy is not part of the ticket's numbers.
 */
create or replace function save_insurance_policy(
  p_id bigint,
  p_ticket_id text,
  p_policy jsonb,
  p_claims jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
begin
  if p_id is null then
    insert into insurance_policies (
      ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
      sold_at, starts_at, ends_at, notes, created_by
    ) values (
      p_ticket_id,
      coalesce(p_policy->>'plate', ''),
      coalesce(p_policy->>'planName', ''),
      coalesce((p_policy->>'price')::numeric, 0),
      coalesce((p_policy->>'bigPieces')::int, 0),
      coalesce((p_policy->>'smallPieces')::int, 0),
      coalesce(p_policy->>'terms', ''),
      coalesce((p_policy->>'soldAt')::date, current_date),
      (p_policy->>'startsAt')::date,
      (p_policy->>'endsAt')::date,
      coalesce(p_policy->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update insurance_policies set
      plate        = coalesce(p_policy->>'plate', ''),
      plan_name    = coalesce(p_policy->>'planName', ''),
      price        = coalesce((p_policy->>'price')::numeric, 0),
      big_pieces   = coalesce((p_policy->>'bigPieces')::int, 0),
      small_pieces = coalesce((p_policy->>'smallPieces')::int, 0),
      terms        = coalesce(p_policy->>'terms', ''),
      sold_at      = coalesce((p_policy->>'soldAt')::date, current_date),
      starts_at    = (p_policy->>'startsAt')::date,
      ends_at      = (p_policy->>'endsAt')::date,
      notes        = coalesce(p_policy->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  delete from insurance_claims where policy_id = v_id;
  insert into insurance_claims (policy_id, claimed_at, big_used, small_used, detail, technician, created_by)
  select
    v_id,
    coalesce((c->>'claimedAt')::date, current_date),
    coalesce((c->>'bigUsed')::int, 0),
    coalesce((c->>'smallUsed')::int, 0),
    coalesce(c->>'detail', ''),
    coalesce(c->>'technician', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) as c
  -- A claim that used nothing and says nothing is an empty row on the form.
  where coalesce((c->>'bigUsed')::int, 0) > 0
     or coalesce((c->>'smallUsed')::int, 0) > 0
     or coalesce(c->>'detail', '') <> '';

  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

-- Starter plans, one shop-wide row so the picker is not empty on day one. The
-- shop edits these in สต็อกสินค้า; `on conflict do nothing` has nothing to key
-- on, so guard by existence instead.
insert into insurance_plans (shop_id, name, price, big_pieces, small_pieces, months, terms, sort_order)
select null, 'ประกันฟิล์มกันรอย 1 ปี', 0, 2, 20, 12, '', 1
where not exists (select 1 from insurance_plans);

/*
  Carry the ประกัน lines that already exist on tickets into policies.

  Those rows were the old model. Left in ticket_items they would keep counting
  in each ticket's total, which is exactly the double-count this migration
  exists to remove — revenue now reads policies by `sold_at`. The ticket's
  own date is the best `sold_at` available for them.
*/
insert into insurance_policies (ticket_id, plate, plan_name, price, sold_at, starts_at, notes)
select
  i.ticket_id,
  coalesce(t.plate, ''),
  'ประกัน',
  coalesce(i.sold_price, 0),
  coalesce(t.drop_off_date::date, t.created_at::date, current_date),
  coalesce(t.drop_off_date::date, t.created_at::date, current_date),
  'ย้ายมาจากรายการสินค้าในใบงานเดิม'
from ticket_items i
join tickets t on t.id = i.ticket_id
where i.category = 'ประกัน'
  and not exists (select 1 from insurance_policies p where p.ticket_id = i.ticket_id)
  -- ครั้งเดียวเท่านั้น: on a re-run this would turn any ประกัน line added since
  -- into a policy the shop never sold, and the DELETE below would remove it.
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0023');

delete from ticket_items
where category = 'ประกัน'
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0023');

/*
  `save_ticket_extras` loses its ประกัน half.

  0022 mirrored the ประกัน tick onto an auto-added ticket_item at ราคา 0, because
  that was where insurance lived. It lives in `insurance_policies` now, so the
  extras save goes back to doing exactly one thing: writing `extras`.
*/
drop function if exists save_ticket_extras(text, jsonb, boolean);

create or replace function save_ticket_extras(
  p_ticket_id text,
  p_extras jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  update tickets set extras = coalesce(p_extras, '{}'::jsonb) where id = p_ticket_id;
  if not found then
    raise exception 'ไม่พบใบงานนี้' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function save_ticket_extras(text, jsonb) from public, anon;
grant execute on function save_ticket_extras(text, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0023', 'insurance') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0024.sql
-- ==========================================================================

-- supabase/release-0024.sql
--
-- โมดูลรายได้ — ประวัติการออกเอกสารการเงิน และเมนู "รายได้"
--
-- รันต่อจาก release-0023.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, insert แบบ on conflict do nothing
--
-- หมายเหตุ: ประวัติการออกใบกำกับภาษีเริ่มนับจากวันที่รันไฟล์นี้เป็นต้นไป
-- ของเดิมไม่เคยถูกบันทึกไว้ จึงไม่มีข้อมูลย้อนหลัง
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0024_revenue_report.sql
--
-- โมดูลรายได้ — เก็บประวัติการออกเอกสารการเงิน และเปิดเมนู "รายได้"
--
-- The shop asked for a sales report split by ชนิดสินค้า that also says whether a
-- ใบกำกับภาษี was issued. The first half was already answerable from
-- `ticket_items`; the second half was not answerable at all.
--
-- Issuing a financial document was a PRINT and nothing else: the type (ใบเสร็จ /
-- ใบกำกับภาษี / ใบเสนอราคา), the buyer's นิติบุคคล name and its เลขผู้เสียภาษี
-- lived in React state for as long as the screen was open and then went away. So
-- nobody could answer "which sales did we issue a tax invoice for", which is the
-- question the accountant asks every month.
--
-- `ticket_documents` is that record. One row per (ticket, document type): a
-- reprint is the same document, not a second one, so it updates in place and
-- keeps its original `issued_at`. The number is stored as printed, because that
-- is the string the customer will quote back on the phone.

set search_path = pos, public, extensions;

create table if not exists ticket_documents (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  -- ใบเสร็จรับเงิน | ใบกำกับภาษี/ใบเสร็จรับเงิน | ใบเสนอราคา
  doc_type text not null,
  doc_no text not null default '',
  -- The day it was handed over, kept through a reprint.
  issued_at date not null default current_date,
  -- Snapshot of who it was made out to. `corporate_buyers` is a registry the
  -- shop edits; a document says who it was issued to on the day.
  buyer_name text not null default '',
  buyer_tax_id text not null default '',
  buyer_address text not null default '',
  amount numeric(12, 2) not null default 0,
  issued_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ticket_id, doc_type)
);

comment on table ticket_documents is
  'เอกสารการเงินที่ออกให้ลูกค้าแล้ว — หนึ่งแถวต่อหนึ่งชนิดเอกสารต่อใบงาน พิมพ์ซ้ำไม่นับใหม่';

create index if not exists ticket_documents_issued_idx on ticket_documents (issued_at);
create index if not exists ticket_documents_type_idx on ticket_documents (doc_type);

alter table ticket_documents enable row level security;
drop policy if exists ticket_documents_rw on ticket_documents;
create policy ticket_documents_rw on ticket_documents for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

/**
 * บันทึกว่าออกเอกสารให้ลูกค้าแล้ว.
 *
 * Upsert, not insert: printing the same receipt a second time is the shop
 * handing over another copy of ONE document. `issued_at` therefore survives —
 * the date on the paper the customer already has does not change — while the
 * buyer and the amount are refreshed, because a reprint after an edit should
 * carry what the document now says.
 *
 * No `locked` check. Issuing a receipt for a closed job is the normal case, and
 * this writes nothing the lock protects.
 */
create or replace function record_ticket_document(
  p_ticket_id text,
  p_doc_type text,
  p_doc_no text,
  p_buyer_name text,
  p_buyer_tax_id text,
  p_buyer_address text,
  p_amount numeric
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into ticket_documents (
    ticket_id, doc_type, doc_no, buyer_name, buyer_tax_id, buyer_address, amount, issued_by
  ) values (
    p_ticket_id,
    p_doc_type,
    coalesce(p_doc_no, ''),
    coalesce(p_buyer_name, ''),
    coalesce(p_buyer_tax_id, ''),
    coalesce(p_buyer_address, ''),
    coalesce(p_amount, 0),
    auth.uid()
  )
  on conflict (ticket_id, doc_type) do update set
    doc_no        = excluded.doc_no,
    buyer_name    = excluded.buyer_name,
    buyer_tax_id  = excluded.buyer_tax_id,
    buyer_address = excluded.buyer_address,
    amount        = excluded.amount;
end;
$$;

revoke all on function record_ticket_document(text, text, text, text, text, text, numeric) from public, anon;
grant execute on function record_ticket_document(text, text, text, text, text, text, numeric) to authenticated;

-- เมนู "รายได้". Delta insert so a live matrix keeps whatever the shop re-toggled.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','nav','revenue',true),
  ('exec','nav','revenue',true),
  ('sales','nav','revenue',false),
  ('tech','nav','revenue',false)
on conflict (role_id, permission_type, permission_key) do nothing;

-- And into the reset, or "รีเซ็ตค่าเริ่มต้น" would delete the key and the module
-- would vanish for everyone. Only the four `nav`/`revenue` lines differ from
-- migration 0017's copy of this function.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys: maintaining the option lists, and reopening a closed ticket.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    ('sales','module_capability','list.unlock',false),
    ('tech','module_capability','list.unlock',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0024', 'revenue_report') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0025.sql
-- ==========================================================================

-- supabase/release-0025.sql
--
-- ความถูกต้องของจำนวนสต็อก — คำนวณที่ฐานข้อมูล ไม่ใช่ที่เบราว์เซอร์
--
-- รันต่อจาก release-0024.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function, create index if not exists
--
-- หมายเหตุ: ถ้ามีชื่อสินค้าซ้ำกันในสาขาเดียวกัน ไฟล์นี้จะข้ามการสร้าง unique index
-- แล้วขึ้น NOTICE บอก — รัน supabase/check-duplicate-stock-names.sql เพื่อดูว่าซ้ำที่ไหน
-- แก้แล้วรันไฟล์นี้ซ้ำได้เลย
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0025_stock_integrity.sql
--
-- ความถูกต้องของจำนวนสต็อก — คำนวณที่ฐานข้อมูล ไม่ใช่ที่เบราว์เซอร์
--
-- Every place that moved stock read `qty` into JavaScript, did the arithmetic
-- there and wrote the result back. Two people saving at the same time both read
-- 10, both write 8, and the shop is one roll short with nothing to show for it —
-- a lost update, and a silent one, because each write succeeded.
--
-- The fix is to let the database do the subtraction: `qty = qty - ?` is applied
-- against whatever the row holds at that instant, so two concurrent changes both
-- land. This is the only way to be correct with more than one counter, and the
-- shop has five branches.
--
-- Also here: a unique index on (สาขา, ชื่อสินค้า). Stock movement matches a
-- ticket's recorded usage to a product BY NAME, so two rows with the same name
-- at one branch made the match arbitrary — whichever came back first won. The
-- index is created only when the data already allows it; on a branch that has
-- duplicates it is skipped with a notice rather than failing the release, and
-- supabase/check-duplicate-stock-names.sql finds them.

set search_path = pos, public, extensions;

/**
 * เปลี่ยนจำนวนสต็อกหลายรายการพร้อมกัน แบบ atomic.
 *
 * `p_changes` is `[{"id": 12, "change": -2}, ...]` where `change` is added to
 * `qty` — negative consumes, positive receives. One statement for the whole set,
 * so a batch is all-or-nothing and no row is read into the client first.
 *
 * NOT clamped at zero, deliberately and consistently. `lib/stock/movements.ts`
 * already documented why: a negative figure means the shop counted wrong or
 * forgot to receive a delivery, and hiding that behind a floor of zero makes the
 * error permanent. The manual-withdrawal path used to clamp, which is the same
 * mistake in the other direction — it now behaves like every other path.
 *
 * RLS still applies (`security invoker`), so a caller can only move stock at a
 * shop they can already see.
 */
create or replace function apply_stock_deltas(p_changes jsonb)
returns void
language sql
security invoker
set search_path = pos
as $$
  update stock s
     set qty = s.qty + c.change
    from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as c(id bigint, change numeric)
   where s.id = c.id;
$$;

revoke all on function apply_stock_deltas(jsonb) from public, anon;
grant execute on function apply_stock_deltas(jsonb) to authenticated;

/*
  One product name per branch.

  Guarded rather than unconditional: a live branch may already carry duplicates,
  and failing the whole release over data the shop can fix in a minute would be
  the wrong trade. When it is skipped the notice says so, and the check script
  lists exactly which names to merge.
*/
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes
    from (select shop_id, name from stock group by shop_id, name having count(*) > 1) d;

  if v_dupes > 0 then
    raise notice 'ข้ามการสร้าง unique index: มีชื่อสินค้าซ้ำในสาขาเดียวกัน % ชื่อ — รัน supabase/check-duplicate-stock-names.sql เพื่อดูรายการ', v_dupes;
  else
    create unique index if not exists stock_shop_name_key on stock (shop_id, name);
    raise notice 'สร้าง unique index (shop_id, name) เรียบร้อย';
  end if;
end $$;

insert into supabase_migrations.schema_migrations(version, name) values ('0025', 'stock_integrity') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0026.sql
-- ==========================================================================

-- supabase/release-0026.sql
--
-- สมุดบัญชีสต็อก — บันทึกทุกการเคลื่อนไหว พร้อมจำนวนก่อน/หลัง
--
-- รันต่อจาก release-0025.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, add column if not exists, insert แบบ on conflict
--
-- หมายเหตุ: สมุดบัญชีเริ่มนับจากวันที่รันไฟล์นี้ ของเดิมใน withdrawals ไม่มี
-- จำนวนก่อน/หลังให้ย้ายมา จึงปล่อยไว้ที่เดิมเป็นประวัติเก่า
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0026_stock_ledger.sql
--
-- สมุดบัญชีสต็อก — บันทึกทุกการเคลื่อนไหว พร้อมจำนวนก่อน/หลัง
--
-- `withdrawals` was doing two jobs at once. It was the shop's ใบขอเบิก — a
-- request waiting for a manager — and it was also the audit log every automatic
-- movement wrote into, with the reason encoded in a Thai sentence
-- ("ตัดสต็อกจากใบงาน (JT-CM-00216)") and the product identified by NAME. Neither
-- job was done well:
--
--   * รับของเข้า and ปรับสต็อก wrote nothing at all — the two operations that
--     move stock most often left no trace, so "why did this drop from 20 to 8"
--     had no answer.
--   * There was no before/after, so a balance could not be reconstructed for a
--     date.
--   * The product was a name, so a rename detached the history from the product.
--   * "รออนุมัติ" had no approve button anywhere in the app. The pill was
--     decoration.
--
-- So the two jobs split. `stock_movements` is the ledger: one row per movement,
-- keyed by `stock_id`, carrying qty before and after, written by the same
-- function that changes the quantity so the two can never disagree.
-- `withdrawals` goes back to being only the request, and gains a real decision.
--
-- The ledger starts empty. Old `withdrawals` rows stay where they are as the
-- history that existed before this — they carry no before/after to import.

set search_path = pos, public, extensions;

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  -- Kept when a product is deleted: the movement happened, and a ledger that
  -- forgets its own entries is not a ledger.
  stock_id bigint references stock(id) on delete set null,
  -- Snapshot of the name at the time, so a later rename does not rewrite history.
  item_name text not null default '',
  shop_id text not null references shops(id) on delete cascade,

  -- ใบงาน | ขายส่ง | รับเข้า | ปรับสต็อก | เบิกใช้ | คืนจากใบเบิก | ยกเลิกใบงาน | กู้คืนใบงาน
  kind text not null,
  -- The document behind it: JT-CM-00216, an order id, or blank for a count.
  document_id text not null default '',

  -- Signed: negative consumes, positive returns or receives.
  change numeric(12, 2) not null,
  qty_before numeric(12, 2) not null,
  qty_after numeric(12, 2) not null,

  note text not null default '',
  moved_at timestamptz not null default now(),
  moved_by uuid references app_users(id) on delete set null,
  -- The name as well as the id: the prototype credited a person, and a user row
  -- removed later should not blank out who did it.
  moved_by_name text not null default ''
);

comment on table stock_movements is
  'สมุดบัญชีสต็อก — ทุกการเคลื่อนไหวพร้อมจำนวนก่อน/หลัง อ้างอิงสินค้าด้วย id';

create index if not exists stock_movements_stock_idx on stock_movements (stock_id, moved_at desc);
create index if not exists stock_movements_shop_idx on stock_movements (shop_id, moved_at desc);
create index if not exists stock_movements_doc_idx on stock_movements (document_id);

alter table stock_movements enable row level security;
drop policy if exists stock_movements_rw on stock_movements;
create policy stock_movements_rw on stock_movements for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/**
 * เปลี่ยนจำนวนสต็อก พร้อมลงบัญชีในคำสั่งเดียว.
 *
 * Supersedes `apply_stock_deltas` (0025), which moved the quantity correctly but
 * left the logging to the caller — so a caller that forgot, or a caller added
 * later, produced a silent movement. Doing both here means an unlogged movement
 * is not expressible.
 *
 * `p_changes` is `[{"id": 12, "change": -2}, ...]`; `change` is added to `qty`.
 * The before/after come out of the same UPDATE, so they are the real values at
 * that instant even when two callers land together.
 *
 * Still not clamped at zero — see 0025. A negative figure is a signal.
 */
create or replace function move_stock(
  p_changes jsonb,
  p_kind text,
  p_document_id text,
  p_by_name text,
  p_note text default ''
)
returns void
language sql
security invoker
set search_path = pos
as $$
  with c as (
    select x.id, x.change
      from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(id bigint, change numeric)
     where x.id is not null and coalesce(x.change, 0) <> 0
  ),
  upd as (
    update stock s
       set qty = s.qty + c.change
      from c
     where s.id = c.id
    returning s.id, s.name, s.shop_id, s.qty as qty_after, c.change as change
  )
  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, moved_by, moved_by_name, note
  )
  select
    u.id, u.name, u.shop_id, p_kind, coalesce(p_document_id, ''),
    u.change, u.qty_after - u.change, u.qty_after,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  from upd u;
$$;

revoke all on function move_stock(jsonb, text, text, text, text) from public, anon;
grant execute on function move_stock(jsonb, text, text, text, text) to authenticated;

/**
 * ปรับสต็อกตามผลนับจริง.
 *
 * A count is an ABSOLUTE figure, not a delta — the shelf holds what it holds. The
 * difference is read inside the statement, so the ledger records the movement
 * that actually happened rather than one derived from a number the client read a
 * moment earlier.
 *
 * A count that matches what the system already holds writes nothing: it is not a
 * movement, and a ledger full of zero-change rows is harder to read than one
 * without them.
 */
create or replace function count_stock(
  p_id bigint,
  p_counted numeric,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
  v_name text;
  v_shop text;
begin
  select qty, name, shop_id into v_before, v_name, v_shop
    from stock where id = p_id for update;
  if not found or v_before = p_counted then
    return;
  end if;

  update stock set qty = p_counted where id = p_id;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, moved_by, moved_by_name, note
  ) values (
    p_id, v_name, v_shop, 'ปรับสต็อก', '',
    p_counted - v_before, v_before, p_counted,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  );
end;
$$;

revoke all on function count_stock(bigint, numeric, text, text) from public, anon;
grant execute on function count_stock(bigint, numeric, text, text) to authenticated;

-- ใบขอเบิก gets a real decision, and a link to the product it took.
alter table withdrawals
  add column if not exists stock_id bigint references stock(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references app_users(id) on delete set null;

comment on column withdrawals.stock_id is
  'สินค้าที่เบิก — อ้างด้วย id เพื่อให้การคืนของตอนไม่อนุมัติหาแถวถูก แม้ชื่อจะถูกแก้';

-- อนุมัติ/ไม่อนุมัติใบเบิก. Requesting one is `stock.withdraw`; signing it off is
-- a manager's decision and gets its own key, so a หัวหน้าช่าง can take stock
-- without also being able to approve their own withdrawal.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','module_capability','stock.approveWithdraw',true),
  ('exec','module_capability','stock.approveWithdraw',true),
  ('sales','module_capability','stock.approveWithdraw',false),
  ('tech','module_capability','stock.approveWithdraw',false)
on conflict (role_id, permission_type, permission_key) do nothing;

-- And into the reset, or "รีเซ็ตค่าเริ่มต้น" would delete the key and nobody
-- could approve a withdrawal again. Only the four new lines differ from 0024's
-- copy of this function.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys: maintaining the option lists, and reopening a closed ticket.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false),
    ('admin','module_capability','stock.approveWithdraw',true),
    ('exec','module_capability','stock.approveWithdraw',true),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    ('sales','module_capability','list.unlock',false),
    ('tech','module_capability','list.unlock',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0026', 'stock_ledger') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0027.sql
-- ==========================================================================

-- supabase/release-0027.sql
--
-- ต้นทุนตามล็อต — รับของแต่ละรอบเก็บราคาของตัวเอง, ตัดของเก่าก่อน (FIFO)
--
-- รันต่อจาก release-0026.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, add column if not exists, insert แบบ guard ด้วย not exists
--
-- หมายเหตุสำคัญ:
--   1) ของที่มีอยู่ตอนนี้จะถูกตั้งเป็น "ล็อตยกมา" ล็อตเดียว ใช้ราคาทุนปัจจุบัน
--      ย้อนหลังแยกเป็นรอบ ๆ ไม่ได้เพราะไม่เคยเก็บไว้ — ตั้งแต่รันไฟล์นี้ทุกรอบแยกกัน
--   2) stock.cost เลิกพิมพ์เอง กลายเป็นค่าเฉลี่ยถ่วงน้ำหนักของล็อตที่เหลือ
--      คำนวณอัตโนมัติทุกครั้งที่สต็อกขยับ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0027_stock_batches.sql
--
-- ต้นทุนตามล็อต — รับของแต่ละรอบเก็บราคาของตัวเอง, ตัดของเก่าก่อน (FIFO)
--
-- `stock.cost` was one number per product, overwritten every time a delivery
-- arrived. Buy ten rolls at 800 and ten more at 950, and the shop is told all
-- twenty cost 950: the stock is valued 1,500 too high and the cost of any one
-- job cannot be worked out at all.
--
-- A LOT is one delivery. It carries its own unit cost and remembers how much of
-- it is left, so "what did we pay that round" stays answerable for as long as
-- the goods are on the shelf. Consumption draws from the oldest lot first, which
-- is what the shop already does physically — you finish the roll that is open.
--
-- Three pieces:
--   stock_batches           — one row per delivery
--   stock_movement_batches  — which lots a movement drew from, and at what cost
--   move_stock / receive_stock — allocate, cost, and record, in one call
--
-- `stock.cost` stops being typed in and becomes the weighted average of what is
-- left. It is derived now, so it cannot be wrong.
--
-- Lots start the day this runs. Whatever is on the shelf becomes ONE opening lot
-- at the cost currently recorded — the earlier rounds were never kept, so there
-- is nothing to split it into.

set search_path = pos, public, extensions;

create table if not exists stock_batches (
  id bigint generated always as identity primary key,
  stock_id bigint not null references stock(id) on delete cascade,
  -- Denormalised so RLS can scope without joining, like stock_movements.
  shop_id text not null references shops(id) on delete cascade,

  received_at date not null default current_date,
  -- Where it came from. The moment of receiving is the only time anyone knows
  -- this, and it was never captured before.
  supplier text not null default '',
  doc_no text not null default '',

  qty_received numeric(12, 2) not null,
  -- Drawn down by consumption; a lot at zero is spent but stays for its history.
  qty_remaining numeric(12, 2) not null,
  unit_cost numeric(12, 2) not null default 0,

  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null,
  created_by_name text not null default ''
);

comment on table stock_batches is
  'ล็อตสินค้า — การรับของหนึ่งรอบ พร้อมต้นทุนของรอบนั้นและจำนวนคงเหลือ';

-- FIFO reads this every time stock is consumed, oldest first.
create index if not exists stock_batches_fifo_idx
  on stock_batches (stock_id, received_at, id)
  where qty_remaining > 0;
create index if not exists stock_batches_stock_idx on stock_batches (stock_id, received_at desc);

alter table stock_batches enable row level security;
drop policy if exists stock_batches_rw on stock_batches;
create policy stock_batches_rw on stock_batches for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/**
 * ล็อตที่การเคลื่อนไหวหนึ่งครั้งไปตัดมา.
 *
 * A job that needs six rolls when the open lot has four takes from two lots at
 * two different prices. This is that split — it is what makes the cost of the
 * job a real figure rather than an average, and what lets a cancellation put
 * each roll back where it came from.
 */
create table if not exists stock_movement_batches (
  id bigint generated always as identity primary key,
  movement_id bigint not null references stock_movements(id) on delete cascade,
  batch_id bigint not null references stock_batches(id) on delete cascade,
  qty numeric(12, 2) not null,
  unit_cost numeric(12, 2) not null
);

create index if not exists stock_movement_batches_movement_idx
  on stock_movement_batches (movement_id);
create index if not exists stock_movement_batches_batch_idx on stock_movement_batches (batch_id);

alter table stock_movement_batches enable row level security;
drop policy if exists stock_movement_batches_rw on stock_movement_batches;
create policy stock_movement_batches_rw on stock_movement_batches for all
  using (movement_id in (select id from stock_movements where shop_id in (select current_user_shops())))
  with check (movement_id in (select id from stock_movements where shop_id in (select current_user_shops())));

-- The money side of a movement: what the goods that moved actually cost.
alter table stock_movements
  add column if not exists cost_total numeric(12, 2) not null default 0;

comment on column stock_movements.cost_total is
  'ต้นทุนของที่เคลื่อนไหวครั้งนี้ (บวกเมื่อรับเข้า, ลบเมื่อตัดออก) — มาจากล็อตจริง ไม่ใช่ค่าเฉลี่ย';

/**
 * ต้นทุนเฉลี่ยของที่เหลือ — เขียนกลับลง stock.cost.
 *
 * `cost` used to be typed in and overwritten; it is derived now, so it cannot
 * disagree with the lots. A product with nothing left keeps its last known cost
 * rather than dropping to zero, because zero would read as "free" on the next
 * report rather than "none in stock".
 */
create or replace function refresh_stock_cost(p_stock_id bigint)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_qty numeric;
  v_value numeric;
begin
  select coalesce(sum(qty_remaining), 0), coalesce(sum(qty_remaining * unit_cost), 0)
    into v_qty, v_value
    from stock_batches
   where stock_id = p_stock_id;

  if v_qty > 0 then
    update stock set cost = round(v_value / v_qty, 2) where id = p_stock_id;
  end if;
end;
$$;

revoke all on function refresh_stock_cost(bigint) from public, anon;
grant execute on function refresh_stock_cost(bigint) to authenticated;

/**
 * รับของเข้า — สร้างล็อตใหม่พร้อมต้นทุนของรอบนี้.
 *
 * Receiving is the one movement that CREATES cost rather than spending it, so
 * it gets its own entry point. The lot, the quantity and the ledger line are
 * written together; `stock.cost` is recomputed from the lots afterwards rather
 * than being overwritten with whatever this delivery happened to cost.
 */
create or replace function receive_stock(
  p_stock_id bigint,
  p_qty numeric,
  p_unit_cost numeric,
  p_supplier text,
  p_doc_no text,
  p_by_name text,
  p_note text default ''
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
  v_name text;
  v_shop text;
  v_batch_id bigint;
  v_movement_id bigint;
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'จำนวนที่รับเข้าต้องมากกว่า 0';
  end if;

  select qty, name, shop_id into v_before, v_name, v_shop
    from stock where id = p_stock_id for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้' using errcode = 'P0002';
  end if;

  insert into stock_batches (
    stock_id, shop_id, received_at, supplier, doc_no,
    qty_received, qty_remaining, unit_cost, note, created_by, created_by_name
  ) values (
    p_stock_id, v_shop, current_date, coalesce(p_supplier, ''), coalesce(p_doc_no, ''),
    p_qty, p_qty, coalesce(p_unit_cost, 0), coalesce(p_note, ''), auth.uid(), coalesce(p_by_name, '')
  )
  returning id into v_batch_id;

  update stock set qty = v_before + p_qty where id = p_stock_id;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    p_stock_id, v_name, v_shop, 'รับเข้า', coalesce(p_doc_no, ''),
    p_qty, v_before, v_before + p_qty, p_qty * coalesce(p_unit_cost, 0),
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_movement_id;

  insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
  values (v_movement_id, v_batch_id, p_qty, coalesce(p_unit_cost, 0));

  perform refresh_stock_cost(p_stock_id);
  return v_batch_id;
end;
$$;

revoke all on function receive_stock(bigint, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function receive_stock(bigint, numeric, numeric, text, text, text, text) to authenticated;

/**
 * เปลี่ยนจำนวนสต็อก พร้อมลงบัญชีและคิดต้นทุนจากล็อตจริง.
 *
 * Replaces the 0026 version, which moved quantities correctly but had no notion
 * of what they cost.
 *
 *   * CONSUMING draws from the oldest lot with anything left, then the next, and
 *     records the split. Six rolls out of a lot holding four costs 4×800 + 2×950,
 *     not 6× an average.
 *   * RETURNING (a cancelled job, a rejected withdrawal) puts the goods back into
 *     the lots that document took them from, newest allocation first, so the cost
 *     that came off comes back exactly. With nothing to match — stock returned
 *     against no earlier consumption — it lands in the newest open lot.
 *   * Consuming more than the lots hold is allowed and costed at whatever the
 *     lots could cover. The quantity still goes negative, which is the signal
 *     0025 deliberately kept; a shortfall in COST would otherwise be invented.
 */
create or replace function move_stock(
  p_changes jsonb,
  p_kind text,
  p_document_id text,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  r record;
  b record;
  v_before numeric;
  v_name text;
  v_shop text;
  v_movement_id bigint;
  v_left numeric;
  v_take numeric;
  v_cost numeric;
begin
  for r in
    select x.id, x.change
      from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(id bigint, change numeric)
     where x.id is not null and coalesce(x.change, 0) <> 0
  loop
    select qty, name, shop_id into v_before, v_name, v_shop
      from stock where id = r.id for update;
    continue when not found;

    update stock set qty = v_before + r.change where id = r.id;

    insert into stock_movements (
      stock_id, item_name, shop_id, kind, document_id,
      change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
    ) values (
      r.id, v_name, v_shop, p_kind, coalesce(p_document_id, ''),
      r.change, v_before, v_before + r.change, 0,
      auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
    )
    returning id into v_movement_id;

    v_cost := 0;

    if r.change < 0 then
      -- ตัดออก: ของเก่าก่อน
      v_left := -r.change;
      for b in
        select id, qty_remaining, unit_cost
          from stock_batches
         where stock_id = r.id and qty_remaining > 0
         order by received_at, id
           for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, b.qty_remaining);
        update stock_batches set qty_remaining = qty_remaining - v_take where id = b.id;
        insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
        values (v_movement_id, b.id, -v_take, b.unit_cost);
        v_cost := v_cost - v_take * b.unit_cost;
        v_left := v_left - v_take;
      end loop;
    else
      -- คืนเข้า: กลับเข้าล็อตที่เอกสารนี้เคยตัดไป ใหม่สุดก่อน
      v_left := r.change;
      for b in
        select mb.batch_id, mb.unit_cost, sum(-mb.qty) as taken
          from stock_movement_batches mb
          join stock_movements m on m.id = mb.movement_id
         where m.stock_id = r.id
           and m.document_id = coalesce(p_document_id, '')
           and mb.qty < 0
         group by mb.batch_id, mb.unit_cost
         order by mb.batch_id desc
      loop
        exit when v_left <= 0;
        v_take := least(v_left, b.taken);
        update stock_batches set qty_remaining = qty_remaining + v_take where id = b.batch_id;
        insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
        values (v_movement_id, b.batch_id, v_take, b.unit_cost);
        v_cost := v_cost + v_take * b.unit_cost;
        v_left := v_left - v_take;
      end loop;

      -- Nothing to match it against: put the remainder in the newest open lot,
      -- so the quantity and the lots stay in step.
      if v_left > 0 then
        select id, unit_cost into b from stock_batches
         where stock_id = r.id order by received_at desc, id desc limit 1 for update;
        if found then
          update stock_batches set qty_remaining = qty_remaining + v_left where id = b.id;
          insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
          values (v_movement_id, b.id, v_left, b.unit_cost);
          v_cost := v_cost + v_left * b.unit_cost;
        end if;
      end if;
    end if;

    update stock_movements set cost_total = v_cost where id = v_movement_id;
    perform refresh_stock_cost(r.id);
  end loop;
end;
$$;

revoke all on function move_stock(jsonb, text, text, text, text) from public, anon;
grant execute on function move_stock(jsonb, text, text, text, text) to authenticated;

/*
  ล็อตยกมา — whatever is on the shelf today, at the cost currently recorded.

  The earlier rounds were never kept, so this cannot be split into the deliveries
  it really came from. One lot, dated today, marked as carried forward: from here
  on every round stands on its own.
*/
insert into stock_batches (
  stock_id, shop_id, received_at, supplier, doc_no,
  qty_received, qty_remaining, unit_cost, note, created_by_name
)
select s.id, s.shop_id, current_date, '', '',
       s.qty, s.qty, coalesce(s.cost, 0), 'ยกมาก่อนเริ่มระบบล็อต', 'ระบบ'
  from stock s
 where s.qty > 0
   and not exists (select 1 from stock_batches b where b.stock_id = s.id);

/**
 * ปรับสต็อกตามผลนับจริง — ให้ล็อตเดินตามผลนับด้วย.
 *
 * The 0026 version set `qty` and wrote a ledger line, which was right when a
 * quantity was all there was. With lots it is not enough: a count that finds
 * fewer than the lots say leaves the two disagreeing, and `stock.cost` is
 * derived from the lots, so the shop's stock value would quietly stop matching
 * the shelf.
 *
 * It delegates to `move_stock` now. A shortfall is drawn down FIFO — the goods
 * are simply not there, and the oldest are the ones missing. A surplus goes into
 * the newest lot, because that is the most likely price of something found late.
 */
create or replace function count_stock(
  p_id bigint,
  p_counted numeric,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
begin
  select qty into v_before from stock where id = p_id for update;
  if not found or v_before = p_counted then
    return;
  end if;

  perform move_stock(
    jsonb_build_array(jsonb_build_object('id', p_id, 'change', p_counted - v_before)),
    'ปรับสต็อก',
    '',
    p_by_name,
    p_note
  );
end;
$$;

revoke all on function count_stock(bigint, numeric, text, text) from public, anon;
grant execute on function count_stock(bigint, numeric, text, text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0027', 'stock_batches') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0028.sql
-- ==========================================================================

-- supabase/release-0028.sql
--
-- โอนสต็อกระหว่างสาขา — ต้นทุนเดินทางไปกับของ
--
-- รันต่อจาก release-0027.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function อย่างเดียว
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0028_stock_transfer.sql
--
-- โอนสต็อกระหว่างสาขา — ต้นทุนเดินทางไปกับของ
--
-- Moving stock between branches had no operation at all. The shop did it by
-- withdrawing at one branch and adding at the other, which produced two
-- unrelated records, broke the history in half, and — since receiving asked for
-- a price — let the same goods arrive at a cost somebody typed from memory.
--
-- A transfer is ONE act with two ends. It draws FIFO from the source, and lands
-- at the destination as lots carrying THE SAME unit costs: the goods did not
-- become cheaper or dearer by being driven down the road. Both ends are written
-- to the ledger, each pointing at the other's branch, so the pair can be read
-- back as one movement.
--
-- The destination row is found by name within that branch, or created empty and
-- received into — the same rule the rest of the module uses to match a product
-- across shops (migration 0025's unique index makes it unambiguous).

set search_path = pos, public, extensions;

/**
 * โอนสินค้าจากสาขาหนึ่งไปอีกสาขา.
 *
 * Refuses to move more than the source holds. Consumption elsewhere may go
 * negative deliberately — that is a miscount worth seeing — but a transfer of
 * goods that are not there is not a signal, it is a mistake, and it would create
 * stock at the destination out of nothing.
 *
 * Returns the destination `stock.id`, which the caller needs to show where the
 * goods went.
 */
create or replace function transfer_stock(
  p_from_stock_id bigint,
  p_to_shop_id text,
  p_qty numeric,
  p_by_name text,
  p_note text default ''
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_src stock%rowtype;
  v_dest_id bigint;
  v_before_src numeric;
  v_before_dst numeric;
  v_out_movement bigint;
  v_in_movement bigint;
  v_new_batch bigint;
  v_left numeric;
  v_take numeric;
  v_cost numeric := 0;
  b record;
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'จำนวนที่โอนต้องมากกว่า 0';
  end if;

  select * into v_src from stock where id = p_from_stock_id for update;
  if not found then
    raise exception 'ไม่พบสินค้าต้นทาง' using errcode = 'P0002';
  end if;
  if v_src.shop_id = p_to_shop_id then
    raise exception 'สาขาต้นทางและปลายทางเป็นสาขาเดียวกัน';
  end if;
  if v_src.qty < p_qty then
    raise exception 'สต็อกต้นทางไม่พอ (มี %, ต้องการโอน %)', v_src.qty, p_qty;
  end if;

  -- The same product at the destination, or a new row for it. Created EMPTY:
  -- the quantity arrives through the lots below, so it is always backed by cost.
  select id into v_dest_id from stock where shop_id = p_to_shop_id and name = v_src.name;
  if v_dest_id is null then
    insert into stock (sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price)
    values (
      -- `sku` is unique across the whole system, so a per-branch suffix is the
      -- only way the same product can exist at two shops.
      v_src.sku || '-' || upper(p_to_shop_id),
      v_src.name, v_src.short_name, v_src.category,
      p_to_shop_id, 0, v_src.min_qty, 0, v_src.sell_price
    )
    returning id into v_dest_id;
  end if;

  select qty into v_before_dst from stock where id = v_dest_id for update;
  v_before_src := v_src.qty;

  update stock set qty = v_before_src - p_qty where id = p_from_stock_id;
  update stock set qty = v_before_dst + p_qty where id = v_dest_id;

  -- Each end names the OTHER branch, so one row explains where the goods went
  -- and the other where they came from.
  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    p_from_stock_id, v_src.name, v_src.shop_id, 'โอนออก', p_to_shop_id,
    -p_qty, v_before_src, v_before_src - p_qty, 0,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_out_movement;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    v_dest_id, v_src.name, p_to_shop_id, 'โอนเข้า', v_src.shop_id,
    p_qty, v_before_dst, v_before_dst + p_qty, 0,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_in_movement;

  -- FIFO out of the source, mirrored into the destination lot by lot. The unit
  -- cost is carried across unchanged: goods do not change price by moving.
  v_left := p_qty;
  for b in
    select id, qty_remaining, unit_cost, supplier, doc_no
      from stock_batches
     where stock_id = p_from_stock_id and qty_remaining > 0
     order by received_at, id
       for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, b.qty_remaining);

    update stock_batches set qty_remaining = qty_remaining - v_take where id = b.id;
    insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
    values (v_out_movement, b.id, -v_take, b.unit_cost);

    insert into stock_batches (
      stock_id, shop_id, received_at, supplier, doc_no,
      qty_received, qty_remaining, unit_cost, note, created_by, created_by_name
    ) values (
      v_dest_id, p_to_shop_id, current_date, b.supplier, b.doc_no,
      v_take, v_take, b.unit_cost, 'โอนจากสาขา ' || v_src.shop_id,
      auth.uid(), coalesce(p_by_name, '')
    )
    returning id into v_new_batch;

    insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
    values (v_in_movement, v_new_batch, v_take, b.unit_cost);

    v_cost := v_cost + v_take * b.unit_cost;
    v_left := v_left - v_take;
  end loop;

  update stock_movements set cost_total = -v_cost where id = v_out_movement;
  update stock_movements set cost_total = v_cost where id = v_in_movement;

  perform refresh_stock_cost(p_from_stock_id);
  perform refresh_stock_cost(v_dest_id);

  return v_dest_id;
end;
$$;

revoke all on function transfer_stock(bigint, text, numeric, text, text) from public, anon;
grant execute on function transfer_stock(bigint, text, numeric, text, text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0028', 'stock_transfer') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0029.sql
-- ==========================================================================

-- supabase/release-0029.sql
--
-- ราคาฟิล์ม/กันรอย แยกตามสาขาได้
--
-- รันต่อจาก release-0028.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0029_film_price_per_shop.sql
--
-- ราคาฟิล์ม/กันรอย แยกตามสาขาได้ — สาขาเดียวกันสินค้าเดียวกันขายคนละราคาได้
--
-- The shop sells the same product at different prices at different branches.
-- `stock.sell_price` already allowed that, because a stock row belongs to one
-- shop. `film_price_matrix` did not: it had no shop column at all, so ONE price
-- per (ชนิดสินค้า × สินค้า × ตำแหน่งติดตั้ง × ประเภทรถ) was shared by all five
-- branches — and an admin setting Lampang's price silently changed Chiang Mai's,
-- with nothing on screen to say it had happened.
--
-- `shop_id` is nullable and means what it means everywhere else in this schema
-- (`commission_rules`, `insurance_plans`): NULL is the ราคากลาง every branch
-- falls back to, and a row with a shop overrides it for that branch only.
-- Existing rows stay NULL, so nothing changes for a shop that has not set a
-- branch price — which is every shop today.

set search_path = pos, public, extensions;

alter table film_price_matrix
  add column if not exists shop_id text references shops(id) on delete cascade;

comment on column film_price_matrix.shop_id is
  'NULL = ราคากลางใช้ทุกสาขา; ระบุสาขา = ราคาเฉพาะสาขานั้น ทับราคากลาง';

/*
  The old constraint has to go first.

  `unique (category, product, position, car_type)` from migration 0003 knows
  nothing about shops, so with it in place a branch price and the ราคากลาง for
  the same combination could not both exist — the second insert failed. The two
  partial indexes below say the same thing correctly, once per scope.
*/
alter table film_price_matrix
  drop constraint if exists film_price_matrix_category_product_position_car_type_key;

/*
  One price per combination per scope.

  Two indexes rather than one, because NULL is not equal to itself in a unique
  index: without the first, a branch could accumulate any number of duplicate
  ราคากลาง rows and the lookup would pick between them arbitrarily.
*/
create unique index if not exists film_price_matrix_global_key
  on film_price_matrix (category, product, "position", car_type)
  where shop_id is null;

create unique index if not exists film_price_matrix_shop_key
  on film_price_matrix (shop_id, category, product, "position", car_type)
  where shop_id is not null;

insert into supabase_migrations.schema_migrations(version, name) values ('0029', 'film_price_per_shop') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0031.sql
-- ==========================================================================

-- supabase/release-0031.sql
--
-- ใบงานนี้เป็น "รายได้" หรือ "รับแทน"
--
-- รันต่อจาก release-0030.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
-- ใบงานเดิมทั้งหมดเป็น "รายได้" ตามค่าตั้งต้น ตัวเลขเดิมไม่เปลี่ยน
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0031_ticket_revenue_kind.sql
--
-- ใบงานนี้เป็น "รายได้" หรือ "รับแทน"
--
-- Some jobs are taken at one branch but belong to another Finnix shop: the
-- customer pays here, and the money is held until it goes back. It is not this
-- shop's takings, and counting it as such overstates every sales figure on the
-- system — the dashboard, โมดูลรายได้, and anything read off them.
--
-- One column on the ticket, because that is the grain the shop works at: a whole
-- job is either ours or held for Finnix, never half of each. `รายได้` is the
-- default, so every ticket already recorded keeps counting exactly as it does
-- today and nothing has to be back-filled.
--
-- The money itself is NOT hidden: `ticket_payments` still records what was
-- collected, so the cash in the drawer still reconciles. Only which pile the
-- total lands in changes.

set search_path = pos, public, extensions;

alter table tickets
  add column if not exists revenue_kind text not null default 'รายได้';

do $$
begin
  alter table tickets
    add constraint tickets_revenue_kind_check
    check (revenue_kind in ('รายได้', 'รับแทน'));
exception
  when duplicate_object then null;
end $$;

comment on column tickets.revenue_kind is
  'รายได้ = ยอดขายของสาขานี้; รับแทน = เงินรอคืน Finnix ไม่นับเป็นยอดขาย';

-- The report reads only the held ones, and they are the small minority.
create index if not exists tickets_held_idx
  on tickets (shop_id, drop_off_date desc)
  where revenue_kind = 'รับแทน' and deleted_at is null;

insert into supabase_migrations.schema_migrations(version, name) values ('0031', 'ticket_revenue_kind') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0032.sql
-- ==========================================================================

-- supabase/release-0032.sql
--
-- ค่าใช้จ่ายนี้เป็นของสาขา หรือ "จ่ายแทน" Finnix
--
-- รันต่อจาก release-0031.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
-- รายการเดิมทั้งหมดเป็น "ค่าใช้จ่าย" ตามค่าตั้งต้น ตัวเลขเดิมไม่เปลี่ยน
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0032_expense_paid_for_finnix.sql
--
-- ค่าใช้จ่ายนี้เป็นของสาขา หรือ "จ่ายแทน" Finnix
--
-- The mirror of migration 0031 on the money going out: the branch pays a bill
-- that belongs to another Finnix shop and waits to be reimbursed. The cash did
-- leave the drawer, so the row belongs in ค่าใช้จ่าย and in the petty-cash
-- balance — but it is not this branch's cost, and counting it as one understates
-- every profit figure the shop reads.
--
-- One column, same as the ticket, and for the same reason: the shop decides this
-- per document, not per line. `ค่าใช้จ่าย` is the default, so every row already
-- recorded keeps counting exactly as it does today.
--
-- Reimbursement is NOT tracked here. The shop settles with Finnix on the total
-- for a period, which the report answers; a per-row settlement ledger is the
-- larger design that was deliberately set aside.

set search_path = pos, public, extensions;

alter table expenses
  add column if not exists expense_kind text not null default 'ค่าใช้จ่าย';

do $$
begin
  alter table expenses
    add constraint expenses_expense_kind_check
    check (expense_kind in ('ค่าใช้จ่าย', 'จ่ายแทน'));
exception
  when duplicate_object then null;
end $$;

comment on column expenses.expense_kind is
  'ค่าใช้จ่าย = ต้นทุนของสาขานี้; จ่ายแทน = เงินรอรับคืนจาก Finnix ไม่นับเป็นค่าใช้จ่าย';

-- The report reads only the ones paid on behalf of Finnix, a small minority.
create index if not exists expenses_paid_for_finnix_idx
  on expenses (shop_id, paid_at desc)
  where expense_kind = 'จ่ายแทน';

insert into supabase_migrations.schema_migrations(version, name) values ('0032', 'expense_paid_for_finnix') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0033.sql
-- ==========================================================================

-- supabase/release-0033.sql
--
-- จัดการสิทธิ์ ครอบคลุมทุกโมดูลและทุกการ์ด
--
-- รันต่อจาก release-0032.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0033_permission_coverage.sql
--
-- จัดการสิทธิ์ ต้องครอบคลุมทุกโมดูลและทุกการ์ด
--
-- Two gaps, both of the same kind: something was added to the app and the one
-- screen that governs access never heard about it.
--
--   * `insuranceExpiry` — การ์ดประกันใกล้หมดอายุ was added with the insurance
--     work (migration 0023) and rendered for everybody, with no way to turn it
--     off for a role that has no business reading customer policies. It is gated
--     now, so the rows have to exist or the card would vanish for every role at
--     once. Seeded TRUE for everyone: this changes who CAN hide it, not what
--     anybody sees today.
--
--   * `stock.approveWithdraw` already had its rows (migration 0026) but was
--     missing from the admin screen's own list, so it could not be granted. That
--     half is a code fix; nothing to do here beyond making sure a reset keeps it.
--
-- `reset_permissions_to_defaults()` is rebuilt with both keys in it, because a
-- reset that drops a key silently un-governs it again.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'dashboard_widget', 'insuranceExpiry', true
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',false), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),('list.unlock'),
      ('customers.edit'),('options.manage'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',false), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',false),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0033', 'permission_coverage') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0034.sql
-- ==========================================================================

-- supabase/release-0034.sql
--
-- เพิ่ม/แก้ไขชื่อสาขาได้จากหน้าจัดการสิทธิ์
--
-- รันต่อจาก release-0033.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function อย่างเดียว ไม่แก้ข้อมูล
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0034_manage_shops.sql
--
-- เพิ่ม/แก้ไขชื่อสาขา ได้จากหน้าจัดการสิทธิ์
--
-- The five branches were seeded by migration 0001 and there has been no way to
-- add a sixth since. Opening a new shop — one that only does ขายส่ง, say — meant
-- asking a developer to write SQL, which is not a thing a shop should have to do
-- to open a shop.
--
-- `shops` carries a select-only policy (migration 0007), so this is a
-- `security definer` function rather than an insert policy: the admin check then
-- lives in the database and holds for any caller, not only for the screen that
-- has the button.
--
-- No delete. `shops.id` is referenced by tickets, orders, stock, expenses, petty
-- cash, commission rules and more; removing a branch would either fail on those
-- constraints or, worse, take its history with it. A branch that closes is a
-- branch nobody is given access to.

set search_path = pos, public, extensions;

create or replace function save_shop(p_id text, p_name text, p_sort integer default null)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_id   text := lower(trim(coalesce(p_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_sort integer;
begin
  -- coalesce, not a bare comparison: `current_user_role()` is NULL for a token
  -- with no `app_users` row, and `NULL <> 'admin'` is NULL — which is not TRUE,
  -- so the guard would have let exactly that caller through.
  if coalesce(current_user_role(), '') <> 'admin' then
    raise exception 'forbidden: เฉพาะแอดมินเท่านั้นที่เพิ่ม/แก้ไขสาขาได้';
  end if;

  -- The id goes into every document number and every export filename, so it is
  -- kept short, lowercase and free of anything that needs escaping.
  if v_id !~ '^[a-z0-9]{2,10}$' then
    raise exception 'รหัสสาขาต้องเป็น a-z หรือ 0-9 ความยาว 2-10 ตัว (เช่น north)';
  end if;
  if v_name = '' then
    raise exception 'ต้องระบุชื่อสาขา';
  end if;

  -- Appended to the end unless told otherwise; renaming must not silently
  -- reorder the sidebar.
  v_sort := coalesce(
    p_sort,
    (select sort_order from shops where id = v_id),
    (select coalesce(max(sort_order), 0) + 1 from shops)
  );

  insert into shops (id, name, sort_order)
  values (v_id, v_name, v_sort)
  on conflict (id) do update
    set name = excluded.name,
        sort_order = excluded.sort_order;

  return v_id;
end;
$$;

revoke all on function save_shop(text, text, integer) from public, anon;
grant execute on function save_shop(text, text, integer) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0034', 'manage_shops') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0035.sql
-- ==========================================================================

-- supabase/release-0035.sql
--
-- สาขาที่จดทะเบียนภาษีมูลค่าเพิ่ม ออกใบกำกับภาษีได้เท่านั้น
--
-- รันต่อจาก release-0034.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists และไม่ทับค่าที่แก้ไว้บนหน้าจอ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0035_vat_registered_shop.sql
--
-- สาขาที่จดทะเบียนภาษีมูลค่าเพิ่ม ออกใบกำกับภาษีได้เท่านั้น
--
-- Only FINNIX FILM เชียงใหม่ is registered for VAT, so only เชียงใหม่ may issue a
-- ใบกำกับภาษี/ใบเสร็จรับเงิน. Any other branch issuing one would be handing a
-- customer a tax document against a registration it does not hold — the kind of
-- mistake that is found by an auditor, months later, on paper already in
-- somebody else's hands.
--
-- A column rather than a branch id written into the code: registrations change,
-- and a shop that registers next year should become able to issue tax invoices
-- by ticking a box in จัดการสิทธิ์, not by waiting for a developer. It sits on
-- `shop_info`, beside the company name and tax id that print on those documents.

set search_path = pos, public, extensions;

alter table shop_info
  add column if not exists vat_registered boolean not null default false;

comment on column shop_info.vat_registered is
  'สาขานี้จดทะเบียนภาษีมูลค่าเพิ่ม จึงออกใบกำกับภาษีได้ (migration 0035)';

-- The one branch that is registered today. Guarded so a re-run cannot undo a
-- change the shop has since made on the screen.
insert into shop_info (shop_id, vat_registered)
select 'cm', true
-- ครั้งเดียวเท่านั้น: if the shop has since switched VAT off for this branch, a
-- re-run must not quietly switch it back on and start printing tax invoices.
where not exists (select 1 from supabase_migrations.schema_migrations where version = '0035')
on conflict (shop_id) do update
  set vat_registered = true
  where shop_info.vat_registered is distinct from true;

insert into supabase_migrations.schema_migrations(version, name) values ('0035', 'vat_registered_shop') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0036.sql
-- ==========================================================================

-- supabase/release-0036.sql
--
-- เลขที่ PO ออกโดยฐานข้อมูล — เลิกเลขสุ่มที่ซ้ำกันได้
--
-- รันต่อจาก release-0035.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace + แก้เลขย้อนหลังเฉพาะใบที่เป็น WS-NEW-%
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0036_order_doc_no.sql
--
-- เลขที่ PO ออกโดยฐานข้อมูล — WS-CM-0092
--
-- A PO created through the app was numbered `'WS-NEW-' + random(1000..9999)` in
-- the browser, and that number became its primary key for ever. Three things
-- are wrong with it, in increasing order of seriousness:
--
--   * it carries no branch and no order, so the numbers say nothing;
--   * it is not sequential, so a missing PO cannot be noticed; and
--   * it COLLIDES. Nine thousand numbers sounds like plenty, but the chance two
--     POs share one passes 50% at about 112 POs — and the save is an upsert, so
--     a collision silently overwrites the earlier PO's header and replaces all
--     of its items, returns, payments and adjustments.
--
-- The seeded POs (WS-CM-0088 and friends) already carry the right shape, which
-- is exactly why this went unnoticed: the demo data looks correct and only real
-- use produces WS-NEW-4823.
--
-- Numbered the way expenses are (migration 0019): in the database, under an
-- advisory lock, by a BEFORE INSERT trigger. Two people raising a PO for the
-- same branch at the same moment cannot both be handed 0092, and the number
-- never changes once issued because a customer is holding a document with it.

set search_path = pos, public, extensions;

/**
 * The next unused PO number for a branch.
 *
 * `security definer` so the scan covers every PO, not only the ones the caller
 * may read — a Lampang number must not be reissued because the person raising
 * it cannot see Lampang's other orders.
 */
create or replace function next_order_id(p_shop text)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text := 'WS-' || upper(p_shop) || '-';
  v_seq    integer;
begin
  -- Everything after the prefix is the sequence, and only rows whose tail is
  -- entirely digits count: the old random ids (WS-NEW-4823) live under a
  -- different prefix, but a hand-typed one must not break the max either.
  select coalesce(max(substr(id, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from orders
   where id like v_prefix || '%'
     and substr(id, length(v_prefix) + 1) ~ '^[0-9]+$';

  -- lpad, not a fixed format: a branch that passes 9999 POs gets 10000 rather
  -- than a row of hashes.
  return v_prefix || lpad(v_seq::text, 4, '0');
end;
$$;

revoke all on function next_order_id(text) from public, anon;
grant execute on function next_order_id(text) to authenticated;

create or replace function assign_order_id()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  -- A real number already on the row wins: this is how a data migration, or a
  -- future import, keeps the numbers it came with.
  if new.id is not null and new.id not like 'WS-NEW-%' and btrim(new.id) <> '' then
    return new;
  end if;

  -- Serialise numbering for this branch. Transaction-scoped, so it is released
  -- when the insert commits and can never leak.
  perform pg_advisory_xact_lock(hashtext('order_id:' || new.shop_id));

  new.id := next_order_id(new.shop_id);
  return new;
end;
$$;

drop trigger if exists orders_assign_id on orders;
create trigger orders_assign_id
  before insert on orders
  for each row
  execute function assign_order_id();

/*
  Repair what the random numbering already produced.

  Renumbered oldest-first per branch so the running order matches the order the
  POs were actually raised. The children follow by `on update cascade`… which
  the original foreign keys do not have, so they are replaced first. Nothing
  happens at all on a database that has no WS-NEW-% rows, which is the expected
  case for a shop that has not raised a PO through the app yet.
*/
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from orders where id like 'WS-NEW-%';
  if v_bad = 0 then
    raise notice 'ไม่มี PO ที่ใช้เลขสุ่ม ไม่ต้องแก้เลขย้อนหลัง';
    return;
  end if;

  alter table order_items drop constraint order_items_order_id_fkey;
  alter table order_items add constraint order_items_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_returns drop constraint order_returns_order_id_fkey;
  alter table order_returns add constraint order_returns_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_adjustments drop constraint order_adjustments_order_id_fkey;
  alter table order_adjustments add constraint order_adjustments_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_payments drop constraint order_payments_order_id_fkey;
  alter table order_payments add constraint order_payments_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;

  with renumbered as (
    select o.id as old_id,
           'WS-' || upper(o.shop_id) || '-' || lpad(
             (
               coalesce((
                 select max(substr(x.id, length('WS-' || upper(o.shop_id) || '-') + 1)::int)
                   from orders x
                  where x.id like 'WS-' || upper(o.shop_id) || '-%'
                    and substr(x.id, length('WS-' || upper(o.shop_id) || '-') + 1) ~ '^[0-9]+$'
               ), 0)
               + row_number() over (partition by o.shop_id order by o.created_at, o.id)
             )::text, 4, '0') as new_id
      from orders o
     where o.id like 'WS-NEW-%'
  )
  update orders o
     set id = r.new_id
    from renumbered r
   where o.id = r.old_id;

  raise notice 'แก้เลข PO ที่เป็นเลขสุ่มแล้ว % ใบ', v_bad;
end $$;

insert into supabase_migrations.schema_migrations(version, name) values ('0036', 'order_doc_no') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0037.sql
-- ==========================================================================

-- supabase/release-0037.sql
--
-- เปลี่ยนสถานะ PO ต้องมีสิทธิ์
--
-- รันต่อจาก release-0036.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0037_wholesale_status_capability.sql
--
-- เปลี่ยนสถานะ PO ต้องมีสิทธิ์
--
-- Moving a PO to ปิดงานแล้ว closes it, and moving it back reopens one that was
-- closed. Those are decisions of the same weight as approving a discount or
-- writing off a debt — both of which have always been gated — and leaving the
-- status dropdown open meant the other two could simply be walked around.
--
-- Seeded TRUE for every role that could already do it, which is every role: this
-- changes who CAN be stopped, not what anybody may do today. An admin can now
-- take it away from a role that should not have it.
--
-- `reset_permissions_to_defaults()` is rebuilt to carry the key, because a reset
-- that drops it would quietly un-gate the button again.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.updateStatus', true
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',false), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),('list.unlock'),
      ('customers.edit'),('options.manage'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',false), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',false),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0037', 'wholesale_status_capability') on conflict (version) do nothing;


-- ==========================================================================
-- 0038 และ 0039 — บันทึกว่ารันแล้ว โดยไม่รันเนื้อใน
-- ==========================================================================
--
-- ทั้งสองไฟล์มีแค่ `create or replace function reset_permissions_to_defaults()`
-- ซึ่ง 0040, 0042, 0044 และ 0048 ในไฟล์นี้สร้างทับด้วยเวอร์ชันที่ใหม่กว่าอยู่แล้ว
-- รันเนื้อในซ้ำจึงไม่ได้อะไร แต่ถ้าไม่บันทึกไว้ `supabase db push` ครั้งต่อไป
-- จะเห็นว่ายังไม่เคยรัน แล้วรันให้ — เอาฟังก์ชันรีเซ็ตสิทธิ์เวอร์ชันเก่าไปทับ
-- เวอร์ชันปัจจุบันเงียบ ๆ
insert into supabase_migrations.schema_migrations(version, name) values ('0038', 'reset_matches_the_grants') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version, name) values ('0039', 'reset_keeps_custom_roles') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0040.sql
-- ==========================================================================

-- supabase/release-0040.sql
--
-- ลบ PO ขายส่งได้ — แบบย้ายเข้าถังขยะ
--
-- รันต่อจาก release-0037.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- ลบ PO ขายส่งได้ — แบบย้ายเข้าถังขยะ
--
-- A PO raised by mistake could not be removed at all. There was no delete of any
-- kind in the wholesale module, so the branch's very first PO — WS-NORTH-0001 —
-- sits in the list forever, and the only way past it was to leave a 0-baht order
-- in ทั้งหมด and in every figure derived from it.
--
-- A SOFT delete, for the same reasons ใบงาน got one in 0013:
--   * `on delete cascade` on the four child tables would take the items, the
--     returns, the price-approval reasons and the RECORDED PAYMENTS with it, and
--     nothing could bring them back;
--   * the PO number is issued by the database (0036) and must stay issued. A
--     deleted WS-CM-0001 is not handed out again, so restoring it cannot collide
--     with a PO raised in the meantime.
--
-- Stock IS rewound by the delete action, unlike 0013's original position: a
-- wholesale PO deducts goods on save, and a PO that should not exist did not
-- take goods off the shelf. Restoring deducts them again.

set search_path = pos, public, extensions;

alter table orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references app_users(id);

-- Every list query filters on this and the bin is the rare case, so index the
-- live rows rather than the whole column — the same shape as tickets_live_idx.
create index if not exists orders_live_idx on orders (shop_id) where deleted_at is null;

comment on column orders.deleted_at is
  'Soft-delete flag. NULL = live. Set by ลบ PO (capability wholesale.delete), cleared by กู้คืน (capability wholesale.restore).';

-- The capability check lives in the database, not only in the server action.
-- `orders_rw` lets anyone with the branch update the row, so without this a
-- caller lacking wholesale.delete could still flip the flag through PostgREST.
create or replace function enforce_order_delete_capability()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null and not current_user_can('wholesale.delete') then
      raise exception 'ไม่มีสิทธิ์ลบ PO' using errcode = '42501';
    end if;
    if new.deleted_at is null and not current_user_can('wholesale.restore') then
      raise exception 'ไม่มีสิทธิ์กู้คืน PO' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_delete_capability on orders;
create trigger orders_delete_capability
  before update of deleted_at on orders
  for each row execute function enforce_order_delete_capability();

-- Seeded to match ใบงาน exactly: whoever may delete a job may delete a PO, and
-- putting one back is an admin/ผู้บริหาร decision. Nothing is granted to a role
-- that could not already remove a record of the same weight.
insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.delete', r.id in ('admin', 'exec', 'sales')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.restore', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

-- `reset_permissions_to_defaults()` is rebuilt to carry both new keys. A reset
-- that dropped them would leave the delete button ungoverned — the same failure
-- the coverage guard in tests/unit/components/permissions exists to catch.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0040', 'order_soft_delete') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0041.sql
-- ==========================================================================

-- supabase/release-0041.sql
--
-- ใบเคลมประกัน ต้องมีวันรับรถ/ส่งมอบรถ พร้อมเวลา เป็นของตัวเอง
--
-- รันต่อจาก release-0040.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- ใบเคลมประกัน ต้องมีวันรับรถ/ส่งมอบรถ พร้อมเวลา เป็นของตัวเอง
--
-- The ใบเคลมประกัน printed the ORIGINAL job's dates in its วันรับรถ / วันส่งมอบรถ
-- row, because a claim had nowhere else to get them from: `insurance_claims`
-- carried `claimed_at` and nothing more. So a claim handled today printed the
-- day the film was fitted last year, which is the one date on the sheet nobody
-- needed there — the customer brought the car in on a real day, at a real time,
-- and that is what the shop is being asked to evidence.
--
-- Four columns, matching `service_visits` exactly (0022): a date and a free-text
-- time, not a timestamptz. The shop writes "16:00" on a paper form and does not
-- always know a delivery time when the car is dropped off, so a half-filled
-- timestamp would be a lie the type system cannot express. `service_visits`
-- already made this choice and the two forms print the same row.
--
-- Existing claims get no dates rather than a guess: the original job's dates are
-- still printed beside them, now labelled as the install, so nothing is lost and
-- nothing is invented.

set search_path = pos, public, extensions;

alter table insurance_claims
  add column if not exists received_at date,
  add column if not exists received_time text not null default '',
  add column if not exists delivered_at date,
  add column if not exists delivered_time text not null default '';

comment on column insurance_claims.received_at is
  'วันที่รับรถเข้าเคลม — the day the customer actually brought the car in, not the day the film was fitted.';

-- The dashboard windows appointments on this, so the lookup is by date.
create index if not exists insurance_claims_received_idx on insurance_claims (received_at)
  where received_at is not null;

/*
  `save_insurance_policy` replaces the whole claim list on every save, so the
  four new fields have to be carried through it or they would be dropped the
  next time anybody touched the policy.

  Everything else about the function is unchanged — reproduced in full because
  `create or replace` has no way to patch one statement.
*/
create or replace function save_insurance_policy(
  p_id bigint,
  p_ticket_id text,
  p_policy jsonb,
  p_claims jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
begin
  if p_id is null then
    insert into insurance_policies (
      ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
      sold_at, starts_at, ends_at, notes, created_by
    ) values (
      p_ticket_id,
      coalesce(p_policy->>'plate', ''),
      coalesce(p_policy->>'planName', ''),
      coalesce((p_policy->>'price')::numeric, 0),
      coalesce((p_policy->>'bigPieces')::int, 0),
      coalesce((p_policy->>'smallPieces')::int, 0),
      coalesce(p_policy->>'terms', ''),
      coalesce((p_policy->>'soldAt')::date, current_date),
      (p_policy->>'startsAt')::date,
      (p_policy->>'endsAt')::date,
      coalesce(p_policy->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update insurance_policies set
      plate        = coalesce(p_policy->>'plate', ''),
      plan_name    = coalesce(p_policy->>'planName', ''),
      price        = coalesce((p_policy->>'price')::numeric, 0),
      big_pieces   = coalesce((p_policy->>'bigPieces')::int, 0),
      small_pieces = coalesce((p_policy->>'smallPieces')::int, 0),
      terms        = coalesce(p_policy->>'terms', ''),
      sold_at      = coalesce((p_policy->>'soldAt')::date, current_date),
      starts_at    = (p_policy->>'startsAt')::date,
      ends_at      = (p_policy->>'endsAt')::date,
      notes        = coalesce(p_policy->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  delete from insurance_claims where policy_id = v_id;
  insert into insurance_claims (
    policy_id, claimed_at, big_used, small_used, detail, technician,
    received_at, received_time, delivered_at, delivered_time, created_by
  )
  select
    v_id,
    coalesce((c->>'claimedAt')::date, current_date),
    coalesce((c->>'bigUsed')::int, 0),
    coalesce((c->>'smallUsed')::int, 0),
    coalesce(c->>'detail', ''),
    coalesce(c->>'technician', ''),
    -- nullif so an empty string from a blank date input stays NULL rather than
    -- failing the cast.
    nullif(c->>'receivedAt', '')::date,
    coalesce(c->>'receivedTime', ''),
    nullif(c->>'deliveredAt', '')::date,
    coalesce(c->>'deliveredTime', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) as c
  -- A claim that used nothing and says nothing is an empty row on the form.
  -- Dates count as saying something now: a claim booked in for next Tuesday has
  -- no detail written yet and must still be stored, or the appointment vanishes
  -- the moment the form is saved.
  where coalesce((c->>'bigUsed')::int, 0) > 0
     or coalesce((c->>'smallUsed')::int, 0) > 0
     or coalesce(c->>'detail', '') <> ''
     or nullif(c->>'receivedAt', '') is not null
     or nullif(c->>'deliveredAt', '') is not null;

  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0041', 'claim_visit_dates') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0042.sql
-- ==========================================================================

-- supabase/release-0042.sql
--
-- การ์ดเปรียบเทียบรายสาขา บนแดชบอร์ด
--
-- รันต่อจาก release-0041.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- การ์ดเปรียบเทียบรายสาขา บนแดชบอร์ด
--
-- The dashboard could answer "how is THIS branch doing" or "how is the business
-- doing" and nothing in between: comparing five branches meant choosing each one
-- from the filter in turn and copying the figures onto paper. Management asked
-- for the third view — every branch beside every other one — and this is the
-- permission key that governs it.
--
-- Seeded to match `seeAllShops`, the existing key for "may look at branches
-- other than your own": a card that ranks the branches against each other is
-- exactly that permission's subject, so anyone who could already see all shops
-- gets it, and nobody else does. An admin can take it away per role afterwards.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select
  r.id,
  'dashboard_widget',
  'branchCompare',
  coalesce(
    (
      select rp.allowed
      from role_permissions rp
      where rp.role_id = r.id
        and rp.permission_type = 'dashboard_widget'
        and rp.permission_key = 'seeAllShops'
    ),
    false
  )
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

-- `reset_permissions_to_defaults()` is rebuilt to carry the new key, because a
-- reset that dropped it would leave the card ungoverned — the failure the
-- coverage guard in tests/unit/components/permissions exists to catch.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','branchCompare',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','branchCompare',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','branchCompare',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','branchCompare',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0042', 'branch_compare_widget') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0043.sql
-- ==========================================================================

-- supabase/release-0043.sql
--
-- ทะเบียนแหล่งเงิน: ยอดตั้งต้น และการโอน/ฝากเงินระหว่างแหล่งเงิน
--
-- รันต่อจาก release-0042.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists / on conflict do nothing /
-- การคัดลอกเงินสดย่อยมี not exists กันซ้ำ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- ทะเบียนแหล่งเงิน: ยอดตั้งต้น และการโอน/ฝากเงินระหว่างแหล่งเงิน
--
-- The dashboard could not say how much money the shop has. It knew what came in
-- against a payment method and what went out against an expense source, both
-- only since the day the system was switched on — so any figure it printed was
-- movement, not a balance. A bank account held money before that day, and the
-- cash the counter takes is banked or moved into เงินสดย่อย without either leg
-- being recorded anywhere.
--
-- Two things fix that, and both are here:
--
--   * `money_accounts` — every place the branch keeps money, with the balance it
--     started from and the date that balance was true. That is the missing
--     opening figure, and it is EDITABLE: a shop that mistypes it, or that
--     reconciles against a statement later, must be able to correct it without
--     inventing a fake transaction.
--
--   * `money_transfers` — moving money between two of those places. Banking the
--     day's cash and topping up เงินสดย่อย are the same operation with different
--     ends, and neither is income or expense: the business is no richer, the
--     money is somewhere else. Recording them as transfers is what stops the
--     same 5,000 baht being counted twice.
--
-- MATCHING EXISTING HISTORY. `ticket_payments.method` and `expenses.source` are
-- free text from option lists ('โอน TTB', 'บัญชีธนาคารสาขา'). Rather than
-- rewrite three tables of live history, an account carries `match_names`: the
-- labels that mean it. Existing rows attach to their account the moment the
-- account names them, and nothing about how the shop records a payment today has
-- to change.

set search_path = pos, public, extensions;

create table if not exists money_accounts (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  -- What the shop calls it: 'Kbank', 'เงินสดหน้าร้าน', 'เงินสดย่อย'.
  name text not null,
  -- 'bank' | 'cash' | 'petty' | 'credit'. Drives the icon and the ordering, not
  -- the arithmetic — every kind is a place money sits.
  kind text not null default 'bank',
  account_no text not null default '',
  opening_balance numeric(12, 2) not null default 0,
  -- The date the opening balance was true. Movements before it belong to
  -- whatever the shop was doing previously and are NOT added on top.
  opened_at date not null default current_date,
  /*
    The labels in `ticket_payments.method` / `order_payments.method` /
    `expenses.source` that mean this account. Empty is fine: a brand-new bank
    account has no history to claim.
  */
  match_names text[] not null default '{}',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

comment on column money_accounts.opening_balance is
  'ยอดตั้งต้น ณ วันที่ opened_at. Editable — correcting it is reconciliation, not a transaction.';
comment on column money_accounts.match_names is
  'ป้ายกำกับใน ticket_payments.method / expenses.source ที่หมายถึงบัญชีนี้.';

create index if not exists money_accounts_shop_idx on money_accounts (shop_id, sort_order)
  where active;

create table if not exists money_transfers (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  /*
    Either end may be null, and that is deliberate rather than sloppy:
      * from null = money arriving from outside the register (the owner putting
        capital in, an opening float nobody had recorded);
      * to null = money leaving it and not becoming an expense — repaying a
        director who fronted cash, or the owner drawing money out. Neither is
        a cost to the business, so forcing it through ค่าใช้จ่าย would inflate
        the expense figure and understate the profit by the same amount.
    Forcing both ends would make the shop invent an account to satisfy the
    schema, and an invented account is worse than an honest blank.
  */
  from_account_id bigint references money_accounts(id) on delete set null,
  to_account_id bigint references money_accounts(id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  moved_at date not null default current_date,
  note text not null default '',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A transfer that goes nowhere is a typo, not a record.
  constraint money_transfers_has_an_end check (
    from_account_id is not null or to_account_id is not null
  ),
  constraint money_transfers_not_circular check (
    from_account_id is null
    or to_account_id is null
    or from_account_id <> to_account_id
  )
);

create index if not exists money_transfers_shop_idx on money_transfers (shop_id, moved_at desc);
create index if not exists money_transfers_from_idx on money_transfers (from_account_id) where from_account_id is not null;
create index if not exists money_transfers_to_idx on money_transfers (to_account_id) where to_account_id is not null;

alter table money_accounts enable row level security;
alter table money_transfers enable row level security;

-- Same shape as every other shop-scoped table: you see and touch your branches.
drop policy if exists money_accounts_rw on money_accounts;
create policy money_accounts_rw on money_accounts for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

drop policy if exists money_transfers_rw on money_transfers;
create policy money_transfers_rw on money_transfers for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/*
  Seed one account per existing source, per branch, so the register is not empty
  on day one and every historical payment already attaches to something.

  Opening balance 0 and `opened_at` = today: the shop types the real figures in
  once, and until it does the card shows what the system genuinely knows rather
  than a number somebody might believe.
*/
insert into money_accounts (shop_id, name, kind, match_names, sort_order)
select s.id, a.name, a.kind, a.match_names, a.sort_order
from shops s
cross join (values
  ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                            1),
  ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
  ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                        3),
  ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],        4)
) as a(name, kind, match_names, sort_order)
-- เฉพาะสาขาที่ยังไม่มีแหล่งเงินเลย. The conflict key is the NAME, so once a
-- branch renames an account (บัญชีธนาคารสาขา → K-bank คูลมาน) a re-run no
-- longer recognises it and adds the default back — carrying labels like
-- โอนเงิน that could then pull money onto the wrong row of the register.
where not exists (select 1 from money_accounts x where x.shop_id = s.id)
on conflict (shop_id, name) do nothing;

/*
  เงินสดย่อย top-ups become transfers INTO the petty account.

  `petty_cash` stays exactly as it is — บัญชี/ค่าใช้จ่าย reads and writes it, and
  its ledger is a screen the shop uses. This copies each top-up across so the
  balance arithmetic has one place to look, with `from` left null because the
  original rows never recorded where the money came from.
*/
insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note)
select
  p.shop_id,
  null,
  (select a.id from money_accounts a where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย'),
  p.amount,
  p.entry_at::date,
  case when coalesce(p.note, '') = '' then 'เติมเงินสดย่อย' else p.note end
from petty_cash p
where p.type = 'เติมเงิน'
  -- ข้ามแถวที่ยอดเป็นศูนย์ (หรือติดลบ).
  --
  -- money_transfers บังคับ amount > 0 ด้วยเหตุผลที่เขียนไว้ข้างบน — รายการที่ไม่ได้
  -- ย้ายเงินคือพิมพ์ผิด ไม่ใช่บันทึก แต่ petty_cash ของจริงมีแถว "เติมเงิน" ยอด 0.00
  -- อยู่ (เจอตอนรันขึ้นระบบจริง 2026-09-11 ที่สาขา cm) การคัดลอกมาทั้งดุ้นจึงทำให้
  -- ทั้งไฟล์ล้มและ rollback หมด ทั้งที่แถวนั้นไม่ได้แทนเงินสักบาท
  --
  -- ไม่แตะ petty_cash เลย แถวเดิมยังอยู่ในบัญชี/ค่าใช้จ่ายตามเดิม ที่ไม่คัดลอกมา
  -- เพราะเลขศูนย์ไม่มีผลกับยอดคงเหลืออยู่แล้ว
  and p.amount > 0
  and exists (select 1 from money_accounts a where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย')
  -- Guarded so a re-run cannot double the shop’s petty cash. The release copy
  -- of this file is run by hand from the SQL editor, where "did that go
  -- through?" is answered by running it again.
  --
  -- Matched on the DESTINATION rather than on `from_account_id is null`: once a
  -- shop says where a top-up came from, that earlier version had nothing to
  -- recognise and copied the row a second time.
  -- ครั้งเดียวเท่านั้น (เพิ่มตอนทำ 0056). The check below stops an exact
  -- duplicate, but a top-up pressed AFTER this first ran is not a duplicate of
  -- anything — so every later run of this file (or of release-GO-LIVE.sql)
  -- used to copy it across as a new transfer from นอกระบบ, including money the
  -- shop had already keyed by hand on another day. Those are for a person to
  -- decide on /money now (0056); this copy is only ever the first one.
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0043')
  and not exists (
    select 1 from money_transfers t
    where t.shop_id = p.shop_id
      and t.moved_at = p.entry_at::date
      and t.amount = p.amount
      and t.to_account_id = (
        select a.id from money_accounts a
        where a.shop_id = p.shop_id and a.name = 'เงินสดย่อย'
      )
  );

/*
  การกระทบยอด — what was actually counted, against what the system says.

  This is the register's real job: the shop counts the drawer and reads the bank
  statement, and the difference from the computed balance is the thing worth
  looking at. Recorded rather than corrected, on purpose — silently editing the
  opening balance to make a difference disappear destroys the only evidence that
  it happened. A row here says "on this date we counted this much", and the
  screen shows the gap.
*/
create table if not exists money_reconciliations (
  id bigint generated always as identity primary key,
  account_id bigint not null references money_accounts(id) on delete cascade,
  counted_at date not null default current_date,
  counted_balance numeric(12, 2) not null,
  /** What the system said at the moment of counting, kept so the gap survives
      later edits to older transactions. */
  system_balance numeric(12, 2) not null,
  note text not null default '',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists money_reconciliations_account_idx
  on money_reconciliations (account_id, counted_at desc);

alter table money_reconciliations enable row level security;

drop policy if exists money_reconciliations_rw on money_reconciliations;
create policy money_reconciliations_rw on money_reconciliations for all
  using (
    account_id in (
      select a.id from money_accounts a where a.shop_id in (select current_user_shops())
    )
  )
  with check (
    account_id in (
      select a.id from money_accounts a where a.shop_id in (select current_user_shops())
    )
  );

-- ด่านนี้อยู่ใน migrations/0043 ตั้งแต่แรก แต่ตกหล่นจากไฟล์นี้ ระบบจริงจึงไม่มี
-- จนถึง 23 ก.ย. 2569 (ใส่ให้ตอนขึ้นระบบ 0053-0065) ทั้งสองฝั่งตรงกันแล้ว
/*
  ทั้งสองด้านของการโอน ต้องเป็นบัญชีของสาขาเดียวกับรายการ.

  `money_transfers.shop_id` decides which branch the transfer belongs to, and the
  two account ids decide which balances move. Nothing tied them together, so a
  caller could file a transfer under one branch while moving another branch's
  money — and the row would then be invisible to the branch whose balances it
  changed, which is the worst of both: the money moves and nobody can see why.

  Enforced here rather than only in the server action, because the action is a
  plain POST and RLS on its own checks `shop_id` without ever looking at the
  accounts.
*/
create or replace function enforce_transfer_accounts_match_shop()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if new.from_account_id is not null
     and not exists (
       select 1 from money_accounts a
       where a.id = new.from_account_id and a.shop_id = new.shop_id
     ) then
    raise exception 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้' using errcode = '23514';
  end if;

  if new.to_account_id is not null
     and not exists (
       select 1 from money_accounts a
       where a.id = new.to_account_id and a.shop_id = new.shop_id
     ) then
    raise exception 'แหล่งเงินปลายทางไม่ได้อยู่ในสาขานี้' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists money_transfers_accounts_match_shop on money_transfers;
create trigger money_transfers_accounts_match_shop
  before insert or update on money_transfers
  for each row execute function enforce_transfer_accounts_match_shop();

insert into supabase_migrations.schema_migrations(version, name) values ('0043', 'money_accounts') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0044.sql
-- ==========================================================================

-- supabase/release-0044.sql
--
-- โมดูล การจัดการเงิน/บัญชี
--
-- รันต่อจาก release-0043.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- โมดูล การจัดการเงิน/บัญชี
--
-- The money register (0043) needs a screen, and that screen must not be visible
-- to everyone who can see ค่าใช้จ่าย. Opening balances, moving money between
-- accounts and reconciling against the bank statement are the bookkeeper's work;
-- a panel inside the expense module would inherit that module's audience, so the
-- register gets a nav key of its own, which is the only gate that actually shuts.
--
-- Seeded for แอดมิน and ผู้บริหาร only. Nobody gains anything they had before —
-- the screen did not exist — and a shop that wants a third role in there grants
-- it deliberately in จัดการสิทธิ์.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'nav', 'money', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

-- `reset_permissions_to_defaults()` is rebuilt to carry the new nav key. A
-- reset that dropped it would hide the module from everyone, including the
-- admin who has to grant it back.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','money',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','money',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','money',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','money',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','branchCompare',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','branchCompare',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','branchCompare',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','branchCompare',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0044', 'money_module') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0045.sql
-- ==========================================================================

-- supabase/release-0045.sql
--
-- ใบส่งของ และ ใบรับคืนสินค้า — วันที่ที่ยอดขายส่งต้องใช้
--
-- รันต่อจาก release-0044.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- ใบส่งของ และ ใบรับคืนสินค้า — วันที่ที่ยอดขายส่งต้องใช้
--
-- Wholesale sells on credit: the goods go out, the money comes weeks later. That
-- makes DELIVERY the moment the sale is earned, which the shop confirmed, and it
-- is the one date the system never recorded. `orders` knew the status was
-- จัดส่งแล้ว and nothing about when — so a PO could not be attributed to a month,
-- and wholesale takings appear in no figure anywhere in the app today.
--
-- The same hole exists on the other side: `order_returns` records what came back
-- and how many, with no date, so a return cannot reduce the month it belongs to.
--
-- Both dates arrive with the documents that create them, which is not a
-- coincidence — a ใบส่งของ IS the delivery, and a ใบรับคืนสินค้า IS the return.
--
-- Also fixed here: `save_order_children` stamped every payment and every price
-- adjustment with the date the PO was SAVED, discarding the row's own date. On a
-- business that delivers in March and is paid in May, that put the money in
-- whichever month somebody last opened the record — and the money register
-- (0043) reads exactly this column to say where cash is.

set search_path = pos, public, extensions;

alter table orders
  -- Null on purpose for existing rows. A PO already marked จัดส่งแล้ว really was
  -- delivered, but nobody wrote down when, and inventing a date would put real
  -- revenue in a month it did not happen. The module shows which POs still need
  -- one instead.
  add column if not exists delivered_at date;

comment on column orders.delivered_at is
  'วันที่ส่งของ — the date wholesale revenue is recognised on. Set by issuing ใบส่งของ.';

create index if not exists orders_delivered_idx on orders (delivered_at)
  where delivered_at is not null;

alter table order_returns
  add column if not exists returned_at date not null default current_date;

comment on column order_returns.returned_at is
  'วันที่รับคืนสินค้า — the date the return reduces revenue on.';

create index if not exists order_returns_returned_idx on order_returns (returned_at);

/*
  Children keep their OWN dates.

  `p_saved_on` stays as the fallback for a row that carries no date — an older
  client, or a payment typed without one — so nothing ends up with a null date
  in a NOT NULL column. What changes is that a date the form collected is no
  longer thrown away.
*/
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason, returned_at)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (order_id, amount, method, paid_at)
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

/*
  สาขาที่เพิ่มใหม่ ต้องได้แหล่งเงินตั้งต้นด้วย.

  0043 seeded the four default accounts for every shop that existed when it ran.
  A branch created afterwards got none — which is not a small gap: with no
  accounts, nothing the branch takes or spends can be attributed anywhere, and
  the money card shows it as having no money rather than as unconfigured.

  Finnix North, created for the wholesale team, hit exactly this. Seeding inside
  `save_shop` means the next branch cannot.

  Everything else about the function is unchanged; `create or replace` has no way
  to patch one statement.
*/
create or replace function save_shop(p_id text, p_name text, p_sort integer default null)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_id   text := lower(trim(coalesce(p_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_sort integer;
begin
  -- coalesce, not a bare comparison: `current_user_role()` is NULL for a token
  -- with no `app_users` row, and `NULL <> 'admin'` is NULL — which is not TRUE,
  -- so the guard would have let exactly that caller through.
  if coalesce(current_user_role(), '') <> 'admin' then
    raise exception 'forbidden: เฉพาะแอดมินเท่านั้นที่เพิ่ม/แก้ไขสาขาได้';
  end if;

  -- The id goes into every document number and every export filename, so it is
  -- kept short, lowercase and free of anything that needs escaping.
  if v_id !~ '^[a-z0-9]{2,10}$' then
    raise exception 'รหัสสาขาต้องเป็น a-z หรือ 0-9 ความยาว 2-10 ตัว (เช่น north)';
  end if;
  if v_name = '' then
    raise exception 'ต้องระบุชื่อสาขา';
  end if;

  -- Appended to the end unless told otherwise; renaming must not silently
  -- reorder the sidebar.
  v_sort := coalesce(
    p_sort,
    (select sort_order from shops where id = v_id),
    (select coalesce(max(sort_order), 0) + 1 from shops)
  );

  insert into shops (id, name, sort_order)
  values (v_id, v_name, v_sort)
  on conflict (id) do update
    set name = excluded.name,
        sort_order = excluded.sort_order;

  -- The company details a document prints, and the four places money sits.
  -- `do nothing` on both, so renaming an existing branch changes nothing else.
  insert into shop_info (shop_id) values (v_id) on conflict (shop_id) do nothing;

  insert into money_accounts (shop_id, name, kind, match_names, sort_order)
  select v_id, a.name, a.kind, a.match_names, a.sort_order
  from (values
    ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                                       1),
    ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
    ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                                   3),
    ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],                  4)
  ) as a(name, kind, match_names, sort_order)
  on conflict (shop_id, name) do nothing;

  return v_id;
end;
$$;

revoke all on function save_shop(text, text, integer) from public, anon;
grant execute on function save_shop(text, text, integer) to authenticated;

-- Branches that already exist without accounts — Finnix North today, and any
-- other added between 0043 and now.
insert into money_accounts (shop_id, name, kind, match_names, sort_order)
select s.id, a.name, a.kind, a.match_names, a.sort_order
from shops s
cross join (values
  ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                                       1),
  ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
  ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                                   3),
  ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],                  4)
) as a(name, kind, match_names, sort_order)
-- เฉพาะสาขาที่ยังไม่มีแหล่งเงินเลย. The conflict key is the NAME, so once a
-- branch renames an account (บัญชีธนาคารสาขา → K-bank คูลมาน) a re-run no
-- longer recognises it and adds the default back — carrying labels like
-- โอนเงิน that could then pull money onto the wrong row of the register.
where not exists (select 1 from money_accounts x where x.shop_id = s.id)
on conflict (shop_id, name) do nothing;

insert into shop_info (shop_id)
select s.id from shops s
on conflict (shop_id) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0045', 'wholesale_delivery_and_returns') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0046.sql
-- ==========================================================================

-- supabase/release-0046.sql
--
-- เติมวันส่งของย้อนหลังให้ PO ที่ส่งของไปแล้ว
--
-- รันต่อจาก release-0045.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: อัปเดตเฉพาะแถวที่ delivered_at ยังว่าง รันซ้ำแล้วไม่ทับของเดิม
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- เติมวันส่งของย้อนหลังให้ PO ที่ส่งของไปแล้ว
--
-- 0045 added `orders.delivered_at` and left it NULL for existing rows, on the
-- grounds that inventing a date puts real revenue in a month it did not happen.
-- The shop weighed that against the alternative and chose the backfill: a PO
-- already marked จัดส่งแล้ว WAS delivered, and leaving it dateless means it never
-- appears in ยอดขาย at all — which is not a smaller error than being a few days
-- out, it is the whole sale missing.
--
-- WHAT DATE IS USED. `created_at`, read on the shop's clock. It is the only date
-- these rows carry, and for wholesale it is close: a PO is raised when the order
-- is agreed and the goods follow within days. It is NOT the delivery date, and
-- anyone reconciling a month should know that — hence this file, and the note in
-- the release runbook.
--
-- ONLY rows past delivery, and only rows with no date. A PO still at
-- รออนุมัติราคา or รอจัดส่ง has genuinely not been delivered, and stamping it
-- would book revenue for goods still on the shelf.

set search_path = pos, public, extensions;

update orders
set delivered_at = (created_at at time zone 'Asia/Bangkok')::date
where delivered_at is null
  and status in ('จัดส่งแล้ว', 'ค้างชำระ', 'ปิดงานแล้ว');

insert into supabase_migrations.schema_migrations(version, name) values ('0046', 'backfill_delivered_at') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0047.sql
-- ==========================================================================

-- supabase/release-0047.sql
--
-- พนักงานขายของโมดูลขายส่ง
--
-- รันต่อจาก release-0046.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table if not exists / add column if not exists /
-- create index if not exists / on conflict do nothing
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- พนักงานขายของโมดูลขายส่ง
--
-- Finnix North sells through two people, โหน่ง and เคน, and their documents are
-- meant to carry the shop name and THAT PERSON's phone number — a wholesale
-- customer rings the rep who sold to them, not a branch switchboard.
--
-- WHY A TABLE AND NOT AN OPTION LIST. The design note first put these names in
-- `option_lists`, which is where every other people-list in this system lives
-- (technicians, commission teams). That works while a person is only a name.
-- A phone number printed on a customer's invoice is a second field, and packing
-- two fields into one option value ("โหน่ง · 081-…") makes the phone unsearchable,
-- unvalidatable and impossible to change without editing the name. So: a table.
--
-- `orders.sales_by` still stores the NAME, not a foreign key. โหน่ง and เคน may
-- never have logins, a person can leave while their POs must keep saying who
-- sold them, and every other "who did this" column in this schema
-- (`tickets.tech_by_category`, `service_visits.sales_by`) is a name for exactly
-- those reasons. The table is the picker and the phone book; the PO keeps the
-- name it was sold under.

set search_path = pos, public, extensions;

create table if not exists sales_people (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id) on delete cascade,
  name text not null,
  phone text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

comment on table sales_people is
  'พนักงานขายของแต่ละสาขา. The phone is printed on that person''s wholesale documents.';

create index if not exists sales_people_shop_idx on sales_people (shop_id, sort_order) where active;

alter table sales_people enable row level security;

-- Readable by anyone signed in, because a document printed for another branch
-- still has to render the rep's name; writable only within your own branches.
drop policy if exists sales_people_select on sales_people;
create policy sales_people_select on sales_people for select
  using (auth.uid() is not null);

drop policy if exists sales_people_write on sales_people;
create policy sales_people_write on sales_people for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

alter table orders
  -- The NAME, matching `sales_people.name` within the branch. Empty on every
  -- existing PO: nobody recorded who sold them, and assigning them to whoever
  -- is on the list today would put another person's sales in their column.
  add column if not exists sales_by text not null default '';

comment on column orders.sales_by is
  'พนักงานขายที่ขาย PO ใบนี้ — ชื่อ ไม่ใช่ FK. ว่างหมายถึงยังไม่ได้ระบุ.';

create index if not exists orders_sales_by_idx on orders (shop_id, sales_by) where sales_by <> '';

-- โหน่ง และ เคน. Seeded only if Finnix North exists — a database that has not
-- created that branch yet gets nothing, and adding it later is a screen away.
insert into sales_people (shop_id, name, phone, sort_order)
select 'north', p.name, p.phone, p.sort_order
from (values
  ('โหน่ง', '', 1),
  ('เคน', '', 2)
) as p(name, phone, sort_order)
where exists (select 1 from shops where id = 'north')
  -- Same name-keyed conflict: rename โหน่ง to a full name and a re-run would add
  -- a second, phone-less โหน่ง to the picker.
  and not exists (select 1 from sales_people x where x.shop_id = 'north')
on conflict (shop_id, name) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0047', 'sales_people') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0048.sql
-- ==========================================================================

-- supabase/release-0048.sql
--
-- การรับเงินขายส่ง — เช็คลงวันที่ล่วงหน้า และการยืนยันเงินเข้า
--
-- รันต่อจาก release-0047.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function / on conflict do nothing. การเติมสถานะย้อนหลัง
-- แตะเฉพาะแถวที่ยังไม่มี cleared_at จึงไม่ย้อนกลับการยืนยันที่ทำไปแล้ว
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
--
-- การรับเงินขายส่ง — เช็คลงวันที่ล่วงหน้า และการยืนยันเงินเข้า
--
-- Wholesale is paid mostly by cheque, usually post-dated. That makes ONE row in
-- `order_payments` today stand for three different events on three different
-- days: a sale takes a piece of paper, someone banks it, and some time later the
-- money either arrives or the cheque bounces. The table records amount, method
-- and one date, so the system cannot tell "we hold a cheque" from "we have the
-- money" — and it counted the first as the second, clearing the customer's debt
-- and moving the money card on the strength of a promise.
--
-- WHAT THE SHOP DECIDED (docs/DESIGN-wholesale-sales-and-channel.md § 3):
--   - หนี้ถูกตัดเมื่อเช็คผ่านจริง — the customer still owes until money lands.
--   - ออกใบเสร็จตอนรับเช็ค — the receipt goes out with the cheque, as it does now.
--   - sale แจ้งได้ แอดมิน/ผู้บริหารยืนยัน — a sale records what they received;
--     only `wholesale.confirmPayment` turns it into money.
--
-- Those first two together mean a receipt exists for money not yet received.
-- That is the shop's real practice, not a contradiction to design away, so the
-- receipt has to carry the cheque's own number, bank and date — a receipt that
-- says only "รับเงินแล้ว 50,000" for a cheque dated next month misleads both
-- sides — and a bounce has to be recordable after the fact.
--
-- WHY `uid` AND NOT THE PRIMARY KEY. `save_order_children` deletes every child
-- row and re-inserts it on each save, so `order_payments.id` changes every time
-- anybody edits the PO. A confirmation keyed on it would not survive the next
-- save, and a confirmation sent up from the browser could be forged by anyone
-- who can POST to the Server Action (CORRECTION C2). So each payment carries a
-- client-generated `uid` that survives the round trip, the save function copies
-- the confirmation columns forward by that uid and ignores whatever the client
-- says about them, and confirming is a separate security-definer function that
-- checks the capability itself.

set search_path = pos, public, extensions;

alter table order_payments
  -- Stable across the delete-and-reinsert in `save_order_children`. Empty for
  -- rows written before this migration; those are already confirmed, so nothing
  -- needs to be matched to them.
  add column if not exists uid text not null default '',
  -- แจ้งแล้ว → รับเงินแล้ว → เด้ง. Existing rows are backfilled to รับเงินแล้ว
  -- below: they were counted as money before this migration, and re-opening
  -- settled debts across every branch is not a migration's decision to make.
  add column if not exists status text not null default 'แจ้งแล้ว',
  add column if not exists cheque_no text not null default '',
  add column if not exists cheque_bank text not null default '',
  -- วันที่หน้าเช็ค. The date the money is EXPECTED, which is what makes
  -- "เดือนหน้าจะมีเงินเข้าเท่าไหร่" answerable.
  add column if not exists cheque_date date,
  add column if not exists reported_by uuid references auth.users(id),
  add column if not exists reported_at timestamptz,
  -- วันที่เงินเข้าจริง. The money register dates the movement by THIS, not by
  -- `paid_at` — a cheque received in March and cleared in May is May's cash.
  add column if not exists cleared_at date,
  add column if not exists cleared_by uuid references auth.users(id),
  add column if not exists bounced_at date,
  add column if not exists bounce_note text not null default '';

do $ck$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_payments_status_ck'
      and conrelid = 'pos.order_payments'::regclass
  ) then
    alter table order_payments
      add constraint order_payments_status_ck check (status in ('แจ้งแล้ว', 'รับเงินแล้ว', 'เด้ง'));
  end if;
end
$ck$;

comment on column order_payments.uid is
  'คีย์ฝั่งไคลเอนต์ที่อยู่รอดข้ามการบันทึก — ใช้จับคู่แถวเดิมกับแถวใหม่ใน save_order_children.';
comment on column order_payments.status is
  'แจ้งแล้ว (ยังไม่ใช่เงิน) / รับเงินแล้ว (เงินเข้าจริง) / เด้ง (เช็คไม่ผ่าน).';
comment on column order_payments.cleared_at is
  'วันที่เงินเข้าจริง — วันที่ที่ใช้ในการ์ดเงินอยู่ที่ไหนบ้าง.';

-- Every payment recorded before today was treated as received the moment it was
-- typed, and every downstream figure was built on that. Backfilling to
-- รับเงินแล้ว keeps all of them exactly where they are.
-- รันครั้งแรกเท่านั้น. เงื่อนไขนี้ตั้งใจจับ "ทุกแถวที่มีอยู่ก่อนไมเกรชันนี้" ซึ่งรอบแรก
-- ถูกต้อง แต่รอบสองแถวที่เข้าเงื่อนไขคือเช็คที่รอยืนยันอยู่จริงๆ การรันซ้ำจะกลายเป็น
-- การยืนยันเงินเข้าให้ทุกใบโดยไม่มีใครกด จึงล็อกไว้กับบันทึกเวอร์ชันของไฟล์นี้เอง
update order_payments
set status = 'รับเงินแล้ว',
    cleared_at = coalesce(cleared_at, paid_at)
where status = 'แจ้งแล้ว' and cleared_at is null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0048');

-- Two questions this index exists for: what is still unconfirmed, and which
-- cheques come due when.
create index if not exists order_payments_status_idx on order_payments (status, cheque_date);

/*
  การยืนยันไม่ผ่านหน้าจอแก้ไข PO.

  `p_payments` still carries the cheque details and the amount — a sale types
  those. It does NOT carry status: the function reads the previous state for
  each uid and writes it back, so a forged payload cannot promote a payment to
  รับเงินแล้ว. A row with no matching uid is new, and new payments start
  แจ้งแล้ว whoever saved them, including an admin — one deliberate click
  confirms it, which is the point of having a confirmation at all.
*/
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
begin
  -- The confirmation state of what is already stored, keyed by uid, captured
  -- before the delete below throws the rows away.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason, returned_at)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    -- Everything from here down comes from the database, never from the caller.
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

/*
  ยืนยันเงินเข้า.

  security definer with the capability checked inside, because the button is not
  the gate — a Server Action is a plain POST. `p_on` is the date the money
  actually landed, which the confirmer types: a cheque banked on Friday and
  credited on Monday belongs to Monday, and only the person holding the
  statement knows which.
*/
create or replace function confirm_order_payment(
  p_order_id text,
  p_uid text,
  p_on date default null
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.confirmPayment') then
    raise exception 'forbidden: ไม่มีสิทธิ์ยืนยันการรับเงิน';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  -- security definer bypasses RLS, so the branch check has to be made here.
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_payments
  set status = 'รับเงินแล้ว',
      cleared_at = coalesce(p_on, current_date),
      cleared_by = auth.uid(),
      -- A bounced cheque the customer made good on is confirmed, not haunted by
      -- the old bounce date.
      bounced_at = null
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการรับเงินที่ต้องการยืนยัน';
  end if;
end;
$$;

revoke all on function confirm_order_payment(text, text, date) from public, anon;
grant execute on function confirm_order_payment(text, text, date) to authenticated;

/*
  เช็คเด้ง.

  The debt comes back on its own, because ค้างรับ counts only รับเงินแล้ว. The
  receipt already issued is NOT deleted — it is in the customer's hands, and
  destroying the record that it was issued destroys the evidence of what
  happened. The reason is required: "เด้ง" with no note is unactionable a month
  later.
*/
create or replace function bounce_order_payment(
  p_order_id text,
  p_uid text,
  p_on date default null,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.confirmPayment') then
    raise exception 'forbidden: ไม่มีสิทธิ์บันทึกเช็คเด้ง';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_payments
  set status = 'เด้ง',
      bounced_at = coalesce(p_on, current_date),
      bounce_note = coalesce(nullif(trim(p_note), ''), 'ไม่ได้ระบุเหตุผล'),
      -- It never cleared, so the money card must stop counting it.
      cleared_at = null,
      cleared_by = null
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการรับเงินที่ต้องการบันทึก';
  end if;
end;
$$;

revoke all on function bounce_order_payment(text, text, date, text) from public, anon;
grant execute on function bounce_order_payment(text, text, date, text) to authenticated;

-- สิทธิ์ใหม่: ขายส่ง: ยืนยันเงินเข้า. Admin and ผู้บริหาร by default; a sale
-- records what they received and cannot promote it to money.
insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.confirmPayment', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

/*
  `reset_permissions_to_defaults()` rebuilt to carry `wholesale.confirmPayment`.

  A reset that dropped the key would leave nobody able to confirm a payment,
  which stops money being recognised at all — the module would look like it had
  simply stopped working. Everything else here is 0044 unchanged; `create or
  replace` cannot patch one statement.
*/
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','money',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','money',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','money',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','money',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','branchCompare',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','branchCompare',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','branchCompare',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','branchCompare',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),('wholesale.confirmPayment'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.confirmPayment',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.confirmPayment',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0048', 'wholesale_cheque_payments') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0049.sql
-- ==========================================================================

-- supabase/release-0049.sql
--
-- uid ของการรับเงินขายส่งต้องไม่ซ้ำกันใน PO เดียวกัน (ปิดช่องโหว่ของ 0048)
--
-- รันต่อจาก release-0048.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create unique index if not exists / create or replace
-- function และการตรวจ uid ซ้ำเป็นการอ่านอย่างเดียว
--
-- ไม่มีการลบหรือแก้ข้อมูลเดิมแม้แต่แถวเดียว ถ้ามี uid ซ้ำค้างอยู่ สคริปต์จะหยุด
-- และบอกว่า PO ไหน โดยไม่แตะข้อมูล — ให้คนตัดสินใจว่าแถวไหนคือเงินจริง
--
-- ถอยกลับ: supabase/revert-0042-0049.sql (drop index อย่างเดียว)
--
set search_path = pos, public, extensions;

-- ---- 1. ตรวจว่ามี uid ซ้ำค้างอยู่ก่อนหรือไม่ --------------------------------
-- ไม่ลบให้เอง เพราะแต่ละแถวคือ "เงิน" ที่ต้องมีคนตัดสินใจ ถ้าเจอให้หยุดและบอกว่า
-- PO ไหน แล้วให้คนแก้ก่อนค่อยรันใหม่
do $$
declare
  v_dupes text;
begin
  select string_agg(distinct order_id || ' (uid=' || uid || ')', ', ')
    into v_dupes
    from (
      select order_id, uid
        from order_payments
       where uid <> ''
       group by order_id, uid
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception
      'พบ uid ของการรับเงินซ้ำกันใน PO เหล่านี้: %. แก้ให้เหลือแถวละ uid เดียวก่อน แล้วรัน 0049 ใหม่',
      v_dupes;
  end if;
end;
$$;

-- ---- 2. กฎระดับฐานข้อมูล ---------------------------------------------------
create unique index if not exists order_payments_order_uid_key
  on order_payments (order_id, uid)
  where uid <> '';

comment on index order_payments_order_uid_key is
  'uid ต้องไม่ซ้ำใน PO เดียวกัน — กันการปลอม payload ให้แถวใหม่สืบสถานะ รับเงินแล้ว จากแถวเดิม (0049).';

-- ---- 3. ข้อความผิดพลาดที่อ่านรู้เรื่องใน save_order_children ----------------
-- เนื้อในเหมือน 0048 ทุกอย่าง เพิ่มเฉพาะการตรวจ uid ซ้ำก่อน insert เพราะ
-- `create or replace` แก้ทีละบรรทัดไม่ได้
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
  v_dupe_count int;
begin
  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — ฝั่งหน้าจอสร้าง uid
  -- ใหม่ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
  select count(*) into v_dupe_count
    from (
      select pay->>'uid' as uid
        from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
       where coalesce(pay->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;

  if v_dupe_count > 0 then
    raise exception 'รายการรับเงินมี uid ซ้ำกัน บันทึกไม่ได้';
  end if;

  -- The confirmation state of what is already stored, keyed by uid, captured
  -- before the delete below throws the rows away.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason, returned_at)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    -- Everything from here down comes from the database, never from the caller.
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

insert into supabase_migrations.schema_migrations(version, name) values ('0049', 'order_payment_uid_unique') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0050.sql
-- ==========================================================================

-- supabase/release-0050.sql
--
-- กำหนดชำระเงินของ PO ขายส่ง
--
-- รันต่อจาก release-GO-LIVE.sql (หรือ release-0049.sql)
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
--
-- ขายส่งส่งของก่อน แล้วค่อยเก็บเงินทีหลัง — so every PO carries an unspoken credit
-- term, and until now the system held no record of it anywhere. The invoice and
-- the delivery note went out saying what was owed and saying nothing about when,
-- which leaves the shop chasing on memory and gives the customer nothing to
-- answer to.
--
-- Deliberately a DATE the shop sets per PO rather than a term in days on the
-- customer: the same buyer gets 30 days on one order and cash-on-delivery on the
-- next, and a stored term would be quietly wrong on the exception rather than
-- absent. Null means nobody agreed a date — the documents then print nothing at
-- all, which is honest, rather than inventing one from the delivery date.

set search_path = pos, public, extensions;

alter table orders
  add column if not exists due_at date;

comment on column orders.due_at is
  'กำหนดชำระเงินของ PO ใบนี้ — พิมพ์บนใบแจ้งหนี้และใบส่งของ. null = ยังไม่ได้ตกลงวันไว้.';

-- The question this index answers: which POs are past their date and still owed.
create index if not exists orders_due_idx on orders (due_at)
  where due_at is not null;
insert into supabase_migrations.schema_migrations(version, name) values ('0050', 'order_due_date') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0051.sql
-- ==========================================================================

-- supabase/release-0051.sql
--
-- การปรับราคาต้องได้รับอนุมัติ เหมือนการเสนอราคาต่ำกว่ามาตรฐาน
--
-- รันต่อจาก release-0050.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function และการเติมสถานะย้อนหลังแตะเฉพาะแถวที่ยังไม่มี
-- approved_at จึงไม่ย้อนกลับการอนุมัติที่ทำไปแล้ว
--
-- เสนอราคาต่ำกว่าราคามาตรฐาน ต้องให้ผู้บริหารอนุมัติก่อนอยู่แล้ว — but a price
-- ADJUSTMENT gives away exactly the same money and went through nobody. It is
-- arguably the looser of the two: a discount is agreed before the goods move,
-- while an adjustment is written after they have already gone out and the
-- invoice has been raised, which is precisely when the shop has least leverage
-- and most reason to want a second pair of eyes.
--
-- WHY NOT REUSE THE PO STATUS. A discount waits in `รออนุมัติราคา`, and the
-- approval card keys off that. An adjustment cannot: by the time one is written
-- the PO is จัดส่งแล้ว or ค้างชำระ, and pushing it back to รออนุมัติราคา would
-- make the status lie about goods that have already shipped. So the approval
-- lives on the adjustment row itself, and the PO keeps saying what is true.
--
-- WHAT THIS CHANGES IN THE MONEY. `orderTotal` subtracts adjustments, so an
-- unapproved one must NOT reduce the bill yet — otherwise the approval is
-- decoration and the money has already left. Existing rows are backfilled to
-- อนุมัติแล้ว, so nothing that has already been reported moves.
--
-- The uid trick is the one from 0048, for the same reason: `save_order_children`
-- deletes and re-inserts every child row on each save, so the approval is keyed
-- on a client-generated id that survives the round trip, the save function
-- copies the approval forward and ignores whatever the browser claims, and
-- approving is a separate security-definer function that checks the capability
-- itself.

set search_path = pos, public, extensions;

alter table order_adjustments
  add column if not exists uid text not null default '',
  -- รออนุมัติ → อนุมัติแล้ว / ปฏิเสธ. Existing rows are backfilled below: they
  -- were already subtracted from every figure the shop has read, and re-opening
  -- settled invoices is not a migration's decision to make.
  add column if not exists status text not null default 'รออนุมัติ',
  add column if not exists approved_at date,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists reject_note text not null default '';

do $ck$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_adjustments_status_ck'
      and conrelid = 'pos.order_adjustments'::regclass
  ) then
    alter table order_adjustments
      add constraint order_adjustments_status_ck check (status in ('รออนุมัติ', 'อนุมัติแล้ว', 'ปฏิเสธ'));
  end if;
end
$ck$;

comment on column order_adjustments.status is
  'รออนุมัติ (ยังไม่ลดยอด) / อนุมัติแล้ว (ลดยอดแล้ว) / ปฏิเสธ.';

-- รันครั้งแรกเท่านั้น ด้วยเหตุผลเดียวกับ release-0048: รอบสองแถวที่เข้าเงื่อนไขคือ
-- รายการปรับราคาที่รอผู้บริหารอยู่จริงๆ การรันซ้ำจะอนุมัติให้ทุกใบเอง
update order_adjustments
set status = 'อนุมัติแล้ว',
    approved_at = adjusted_at
where status = 'รออนุมัติ' and approved_at is null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0051');

create index if not exists order_adjustments_status_idx on order_adjustments (status);

/*
  บันทึกรายการปรับราคาไม่ใช่การอนุมัติ.

  Everything about the payment half of this function is unchanged from 0048,
  plus the duplicate-uid guard 0049 added; `create or replace` has no way to
  patch one statement, so both have to be carried forward here verbatim.
*/
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
  v_prior_adj jsonb;
  v_dupe_count int;
begin
  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — ฝั่งหน้าจอสร้าง uid
  -- ใหม่ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
  -- (ยกมาจาก 0049 — `create or replace` ที่นี่จะทับของเดิมทั้งก้อน)
  select count(*) into v_dupe_count
    from (
      select pay->>'uid' as uid
        from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
       where coalesce(pay->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;

  if v_dupe_count > 0 then
    raise exception 'รายการรับเงินมี uid ซ้ำกัน บันทึกไม่ได้';
  end if;
  -- การอนุมัติของรายการปรับราคา, keyed by uid, captured before the delete.
  -- Same shape and same reason as the payment state below it: the rows are
  -- thrown away and re-inserted on every save, so an approval keyed on the
  -- database id would not survive, and one sent up from the browser could be
  -- forged by anyone who can POST to the Server Action.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'approved_at', approved_at,
        'approved_by', approved_by,
        'reject_note', reject_note
      )
    ),
    '{}'::jsonb
  )
  into v_prior_adj
  from order_adjustments
  where order_id = p_order_id and uid <> '';
  -- The confirmation state of what is already stored, keyed by uid, captured
  -- before the delete below throws the rows away.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason, returned_at)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (
    order_id, amount, reason, adjusted_at, uid,
    status, approved_at, approved_by, reject_note
  )
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on),
    coalesce(a->>'uid', ''),
    -- From the database, never from the caller. A new row starts รออนุมัติ
    -- whoever saved it, including somebody who holds the capability: recording
    -- an adjustment and approving it are two decisions, and the second one is
    -- the whole point of this migration.
    coalesce(prior_adj.v->>'status', 'รออนุมัติ'),
    (prior_adj.v->>'approved_at')::date,
    (prior_adj.v->>'approved_by')::uuid,
    coalesce(prior_adj.v->>'reject_note', '')
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a
  left join lateral (
    select v_prior_adj -> coalesce(a->>'uid', '') as v
  ) as prior_adj on true;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    -- Everything from here down comes from the database, never from the caller.
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

/*
  อนุมัติการปรับราคา.

  security definer with the capability checked inside, because the button is not
  the gate — a Server Action is a plain POST. Gated on `wholesale.priceApproval`,
  the same key that approves a below-standard price: it is the same decision
  about the same money, and giving it a second key would let the two drift apart.
*/
create or replace function approve_order_adjustment(
  p_order_id text,
  p_uid text,
  p_on date default null
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.priceApproval') then
    raise exception 'forbidden: ไม่มีสิทธิ์อนุมัติการปรับราคา';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  -- security definer bypasses RLS, so the branch check has to be made here.
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_adjustments
  set status = 'อนุมัติแล้ว',
      approved_at = coalesce(p_on, current_date),
      approved_by = auth.uid(),
      reject_note = ''
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการปรับราคาที่ต้องการอนุมัติ';
  end if;
end;
$$;

revoke all on function approve_order_adjustment(text, text, date) from public, anon;
grant execute on function approve_order_adjustment(text, text, date) to authenticated;

/*
  ปฏิเสธการปรับราคา.

  The row is NOT deleted. Somebody asked for this reduction and somebody said
  no, and both halves of that are worth keeping — a deleted row leaves the next
  person to wonder whether it was ever raised. A rejected adjustment simply
  stops reducing the bill.
*/
create or replace function reject_order_adjustment(
  p_order_id text,
  p_uid text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.priceApproval') then
    raise exception 'forbidden: ไม่มีสิทธิ์อนุมัติการปรับราคา';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_adjustments
  set status = 'ปฏิเสธ',
      approved_at = null,
      approved_by = auth.uid(),
      reject_note = coalesce(nullif(trim(p_note), ''), 'ไม่ได้ระบุเหตุผล')
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการปรับราคาที่ต้องการบันทึก';
  end if;
end;
$$;

revoke all on function reject_order_adjustment(text, text, text) from public, anon;
grant execute on function reject_order_adjustment(text, text, text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0051', 'adjustment_approval') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0052.sql
-- ==========================================================================

-- supabase/release-0052.sql
--
-- อนุมัติราคาให้ทิ้งร่องรอย และล็อกการเปลี่ยนสถานะ PO ที่ฐานข้อมูล
--
-- รันต่อจาก release-0051.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create or replace function /
-- drop trigger if exists ก่อน create trigger
--
-- สองช่องโหว่ที่เหลือจากการตรวจโมดูลขายส่ง
--
-- 1. อนุมัติราคาไม่ทิ้งร่องรอย. Approving a below-standard price only moved the
--    PO from รออนุมัติราคา to รอจัดส่ง. Nothing recorded WHO approved it or WHEN,
--    so "ส่วนลดผ่านไปแล้วสาวกลับไม่ได้ว่าใครอนุมัติ" was literally true: the only
--    evidence was a status that anybody could have set. Compare the adjustment
--    approval added in 0051, which records both — the two decisions give away the
--    same money and should leave the same trail.
--
-- 2. ใครก็เปลี่ยนสถานะ PO ได้. `wholesale.updateStatus` was checked in the Server
--    Action and nowhere else, and `orders_rw` lets any member of the branch
--    UPDATE the row — so a signed-in token could PATCH the status straight
--    through PostgREST without ever loading the screen that has the control.
--    Same hole, and the same fix, as ลบ/กู้คืน PO in migration 0040.

set search_path = pos, public, extensions;

alter table orders
  -- 'อนุมัติ' / 'ปฏิเสธ' / '' — the last decision made about this PO's price.
  add column if not exists price_decision text not null default '',
  add column if not exists price_decided_at date,
  add column if not exists price_decided_by uuid references auth.users(id);

do $ck$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_price_decision_ck' and conrelid = 'pos.orders'::regclass
  ) then
    alter table orders
      add constraint orders_price_decision_ck check (price_decision in ('', 'อนุมัติ', 'ปฏิเสธ'));
  end if;
end
$ck$;

comment on column orders.price_decision is
  'ผลการตัดสินใจเรื่องราคาล่าสุด — ใครอนุมัติ/ปฏิเสธ และเมื่อไหร่ อยู่ในอีกสองคอลัมน์.';

/*
  ตัดสินใจเรื่องราคา — อนุมัติ หรือ ปฏิเสธ.

  Replaces two Server Actions that each did a bare `update orders set status`.
  The capability is checked HERE, not only in the action, because the action is a
  plain POST anyone can send (CORRECTION C2) — and the status it writes is now
  also guarded by the trigger below, which this function has to satisfy legally
  rather than sneak past.
*/
create or replace function decide_order_price(p_order_id text, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.priceApproval') then
    raise exception 'forbidden: ไม่มีสิทธิ์อนุมัติราคา';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  -- security definer bypasses RLS, so the branch check has to be made here.
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update orders
  set status = case when p_approve then 'รอจัดส่ง' else 'รออนุมัติราคา' end,
      price_decision = case when p_approve then 'อนุมัติ' else 'ปฏิเสธ' end,
      price_decided_at = current_date,
      price_decided_by = auth.uid()
  where id = p_order_id;
end;
$$;

revoke all on function decide_order_price(text, boolean) from public, anon;
grant execute on function decide_order_price(text, boolean) to authenticated;

/*
  เปลี่ยนสถานะ PO ต้องมีสิทธิ์ — ตรวจที่ฐานข้อมูล.

  Checked per TRANSITION rather than with one blanket key, because three
  different people legitimately move a PO and they hold three different keys:

    - `wholesale.updateStatus` — the general one, any transition.
    - `wholesale.priceApproval` — moves it to รอจัดส่ง or back to รออนุมัติราคา,
      which is what `decide_order_price` above does.
    - `wholesale.badDebt` — moves it to ค้างชำระ when a balance is written off.

  And one transition belongs to no key at all: stamping the delivery date for
  the FIRST time moves the PO to จัดส่งแล้ว. That is not somebody editing a
  status, it is the ใบส่งของ being issued — so it is allowed only in the same
  statement that fills `delivered_at`, and only while it was empty.

  A save that does not touch the status is untouched by any of this, which is
  the common case: most edits to a PO are lines and prices.
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    -- แบ็กเอนด์ที่ถือ service_role (seed, สคริปต์ซ่อมข้อมูล, ชุดทดสอบ) ไม่ได้ผ่าน
    -- หน้าจอ จึงไม่มี auth.uid() ให้ตรวจสิทธิ์ และจะโดนปฏิเสธทุกครั้ง คีย์นี้เป็น
    -- ความลับฝั่งเซิร์ฟเวอร์อยู่แล้ว และตัวแอปไม่เคยใช้ service_role แตะสถานะ PO
    -- (ใช้เฉพาะใน permissions/actions.ts) ด่านนี้จึงยังกันคนที่ยิงตรงเข้า API ได้ครบ
    if auth.role() = 'service_role' then
      return new;
    end if;
    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'จัดส่งแล้ว'
       and old.delivered_at is null
       and new.delivered_at is not null then
      return new;
    end if;
    raise exception 'forbidden: ไม่มีสิทธิ์เปลี่ยนสถานะ PO';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_capability on orders;
create trigger orders_status_capability
  before update on orders
  for each row
  execute function enforce_order_status_capability();

insert into supabase_migrations.schema_migrations(version, name) values ('0052', 'price_decision_trail') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0053.sql
-- ==========================================================================

-- supabase/release-0053.sql
--
-- จัดการพนักงานขาย — ใส่ชื่อและเบอร์โทรได้จากหน้า PO
--
-- รันต่อจาก release-0052.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: drop policy if exists ก่อน create policy
--
-- 0047 created `sales_people` and seeded โหน่ง and เคน with EMPTY phone numbers,
-- and then gave the shop no way to fill them in: there is no screen for this
-- table anywhere in the app. The phone is what a wholesale customer rings off
-- the invoice, the delivery note and the shipping label, so the one field those
-- three documents exist to carry could only be set by hand in SQL.
--
-- The write policy is tightened at the same time. `sales_people_write` let any
-- signed-in member of the branch insert and update — which was survivable while
-- nothing could reach it, and is not now that a screen can. This is the same
-- decision as `options.manage` covers elsewhere: who may edit the shop's own
-- reference lists (technicians, commission teams, การจอง options). A sales rep
-- picking their own name off a list is not the same act as editing the list.

set search_path = pos, public, extensions;

drop policy if exists sales_people_write on sales_people;

create policy sales_people_write on sales_people for all
  using (
    shop_id in (select current_user_shops())
    and current_user_can('options.manage')
  )
  with check (
    shop_id in (select current_user_shops())
    and current_user_can('options.manage')
  );

insert into supabase_migrations.schema_migrations(version, name) values ('0053', 'sales_people_manage') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0054.sql
-- ==========================================================================

-- supabase/release-0054.sql
--
-- สต๊อกขายส่งเคลื่อนตามเหตุการณ์จริง และการรับคืนต้องยืนยันก่อน
--
-- รันต่อจาก release-0053.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function. การประทับว่า "จัดการไปแล้ว" ล็อกไว้กับบันทึก
-- เวอร์ชันของไฟล์เอง จึงไม่ไปปิดรายการที่รอยืนยันอยู่จริงในการรันรอบสอง
--
-- ตอนนี้สต๊อกขายส่งถูกตัดตอน **กดบันทึก PO** ซึ่งเร็วเกินไปเสมอ. A PO is typed,
-- priced, argued over and re-saved several times before anything leaves the
-- building — and every one of those saves moved the shelf. Goods that were still
-- on the rack read as gone, and a PO that was never delivered took stock with it.
--
-- The shop's rule is the physical one, and it is the right one:
--
--   ของออกจากคลัง เมื่อสถานะเป็น "จัดส่งแล้ว"
--   ของกลับเข้าคลัง เมื่อ "ยืนยันว่าได้รับของคืนแล้ว" — ไม่ใช่ตอนกรอกว่าลูกค้าจะคืน
--
-- Those are two different events from the two dates the module already keeps,
-- and the difference matters. `order_returns.returned_at` is the day the sale is
-- reduced (0045) — a business date the customer and the shop agree on, often
-- backdated. The day the boxes actually came back through the door is when the
-- shelf changes, and that is the day somebody ticks the confirmation. A return
-- that is agreed but not yet received must not put stock back: the goods are on
-- a lorry, not on the rack.
--
-- ของเก่าไม่ถูกแตะ (ตัวเลือกที่ร้านเลือก). Everything already delivered, and every
-- return already recorded, is stamped as "handled" below so the new rule cannot
-- deduct or restore it a second time. Whatever those POs did to stock when they
-- were saved stands as it is; the new rule starts from the next delivery.

set search_path = pos, public, extensions;

alter table orders
  -- ตัดสต๊อกไปแล้วหรือยัง. Stamped once, when the goods leave. Its whole job is
  -- to make the deduction idempotent: a PO can be saved, re-saved and re-opened
  -- any number of times, and the shelf moves exactly once.
  add column if not exists stock_deducted_at timestamptz,
  -- หมายเหตุของ PO — free text for whatever the sale needs to pass on.
  add column if not exists note text not null default '';

comment on column orders.stock_deducted_at is
  'เวลาที่ตัดสต๊อกออกไปจริง — null คือยังไม่ได้ตัด. กันการตัดซ้ำเมื่อบันทึก PO ใหม่.';

alter table order_returns
  -- Stable across the delete-and-reinsert in `save_order_children`, exactly as
  -- on payments (0048) and adjustments (0051): the confirmation must survive the
  -- next save of the PO, and the database id does not.
  add column if not exists uid text not null default '',
  -- ยืนยันว่าได้รับของคืนแล้ว. Null = agreed but not yet in our hands.
  add column if not exists received_at date,
  add column if not exists received_by uuid references auth.users(id),
  -- คืนสต๊อกกลับไปแล้วหรือยัง — same idempotence guard as above.
  add column if not exists stock_returned_at timestamptz;

comment on column order_returns.received_at is
  'วันที่ยืนยันว่าได้รับสินค้าคืนจริง — ไม่ใช่ returned_at ซึ่งเป็นวันที่ลดยอดขาย.';

create index if not exists order_returns_unconfirmed_idx on order_returns (order_id)
  where received_at is null;

/*
  ของเก่าถือว่าจัดการไปแล้ว.

  Not a judgement about whether those movements were right — they are whatever
  the old rule made them. The stamp only stops the new rule from running over
  the top of them and moving the same goods twice.
*/
update orders
set stock_deducted_at = now()
where stock_deducted_at is null
  and status in ('จัดส่งแล้ว', 'ค้างชำระ', 'ปิดงานแล้ว')
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0054');

update order_returns
set stock_returned_at = now(),
    received_at = coalesce(received_at, returned_at)
where stock_returned_at is null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '0054');

/*
  การยืนยันไม่ผ่านหน้าจอแก้ไข PO.

  Same shape as the payment and adjustment state before it: the rows are deleted
  and re-inserted on every save, so the confirmation is captured by uid first and
  written back from the database — never from whatever the browser sent. A save
  records that a return was AGREED; a separate, gated action records that the
  goods arrived.
*/
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
  v_prior_adj jsonb;
  v_prior_ret jsonb;
  v_dupe_count int;
begin
  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — ฝั่งหน้าจอสร้าง uid
  -- ใหม่ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
  --
  -- ยกมาจาก 0049 ทั้งก้อน: `create or replace` เขียนทับทั้งฟังก์ชัน ด่านที่
  -- ไมเกรชันก่อนหน้าใส่ไว้จึงต้องเขียนซ้ำ ไม่ใช่คิดว่ายังอยู่
  select count(*) into v_dupe_count
    from (
      select pay->>'uid' as uid
        from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
       where coalesce(pay->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;
  if v_dupe_count > 0 then
    raise exception 'รายการรับเงินมี uid ซ้ำกัน บันทึกไม่ได้';
  end if;
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'approved_at', approved_at,
        'approved_by', approved_by,
        'reject_note', reject_note
      )
    ),
    '{}'::jsonb
  )
  into v_prior_adj
  from order_adjustments
  where order_id = p_order_id and uid <> '';

  -- การยืนยันรับของคืน และการคืนสต๊อก ต้องอยู่รอดข้ามการบันทึก.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'received_at', received_at,
        'received_by', received_by,
        'stock_returned_at', stock_returned_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior_ret
  from order_returns
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (
    order_id, item_name, qty, reason, returned_at, uid,
    received_at, received_by, stock_returned_at
  )
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on),
    coalesce(r->>'uid', ''),
    -- From the database, never from the caller.
    (prior_ret.v->>'received_at')::date,
    (prior_ret.v->>'received_by')::uuid,
    (prior_ret.v->>'stock_returned_at')::timestamptz
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r
  left join lateral (
    select v_prior_ret -> coalesce(r->>'uid', '') as v
  ) as prior_ret on true;

  insert into order_adjustments (
    order_id, amount, reason, adjusted_at, uid,
    status, approved_at, approved_by, reject_note
  )
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on),
    coalesce(a->>'uid', ''),
    coalesce(prior_adj.v->>'status', 'รออนุมัติ'),
    (prior_adj.v->>'approved_at')::date,
    (prior_adj.v->>'approved_by')::uuid,
    coalesce(prior_adj.v->>'reject_note', '')
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a
  left join lateral (
    select v_prior_adj -> coalesce(a->>'uid', '') as v
  ) as prior_adj on true;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

/*
  ยืนยันว่าได้รับสินค้าคืนแล้ว.

  Gated by `wholesale.updateStatus`: putting goods back on the shelf is the same
  kind of act as moving a PO along, and the people who handle returning stock are
  the people who handle the PO's status. Checked in the database because the
  button is not the gate.

  It only marks the confirmation. The stock movement itself is applied by the
  application afterwards, through the same `applyStockMovements` ledger every
  other module writes to — the ledger needs a cost lookup and lot handling that
  belong in one place, not re-implemented in plpgsql.
*/
create or replace function confirm_order_return(
  p_order_id text,
  p_uid text,
  p_on date default null
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.updateStatus') then
    raise exception 'forbidden: ไม่มีสิทธิ์ยืนยันการรับคืนสินค้า';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_returns
  set received_at = coalesce(p_on, current_date),
      received_by = auth.uid()
  where order_id = p_order_id
    and uid = p_uid
    and p_uid <> ''
    and received_at is null;

  if not found then
    raise exception 'ไม่พบรายการรับคืนที่ต้องการยืนยัน หรือยืนยันไปแล้ว';
  end if;
end;
$$;

revoke all on function confirm_order_return(text, text, date) from public, anon;
grant execute on function confirm_order_return(text, text, date) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0054', 'wholesale_stock_events') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0055.sql
-- ==========================================================================

-- supabase/release-0055.sql
--
-- เปลี่ยนเป็น "จัดส่งแล้ว" ต้องกรอกข้อมูลการจัดส่ง และแนบไฟล์
--
-- รันต่อจาก release-0054.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / on conflict do nothing /
-- create or replace function. ไม่มีการ backfill ใดๆ จึงไม่มีอะไรให้ล็อกกับเวอร์ชัน
--
-- ขายส่งส่งของก่อน แล้วค่อยเก็บเงินทีหลัง — ช่วงที่ของออกไปแล้วแต่เงินยังไม่เข้า
-- คือช่วงที่เสี่ยงที่สุดของร้าน. When a customer says the goods never arrived, the
-- only thing that settles it is what was written down at the time. Until now the
-- module recorded a DATE and nothing else.
--
-- **ต้องสร้าง policy ของ storage ด้วย.** The three policies below are attempted
-- and downgraded to a warning if this connection does not own `storage.objects`
-- (the Dashboard SQL Editor does not). If you see that warning, create them from
-- Dashboard → Storage → Policies using supabase/storage-policies.sql, or delivery
-- evidence will not upload and the transition will be impossible to complete.
--
-- ของเก่าไม่ถูกแตะ. The rule fires only when the status CHANGES to จัดส่งแล้ว, so
-- every PO already in that status stays exactly as it is.

set search_path = pos, public, extensions;

alter table orders
  -- ข้อมูลการจัดส่ง — ขนส่งเจ้าไหน เลขพัสดุ ใครรับ. Free text on purpose: the
  -- shop uses a different courier per customer and sometimes its own van, and a
  -- fixed set of fields would be wrong for whichever case was not foreseen.
  add column if not exists delivery_note text not null default '',
  -- Storage paths in the `wholesale-attachments` bucket — the signed delivery
  -- note, the courier receipt, the photo of the pallet on the truck.
  add column if not exists delivery_attachments text[] not null default '{}';

comment on column orders.delivery_note is
  'ข้อมูลการจัดส่ง — ขนส่ง/เลขพัสดุ/ผู้รับ. บังคับกรอกตอนเปลี่ยนเป็นจัดส่งแล้ว.';
comment on column orders.delivery_attachments is
  'หลักฐานการจัดส่งใน bucket wholesale-attachments. ต้องมีอย่างน้อยหนึ่งไฟล์.';

-- Own bucket rather than reusing `ticket-attachments`: a ticket's photos are
-- readable by anyone with the `list` nav — a technician included — and a
-- wholesale delivery note is not their business. One bucket would have to
-- satisfy the looser of the two navs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wholesale-attachments',
  'wholesale-attachments',
  false,
  10485760,  -- 10 MB: a phone photo of a signed slip, not a scan archive
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

/*
  Attempted rather than asserted, for the reason spelled out in 0014 and 0018:
  `storage.objects` belongs to `supabase_storage_admin`, so these succeed under
  `supabase db push` (whose connection can act as that owner) but not under a
  plain `postgres` one such as the Dashboard SQL Editor. A hard failure there
  would roll this migration back and strand the release, so a missing privilege
  becomes a warning and `supabase/storage-policies.sql` holds the three for
  creating by hand.
*/
do $$
declare
  ddl text;
begin
  foreach ddl in array array[
    $p$create policy wholesale_attachments_object_read on storage.objects for select to authenticated
      using (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$,
    $p$create policy wholesale_attachments_object_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$,
    $p$create policy wholesale_attachments_object_delete on storage.objects for delete to authenticated
      using (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$
  ]
  loop
    begin
      execute ddl;
    exception
      when insufficient_privilege then
        raise warning 'SKIPPED a storage.objects policy for wholesale-attachments: not the owner of storage.objects. Create the three from Dashboard -> Storage -> Policies using supabase/storage-policies.sql, or delivery evidence will not upload or open.';
      when duplicate_object then
        null;
    end;
  end loop;
end $$;

/*
  เปลี่ยนเป็นจัดส่งแล้ว ต้องมีหลักฐานติดมาด้วย.

  Everything else in this function is 0052 unchanged — `create or replace` has
  no way to patch one branch, and every guard an earlier migration put here has
  to be written out again rather than assumed. (0051 learned that the hard way
  by silently deleting 0049's uid check; the first draft of THIS file dropped
  0052's service_role bypass the same way. Re-read the old body, do not trust
  the memory of it.)

  The evidence is demanded only on the TRANSITION. A PO already delivered can
  still be edited, re-priced and re-saved without anybody being asked for a
  photograph of something that happened last month.
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    -- แบ็กเอนด์ที่ถือ service_role (seed, สคริปต์ซ่อมข้อมูล, ชุดทดสอบ) ไม่ได้ผ่าน
    -- หน้าจอ จึงไม่มี auth.uid() ให้ตรวจสิทธิ์ และจะโดนปฏิเสธทุกครั้ง คีย์นี้เป็น
    -- ความลับฝั่งเซิร์ฟเวอร์อยู่แล้ว และตัวแอปไม่เคยใช้ service_role แตะสถานะ PO
    -- (ใช้เฉพาะใน permissions/actions.ts) ด่านนี้จึงยังกันคนที่ยิงตรงเข้า API ได้ครบ
    --
    -- มาก่อนด่านหลักฐานด้วย: a seed or a repair script setting up a PO that was
    -- delivered last year has no photograph to offer, and demanding one would
    -- make the fixtures impossible to write rather than making the shop safer.
    if auth.role() = 'service_role' then
      return new;
    end if;

    -- หลักฐานการจัดส่ง ก่อนเรื่องสิทธิ์: this is about the row being complete,
    -- not about who is asking, so it applies to everyone including an admin.
    if new.status = 'จัดส่งแล้ว' and old.status is distinct from 'จัดส่งแล้ว' then
      if new.delivered_at is null then
        raise exception 'ต้องระบุวันที่จัดส่งก่อน จึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(trim(new.delivery_note), '') = '' then
        raise exception 'ต้องกรอกข้อมูลการจัดส่ง (ขนส่ง/เลขพัสดุ/ผู้รับ) ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(array_length(new.delivery_attachments, 1), 0) = 0 then
        raise exception 'ต้องแนบหลักฐานการจัดส่งอย่างน้อยหนึ่งไฟล์ ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
    end if;

    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'จัดส่งแล้ว'
       and old.delivered_at is null
       and new.delivered_at is not null then
      return new;
    end if;
    raise exception 'forbidden: ไม่มีสิทธิ์เปลี่ยนสถานะ PO';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_capability on orders;
create trigger orders_status_capability
  before update on orders
  for each row
  execute function enforce_order_status_capability();

insert into supabase_migrations.schema_migrations(version, name) values ('0055', 'delivery_evidence') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0056.sql
-- ==========================================================================

-- supabase/release-0056.sql
--
-- เติมเงินสดย่อยจากหน้าค่าใช้จ่าย ต้องเข้ายอดเงินด้วย
--
-- รันต่อจาก release-0055.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function. การผูกของเดิมดูเฉพาะแถวที่ยังไม่ผูก และเฉพาะการโอน
-- ที่ยังไม่มีใครผูก รอบสองจึงไม่เปลี่ยนอะไร
--
-- ตั้งแต่ 0043 ยอดเงินคิดจากการโอน แต่ปุ่ม "เติมเงินสดย่อย" ในหน้าค่าใช้จ่ายยังบันทึก
-- ลง petty_cash อย่างเดียว ทุกครั้งที่กดหลังขึ้นระบบ ยอดเงินสดย่อยจึงไม่เพิ่ม และ
-- แหล่งเงินต้นทางก็ไม่ลด
--
-- หลังรันไฟล์นี้:
--   * ปุ่มนี้บันทึกเป็นการโอนด้วย และถามว่าเงินมาจากไหน
--   * รายการเก่าที่ตรงกับการโอนที่มีอยู่แน่นอน (สาขา วัน จำนวน ตรงกัน) ถูกผูกให้
--   * ที่เหลือ **ไม่ถูกคัดลอกให้อัตโนมัติ** — ขึ้นเป็นรายการที่หน้าการจัดการเงิน/บัญชี
--     ให้เลือกนำเข้า หรือกด "โอนไว้เองแล้ว" ทีละรายการ เพราะบางก้อนอาจคีย์เป็นการ
--     โอนไว้เองแล้ว คัดลอกทั้งหมดจะนับเงินซ้ำ

set search_path = pos, public, extensions;

alter table petty_cash
  -- การโอนที่เป็นคู่ของรายการเติมเงินนี้ ในยอดเงิน
  add column if not exists money_transfer_id bigint
    references money_transfers(id) on delete set null,
  -- "บันทึกโอนไว้เองแล้ว" — decided, but not by importing it
  add column if not exists transfer_skipped_at timestamptz,
  add column if not exists transfer_skipped_by uuid
    references app_users(id) on delete set null;

comment on column petty_cash.money_transfer_id is
  'การโอนเข้าบัญชีเงินสดย่อยที่เป็นคู่ของรายการเติมเงินนี้ (0056). null = ยังไม่เข้ายอดเงิน.';
comment on column petty_cash.transfer_skipped_at is
  'ร้านยืนยันว่าบันทึกการโอนก้อนนี้ไว้เองแล้ว จึงไม่นำเข้าซ้ำ (0056).';

-- One transfer explains one top-up. Without this, two identical top-ups on the
-- same day could both claim the same transfer and the second would look
-- accounted for when it is not.
create unique index if not exists petty_cash_money_transfer_uidx
  on petty_cash (money_transfer_id)
  where money_transfer_id is not null;

/*
  ผูกของเดิมที่ตรงกันแน่นอน.

  A loop rather than one UPDATE … FROM: two identical top-ups on one day must
  take two different transfers, and a set-based update would hand both the same
  one. Oldest top-up takes the oldest matching transfer.

  Safe to re-run: it only ever looks at rows that are still unlinked, and only
  at transfers no row has claimed.
*/
do $$
declare
  r record;
  v_transfer bigint;
begin
  for r in
    select p.id, p.shop_id, p.amount, p.entry_at
    from petty_cash p
    where p.type = 'เติมเงิน'
      and p.amount > 0
      and p.money_transfer_id is null
      and p.transfer_skipped_at is null
    order by p.id
  loop
    select t.id into v_transfer
    from money_transfers t
    join money_accounts a on a.id = t.to_account_id and a.kind = 'petty'
    where t.shop_id = r.shop_id
      and t.moved_at = r.entry_at
      and t.amount = r.amount
      and not exists (select 1 from petty_cash x where x.money_transfer_id = t.id)
    order by t.id
    limit 1;

    if v_transfer is not null then
      update petty_cash set money_transfer_id = v_transfer where id = r.id;
    end if;
  end loop;
end $$;

/*
  เติมเงินสดย่อย.

  security definer because it writes two tables in one go, which means RLS does
  not stand guard — so every check RLS and the Server Action used to make is
  made here, explicitly: the capability, the branch, the amount, and that both
  ends of the transfer are accounts of that branch.

  `p_from_account` null means นอกระบบ — the money came from somewhere the
  register does not track (a director's own pocket). That is a real answer and
  the form makes the person choose it, rather than null standing for "nobody
  said".
*/
create or replace function topup_petty_cash(
  p_shop text,
  p_from_account bigint,
  p_amount numeric,
  p_note text default '',
  p_on date default null
)
returns bigint
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_petty bigint;
  v_transfer bigint;
  v_id bigint;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_on date;
  v_note text;
begin
  if not current_user_can('accounting.topupCash') then
    raise exception 'forbidden: ไม่มีสิทธิ์เติมเงินสดย่อย';
  end if;
  if p_shop is null or p_shop not in (select current_user_shops()) then
    raise exception 'forbidden: ไม่มีสิทธิ์ในสาขานี้';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'จำนวนเงินต้องมากกว่า 0';
  end if;

  -- วันที่ของร้าน ไม่ใช่ของเซิร์ฟเวอร์. The old action sent a UTC timestamp into
  -- a DATE column, so a top-up before 07:00 was filed under yesterday.
  v_on := coalesce(p_on, v_today);
  if v_on > v_today then
    raise exception 'วันที่เติมเงินต้องไม่เกินวันนี้';
  end if;

  select a.id into v_petty
  from money_accounts a
  where a.shop_id = p_shop and a.kind = 'petty' and a.active
  order by a.sort_order, a.id
  limit 1;
  if v_petty is null then
    raise exception 'สาขานี้ยังไม่มีแหล่งเงินประเภทเงินสดย่อย — เพิ่มที่หน้าการจัดการเงิน/บัญชีก่อน';
  end if;

  if p_from_account is not null then
    if p_from_account = v_petty then
      raise exception 'เงินสดย่อยเติมจากตัวเองไม่ได้';
    end if;
    if not exists (
      select 1 from money_accounts a
      where a.id = p_from_account and a.shop_id = p_shop and a.active
    ) then
      raise exception 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้';
    end if;
  end if;

  v_note := coalesce(nullif(trim(p_note), ''), 'เติมเงินสดย่อย');

  insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note, created_by)
  values (p_shop, p_from_account, v_petty, p_amount, v_on, v_note, auth.uid())
  returning id into v_transfer;

  insert into petty_cash (shop_id, type, amount, note, entry_at, money_transfer_id)
  values (p_shop, 'เติมเงิน', p_amount, v_note, v_on, v_transfer)
  returning id into v_id;

  return v_id;
end;
$$;

/*
  นำการเติมเงินสดย่อยที่ตกหล่นเข้ายอดเงิน.

  Gated by the money register's own nav rather than `accounting.topupCash`:
  deciding what an old entry means for the balances is the bookkeeper's call on
  /money, and that is where the control lives. The transfer is dated the day
  the top-up was, so the balance history lands where it happened.
*/
create or replace function link_petty_cash_topup(
  p_petty_id bigint,
  p_from_account bigint
)
returns bigint
language plpgsql
security definer
set search_path = pos
as $$
declare
  r petty_cash%rowtype;
  v_petty bigint;
  v_transfer bigint;
begin
  if not current_user_has_nav('money') then
    raise exception 'forbidden: ไม่มีสิทธิ์จัดการแหล่งเงิน';
  end if;

  select * into r from petty_cash where id = p_petty_id for update;
  if not found or r.shop_id not in (select current_user_shops()) then
    raise exception 'ไม่พบรายการเติมเงินสดย่อยนี้';
  end if;
  if r.type <> 'เติมเงิน' or r.amount <= 0 then
    raise exception 'รายการนี้ไม่ใช่การเติมเงินสดย่อย';
  end if;
  if r.money_transfer_id is not null or r.transfer_skipped_at is not null then
    raise exception 'รายการนี้จัดการไปแล้ว';
  end if;

  select a.id into v_petty
  from money_accounts a
  where a.shop_id = r.shop_id and a.kind = 'petty' and a.active
  order by a.sort_order, a.id
  limit 1;
  if v_petty is null then
    raise exception 'สาขานี้ยังไม่มีแหล่งเงินประเภทเงินสดย่อย — เพิ่มที่หน้าการจัดการเงิน/บัญชีก่อน';
  end if;

  if p_from_account is not null then
    if p_from_account = v_petty then
      raise exception 'เงินสดย่อยเติมจากตัวเองไม่ได้';
    end if;
    if not exists (
      select 1 from money_accounts a
      where a.id = p_from_account and a.shop_id = r.shop_id and a.active
    ) then
      raise exception 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้';
    end if;
  end if;

  insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note, created_by)
  values (
    r.shop_id, p_from_account, v_petty, r.amount, r.entry_at,
    coalesce(nullif(trim(r.note), ''), 'เติมเงินสดย่อย'), auth.uid()
  )
  returning id into v_transfer;

  update petty_cash set money_transfer_id = v_transfer where id = r.id;
  return v_transfer;
end;
$$;

/*
  "บันทึกโอนไว้เองแล้ว".

  Kept as a decision with a name and a time on it rather than a delete: the
  petty-cash entry is still the accounting screen's record of the top-up, and
  whoever looks at it later should be able to see that somebody chose not to
  import it, and who.
*/
create or replace function skip_petty_cash_topup(p_petty_id bigint)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  r petty_cash%rowtype;
begin
  if not current_user_has_nav('money') then
    raise exception 'forbidden: ไม่มีสิทธิ์จัดการแหล่งเงิน';
  end if;

  select * into r from petty_cash where id = p_petty_id for update;
  if not found or r.shop_id not in (select current_user_shops()) then
    raise exception 'ไม่พบรายการเติมเงินสดย่อยนี้';
  end if;
  if r.money_transfer_id is not null or r.transfer_skipped_at is not null then
    raise exception 'รายการนี้จัดการไปแล้ว';
  end if;

  update petty_cash
  set transfer_skipped_at = now(),
      transfer_skipped_by = auth.uid()
  where id = r.id;
end;
$$;

revoke all on function topup_petty_cash(text, bigint, numeric, text, date) from public, anon;
grant execute on function topup_petty_cash(text, bigint, numeric, text, date) to authenticated;
revoke all on function link_petty_cash_topup(bigint, bigint) from public, anon;
grant execute on function link_petty_cash_topup(bigint, bigint) to authenticated;
revoke all on function skip_petty_cash_topup(bigint) from public, anon;
grant execute on function skip_petty_cash_topup(bigint) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0056', 'petty_cash_transfers') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0057.sql
-- ==========================================================================

-- supabase/release-0057.sql
--
-- ยอดขายของ PO เป็นของเซลล์ที่เลือก และบันทึกว่าใครเปิด PO
--
-- รันต่อจาก release-0056.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create or replace function /
-- drop trigger if exists. ไม่มีการแก้ข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * PO ใหม่ของสาขาที่มีพนักงานขาย (Finnix North) ต้องเลือกเซลล์เจ้าของยอดขาย
--   * ระบบบันทึกเองว่าใครเปิด PO และแก้ไม่ได้ — เปิดแทนกันได้ ยอดยังเป็นของเซลล์
--   * PO เก่าที่บันทึกไว้โดยไม่มีเซลล์ ยังแก้ไขได้ตามเดิม

set search_path = pos, public, extensions;

alter table orders
  add column if not exists created_by uuid
    references app_users(id) on delete set null
    default auth.uid();

comment on column orders.created_by is
  'ผู้ใช้ที่เปิด PO — ตั้งจากผู้ที่ล็อกอินตอนสร้าง แก้ไม่ได้ (0057). ยอดขายเป็นของ sales_by ไม่ใช่คนนี้.';

/*
  security definer so the rep lookup does not depend on the caller being able
  to read `sales_people`; nothing here widens what the caller can write, it only
  refuses rows.

  service_role passes untouched, as in 0052: seeds and repair scripts have no
  session to take `created_by` from, and backfilling history is exactly what
  they are for.
*/
create or replace function enforce_order_sales_attribution()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- ใครเปิด PO — from the session, never from the payload, and fixed for good.
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;

  if coalesce(trim(new.sales_by), '') = ''
     and (tg_op = 'INSERT' or coalesce(trim(old.sales_by), '') <> '')
     and exists (
       select 1 from sales_people p
       where p.shop_id = new.shop_id and p.active
     ) then
    raise exception 'ต้องเลือกพนักงานขายเจ้าของยอดขายของ PO นี้';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_sales_attribution on orders;
create trigger orders_sales_attribution
  before insert or update on orders
  for each row
  execute function enforce_order_sales_attribution();

insert into supabase_migrations.schema_migrations(version, name) values ('0057', 'order_sales_attribution') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0058.sql
-- ==========================================================================

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


-- ==========================================================================
-- supabase/release-0059.sql
-- ==========================================================================

-- supabase/release-0059.sql
--
-- เคลมประกันผ่านการเซอร์วิส
--
-- รันต่อจาก release-0058.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- drop trigger if exists / drop function if exists / create or replace.
-- ไม่แก้ข้อมูลเดิม การเคลมที่บันทึกไว้ก่อนหน้ายังอยู่ครบ
--
-- หลังรันไฟล์นี้:
--   * การเคลมประกันทำได้จากฟอร์มบันทึกการเซอร์วิสเท่านั้น (ติ๊ก "ใช้ประกันเคลม
--     ในการเซอร์วิสครั้งนี้") ระบบตรวจว่าเป็นประกันของรถคันนั้น อยู่ในช่วงคุ้มครอง
--     และจำนวนชิ้นไม่เกินที่เหลือ
--   * ส่วนประกันแสดงประวัติการเคลมอย่างเดียว
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกัน — โค้ดเดิมเรียกฟังก์ชันบันทึกการเซอร์วิส
--     แบบ 4 ค่า ซึ่งยังใช้ได้ (ค่าที่ 5 มีค่าเริ่มต้น) แต่การเพิ่มการเคลมจากส่วน
--     ประกันแบบเดิมจะถูกปฏิเสธ

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. การเคลมผูกกับการเซอร์วิส
-- ---------------------------------------------------------------------------

alter table insurance_claims
  add column if not exists service_visit_id bigint
    references service_visits(id) on delete cascade;

comment on column insurance_claims.service_visit_id is
  'การเซอร์วิสที่ใช้ประกันเคลมครั้งนี้ (0059). null = การเคลมที่บันทึกก่อนย้ายการเคลมไปที่การเซอร์วิส.';

create unique index if not exists insurance_claims_visit_uidx
  on insurance_claims (service_visit_id)
  where service_visit_id is not null;

/*
  เคลมได้ผ่านการเซอร์วิสเท่านั้น.

  Insert only: the claims already on file have no visit and must stay editable
  by nothing and deletable with their policy, as before. service_role passes,
  as in 0052/0057 — repair scripts have no visit to point at.
*/
create or replace function enforce_claim_through_visit()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.service_visit_id is null then
    raise exception 'บันทึกการเคลมประกันได้จากการเซอร์วิสเท่านั้น'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists insurance_claims_through_visit on insurance_claims;
create trigger insurance_claims_through_visit
  before insert on insurance_claims
  for each row execute function enforce_claim_through_visit();

-- ---------------------------------------------------------------------------
-- 2. บันทึกกรมธรรม์ — ไม่แตะการเคลมแล้ว
-- ---------------------------------------------------------------------------

/*
  `p_claims` stays in the signature so an older client calling it still works;
  it is ignored. Everything else is 0041's body, reproduced because
  `create or replace` replaces the whole function.
*/
create or replace function save_insurance_policy(
  p_id bigint,
  p_ticket_id text,
  p_policy jsonb,
  p_claims jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
begin
  if p_id is null then
    insert into insurance_policies (
      ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
      sold_at, starts_at, ends_at, notes, created_by
    ) values (
      p_ticket_id,
      coalesce(p_policy->>'plate', ''),
      coalesce(p_policy->>'planName', ''),
      coalesce((p_policy->>'price')::numeric, 0),
      coalesce((p_policy->>'bigPieces')::int, 0),
      coalesce((p_policy->>'smallPieces')::int, 0),
      coalesce(p_policy->>'terms', ''),
      coalesce((p_policy->>'soldAt')::date, current_date),
      (p_policy->>'startsAt')::date,
      (p_policy->>'endsAt')::date,
      coalesce(p_policy->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update insurance_policies set
      plate        = coalesce(p_policy->>'plate', ''),
      plan_name    = coalesce(p_policy->>'planName', ''),
      price        = coalesce((p_policy->>'price')::numeric, 0),
      big_pieces   = coalesce((p_policy->>'bigPieces')::int, 0),
      small_pieces = coalesce((p_policy->>'smallPieces')::int, 0),
      terms        = coalesce(p_policy->>'terms', ''),
      sold_at      = coalesce((p_policy->>'soldAt')::date, current_date),
      starts_at    = (p_policy->>'startsAt')::date,
      ends_at      = (p_policy->>'endsAt')::date,
      notes        = coalesce(p_policy->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. บันทึกการเซอร์วิส พร้อมการเคลม
-- ---------------------------------------------------------------------------

-- A new argument is a new signature; the four-argument one would stay callable
-- and never touch a claim, so it goes.
drop function if exists save_service_visit(bigint, text, jsonb, jsonb);

create or replace function save_service_visit(
  p_id bigint,
  p_ticket_id text,
  p_visit jsonb,
  p_points jsonb,
  -- { policyId, bigUsed, smallUsed, detail } — null or no policyId = no claim.
  p_claim jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
  v_no integer;
  v_plate text;
  v_policy insurance_policies%rowtype;
  v_policy_id bigint;
  v_day date;
  v_big integer;
  v_small integer;
  v_used_big integer;
  v_used_small integer;
  v_tech text;
begin
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('service_visit:' || p_ticket_id));
    select coalesce(max(visit_no), 0) + 1 into v_no
      from service_visits where ticket_id = p_ticket_id;

    insert into service_visits (
      ticket_id, visit_no, plate, received_at, received_time, delivered_at, delivered_time,
      sales_by, qc_by, technicians, film_product,
      customer_waits, overall_ok, checks, notes, created_by
    ) values (
      p_ticket_id,
      v_no,
      coalesce(p_visit->>'plate', ''),
      (p_visit->>'receivedAt')::date,
      coalesce(p_visit->>'receivedTime', ''),
      (p_visit->>'deliveredAt')::date,
      coalesce(p_visit->>'deliveredTime', ''),
      coalesce(p_visit->>'salesBy', ''),
      coalesce(p_visit->>'qcBy', ''),
      coalesce(p_visit->'technicians', '[]'::jsonb),
      coalesce(p_visit->>'filmProduct', ''),
      (p_visit->>'customerWaits')::boolean,
      (p_visit->>'overallOk')::boolean,
      coalesce(p_visit->'checks', '{}'::jsonb),
      coalesce(p_visit->>'notes', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update service_visits set
      plate            = coalesce(p_visit->>'plate', ''),
      received_at      = (p_visit->>'receivedAt')::date,
      received_time    = coalesce(p_visit->>'receivedTime', ''),
      delivered_at     = (p_visit->>'deliveredAt')::date,
      delivered_time   = coalesce(p_visit->>'deliveredTime', ''),
      sales_by         = coalesce(p_visit->>'salesBy', ''),
      qc_by            = coalesce(p_visit->>'qcBy', ''),
      technicians      = coalesce(p_visit->'technicians', '[]'::jsonb),
      film_product     = coalesce(p_visit->>'filmProduct', ''),
      customer_waits   = (p_visit->>'customerWaits')::boolean,
      overall_ok       = (p_visit->>'overallOk')::boolean,
      checks           = coalesce(p_visit->'checks', '{}'::jsonb),
      notes            = coalesce(p_visit->>'notes', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบใบเซอร์วิสที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  -- Replace the points wholesale; the form owns all ten rows at once.
  delete from service_visit_points where visit_id = v_id;
  insert into service_visit_points (visit_id, seq, "position", detail, note)
  select
    v_id,
    coalesce((pt->>'seq')::int, 0),
    coalesce(pt->>'position', ''),
    coalesce(pt->>'detail', ''),
    coalesce(pt->>'note', '')
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) as pt
  -- An empty row is a row the technician left blank; storing ten blanks per
  -- visit would bury the ones that say something.
  where coalesce(pt->>'position', '') <> ''
     or coalesce(pt->>'detail', '') <> ''
     or coalesce(pt->>'note', '') <> '';

  -- ---- เคลมประกันในการเซอร์วิสครั้งนี้ ----
  v_policy_id := nullif(coalesce(p_claim->>'policyId', ''), '')::bigint;
  if v_policy_id is null then
    -- Unticked: the visit no longer uses the cover, so its pieces come back.
    delete from insurance_claims where service_visit_id = v_id;
    return v_id;
  end if;

  -- Locked so two visits claiming at once cannot both spend the last piece.
  select * into v_policy from insurance_policies where id = v_policy_id for update;
  if not found then
    raise exception 'ไม่พบประกันที่เลือก' using errcode = 'P0002';
  end if;

  -- This car's cover only: sold on this ticket, or on another ticket for the
  -- same plate. A blank plate matches nothing but its own ticket.
  select plate into v_plate from service_visits where id = v_id;
  if v_policy.ticket_id <> p_ticket_id
     and (
       btrim(coalesce(v_plate, '')) = ''
       or regexp_replace(coalesce(v_policy.plate, ''), '\s', '', 'g')
          <> regexp_replace(v_plate, '\s', '', 'g')
     ) then
    raise exception 'ประกันที่เลือกไม่ใช่ของรถคันนี้' using errcode = '22023';
  end if;

  -- The cover period, read on the day the car came in.
  v_day := coalesce((p_visit->>'receivedAt')::date, current_date);
  if v_policy.starts_at is not null and v_day < v_policy.starts_at then
    raise exception 'ประกันยังไม่เริ่มคุ้มครองในวันที่รับรถ (เริ่ม %)',
      to_char(v_policy.starts_at, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if v_policy.ends_at is not null and v_day > v_policy.ends_at then
    raise exception 'ประกันหมดอายุก่อนวันที่รับรถ (สิ้นสุด %)',
      to_char(v_policy.ends_at, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  v_big := greatest(coalesce((p_claim->>'bigUsed')::int, 0), 0);
  v_small := greatest(coalesce((p_claim->>'smallUsed')::int, 0), 0);
  if v_big + v_small = 0 then
    raise exception 'ระบุจำนวนชิ้นที่เคลมอย่างน้อย 1 ชิ้น' using errcode = '22023';
  end if;

  -- What the policy has left, not counting this visit's own earlier claim.
  select coalesce(sum(big_used), 0), coalesce(sum(small_used), 0)
    into v_used_big, v_used_small
    from insurance_claims
   where policy_id = v_policy_id
     and service_visit_id is distinct from v_id;
  if v_used_big + v_big > v_policy.big_pieces
     or v_used_small + v_small > v_policy.small_pieces then
    raise exception 'เคลมเกินความคุ้มครองที่เหลือ (เหลือ % ชิ้นใหญ่, % ชิ้นเล็ก)',
      greatest(v_policy.big_pieces - v_used_big, 0),
      greatest(v_policy.small_pieces - v_used_small, 0)
      using errcode = '22023';
  end if;

  select coalesce(string_agg(x, ', '), '') into v_tech
    from jsonb_array_elements_text(coalesce(p_visit->'technicians', '[]'::jsonb)) as x;

  update insurance_claims set
    policy_id      = v_policy_id,
    claimed_at     = v_day,
    big_used       = v_big,
    small_used     = v_small,
    detail         = coalesce(p_claim->>'detail', ''),
    technician     = v_tech,
    received_at    = (p_visit->>'receivedAt')::date,
    received_time  = coalesce(p_visit->>'receivedTime', ''),
    delivered_at   = (p_visit->>'deliveredAt')::date,
    delivered_time = coalesce(p_visit->>'deliveredTime', '')
  where service_visit_id = v_id;

  if not found then
    insert into insurance_claims (
      policy_id, service_visit_id, claimed_at, big_used, small_used, detail, technician,
      received_at, received_time, delivered_at, delivered_time, created_by
    ) values (
      v_policy_id, v_id, v_day, v_big, v_small, coalesce(p_claim->>'detail', ''), v_tech,
      (p_visit->>'receivedAt')::date,
      coalesce(p_visit->>'receivedTime', ''),
      (p_visit->>'deliveredAt')::date,
      coalesce(p_visit->>'deliveredTime', ''),
      auth.uid()
    );
  end if;

  return v_id;
end;
$$;

revoke all on function save_service_visit(bigint, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function save_service_visit(bigint, text, jsonb, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0059', 'service_visit_claims') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0060.sql
-- ==========================================================================

-- supabase/release-0060.sql
--
-- วันที่รับเงินของใบงาน ต้องไม่ถูกเขียนทับเป็นวันนี้
--
-- รันต่อจาก release-0059.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace. การ update เติม uid แตะเฉพาะแถวที่ uid ยังว่าง จึงไม่เขียน
-- ทับของที่เติมไปแล้ว ไม่มีการแก้จำนวนเงินหรือวันที่ของข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * ทุกรายการรับเงินในใบงานมี uid ประจำตัว ที่อยู่รอดข้ามการกดบันทึก
--   * การบันทึกใบงานที่ไม่ได้ส่งวันที่รับเงินมา จะใช้วันที่เดิมของรายการนั้น
--     แทนที่จะย้ายเงินมาไว้วันที่ปัจจุบัน
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกัน — โค้ดใหม่เพิ่มช่อง "วันที่รับเงิน" ในแต่ละ
--     รายการ และส่ง uid มาด้วย โค้ดเดิมยังบันทึกได้ แต่จะไม่ส่ง uid จึงจับคู่
--     วันที่เดิมไม่ได้ (ตกไปใช้วันที่ที่ส่งมาเหมือนเดิม)

set search_path = pos, public, extensions;

-- ---- 1. กุญแจประจำรายการรับเงิน --------------------------------------------
alter table ticket_payments
  add column if not exists uid text not null default '';

comment on column ticket_payments.uid is
  'คีย์ประจำรายการรับเงินที่หน้าจอสร้างครั้งเดียวตอนเพิ่มแถว — save_ticket_children ลบแล้วเขียนใหม่ทุกครั้ง id จึงไม่คงที่ (0060).';

-- แถวก่อน 0060 ไม่มี uid ให้เติมให้ เพื่อให้การบันทึกครั้งถัดไปจับคู่วันที่เดิมได้
-- แทนที่จะตกไปเป็นวันนี้ ใช้ id เป็นฐานเพราะไม่ซ้ำอยู่แล้ว
update ticket_payments set uid = 'p' || id::text where uid = '';

create unique index if not exists ticket_payments_ticket_uid_key
  on ticket_payments (ticket_id, uid)
  where uid <> '';

comment on index ticket_payments_ticket_uid_key is
  'uid ต้องไม่ซ้ำในใบงานเดียวกัน — กัน payload ที่ส่ง uid ซ้ำเพื่อให้แถวใหม่สืบวันที่รับเงินของแถวเดิม (0060).';

-- ---- 2. บันทึกแล้ววันที่ต้องไม่หาย -----------------------------------------
-- เนื้อในเหมือน 0018 ทุกอย่าง (`create or replace` แก้ทีละบรรทัดไม่ได้ จึงต้อง
-- ยกมาทั้งก้อน รวมด่านล็อกใบงานจาก 0017 ด้วย) เพิ่มเฉพาะ uid และการจำวันที่เดิม
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
  v_prior_paid jsonb;
  v_dupe_count int;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — หน้าจอสร้าง uid ใหม่
  -- ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
  select count(*) into v_dupe_count
    from (
      select pay->>'uid' as uid
        from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
       where coalesce(pay->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;

  if v_dupe_count > 0 then
    raise exception 'รายการรับเงินมี uid ซ้ำกัน บันทึกไม่ได้';
  end if;

  -- วันที่ของสิ่งที่เก็บอยู่แล้ว คีย์ด้วย uid เก็บไว้ก่อนที่ delete ข้างล่างจะทิ้ง
  select coalesce(jsonb_object_agg(uid, paid_at), '{}'::jsonb)
    into v_prior_paid
    from ticket_payments
   where ticket_id = p_ticket_id and uid <> '';

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at, uid, attachments)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    -- วันที่ที่ส่งมา → วันที่เดิมของ uid นี้ → วันนี้. ลำดับกลางคือสิ่งที่ 0060
    -- เพิ่ม: การบันทึกที่ไม่ได้ส่งวันที่มา จะไม่ย้ายเงินมาไว้วันนี้อีกต่อไป
    coalesce(
      nullif(pay->>'paidAt', '')::date,
      (v_prior_paid ->> coalesce(pay->>'uid', ''))::date,
      current_date
    ),
    coalesce(pay->>'uid', ''),
    -- `jsonb_array_elements_text` over an absent key yields no rows, which
    -- aggregates to NULL — coalesce keeps the NOT NULL default shape.
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(pay->'attachments', '[]'::jsonb))),
      '{}'
    )
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0060', 'ticket_payment_date') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0061.sql
-- ==========================================================================

-- supabase/release-0061.sql
--
-- ประวัติการใช้งานทั้งระบบ
--
-- รันต่อจาก release-0060.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists / drop policy if exists /
-- drop trigger if exists ก่อนสร้างใหม่ / create or replace / ภาพตั้งต้นใช้
-- on conflict do nothing จึงไม่ทับภาพที่ trigger อัปเดตไปแล้ว
-- ไม่แก้ข้อมูลเดิมแม้แต่แถวเดียว
--
-- หลังรันไฟล์นี้:
--   * ทุกการสร้าง แก้ไข ลบ ในระบบถูกบันทึกลง activity_log ว่าใครทำ เมื่อไหร่
--     และค่าเดิมคืออะไร ประวัติเริ่มนับจากตอนรันไฟล์นี้ ย้อนหลังไม่ได้
--   * อ่านได้เฉพาะแอดมิน ไม่มีใครลบหรือแก้ได้ผ่านแอป
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกันเพื่อให้มีเมนู "ประวัติการใช้งาน" และปุ่ม
--     "ประวัติการแก้ไข" บนใบงาน — ถ้ารันไฟล์นี้ก่อน ประวัติก็เริ่มเก็บทันที
--     แค่ยังไม่มีหน้าให้ดู

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ตาราง
-- ---------------------------------------------------------------------------

create table if not exists activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- ธุรกรรมเดียวกัน = การกดบันทึกครั้งเดียว หน้าจอใช้จัดกลุ่ม
  tx bigint not null default txid_current(),
  actor uuid,
  -- ชื่อ ณ ตอนนั้น: ผู้ใช้ที่เปลี่ยนชื่อหรือถูกลบภายหลัง ประวัติต้องยังอ่านได้
  actor_name text not null default '',
  shop_id text,
  entity text not null,
  record_id text not null default '',
  -- เลขเอกสารที่คนใช้ค้น (JT-…, WS-…, POS-…) — การเซอร์วิสและประกันใช้เลข
  -- ใบงาน เพื่อให้ขึ้นอยู่ในประวัติของใบงานนั้นด้วย
  doc_ref text not null default '',
  action text not null check (action in ('สร้าง', 'แก้ไข', 'ลบ')),
  changes jsonb not null default '{}'::jsonb
);

comment on table activity_log is
  'ประวัติการใช้งานทั้งระบบ เขียนจาก trigger เท่านั้น อ่านได้เฉพาะแอดมิน (0061).';
comment on column activity_log.changes is
  'แก้ไข: {"ฟิลด์": [ค่าเดิม, ค่าใหม่]} เฉพาะที่เปลี่ยน · สร้าง/ลบ: ทั้งแถว · ชุดรายการ: {"ส่วน": [ชุดเดิม, ชุดใหม่]}';

create index if not exists activity_log_at_idx on activity_log (at desc);
create index if not exists activity_log_doc_idx on activity_log (doc_ref, at desc);
create index if not exists activity_log_actor_idx on activity_log (actor, at desc);
create index if not exists activity_log_shop_idx on activity_log (shop_id, at desc);

alter table activity_log enable row level security;

drop policy if exists activity_log_admin_read on activity_log;
create policy activity_log_admin_read on activity_log
  for select to authenticated
  using (current_user_role() = 'admin');

revoke insert, update, delete, truncate on activity_log from authenticated, anon;
grant select on activity_log to authenticated;

-- ภาพล่าสุดของแต่ละชุดรายการ ใช้เทียบเท่านั้น ไม่มีใครอ่านผ่าน API
create table if not exists activity_snapshots (
  kind text not null,
  key text not null,
  snapshot jsonb not null,
  primary key (kind, key)
);

alter table activity_snapshots enable row level security;
revoke all on activity_snapshots from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. ใครทำ
-- ---------------------------------------------------------------------------

create or replace function activity_actor_name(p_uid uuid) returns text
language sql stable security definer
set search_path = pos
as $$
  select case
    when p_uid is null then 'ระบบ'
    else coalesce((select name from app_users where id = p_uid), '')
  end;
$$;

revoke all on function activity_actor_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. แถวทั่วไป
-- ---------------------------------------------------------------------------

-- tg_argv = คอลัมน์ที่ไม่ต้องนับว่าเป็นการแก้ (นอกจาก updated_at ที่ข้ามเสมอ)
create or replace function log_row_activity() returns trigger
language plpgsql security definer
set search_path = pos
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['updated_at'] || coalesce(tg_argv::text[], '{}'::text[]);
  v_key text;
  v_action text;
  v_doc text;
  v_shop text;
  v_uid uuid := auth.uid();
begin
  v_row := coalesce(v_new, v_old);

  -- การเคลมที่ผูกกับการเซอร์วิส (0059) ถูกลบแล้วเขียนใหม่ทุกครั้งที่บันทึกการ
  -- เซอร์วิส จึงบันทึกเป็นส่วนหนึ่งของชุดการเซอร์วิสแทน (ข้อ 4)
  if tg_table_name = 'insurance_claims' and v_row->>'service_visit_id' is not null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key = any(v_ignore);
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes
          || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    -- กดบันทึกโดยไม่ได้เปลี่ยนอะไร ไม่ใช่กิจกรรม
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    v_action := 'แก้ไข';
  elsif tg_op = 'INSERT' then
    v_changes := v_new;
    v_action := 'สร้าง';
  else
    v_changes := v_old;
    v_action := 'ลบ';
  end if;

  v_doc := case tg_table_name
    when 'tickets' then v_row->>'id'
    when 'orders' then v_row->>'id'
    when 'expenses' then coalesce(nullif(v_row->>'doc_no', ''), v_row->>'id')
    when 'insurance_policies' then v_row->>'ticket_id'
    when 'service_visits' then v_row->>'ticket_id'
    when 'ticket_documents' then v_row->>'ticket_id'
    when 'insurance_claims' then
      (select ticket_id from insurance_policies where id = (v_row->>'policy_id')::bigint)
    when 'expense_attachments' then
      (select coalesce(nullif(doc_no, ''), id::text) from expenses
        where id = (v_row->>'expense_id')::bigint)
    when 'stock' then v_row->>'name'
    when 'app_users' then v_row->>'name'
    else coalesce(v_row->>'id', v_row->>'key', '')
  end;

  v_shop := coalesce(
    v_row->>'shop_id',
    case when v_row ? 'ticket_id' then
      (select shop_id from tickets where id = v_row->>'ticket_id') end,
    case when v_row ? 'order_id' then
      (select shop_id from orders where id = v_row->>'order_id') end,
    case when tg_table_name = 'insurance_claims' then
      (select t.shop_id from insurance_policies p join tickets t on t.id = p.ticket_id
        where p.id = (v_row->>'policy_id')::bigint) end,
    case when tg_table_name = 'expense_attachments' then
      (select shop_id from expenses where id = (v_row->>'expense_id')::bigint) end
  );

  insert into activity_log (actor, actor_name, shop_id, entity, record_id, doc_ref, action, changes)
  values (
    v_uid,
    activity_actor_name(v_uid),
    v_shop,
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'key', v_row->>'user_id', ''),
    coalesce(v_doc, ''),
    v_action,
    v_changes
  );
  return null;
end;
$$;

revoke all on function log_row_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ชุดรายการที่ลบแล้วเขียนใหม่ทั้งชุด
-- ---------------------------------------------------------------------------

-- ภาพของทั้งชุด ณ ตอนนี้ เลือกเฉพาะฟิลด์ที่คนอ่านแล้วเข้าใจ (ไม่เอา id ซึ่งเปลี่ยน
-- ทุกครั้งที่บันทึก) เรียงตาม id ซึ่งก็คือลำดับที่หน้าจอส่งมา
create or replace function activity_collection(p_kind text, p_key text) returns jsonb
language plpgsql stable security definer
set search_path = pos
as $$
begin
  if p_kind = 'ticket' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category', i.category,
          'booked', i.booked,
          'booked_price', i.booked_price,
          'sold', i.sold,
          'sold_price', i.sold_price,
          'interested', i.interested,
          'interested_price', i.interested_price,
          'discount_type', i.discount_type,
          'discount_value', i.discount_value,
          'actual_qty', i.actual_qty,
          'positions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', p."position", 'product', p.product, 'price', p.price
            ) order by p.id)
            from ticket_item_positions p where p.ticket_item_id = i.id
          ), '[]'::jsonb)
        ) order by i.id)
        from ticket_items i where i.ticket_id = p_key
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid,
          'type', type,
          'method', method,
          'amount', amount,
          'paid_at', paid_at,
          'slips', coalesce(array_length(attachments, 1), 0)
        ) order by id)
        from ticket_payments where ticket_id = p_key
      ), '[]'::jsonb)
    );
  elsif p_kind = 'order' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', name, 'qty', qty, 'list_price', list_price,
          'requested_price', requested_price, 'reason', reason
        ) order by id)
        from order_items where order_id = p_key
      ), '[]'::jsonb),
      'returns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'item_name', item_name, 'qty', qty, 'reason', reason,
          'returned_at', returned_at, 'received_at', received_at
        ) order by id)
        from order_returns where order_id = p_key
      ), '[]'::jsonb),
      'adjustments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'amount', amount, 'reason', reason,
          'adjusted_at', adjusted_at, 'status', status
        ) order by id)
        from order_adjustments where order_id = p_key
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'amount', amount, 'method', method, 'paid_at', paid_at,
          'status', status, 'cheque_no', cheque_no, 'cheque_bank', cheque_bank,
          'cheque_date', cheque_date, 'cleared_at', cleared_at, 'bounced_at', bounced_at
        ) order by id)
        from order_payments where order_id = p_key
      ), '[]'::jsonb)
    );
  elsif p_kind = 'service_visit' then
    return jsonb_build_object(
      'points', coalesce((
        select jsonb_agg(jsonb_build_object(
          'seq', seq, 'position', "position", 'detail', detail, 'note', note
        ) order by seq, id)
        from service_visit_points where visit_id = p_key::bigint
      ), '[]'::jsonb),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'policy_id', policy_id, 'big_used', big_used, 'small_used', small_used,
          'detail', detail, 'technician', technician
        ) order by id)
        from insurance_claims where service_visit_id = p_key::bigint
      ), '[]'::jsonb)
    );
  elsif p_kind = 'option_list' then
    return jsonb_build_object(
      'values', coalesce((
        select jsonb_agg(value order by sort_order, id)
        from option_lists
        where list_key = split_part(p_key, '|', 1)
          and coalesce(shop_id, '') = split_part(p_key, '|', 2)
      ), '[]'::jsonb)
    );
  elsif p_kind = 'user_shops' then
    return jsonb_build_object(
      'shops', coalesce((
        select jsonb_agg(shop_id order by shop_id)
        from user_shop_access where user_id::text = p_key
      ), '[]'::jsonb)
    );
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function activity_collection(text, text) from public, anon, authenticated;

-- ชุดไหน คีย์อะไร: เลือกจากคอลัมน์ของแถวที่ถูกแตะ
create or replace function activity_collection_key(p_kind text, p_row jsonb) returns text
language sql immutable
as $$
  select case p_kind
    when 'ticket' then p_row->>'ticket_id'
    when 'order' then p_row->>'order_id'
    when 'service_visit' then coalesce(p_row->>'visit_id', p_row->>'service_visit_id')
    when 'option_list' then (p_row->>'list_key') || '|' || coalesce(p_row->>'shop_id', '')
    when 'user_shops' then p_row->>'user_id'
  end;
$$;

create or replace function log_collection_activity() returns trigger
language plpgsql security definer
set search_path = pos
as $$
declare
  v_kind text := tg_argv[0];
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_key text;
  v_exists boolean := false;
  v_shop text;
  v_doc text;
  v_now jsonb;
  v_before jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_part text;
  v_uid uuid := auth.uid();
begin
  v_key := activity_collection_key(v_kind, v_row);
  -- การเคลมแบบเดิมที่ไม่ได้ผูกกับการเซอร์วิส ไม่มีชุดให้เข้า (ข้อ 3 ดูแลแล้ว)
  if v_key is null then
    return null;
  end if;

  if v_kind = 'ticket' then
    select true, shop_id, id into v_exists, v_shop, v_doc from tickets where id = v_key;
  elsif v_kind = 'order' then
    select true, shop_id, id into v_exists, v_shop, v_doc from orders where id = v_key;
  elsif v_kind = 'service_visit' then
    select true, t.shop_id, sv.ticket_id into v_exists, v_shop, v_doc
      from service_visits sv join tickets t on t.id = sv.ticket_id
     where sv.id = v_key::bigint;
  elsif v_kind = 'option_list' then
    v_exists := true;
    v_shop := nullif(split_part(v_key, '|', 2), '');
    v_doc := split_part(v_key, '|', 1);
  elsif v_kind = 'user_shops' then
    select true, name into v_exists, v_doc from app_users where id = v_key::uuid;
  end if;

  -- เอกสารถูกลบไปทั้งใบ: บรรทัดของตัวเอกสารเองบันทึกการลบไว้แล้ว ชุดรายการที่
  -- หายตามไปด้วยไม่ใช่การแก้อีกเรื่องหนึ่ง
  if not coalesce(v_exists, false) then
    delete from activity_snapshots where kind = v_kind and key = v_key;
    return null;
  end if;

  v_now := activity_collection(v_kind, v_key);
  select snapshot into v_before from activity_snapshots where kind = v_kind and key = v_key;

  -- ไม่มีอะไรเปลี่ยน หรือแถวอื่นในธุรกรรมเดียวกันบันทึกไปแล้ว
  if v_before is not distinct from v_now then
    return null;
  end if;

  for v_part in select jsonb_object_keys(v_now) loop
    if (v_before -> v_part) is distinct from (v_now -> v_part) then
      v_changes := v_changes
        || jsonb_build_object(v_part, jsonb_build_array(v_before -> v_part, v_now -> v_part));
    end if;
  end loop;

  insert into activity_log (actor, actor_name, shop_id, entity, record_id, doc_ref, action, changes)
  values (
    v_uid,
    activity_actor_name(v_uid),
    v_shop,
    v_kind || '_lines',
    v_key,
    coalesce(v_doc, ''),
    case when v_before is null then 'สร้าง' else 'แก้ไข' end,
    v_changes
  );

  insert into activity_snapshots (kind, key, snapshot) values (v_kind, v_key, v_now)
  on conflict (kind, key) do update set snapshot = excluded.snapshot;

  return null;
end;
$$;

revoke all on function log_collection_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. ติดตั้ง trigger
-- ---------------------------------------------------------------------------

do $$
declare
  v_spec record;
begin
  -- แถวทั่วไป: ชื่อตาราง และคอลัมน์ที่เปลี่ยนเองแล้วไม่นับ
  for v_spec in
    select * from (values
      ('tickets', array[]::text[]),
      ('orders', array[]::text[]),
      ('expenses', array[]::text[]),
      ('expense_attachments', array[]::text[]),
      ('stock', array['qty']),
      ('stock_batches', array['qty_remaining']),
      ('insurance_plans', array[]::text[]),
      ('insurance_policies', array[]::text[]),
      ('insurance_claims', array[]::text[]),
      ('service_visits', array[]::text[]),
      ('ticket_documents', array[]::text[]),
      ('money_accounts', array[]::text[]),
      ('money_transfers', array[]::text[]),
      ('money_reconciliations', array[]::text[]),
      ('petty_cash', array[]::text[]),
      ('withdrawals', array[]::text[]),
      ('retail_customers', array[]::text[]),
      ('wholesale_customers', array[]::text[]),
      ('corporate_buyers', array[]::text[]),
      ('app_users', array[]::text[]),
      ('roles', array[]::text[]),
      ('role_permissions', array[]::text[]),
      ('sales_people', array[]::text[]),
      ('shops', array[]::text[]),
      ('shop_info', array[]::text[]),
      ('statuses', array[]::text[]),
      ('ws_statuses', array[]::text[]),
      ('commission_rules', array[]::text[]),
      ('commission_rule_teams', array[]::text[]),
      ('price_matrix', array[]::text[]),
      ('film_price_matrix', array[]::text[]),
      ('car_models', array[]::text[])
    ) as t(tbl, ignore_cols)
  loop
    execute format('drop trigger if exists activity_log_row on pos.%I', v_spec.tbl);
    execute format(
      'create trigger activity_log_row after insert or update or delete on pos.%I '
      'for each row execute function pos.log_row_activity(%s)',
      v_spec.tbl,
      (select coalesce(string_agg(quote_literal(c), ', '), '') from unnest(v_spec.ignore_cols) c)
    );
  end loop;

  -- ชุดรายการ: ทำงานตอน commit
  for v_spec in
    select * from (values
      ('ticket_items', 'ticket'),
      ('ticket_payments', 'ticket'),
      ('order_items', 'order'),
      ('order_returns', 'order'),
      ('order_adjustments', 'order'),
      ('order_payments', 'order'),
      ('service_visit_points', 'service_visit'),
      ('insurance_claims', 'service_visit'),
      ('option_lists', 'option_list'),
      ('user_shop_access', 'user_shops')
    ) as t(tbl, kind)
  loop
    execute format('drop trigger if exists activity_log_lines on pos.%I', v_spec.tbl);
    execute format(
      'create constraint trigger activity_log_lines after insert or update or delete on pos.%I '
      'deferrable initially deferred for each row execute function pos.log_collection_activity(%L)',
      v_spec.tbl,
      v_spec.kind
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. ภาพตั้งต้นของทุกชุด ให้การแก้ครั้งแรกมีค่าเดิมให้เทียบ
-- ---------------------------------------------------------------------------
-- on conflict do nothing: รันซ้ำแล้วไม่ทับภาพที่ trigger อัปเดตไปแล้ว

insert into activity_snapshots (kind, key, snapshot)
select 'ticket', id, activity_collection('ticket', id) from tickets
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'order', id, activity_collection('order', id) from orders
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'service_visit', id::text, activity_collection('service_visit', id::text) from service_visits
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select distinct on (k) 'option_list', k, activity_collection('option_list', k)
from (select list_key || '|' || coalesce(shop_id, '') as k from option_lists) s
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'user_shops', id::text, activity_collection('user_shops', id::text) from app_users
on conflict (kind, key) do nothing;

insert into supabase_migrations.schema_migrations(version, name) values ('0061', 'activity_log') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0062.sql
-- ==========================================================================

-- supabase/release-0062.sql
--
-- บัญชีรับชำระบนใบแจ้งหนี้ (ขายส่ง) และใบเสนอราคา (Book งาน)
--
-- รันต่อจาก release-0061.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create or replace /
-- drop trigger if exists ก่อนสร้างใหม่ ไม่แก้ข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * PO และใบงานเก็บ "บัญชีรับชำระ" ได้ — แหล่งเงินของสาขาเดียวกันเท่านั้น
--   * ใบแจ้งหนี้พิมพ์บัญชีที่เลือก ถ้าไม่เลือกพิมพ์ช่องทางการชำระเงินของสาขาเหมือนเดิม
--   * ใบเสนอราคาพิมพ์บัญชีที่เลือก ถ้าไม่เลือกก็ไม่พิมพ์ (เหมือนเดิม)
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกัน โค้ดเดิมไม่รู้จักคอลัมน์นี้แต่ก็ไม่พัง
--   * ใส่ชื่อธนาคารและเลขบัญชีจริงของแต่ละแหล่งเงินได้ที่ การจัดการเงิน/บัญชี

set search_path = pos, public, extensions;

alter table orders
  add column if not exists pay_to_account_id bigint
    references money_accounts(id) on delete set null;

alter table tickets
  add column if not exists pay_to_account_id bigint
    references money_accounts(id) on delete set null;

comment on column orders.pay_to_account_id is
  'บัญชีที่พิมพ์ในใบแจ้งหนี้ให้ลูกค้าโอนเข้า — ต้องเป็นแหล่งเงินของสาขาเดียวกัน (0062).';
comment on column tickets.pay_to_account_id is
  'บัญชีที่พิมพ์ในใบเสนอราคาให้ลูกค้าโอนเข้า — ต้องเป็นแหล่งเงินของสาขาเดียวกัน (0062).';

create or replace function enforce_pay_to_account_shop() returns trigger
language plpgsql
set search_path = pos
as $$
begin
  if new.pay_to_account_id is not null and not exists (
    select 1 from money_accounts
     where id = new.pay_to_account_id and shop_id = new.shop_id
  ) then
    raise exception 'บัญชีรับชำระต้องเป็นแหล่งเงินของสาขาเดียวกับเอกสาร'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_pay_to_account_shop on orders;
create trigger orders_pay_to_account_shop
  before insert or update of pay_to_account_id, shop_id on orders
  for each row execute function enforce_pay_to_account_shop();

drop trigger if exists tickets_pay_to_account_shop on tickets;
create trigger tickets_pay_to_account_shop
  before insert or update of pay_to_account_id, shop_id on tickets
  for each row execute function enforce_pay_to_account_shop();

insert into supabase_migrations.schema_migrations(version, name) values ('0062', 'pay_to_account') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0063.sql
-- ==========================================================================

-- supabase/release-0063.sql
--
-- หมายเหตุ 2 แบบบน PO: สำหรับลูกค้า (พิมพ์ลงเอกสาร) และสำหรับร้าน (ไม่พิมพ์)
--
-- รันต่อจาก release-0062.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists ไม่แก้ข้อมูลเดิม หมายเหตุที่เขียน
-- ไว้แล้วยังเป็นหมายเหตุสำหรับร้านเหมือนเดิม ไม่ไปโผล่บนเอกสารลูกค้า

set search_path = pos, public, extensions;

alter table orders
  add column if not exists customer_note text not null default '';

comment on column orders.customer_note is
  'หมายเหตุสำหรับลูกค้า — พิมพ์ลงใบแจ้งหนี้ ใบส่งของ ใบเสร็จ และใบรับคืน (0063).';
comment on column orders.note is
  'หมายเหตุสำหรับร้าน — ภายในเท่านั้น ไม่พิมพ์ลงเอกสาร (0054, ความหมายยืนยันใน 0063).';

insert into supabase_migrations.schema_migrations(version, name) values ('0063', 'order_customer_note') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0064.sql
-- ==========================================================================

-- supabase/release-0064.sql
--
-- การชำระเงิน / แหล่งเงิน / ช่องทางการชำระเงิน เป็นรายการเดียวทุกโมดูล
--
-- รันต่อจาก release-0063.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create index if not exists / create or replace /
-- drop trigger if exists / add column if not exists การตั้งค่าเช็คให้รายการเก่า
-- แตะเฉพาะแถวที่ยังไม่ได้ตั้ง ไม่แก้จำนวนเงิน วันที่ หรือวิธีชำระของรายการเดิม
--
-- ถ้ารันแล้วขึ้นว่า "มีแหล่งเงินชื่อซ้ำกันในสาขาเดียวกัน" ให้เปลี่ยนชื่อแหล่งเงินที่
-- ซ้ำให้ไม่ซ้ำที่ การจัดการเงิน/บัญชี แล้วรันไฟล์นี้ใหม่
--
-- หลังรันไฟล์นี้ (ต้องขึ้นโค้ดชุดใหม่พร้อมกัน):
--   * วิธีชำระในใบงาน วิธีชำระในขายส่ง และจ่ายจากในค่าใช้จ่าย เลือกจากแหล่งเงิน
--     ของสาขานั้นเท่านั้น เงินเข้าบัญชีที่เลือกตรง ๆ
--   * เช็คในขายส่งเป็นช่องติ๊กของตัวเอง รายการเก่าที่วิธีชำระมีคำว่าเช็ค ถูกตั้งให้แล้ว
--   * เปลี่ยนชื่อแหล่งเงินแล้ว รายการเก่ายังนับเข้าบัญชีเดิม
--   * ควรตั้งชื่อแหล่งเงินของทุกสาขาให้อ่านรู้เรื่องก่อนใช้ เพราะเป็นคำที่พนักงาน
--     เลือกทุกวันและพิมพ์บนใบเสร็จ

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ชื่อแหล่งเงินห้ามซ้ำในสาขาเดียวกัน
-- ---------------------------------------------------------------------------
-- ไม่รวมให้เอง: สองบัญชีชื่อเดียวกันอาจมียอดตั้งต้นต่างกัน ต้องมีคนตัดสินใจ
do $$
declare
  v_dupes text;
begin
  select string_agg(distinct shop_id || ': ' || name, ', ')
    into v_dupes
    from (
      select shop_id, name, count(*) over (partition by shop_id, lower(btrim(name))) as n
        from money_accounts
    ) d
   where n > 1;
  if v_dupes is not null then
    raise exception
      'มีแหล่งเงินชื่อซ้ำกันในสาขาเดียวกัน: %. เปลี่ยนชื่อให้ไม่ซ้ำที่ การจัดการเงิน/บัญชี ก่อน แล้วรันไฟล์นี้ใหม่',
      v_dupes;
  end if;
end;
$$;

create unique index if not exists money_accounts_shop_name_key
  on money_accounts (shop_id, lower(btrim(name)));

comment on index money_accounts_shop_name_key is
  'ชื่อแหล่งเงินห้ามซ้ำในสาขา — ชื่อคือตัวเชื่อมรายการรับ/จ่ายเงินเข้ากับบัญชี (0064).';

-- ---------------------------------------------------------------------------
-- 2. เปลี่ยนชื่อแล้ว ชื่อเดิมยังพาเงินเก่ามาที่บัญชีนี้
-- ---------------------------------------------------------------------------
create or replace function keep_old_money_account_name() returns trigger
language plpgsql
set search_path = pos
as $$
begin
  if btrim(old.name) <> btrim(new.name)
     and not (btrim(old.name) = any (coalesce(new.match_names, '{}'))) then
    new.match_names := coalesce(new.match_names, '{}') || btrim(old.name);
  end if;
  return new;
end;
$$;

drop trigger if exists money_accounts_keep_old_name on money_accounts;
create trigger money_accounts_keep_old_name
  before update of name on money_accounts
  for each row execute function keep_old_money_account_name();

-- ---------------------------------------------------------------------------
-- 3. เช็คเป็นช่องของตัวเอง
-- ---------------------------------------------------------------------------
alter table order_payments
  add column if not exists is_cheque boolean not null default false;

comment on column order_payments.is_cheque is
  'ชำระด้วยเช็ค — แยกจาก method ซึ่งตั้งแต่ 0064 คือชื่อแหล่งเงินที่เงินจะเข้า.';

-- รายการเก่า: วิธีชำระมีคำว่าเช็ค หรือกรอกข้อมูลเช็คไว้
update order_payments
   set is_cheque = true
 where not is_cheque
   and (method like '%เช็ค%' or cheque_no <> '' or cheque_bank <> '' or cheque_date is not null);

-- save_order_children: เหมือน 0054 ทุกอย่าง (`create or replace` เขียนทับทั้ง
-- ฟังก์ชัน จึงยกมาทั้งก้อน รวมด่าน uid ซ้ำจาก 0049) เพิ่มเฉพาะ is_cheque
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
  v_prior_adj jsonb;
  v_prior_ret jsonb;
  v_dupe_count int;
begin
  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — ฝั่งหน้าจอสร้าง uid
  -- ใหม่ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
  select count(*) into v_dupe_count
    from (
      select pay->>'uid' as uid
        from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
       where coalesce(pay->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;
  if v_dupe_count > 0 then
    raise exception 'รายการรับเงินมี uid ซ้ำกัน บันทึกไม่ได้';
  end if;
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'approved_at', approved_at,
        'approved_by', approved_by,
        'reject_note', reject_note
      )
    ),
    '{}'::jsonb
  )
  into v_prior_adj
  from order_adjustments
  where order_id = p_order_id and uid <> '';

  -- การยืนยันรับของคืน และการคืนสต๊อก ต้องอยู่รอดข้ามการบันทึก.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'received_at', received_at,
        'received_by', received_by,
        'stock_returned_at', stock_returned_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior_ret
  from order_returns
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (
    order_id, item_name, qty, reason, returned_at, uid,
    received_at, received_by, stock_returned_at
  )
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on),
    coalesce(r->>'uid', ''),
    -- From the database, never from the caller.
    (prior_ret.v->>'received_at')::date,
    (prior_ret.v->>'received_by')::uuid,
    (prior_ret.v->>'stock_returned_at')::timestamptz
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r
  left join lateral (
    select v_prior_ret -> coalesce(r->>'uid', '') as v
  ) as prior_ret on true;

  insert into order_adjustments (
    order_id, amount, reason, adjusted_at, uid,
    status, approved_at, approved_by, reject_note
  )
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on),
    coalesce(a->>'uid', ''),
    coalesce(prior_adj.v->>'status', 'รออนุมัติ'),
    (prior_adj.v->>'approved_at')::date,
    (prior_adj.v->>'approved_by')::uuid,
    coalesce(prior_adj.v->>'reject_note', '')
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a
  left join lateral (
    select v_prior_adj -> coalesce(a->>'uid', '') as v
  ) as prior_adj on true;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date, is_cheque,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    coalesce((pay->>'isCheque')::boolean, false),
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0064', 'one_money_list') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0065.sql
-- ==========================================================================

-- supabase/release-0065.sql
--
-- ของเก่าที่ 0054 ตกหล่น — PO ที่ตัดสต๊อกไปแล้ว และการรับคืนที่ไม่มี uid
--
-- รันต่อจาก release-0064.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: แตะเฉพาะแถวที่ยังไม่ได้ตั้ง
--
-- ไฟล์นี้แก้สองเรื่องที่ 0054 พลาดกับข้อมูลจริง:
--   * PO ที่สถานะสุดท้ายชื่อ เสร็จสิ้น (ไม่ใช่ ปิดงานแล้ว) และ PO ที่ยังไม่ส่ง
--     แต่ระบบเก่าตัดสต๊อกไปแล้ว ถูกบันทึกว่าตัดสต๊อกแล้ว — ไม่ตัดซ้ำตอนส่ง
--   * การรับคืนเก่าได้ uid ของตัวเอง — บันทึก PO แล้วสถานะรับของคืนไม่หาย
--
-- ถ้าระบบเก่ายังเปิดใช้อยู่ระหว่างรัน 0054 ถึงไฟล์นี้ ไฟล์นี้ตามเก็บให้ด้วย

set search_path = pos, public, extensions;

update orders o
set stock_deducted_at = now()
where o.stock_deducted_at is null
  and (
    o.status not in ('รออนุมัติราคา', 'รอจัดส่ง')
    or exists (
      select 1
        from stock_movements m
       where m.document_id = o.id
         and m.kind = 'ขายส่ง'
    )
  );

update order_returns
set uid = 'r' || id,
    received_at = coalesce(received_at, returned_at),
    stock_returned_at = coalesce(stock_returned_at, now())
where uid = '';

insert into supabase_migrations.schema_migrations(version, name) values ('0065', 'legacy_stock_stamps') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/release-0066.sql
-- ==========================================================================

-- supabase/release-0066.sql
--
-- โมดูล รายงานการเงินรายวัน
--
-- รันต่อจาก release-0065.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: on conflict do nothing / create or replace function
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- โมดูล รายงานการเงินรายวัน
--
-- The owners asked for the daily financial report as a module of its own in the
-- POS (24 ก.ย. 2569): one sign-in, and seen by แอดมิน and ผู้บริหาร only. A nav
-- key is the gate that does that. It is its own key, not `money`, so the shop
-- can hand the report to someone without the money register, or the other way
-- round, in จัดการสิทธิ์.
--
-- Seeded for แอดมิน and ผู้บริหาร only. Nobody loses anything: the module is new.

set search_path = pos, public, extensions;

insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'nav', 'dailyReport', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

/*
  `reset_permissions_to_defaults()` rebuilt to carry the new nav key. A reset
  that dropped it would hide the report from everyone, the owners included.
  Everything else here is 0048 unchanged; `create or replace` cannot patch one
  statement.
*/
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','money',true), ('admin','nav','dailyReport',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','money',true), ('exec','nav','dailyReport',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','money',false), ('sales','nav','dailyReport',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','money',false), ('tech','nav','dailyReport',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','branchCompare',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','branchCompare',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','branchCompare',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','branchCompare',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),('wholesale.confirmPayment'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.confirmPayment',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.confirmPayment',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0066', 'daily_report_module') on conflict (version) do nothing;


-- ==========================================================================
-- supabase/repair-categories-and-services.sql
-- ==========================================================================

-- supabase/repair-categories-and-services.sql
--
-- ซ่อมข้อมูลครั้งเดียว รันหลัง release-0019.sql
--
-- ตรวจก่อนรัน: supabase/check-orphan-categories.sql (อ่านอย่างเดียว)
--
-- ไฟล์นี้ทำ 2 อย่าง แยกส่วนกันชัดเจน อ่านทีละส่วนได้
--
--   ส่วน ก — เก็บ "ชนิดสินค้า" ที่มีสินค้าใช้อยู่จริงแต่ไม่อยู่ในรายการตัวเลือก
--            เข้ารายการให้ครบ (เช่น จอ) หลังจากนี้ใบงานถึงจะเลือกชนิดนั้นได้
--
--   ส่วน ข — ย้าย "งานบริการ" จากรายการตัวเลือกเข้าไปเป็นสินค้าในสต็อก
--            เพราะช่องชื่อสินค้าในใบงานดึงจากสต็อกอย่างเดียวแล้ว
--
-- ปลอดภัยเมื่อรันซ้ำ: ทั้งสองส่วนข้ามรายการที่มีอยู่แล้ว
-- ไม่มีการลบหรือแก้ไขข้อมูลเดิม มีแต่การเพิ่ม

set search_path = pos, public, extensions;

-- ===========================================================================
-- ก) ชนิดสินค้าที่ค้างอยู่ -> เข้ารายการตัวเลือก
-- ===========================================================================
insert into option_lists (list_key, value, shop_id, sort_order)
select
  'product_categories',
  s.category,
  null,
  (select coalesce(max(sort_order), 0) from option_lists
    where list_key = 'product_categories' and shop_id is null)
    + row_number() over (order by s.category)
from (
  select distinct btrim(category) as category
  from stock
  where btrim(coalesce(category, '')) <> ''
) s
where not exists (
  select 1 from option_lists o
  where o.list_key = 'product_categories' and btrim(o.value) = s.category
);

-- ===========================================================================
-- ข) งานบริการ -> เป็นสินค้าในสต็อก (ทุกสาขา)
-- ===========================================================================
--
-- ทำไมต้องทุกสาขา: ช่องเลือกสินค้าในใบงานจะขึ้นสินค้าของสาขาอื่นแบบจาง ๆ พร้อม
-- ป้าย "ไม่มีในสาขานี้" ถ้าใส่ให้สาขาเดียว อีก 4 สาขาจะเห็นบริการเป็นของสาขาอื่น
-- ซึ่งไม่จริง — ทุกสาขาให้บริการเหล่านี้ได้เอง
--
-- qty/min_qty = 0 เพราะบริการไม่ใช่ของที่นับสต็อกได้
-- ราคา = 0 ให้พนักงานกรอกราคาจริงในใบงาน (ระบบจะจำราคาต่อประเภทรถให้เอง)
--
-- SKU: SRV-<รหัสสาขา>-<ลำดับ> เช่น SRV-CM-01

/*
  แก้ 2026-09-11 ตอนขึ้นระบบจริง — รุ่นก่อนหน้าพังสองทาง

  1) SKU ชนกัน. เลขลำดับมาจาก row_number() ซึ่งเริ่มนับหนึ่งใหม่ทุกครั้ง ไม่ได้ดู
     ว่าสาขานั้นใช้เลขไหนไปแล้ว พอรันรอบสองจึงชน:
       ERROR: duplicate key value violates unique constraint "stock_sku_key"
       DETAIL: Key (sku)=(SRV-CA-07) already exists.
     ตอนนี้เริ่มนับต่อจากเลขสูงสุดที่สาขานั้นใช้ไปแล้ว

  2) กันซ้ำผิดคีย์. ของเดิมเช็ค name + category = 'งานบริการ' แต่ดัชนีที่บังคับ
     ความไม่ซ้ำคือ stock_shop_name_key บน (shop_id, name) ซึ่งไม่สนใจ category
     ที่ Central Audio มีสองแถวที่ทีมงานย้ายไปหมวด 'จอ' แล้ว (SRV-CA-07, 09)
     ของเดิมจึงมองไม่เห็น และจะแทรกชื่อเดิมซ้ำเข้าไปอีก ทำให้ล้มที่ชื่อแทน
     ตอนนี้เช็คแค่ (สาขา, ชื่อ) — ใครย้ายหมวดไว้แล้วก็ปล่อยไว้อย่างนั้น ช่องเลือก
     สินค้าในใบงานอ่านจากสต็อกด้วยชื่อ ของที่ย้ายหมวดแล้วจึงยังเลือกได้ตามปกติ

  3) รวมค่าซ้ำใน option_lists ก่อน. ของเดิมไม่ได้กรอง shop_id ของ option_lists
     ถ้ามีรายการชื่อเดียวกันทั้งแบบรวมและแบบเฉพาะสาขา cross join จะได้ชื่อซ้ำ
     แล้วชนกับ stock_shop_name_key เอง
*/
with service_items as (
  select btrim(o.value) as value, min(o.sort_order) as sort_order
  from option_lists o
  where o.list_key = 'service_items'
    and btrim(coalesce(o.value, '')) <> ''
  group by btrim(o.value)
)
insert into stock (sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price)
select
  'SRV-' || upper(sh.id) || '-' || lpad(
    (taken.n + row_number() over (partition by sh.id order by i.sort_order))::text, 2, '0'),
  i.value,
  i.value,
  'งานบริการ',
  sh.id,
  0,
  0,
  0,
  0
from service_items i
cross join shops sh
-- เลขสูงสุดที่สาขานี้ใช้ไปแล้ว อ่านครั้งเดียวต่อสาขา แถวที่กำลังแทรกยังมองไม่เห็น
-- ตัวเอง เลขจึงเดินต่อจากของเดิมโดยไม่ชนกัน
cross join lateral (
  select coalesce(max(split_part(st.sku, '-', 3)::int), 0) as n
  from stock st
  where st.shop_id = sh.id
    and st.sku ~ ('^SRV-' || upper(sh.id) || '-[0-9]+$')
) as taken
where not exists (
  select 1 from stock st
  where st.shop_id = sh.id
    and btrim(st.name) = i.value
);-- ===========================================================================
-- ตรวจผล
-- ===========================================================================

-- ชนิดสินค้าทั้งหมดในรายการตอนนี้
select value as ชนิดสินค้า, sort_order
from option_lists
where list_key = 'product_categories' and shop_id is null
order by sort_order;

-- ยังมีสินค้าที่ชนิดไม่อยู่ในรายการอีกไหม (ควรเป็น 0)
select count(*) as still_off_list
from stock s
where btrim(coalesce(s.category, '')) <> ''
  and not exists (
    select 1 from option_lists o
    where o.list_key = 'product_categories' and btrim(o.value) = btrim(s.category)
  );

-- งานบริการที่เลือกได้ในใบงาน แยกตามสาขา
select sh.name as สาขา, count(*) as บริการ
from stock st
join shops sh on sh.id = st.shop_id
where st.category = 'งานบริการ'
group by sh.name
order by sh.name;
