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
