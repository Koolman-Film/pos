-- supabase/migrations/0059_service_visit_claims.sql
--
-- เคลมประกันผ่านการเซอร์วิส (ร้านขอ 17 ก.ย. 2569)
--
-- A claim and a service visit were two records of the same afternoon: the car
-- comes in for its เซอร์วิส, something is wrong, the cover pays for it. They were
-- entered in two places — the claim under the policy, the visit under the
-- Service extra — with the dates and the technician typed twice and nothing
-- saying the two belonged together.
--
-- Now a claim is made FROM a visit:
--   1. `insurance_claims.service_visit_id` ties the claim to the visit it was
--      made at, one claim per visit; deleting the visit takes its claim with it,
--      which gives the pieces back to the policy.
--   2. `save_service_visit` takes the claim with the visit and stores both in
--      one transaction. The claim's dates and technician are the visit's.
--   3. The cover is checked there, where it cannot be walked around: the policy
--      must be this car's, the visit day inside the cover period, and the pieces
--      within what is left. The rules themselves are the policy's as before.
--   4. A claim can no longer be written on its own. `save_insurance_policy`
--      stops replacing the claim list (it would delete visit claims every time a
--      policy was edited), and a trigger refuses a claim row with no visit.
--      Claims recorded before this stay exactly as they are.
--
-- Counting: a visit with a claim is still one เซอร์วิส (`visit_no` as always).

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
