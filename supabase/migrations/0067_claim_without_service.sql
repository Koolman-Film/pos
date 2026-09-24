-- supabase/migrations/0067_claim_without_service.sql
--
-- เคลมประกันโดยไม่ต้องเป็นรอบเซอร์วิส (ร้านขอ 24 ก.ย. 2569)
--
-- 0059 moved การเคลม onto the service visit, because a claim and a visit were
-- two records of the same afternoon: the car comes in for its เซอร์วิส,
-- something is wrong, the cover pays for it. That was right about the common
-- case and wrong as a rule. The shop says a claim is not always part of a
-- service, and three things were broken by assuming it was:
--
--   1. ประกัน sold without a Service package had nowhere to record a claim at
--      all — the claim form lives inside the Service extra.
--   2. A car coming in ONLY to have a claimed piece replaced burned one of the
--      customer's paid-for service visits, because every visit counts toward
--      "ใช้ไป X / Y ครั้ง". That is the customer's money.
--   3. A claim made on a different day from a scheduled visit had to be
--      squeezed into that visit, so the date on the ใบเคลม was not the day it
--      happened.
--
-- WHAT CHANGES. A visit gains a `kind`: เซอร์วิส, as every visit has been, or
-- เคลมประกัน. A เคลมประกัน visit is a real visit — it records who did the work,
-- on what day, to which panel, and it still owns its claim exactly as 0059 set
-- up — but it is NOT one of the visits the customer bought, so it is numbered
-- in its own sequence and never counted against the package.
--
-- WHAT DOES NOT CHANGE. A claim still belongs to a visit
-- (`insurance_claims_through_visit` stays), so there is still no such thing as
-- a claim with nobody's name and no date on it, which is what 0059 was for.
-- Claims recorded before this, and every existing visit, are เซอร์วิส — the
-- default — so nothing already on file moves.

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ชนิดของการเข้ารับบริการ
-- ---------------------------------------------------------------------------

alter table service_visits
  add column if not exists kind text not null default 'เซอร์วิส';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.service_visits'::regclass and conname = 'service_visits_kind_check'
  ) then
    alter table service_visits
      add constraint service_visits_kind_check check (kind in ('เซอร์วิส', 'เคลมประกัน'));
  end if;
end $$;

comment on column service_visits.kind is
  'เซอร์วิส = ครั้งที่นับในแพ็กเกจที่ลูกค้าซื้อ · เคลมประกัน = มาเคลมอย่างเดียว ไม่กินสิทธิ์ (0067)';

/*
  เลขครั้งที่ แยกลำดับกันคนละชนิด.

  `unique (ticket_id, visit_no)` (0020) stopped two people filing "ครั้งที่ 3"
  for the same job, and it still must. But เซอร์วิสครั้งที่ 1 and
  เคลมประกันครั้งที่ 1 are different things on the same ticket, and the service
  numbers have to stay 1..N or they no longer line up with นัดเข้า Service.
  So the pair becomes a triple.
*/
alter table service_visits drop constraint if exists service_visits_ticket_id_visit_no_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.service_visits'::regclass
       and conname = 'service_visits_ticket_kind_no_key'
  ) then
    alter table service_visits
      add constraint service_visits_ticket_kind_no_key unique (ticket_id, kind, visit_no);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. บันทึกใบเซอร์วิส — รับชนิดมาด้วย
-- ---------------------------------------------------------------------------

/*
  0059's body, with two changes: the kind is read from the payload, and a new
  visit's number counts within its OWN kind. Reproduced in full because
  `create or replace function` replaces the whole thing — every check 0059 put
  on the cover is still here, unchanged.
*/
create or replace function save_service_visit(
  p_id bigint,
  p_ticket_id text,
  p_visit jsonb,
  p_points jsonb,
  -- { policyId, bigUsed, smallUsed, detail } — null or no policyId = no claim.
  -- The default is 0059's and must be repeated: dropping it is refused.
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
  v_kind text;
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
  -- Anything the client does not say is a เซอร์วิส, which is what every visit
  -- written before this migration was.
  v_kind := coalesce(nullif(p_visit->>'kind', ''), 'เซอร์วิส');
  if v_kind not in ('เซอร์วิส', 'เคลมประกัน') then
    raise exception 'ชนิดการเข้ารับบริการไม่ถูกต้อง' using errcode = '22023';
  end if;

  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('service_visit:' || p_ticket_id || '|' || v_kind));
    select coalesce(max(visit_no), 0) + 1 into v_no
      from service_visits where ticket_id = p_ticket_id and kind = v_kind;

    insert into service_visits (
      ticket_id, visit_no, kind, plate, received_at, received_time, delivered_at, delivered_time,
      sales_by, qc_by, technicians, film_product,
      customer_waits, overall_ok, checks, notes, created_by
    ) values (
      p_ticket_id,
      v_no,
      v_kind,
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
    -- `kind` is deliberately NOT updated: a visit that has been recorded as one
    -- of the package's ครั้งที่ N cannot quietly become a free claim visit, or
    -- the other way round, and leave the numbering behind it wrong.
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

    select kind into v_kind from service_visits where id = v_id;
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

  -- ---- เคลมประกันในการเข้ารับบริการครั้งนี้ ----
  v_policy_id := nullif(coalesce(p_claim->>'policyId', ''), '')::bigint;
  if v_policy_id is null then
    -- A เคลมประกัน visit with no claim is a record of nothing: it does not
    -- count as a service, and without the claim it says nothing happened.
    if v_kind = 'เคลมประกัน' then
      raise exception 'งานเคลมประกันต้องระบุประกันที่ใช้เคลม' using errcode = '22023';
    end if;
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
