-- supabase/release-0086.sql
--
-- หลักฐานการชำระเงินของ PO ขายส่ง — เก็บจริง และเปิดดูได้
--
-- รันต่อจาก release-0085.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists และ create or replace function
--
-- ช่อง "แนบหลักฐานการชำระเงิน" ในใบ PO มีมาตั้งแต่ต้น แต่มันเก็บแค่ "ชื่อไฟล์"
-- ไว้ในหน่วยความจำของหน้าจอ ไม่ได้อัปโหลดไฟล์ และ `order_payments` ก็ไม่มี
-- คอลัมน์ให้เก็บ พอรีเฟรชหน้า ชื่อไฟล์ก็หายไปพร้อมกัน — หลักฐานที่พนักงานคิดว่า
-- แนบแล้ว ไม่เคยมีอยู่จริงสักไฟล์ (ร้านเจอ 26 ต.ค. 2569)
--
-- หลังรันไฟล์นี้ ไฟล์ขึ้น bucket wholesale-attachments ที่เดียวกับหลักฐานการ
-- จัดส่ง (0055) และคอลัมน์นี้เก็บ storage path ไม่ใช่ชื่อไฟล์
--
-- ของเดิมไม่ขยับ: การรับเงินทุกแถวที่บันทึกไปแล้วได้ลิสต์ไฟล์ว่าง ซึ่งตรงกับ
-- ความจริง — ไฟล์พวกนั้นไม่เคยถูกอัปโหลด

set search_path = pos, public, extensions;

alter table order_payments
  add column if not exists attachments text[] not null default '{}';

comment on column order_payments.attachments is
  'หลักฐานการชำระเงิน — storage path ใน wholesale-attachments (0086)';

/*
  `save_order_children` เก็บหลักฐานการชำระเงินของแต่ละงวดด้วย.

  ตัวเดิมทั้งดุ้น (0080) เพิ่มคอลัมน์เดียว: `attachments` มาจาก payload เหมือน
  `cheque_no` — `create or replace` เขียนทับทั้งตัว ไม่ใช่แก้บางบรรทัด อะไรที่
  ไม่เขียนกลับมาคือของที่หายไป

  `prior` หอบไฟล์เดิมมาด้วย เพราะทุกการบันทึกคือการลบลูกทั้งชุดแล้วเขียนใหม่
  ถ้า payload ไม่มีคีย์นี้ (client รุ่นก่อนหน้า) ไฟล์ที่แนบไว้ต้องไม่หายไปเงียบ ๆ
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
  v_bad record;
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

  select count(*) into v_dupe_count
    from (
      select it->>'uid' as uid
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it
       where coalesce(it->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;
  if v_dupe_count > 0 then
    raise exception 'รายการสินค้ามี uid ซ้ำกัน บันทึกไม่ได้';
  end if;

  -- ของที่ส่งออกไปแล้ว จะลดจำนวนให้ต่ำกว่านั้นหรือลบทิ้งไม่ได้ (0077)
  select sent.item_name as name, sent.qty as sent, coalesce(keep.qty, 0) as keeping
    into v_bad
    from (
      select li.item_uid, max(li.item_name) as item_name, sum(li.qty) as qty
        from order_delivery_items li
        join order_deliveries d on d.id = li.delivery_id
       where d.order_id = p_order_id
       group by li.item_uid
    ) sent
    left join (
      select coalesce(it->>'uid', '') as uid, coalesce((it->>'qty')::numeric, 0) as qty
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it
    ) keep on keep.uid = sent.item_uid
   where coalesce(keep.qty, 0) < sent.qty
   limit 1;

  if found then
    raise exception 'สินค้า "%" ส่งออกไปแล้ว % — จะแก้จำนวนให้เหลือ % หรือลบรายการทิ้งไม่ได้ ต้องลบรอบส่งของก่อน',
      v_bad.name, v_bad.sent, v_bad.keeping using errcode = '55000';
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
        'reported_at', reported_at,
        'attachments', to_jsonb(attachments)
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

  insert into order_items (order_id, name, qty, list_price, requested_price, reason, uid)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', ''),
    -- ไม่มี uid มา = สร้างให้ ไม่ใช่ปล่อยว่าง: ทั้งระบบนับ "ส่งไปแล้วเท่าไหร่"
    -- จากคีย์นี้ และรายการที่ไม่มีคีย์จะไปกองรวมกันเป็นถังเดียว (0079)
    coalesce(nullif(btrim(it->>'uid'), ''), 'i' || replace(gen_random_uuid()::text, '-', ''))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (
    order_id, item_name, item_uid, qty, reason, returned_at, uid,
    received_at, received_by, stock_returned_at
  )
  select
    p_order_id,
    coalesce(r->>'item', ''),
    -- บรรทัดที่ของถูกคืนกลับมา (0080). ว่างได้ — ของที่คืนอาจเป็นสินค้าที่ลูกค้า
    -- ซื้อจาก PO ใบอื่น ซึ่งไม่มีบรรทัดในใบนี้ให้ชี้ถึงตั้งแต่แรก
    coalesce(btrim(r->>'itemUid'), ''),
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
    cheque_no, cheque_bank, cheque_date, is_cheque, installment_uid,
    attachments,
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
    coalesce(pay->>'installmentUid', ''),
    -- ไม่ส่งคีย์นี้มาเลย = client รุ่นก่อนหน้า ซึ่งต้องไม่ลบไฟล์ที่แนบไว้ทิ้ง
    case
      when pay ? 'attachments' then coalesce(
        (select array_agg(value) from jsonb_array_elements_text(pay->'attachments')),
        '{}'::text[]
      )
      else coalesce(prior.files, '{}'::text[])
    end,
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select
      v_prior -> coalesce(pay->>'uid', '') as v,
      (
        select array_agg(value)
          from jsonb_array_elements_text(
            coalesce(v_prior -> coalesce(pay->>'uid', '') -> 'attachments', '[]'::jsonb)
          )
      ) as files
  ) as prior on true;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

select 'release-0086 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0086', 'order_payment_attachments') on conflict (version) do nothing;
