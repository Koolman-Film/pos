-- supabase/release-0079.sql
--
-- ปิดช่องโหว่ของการส่งของหลายรอบ
--
-- รันต่อจาก release-0078.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function ทั้งหมด และการเติม uid ให้
-- รายการสินค้าที่ยังไม่มี ทำเฉพาะแถวที่ค่ายังว่าง
--
-- หลังรันไฟล์นี้
--   * รายการสินค้าที่บันทึกมาโดยไม่มี uid จะได้ uid ที่ระบบสร้างให้ แทนที่จะ
--     ตกไปอยู่ถังเดียวกันจนทำให้ PO ปิดเองทั้งที่ของยังไม่ออกจากคลัง
--   * ส่งของโดยไม่ระบุว่าเป็นสินค้าตัวไหน ถูกปฏิเสธ
--   * ส่งของบน PO ที่อยู่ในถังขยะ ถูกปฏิเสธ
--   * สองคนกดส่งพร้อมกัน จะไม่ผ่านด่านกันส่งเกินทั้งคู่อีกต่อไป (ล็อกแถว PO ก่อนนับ)
--   * ลบรอบส่งของแล้ว ข้อมูลการจัดส่งและหลักฐานบน PO กลับไปเป็นของรอบที่ยังเหลือ

--
-- ปิดช่องโหว่ของการส่งของหลายรอบ (ตรวจพบตอนไล่อ่านโมดูลขายส่ง 30 ก.ย. 2569)
--
-- 0077 ทำให้ "ส่งไปแล้วเท่าไหร่" ผูกกับ `order_items.uid` ทั้งหมด แต่ไม่ได้บังคับ
-- ว่ารายการต้องมี uid จริง ๆ — `save_order_children` ยอมรับค่าว่างมาตลอด ผลคือ
-- รายการที่ไม่มี uid ทุกบรรทัดตกไปอยู่ถังเดียวกัน: PO ที่มีสินค้าสองบรรทัดแบบนั้น
-- ส่งบรรทัดแรกครบ แล้วระบบปิดใบให้ทั้งที่อีกบรรทัดยังไม่ได้ออกจากคลัง และรายได้
-- ก็ถูกรับรู้ไปแล้วด้วย ของเดิมทุกใบได้ uid จากการ backfill ของ 0077 ไปแล้ว
-- ช่องนี้จึงเปิดให้เฉพาะ payload ที่ไม่ได้ส่ง uid มา — ซึ่งไม่ควรมีทางเกิดเลย
--
-- อีกสองอย่างที่ปิดพร้อมกัน เพราะอยู่ในฟังก์ชันเดียวกัน:
--   * ส่งพร้อมกันสองคน — ด่านกันส่งเกินอ่านยอดเดิมคนละรอบแล้วผ่านทั้งคู่ได้
--     ล็อกแถว PO ก่อนนับ เหมือนที่ 0076 ทำกับเลขที่เอกสาร
--   * ส่งของบน PO ที่อยู่ในถังขยะ — ไม่มีหน้าจอไหนพาไปถึง แต่ RPC เปิดอยู่
--
-- และเก็บกวาดอีกข้อ: ลบรอบส่งของรอบล่าสุดแล้ว ข้อมูลการจัดส่ง/หลักฐานบน `orders`
-- ยังเป็นของรอบที่เพิ่งลบไป — ซึ่งเป็นหลักฐานที่ด่านของ 0055 อ่าน

set search_path = pos, public, extensions;

/**
 * บันทึกรอบส่งของหนึ่งรอบ — 0077 บวกด่านที่ขาดไปสามข้อ.
 */
create or replace function save_order_delivery(p_order_id text, p_delivery jsonb)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
  v_date date := nullif(p_delivery->>'date', '')::date;
  v_note text := btrim(coalesce(p_delivery->>'note', ''));
  v_uid text := coalesce(p_delivery->>'uid', '');
  v_lines jsonb := coalesce(p_delivery->'items', '[]'::jsonb);
  v_bad record;
  v_attachments text[];
  v_locked text;
