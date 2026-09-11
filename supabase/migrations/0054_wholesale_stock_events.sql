-- supabase/migrations/0054_wholesale_stock_events.sql
--
-- สต๊อกขายส่งเคลื่อนตามเหตุการณ์จริง และการรับคืนต้องยืนยันก่อน
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
  add column stock_deducted_at timestamptz,
  -- หมายเหตุของ PO — free text for whatever the sale needs to pass on.
  add column note text not null default '';

comment on column orders.stock_deducted_at is
  'เวลาที่ตัดสต๊อกออกไปจริง — null คือยังไม่ได้ตัด. กันการตัดซ้ำเมื่อบันทึก PO ใหม่.';

alter table order_returns
  -- Stable across the delete-and-reinsert in `save_order_children`, exactly as
  -- on payments (0048) and adjustments (0051): the confirmation must survive the
  -- next save of the PO, and the database id does not.
  add column uid text not null default '',
  -- ยืนยันว่าได้รับของคืนแล้ว. Null = agreed but not yet in our hands.
  add column received_at date,
  add column received_by uuid references auth.users(id),
  -- คืนสต๊อกกลับไปแล้วหรือยัง — same idempotence guard as above.
  add column stock_returned_at timestamptz;

comment on column order_returns.received_at is
  'วันที่ยืนยันว่าได้รับสินค้าคืนจริง — ไม่ใช่ returned_at ซึ่งเป็นวันที่ลดยอดขาย.';

create index order_returns_unconfirmed_idx on order_returns (order_id)
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
  and status in ('จัดส่งแล้ว', 'ค้างชำระ', 'ปิดงานแล้ว');

update order_returns
set stock_returned_at = now(),
    received_at = coalesce(received_at, returned_at)
where stock_returned_at is null;

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
