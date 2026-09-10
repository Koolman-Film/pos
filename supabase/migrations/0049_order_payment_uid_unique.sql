/*
  uid ของการรับเงินต้องไม่ซ้ำกันใน PO เดียวกัน

  0048 ทำให้ `order_payments.uid` เป็นกุญแจที่อยู่รอดข้ามการบันทึก และเขียนไว้ว่า
  payload ที่ถูกปลอมจะเลื่อนสถานะเป็น รับเงินแล้ว ไม่ได้ (CORRECTION C2) —
  แต่ยังขาดเงื่อนไขหนึ่งข้อที่ทำให้คำสัญญานั้นเป็นจริง คือ uid ต้องไม่ซ้ำ

  ช่องโหว่ที่พบและทดสอบแล้ว
  ------------------------
  `save_order_children` เก็บสถานะเดิมไว้ใน v_prior โดยใช้ uid เป็นกุญแจ แล้ว
  คัดลอกกลับมาให้แถวใหม่ที่มี uid ตรงกัน ถ้า payload ส่ง uid เดิม "สองครั้ง"
  แถวที่สองซึ่งเป็นของปลอมจะได้ รับเงินแล้ว ติดมาด้วย:

      before : pREAL001 · 1,000 บาท · รับเงินแล้ว
      payload: [{uid:pREAL001, amount:1000}, {uid:pREAL001, amount:999999}]
      after  : pREAL001 · 1,000 บาท · รับเงินแล้ว
               pREAL001 · 999,999 บาท · รับเงินแล้ว   ← ไม่เคยได้รับเงินก้อนนี้

  คนที่บันทึก PO ได้ (เช่น sale) จึงสร้างยอด "รับเงินแล้ว" ขึ้นมาเองได้ ทั้งที่
  ไม่มีสิทธิ์ wholesale.confirmPayment และไม่ได้เรียก confirm_order_payment เลย
  ยอดนี้ไหลต่อไปที่ ค้างรับ / การ์ดเงิน / รายงานรายได้

  ผลข้างเคียงอีกข้อ: confirm_order_payment และ bounce_order_payment สั่ง
  `update ... where uid = p_uid` ถ้า uid ซ้ำ การกดยืนยันครั้งเดียวจะยืนยันทุกแถว
  ที่ใช้ uid นั้นพร้อมกัน

  วิธีปิด
  -------
  1. unique index บางส่วนบน (order_id, uid) — เป็นกฎระดับฐานข้อมูล ไม่ว่าจะเข้ามา
     ทางฟังก์ชันไหนหรือ payload แบบใด ก็ซ้ำไม่ได้ ยกเว้น uid = '' ซึ่งเป็นแถวเก่า
     ก่อน 0048 (ถูกเติมเป็น รับเงินแล้ว ไปแล้ว และไม่มีอะไรต้องจับคู่)
  2. เช็คซ้ำใน save_order_children ก่อน insert เพื่อให้ error ที่ผู้ใช้เห็นอ่านรู้
     เรื่อง แทนข้อความ unique violation ดิบ ๆ จากฐานข้อมูล

  ไม่มีการลบหรือแก้ข้อมูลเดิม ถอยกลับได้ด้วยการ drop index (revert-0042-0049.sql)
*/

set search_path = pos, public, extensions;

-- ---- 1. ตรวจว่ามี uid ซ้ำค้างอยู่ก่อนหรือไม่ --------------------------------
-- ไม่ลบให้เอง เพราะแต่ละแถวคือ "เงิน" ที่ต้องมีคนตัดสินใจ ถ้าเจอให้หยุดและบอกว่า
-- PO ไหน แล้วให้คนแก้ก่อนค่อยรันใหม่
do $$
declare
  v_dupes text;
begin
  select string_agg(distinct order_id || ' (uid=' || uid || ')', ', ')
    into v_dupes
    from (
      select order_id, uid
        from order_payments
       where uid <> ''
       group by order_id, uid
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception
      'พบ uid ของการรับเงินซ้ำกันใน PO เหล่านี้: %. แก้ให้เหลือแถวละ uid เดียวก่อน แล้วรัน 0049 ใหม่',
      v_dupes;
  end if;
end;
$$;

-- ---- 2. กฎระดับฐานข้อมูล ---------------------------------------------------
create unique index if not exists order_payments_order_uid_key
  on order_payments (order_id, uid)
  where uid <> '';

comment on index order_payments_order_uid_key is
  'uid ต้องไม่ซ้ำใน PO เดียวกัน — กันการปลอม payload ให้แถวใหม่สืบสถานะ รับเงินแล้ว จากแถวเดิม (0049).';

-- ---- 3. ข้อความผิดพลาดที่อ่านรู้เรื่องใน save_order_children ----------------
-- เนื้อในเหมือน 0048 ทุกอย่าง เพิ่มเฉพาะการตรวจ uid ซ้ำก่อน insert เพราะ
-- `create or replace` แก้ทีละบรรทัดไม่ได้
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
  v_dupe_count int;
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

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

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