begin
  /*
    ล็อกแถว PO ก่อนอ่านยอดที่ส่งไปแล้ว.

    ด่านกันส่งเกินข้างล่างคือ "อ่านแล้วค่อยเขียน" — สองคนกดส่งพร้อมกันจะอ่านยอด
    เดิมเหมือนกันทั้งคู่ แล้วผ่านด่านทั้งคู่ ของจึงออกจากคลังเกินใบสั่ง โดยที่
    ทั้งสองคำสั่งสำเร็จ (เหตุผลเดียวกับที่ 0076 ล็อกก่อนออกเลขที่เอกสาร)
  */
  select id into v_locked from orders where id = p_order_id and deleted_at is null for update;
  if v_locked is null then
    raise exception 'ไม่พบ PO นี้' using errcode = 'P0002';
  end if;

  if v_date is null then
    raise exception 'ต้องระบุวันที่ส่งของ' using errcode = '55000';
  end if;
  if v_note = '' then
    raise exception 'ต้องกรอกข้อมูลการจัดส่ง (ขนส่ง/เลขพัสดุ/ผู้รับ)' using errcode = '55000';
  end if;

  select coalesce(array_agg(value), '{}')
    into v_attachments
    from jsonb_array_elements_text(coalesce(p_delivery->'attachments', '[]'::jsonb));

  if coalesce(array_length(v_attachments, 1), 0) = 0 then
    raise exception 'ต้องแนบหลักฐานการจัดส่งอย่างน้อยหนึ่งไฟล์' using errcode = '55000';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_lines) as l
     where coalesce((l->>'qty')::numeric, 0) > 0
  ) then
    raise exception 'ต้องระบุจำนวนที่ส่งอย่างน้อยหนึ่งรายการ' using errcode = '55000';
  end if;

  -- บรรทัดที่ไม่บอกว่าเป็นสินค้าตัวไหน ไม่ใช่การส่งของ
  if exists (
    select 1 from jsonb_array_elements(v_lines) as l
     where coalesce((l->>'qty')::numeric, 0) > 0
       and coalesce(btrim(l->>'uid'), '') = ''
  ) then
    raise exception 'รายการสินค้าใน PO เปลี่ยนไปแล้ว กรุณาเปิด PO ใหม่แล้วบันทึกอีกครั้ง'
      using errcode = '55000';
  end if;

  -- กดปุ่มสองครั้ง ไม่ใช่การส่งสองรอบ
  if v_uid <> '' and exists (
    select 1 from order_deliveries where order_id = p_order_id and uid = v_uid
  ) then
    select id into v_id from order_deliveries where order_id = p_order_id and uid = v_uid;
    return v_id;
  end if;

  -- ส่งเกินที่สั่ง หรือส่งของที่ไม่ได้อยู่ใน PO
  select i.name, i.qty as ordered, coalesce(d.qty, 0) as sent, l.qty as sending
    into v_bad
    from (
      select coalesce(l->>'uid', '') as uid, coalesce((l->>'qty')::numeric, 0) as qty
        from jsonb_array_elements(v_lines) as l
       where coalesce((l->>'qty')::numeric, 0) > 0
    ) l
    left join order_items i on i.order_id = p_order_id and i.uid = l.uid
    left join order_delivered_qty(p_order_id) d on d.item_uid = l.uid
   where i.uid is null or coalesce(d.qty, 0) + l.qty > i.qty
   limit 1;

  if found then
    if v_bad.name is null then
      raise exception 'รายการสินค้าใน PO เปลี่ยนไปแล้ว กรุณาเปิด PO ใหม่แล้วบันทึกอีกครั้ง'
        using errcode = '55000';
    end if;
    raise exception 'สินค้า "%" สั่งไว้ % ส่งไปแล้ว % รอบนี้ส่งอีก % จะเกินจำนวนที่สั่ง',
      v_bad.name, v_bad.ordered, v_bad.sent, v_bad.sending using errcode = '55000';
  end if;

  insert into order_deliveries (order_id, uid, delivered_at, note, attachments)
  values (p_order_id, v_uid, v_date, v_note, v_attachments)
  returning id into v_id;

  insert into order_delivery_items (delivery_id, item_uid, item_name, qty)
  select
    v_id,
    coalesce(l->>'uid', ''),
    coalesce(i.name, coalesce(l->>'name', '')),
    coalesce((l->>'qty')::numeric, 0)
  from jsonb_array_elements(v_lines) as l
  left join order_items i on i.order_id = p_order_id and i.uid = coalesce(l->>'uid', '')
  where coalesce((l->>'qty')::numeric, 0) > 0;

  update orders
     set delivered_at = least(coalesce(delivered_at, v_date), v_date),
         delivery_note = v_note,
         delivery_attachments = v_attachments,
         status = case
           when order_fully_delivered(p_order_id) and status in ('รออนุมัติราคา', 'รอจัดส่ง')
             then 'จัดส่งแล้ว'
           else status
         end
   where id = p_order_id;

  return v_id;
