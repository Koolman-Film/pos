-- supabase/migrations/0041_claim_visit_dates.sql
--
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
  add column received_at date,
  add column received_time text not null default '',
  add column delivered_at date,
  add column delivered_time text not null default '';

comment on column insurance_claims.received_at is
  'วันที่รับรถเข้าเคลม — the day the customer actually brought the car in, not the day the film was fitted.';

-- The dashboard windows appointments on this, so the lookup is by date.
create index insurance_claims_received_idx on insurance_claims (received_at)
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
