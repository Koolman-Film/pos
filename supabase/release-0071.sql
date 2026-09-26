-- supabase/release-0071.sql
--
-- ค่าประกันมีการรับเงินของตัวเอง
--
-- รันต่อจาก release-0070.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์แบบ if not exists และ create or replace function
--
-- หลังรันไฟล์นี้ กรมธรรม์รับเงินของตัวเองได้ ในบล็อกประกันของใบงาน
-- ใช้ได้แม้ใบงานปิดและชำระค่าสินค้าครบไปแล้ว ซึ่งเป็นเคสที่พบบ่อยที่สุด
-- กรมธรรม์เก่ามี paid_amount = 0 ซึ่งตรงกับความจริง: ยังไม่เคยมีใครบันทึกว่ารับเงินมา

--
-- ค่าประกันมีการรับเงินของตัวเอง
--
-- ขายประกัน 6,000 แล้วไม่มีอะไรขยับ: ยอดของใบงานไม่เปลี่ยน ไม่มีแถวรับเงิน เงิน
-- ไม่เข้ายอดคงเหลือของแหล่งเงินไหน และไม่โผล่ในยอดขายบนแดชบอร์ด ซึ่งนับเงินที่
-- รับมาจริง ส่วนรายงานรายได้นับมันอยู่ เพราะเบี้ยเป็นรายได้ของวันที่ขาย สองฝั่ง
-- จึงต่างกันเท่ากับค่าประกันทุกฉบับที่เคยขายมา (ร้านแจ้ง 26 ก.ย. 2569)
--
-- WHY NOT ON THE TICKET. The obvious repair is to add the premium to what the
-- ticket is owed and collect it with everything else — and it is wrong, for a
-- reason the shop gave: a job is often delivered, paid in full and LOCKED, and
-- the customer comes back weeks later to buy the cover. Adding the premium to
-- that ticket reopens a balance on a closed record, and the lock then refuses
-- the very payment that would clear it: `ticket_payments` cannot be written on
-- a locked ticket (0017). The debt would be visible and uncollectable.
--
-- It is also the wrong shape. A policy already has its own sale date, its own
-- ใบเสร็จ and its own row (0023) — everything except somewhere to record the
-- money. So that is what it gets, and nothing about the goods moves:
--
--   * a closed, fully-paid ticket stays closed and fully paid;
--   * the premium is received on ITS day, into ITS แหล่งเงิน;
--   * the policy stays attached to the ticket that sold the car (ร้านยืนยัน
--     26 ก.ย. 2569) — this is a payment of its own, not a ticket of its own.
--
-- ของเดิมไม่ขยับ: every policy already written keeps `paid_amount` 0, which is
-- the truth about it — nobody recorded receiving that money, and this is the
-- first release where they could.

set search_path = pos, public, extensions;

alter table insurance_policies
  -- ยอดที่รับมาแล้ว. Separate from `price` so a part payment is expressible,
  -- and so "sold for 6,000, nothing received" is a state the report can show.
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  -- วันที่เงินเข้า — ยอดขายบนแดชบอร์ดนับตามวันนี้ ไม่ใช่วันที่ขายกรมธรรม์
  add column if not exists paid_at date,
  -- แหล่งเงินที่เงินเข้า, as free text like every other payment: matched to an
  -- account by name and `match_names` (see components/dashboard/moneyFlow.ts).
  add column if not exists paid_method text not null default '';

comment on column insurance_policies.paid_amount is
  'ยอดค่าประกันที่รับเงินมาแล้ว (0071). 0 = ยังไม่ได้รับเงิน';
comment on column insurance_policies.paid_at is
  'วันที่รับเงินค่าประกัน — ยอดขายบนแดชบอร์ดนับตามวันนี้ ไม่ใช่ sold_at';
comment on column insurance_policies.paid_method is
  'แหล่งเงินที่รับค่าประกันเข้า — จับคู่กับ money_accounts ด้วยชื่อ เหมือน ticket_payments.method';

create index if not exists insurance_policies_paid_idx
  on insurance_policies (paid_at)
  where paid_at is not null;

/*
  `save_insurance_policy` carries the three new fields.

  0059's body — which stopped touching the claims, because a claim is made at
  a service visit — with the payment added and nothing else changed.
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
      sold_at, starts_at, ends_at, notes, created_by,
      paid_amount, paid_at, paid_method
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
      auth.uid(),
      greatest(coalesce((p_policy->>'paidAmount')::numeric, 0), 0),
      (p_policy->>'paidAt')::date,
      coalesce(p_policy->>'paidMethod', '')
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
      notes        = coalesce(p_policy->>'notes', ''),
      paid_amount  = greatest(coalesce((p_policy->>'paidAmount')::numeric, 0), 0),
      paid_at      = (p_policy->>'paidAt')::date,
      paid_method  = coalesce(p_policy->>'paidMethod', '')
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  -- การเคลมไม่ได้เขียนที่นี่ (0059): a claim is made at the service visit it
  -- happened on, and replacing the list here would delete those every time a
  -- policy was edited. `p_claims` stays in the signature for older callers.
  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

select 'release-0071 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0071', 'insurance_payment') on conflict (version) do nothing;