end;
$$;

revoke all on function save_order_delivery(text, jsonb) from public, anon;
grant execute on function save_order_delivery(text, jsonb) to authenticated;

/**
 * ลบรอบส่งของ — 0077 บวกการคืนข้อมูลการจัดส่งให้ตรงกับรอบที่ยังเหลืออยู่.
 *
 * ของเดิมทิ้งหลักฐานของรอบที่เพิ่งลบไปค้างไว้บน `orders` ซึ่งเป็นสองคอลัมน์ที่
 * ด่านหลักฐานของ 0055 อ่าน และเป็นสิ่งที่ร้านหยิบมาใช้ตอนลูกค้าบอกว่าไม่ได้รับของ
 */
create or replace function delete_order_delivery(p_delivery_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_order_id text;
  v_deducted timestamptz;
  v_items jsonb;
  v_last order_deliveries%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not current_user_can('wholesale.updateStatus') then
    raise exception 'ไม่มีสิทธิ์ลบรอบส่งของ (ต้องมีสิทธิ์เปลี่ยนสถานะ PO)'
      using errcode = '42501';
  end if;

  select d.order_id, d.stock_deducted_at
    into v_order_id, v_deducted
    from order_deliveries d
   where d.id = p_delivery_id;

  if v_order_id is null then
    raise exception 'ไม่พบรอบส่งของนี้' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', li.item_name, 'qty', li.qty)), '[]'::jsonb)
    into v_items
    from order_delivery_items li
   where li.delivery_id = p_delivery_id;

  delete from order_deliveries where id = p_delivery_id;

  -- ข้อมูลการจัดส่งบน orders = ของรอบล่าสุดที่ยังเหลืออยู่ ไม่มีเหลือเลยก็ว่าง
  select * into v_last
    from order_deliveries
   where order_id = v_order_id
   order by delivered_at desc, id desc
   limit 1;

  update orders
     set delivered_at = (select min(delivered_at) from order_deliveries where order_id = v_order_id),
         delivery_note = coalesce(v_last.note, ''),
         delivery_attachments = coalesce(v_last.attachments, '{}'),
         status = case
           when status = 'จัดส่งแล้ว' and not order_fully_delivered(v_order_id) then 'รอจัดส่ง'
           else status
         end
   where id = v_order_id;

  return jsonb_build_object(
    'orderId', v_order_id,
    'stockDeducted', v_deducted is not null,
    'items', v_items
  );
end;
$$;

revoke all on function delete_order_delivery(bigint) from public, anon;
grant execute on function delete_order_delivery(bigint) to authenticated;

/*
  `save_order_children` — รายการสินค้าต้องมี uid เสมอ.

  ตัวเดิมทั้งดุ้น (0078) แก้บรรทัดเดียว: uid ที่ว่างมาจะถูกสร้างให้ แทนที่จะ
  ปล่อยผ่านไปเป็นค่าว่าง เพราะ "ส่งไปแล้วเท่าไหร่" ทั้งระบบผูกกับคีย์นี้ และ
  รายการที่ไม่มีคีย์จะไปกองรวมกันในถังเดียว ทำให้ PO ปิดเองทั้งที่ของยังไม่ออก
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

  insert into order_items (order_id, name, qty, list_price, requested_price, reason, uid)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', ''),
    -- ไม่มี uid มา = สร้างให้ ไม่ใช่ปล่อยว่าง: ทั้งระบบนับ "ส่งไปแล้วเท่าไหร่"
    -- จากคีย์นี้ และรายการที่ไม่มีคีย์จะไปกองรวมกันเป็นถังเดียว
    coalesce(nullif(btrim(it->>'uid'), ''), 'i' || replace(gen_random_uuid()::text, '-', ''))
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
    cheque_no, cheque_bank, cheque_date, is_cheque, installment_uid,
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

-- ของที่ค้างอยู่แล้ว: รายการที่ยังไม่มี uid (ถ้ามี) ได้คีย์ของตัวเอง
update order_items
   set uid = 'i' || replace(gen_random_uuid()::text, '-', '')
 where btrim(uid) = '';

select 'release-0079 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0079', 'delivery_integrity') on conflict (version) do nothing;
