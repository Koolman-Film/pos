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
update service_visits
   set film_product = trim(
         concat_ws(' ', nullif(film_type, ''), nullif(film_thickness, ''), nullif(film_colour_code, ''))
       )
 where film_product = ''
   and (film_type <> '' or film_thickness <> '' or film_colour_code <> '');

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
