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
  and not exists (select 1 from insurance_policies p where p.ticket_id = i.ticket_id);

delete from ticket_items where category = 'ประกัน';

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
