-- supabase/release-0049.sql
--
-- uid ของการรับเงินขายส่งต้องไม่ซ้ำกันใน PO เดียวกัน (ปิดช่องโหว่ของ 0048)
--
-- รันต่อจาก release-0048.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create unique index if not exists / create or replace
-- function และการตรวจ uid ซ้ำเป็นการอ่านอย่างเดียว
--
-- ไม่มีการลบหรือแก้ข้อมูลเดิมแม้แต่แถวเดียว ถ้ามี uid ซ้ำค้างอยู่ สคริปต์จะหยุด
-- และบอกว่า PO ไหน โดยไม่แตะข้อมูล — ให้คนตัดสินใจว่าแถวไหนคือเงินจริง
--
-- ถอยกลับ: supabase/revert-0042-0049.sql (drop index อย่างเดียว)
--
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

insert into supabase_migrations.schema_migrations(version, name) values ('0049', 'order_payment_uid_unique') on conflict (version) do nothing;
