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
