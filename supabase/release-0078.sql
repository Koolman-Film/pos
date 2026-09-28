-- supabase/release-0078.sql
--
-- แบ่งชำระหลายงวดใน PO เดียว
--
-- รันต่อจาก release-0077.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: สร้างตารางและดัชนีแบบ if not exists, เพิ่มคอลัมน์แบบ
-- if not exists และ create or replace function
--
-- หลังรันไฟล์นี้ PO ตั้งตารางงวดได้ งวดละวันที่และยอด ใบแจ้งหนี้พิมพ์ตารางนั้นให้
-- ลูกค้า และการเตือน "เลยกำหนดชำระ / ใกล้ถึงกำหนด" ดูทีละงวด ไม่ใช่ทั้งใบ
-- เงินที่รับเข้ามาเลือกได้ว่าตัดเข้างวดไหน ถ้าไม่เลือก ระบบจะไล่ลงงวดที่ค้างเก่า
-- ที่สุดให้เอง
--
-- ของเดิมไม่ถูกแตะ: ไม่มีการสร้างงวดย้อนหลังให้ PO เก่า `orders.due_at` ยังเป็น
-- กำหนดชำระของทั้งใบเหมือนเดิม และ PO ที่ไม่มีตารางงวดยังใช้กติกาเตือนแบบเดิม

--
-- แบ่งชำระหลายงวดใน PO เดียว
--
-- การรับเงินหลายครั้งทำได้อยู่แล้ว (`order_payments` เป็นหลายแถวมาตั้งแต่ 0005)
-- สิ่งที่ไม่เคยมีคือ **ข้อตกลง** ว่าจะแบ่งจ่ายกี่งวด งวดละเท่าไหร่ ครบกำหนดวันไหน
-- `orders.due_at` (0050) เก็บกำหนดชำระได้วันเดียวต่อใบ (ร้านแจ้ง 28 ก.ย. 2569)
--
-- ที่มันสำคัญไม่ใช่ความสวยงามของข้อมูล แต่เป็นสิ่งที่ระบบ "พูดไม่ได้": งวดที่ 1
-- เลยกำหนดแล้วแต่งวดที่ 2 ยังไม่ถึง — กระดิ่งเตือนเดิมเทียบยอดค้างทั้งก้อนกับ
-- วันเดียว จึงเตือนแบบทั้งใบหรือไม่เตือนเลย และใบแจ้งหนี้พิมพ์ตารางงวดให้ลูกค้า
-- ยึดไม่ได้
--
-- ของเดิมไม่ถูกแตะ. ไม่มีการสร้างงวดย้อนหลังให้ PO เก่า: `orders.due_at` ยังเป็น
-- กำหนดชำระของทั้งใบเหมือนเดิม และกติกาเตือนเดิมยังใช้กับใบที่ไม่มีตารางงวด
-- ตารางงวดจะเข้ามาแทนที่ก็ต่อเมื่อมีคนตั้งมันขึ้นมาเท่านั้น
--
-- เงินเข้างวดไหน เลือกเอง (ร้านเลือก 28 ก.ย. 2569) — `order_payments.installment_uid`
-- ว่าง = ยังไม่ได้ระบุ ฝั่งแอปจะไล่เงินที่ไม่ได้ระบุงวดไปลงงวดที่เก่าที่สุดที่ยัง
-- ค้าง เพื่อไม่ให้ระบบทวงงวดที่รับเงินมาแล้วแต่ลืมจิ้ม

set search_path = pos, public, extensions;

create table if not exists order_installments (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  -- คีย์ที่ไคลเอนต์สร้าง การรับเงินชี้มาที่คีย์นี้ และต้องอยู่รอดข้ามการบันทึก
  -- ที่ลบลูกทั้งหมดแล้วใส่กลับใหม่ ด้วยเหตุผลเดียวกับ 0048/0051/0054/0077
  uid text not null default '',
  -- งวดที่ — ลำดับที่ลูกค้าเห็นบนใบแจ้งหนี้
  seq integer not null default 1,
  due_at date not null,
  amount numeric not null default 0,
  note text not null default ''
);

comment on table order_installments is
  'ตารางงวดชำระที่ตกลงกับลูกค้าไว้ (0078). ไม่มีแถว = ใช้ orders.due_at ทั้งใบเหมือนเดิม';

create index if not exists order_installments_order_idx on order_installments (order_id);
-- คำถามที่ดัชนีนี้ตอบ: งวดไหนเลยกำหนดแล้วบ้าง
create index if not exists order_installments_due_idx on order_installments (due_at);

create unique index if not exists order_installments_uid_idx
  on order_installments (order_id, uid)
  where uid <> '';

alter table order_payments
  add column if not exists installment_uid text not null default '';

comment on column order_payments.installment_uid is
  'เงินก้อนนี้ตัดเข้างวดไหน (0078). ว่าง = ยังไม่ได้ระบุ แอปจะไล่ลงงวดที่เก่าที่สุดที่ยังค้าง';

alter table order_installments enable row level security;

drop policy if exists order_installments_rw on order_installments;
create policy order_installments_rw on order_installments
  for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

grant select, insert, update, delete on order_installments to authenticated;

/**
 * บันทึกตารางงวดของ PO ใบหนึ่ง.
 *
 * `p_installments` = [{ uid, dueAt, amount, note }, …] ตามลำดับที่ลูกค้าเห็น
 *
 * ฟังก์ชันของตัวเอง ไม่ได้ไปอยู่ใน `save_order_children` เพราะการเพิ่มพารามิเตอร์
 * คือการสร้างฟังก์ชันใหม่อีกตัว แล้วต้องเลือกว่าจะทิ้งตัวเก่าทันที (แอปรุ่นที่
 * ยังรันอยู่ระหว่างดีพลอยจะบันทึก PO ไม่ได้) หรือเก็บไว้ทั้งคู่ (ตัวเก่าจะลบ
 * ตารางงวดทิ้งทุกครั้งที่ถูกเรียก) — ทั้งสองทางแย่กว่าการแยกออกมา
 *
 * `orders.due_at` ถูกตั้งเป็นงวดสุดท้าย เพื่อให้ทุกที่ที่ยังอ่านคอลัมน์นั้นอยู่
 * ได้ความหมายที่ถูก: ทั้งใบต้องจบภายในวันนั้น
 */
create or replace function save_order_installments(p_order_id text, p_installments jsonb)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_dupes int;
  v_last date;
begin
  if not exists (select 1 from orders where id = p_order_id) then
    raise exception 'ไม่พบ PO นี้' using errcode = 'P0002';
  end if;

  -- uid ซ้ำใน payload เดียวกัน = payload ถูกแก้มา ไม่ใช่การพิมพ์ผิดของผู้ใช้
  select count(*) into v_dupes
    from (
      select ins->>'uid' as uid
        from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) as ins
       where coalesce(ins->>'uid', '') <> ''
       group by 1
      having count(*) > 1
    ) d;
  if v_dupes > 0 then
    raise exception 'งวดชำระมี uid ซ้ำกัน บันทึกไม่ได้' using errcode = '55000';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) as ins
     where coalesce(nullif(ins->>'dueAt', ''), '') = ''
  ) then
    raise exception 'ทุกงวดต้องมีกำหนดชำระ' using errcode = '55000';
  end if;

  delete from order_installments where order_id = p_order_id;

  insert into order_installments (order_id, uid, seq, due_at, amount, note)
  select
    p_order_id,
    coalesce(ins->>'uid', ''),
    n::int,
    (ins->>'dueAt')::date,
    coalesce((ins->>'amount')::numeric, 0),
    coalesce(ins->>'note', '')
  from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb))
       with ordinality as e(ins, n);

  -- กำหนดชำระของทั้งใบ = งวดสุดท้าย. ไม่มีงวดเลยก็ไม่ไปยุ่งกับค่าที่กรอกไว้เอง
  select max(due_at) into v_last from order_installments where order_id = p_order_id;
  if v_last is not null then
    update orders set due_at = v_last where id = p_order_id and due_at is distinct from v_last;
  end if;
end;
$$;

revoke all on function save_order_installments(text, jsonb) from public, anon;
grant execute on function save_order_installments(text, jsonb) to authenticated;

/*
  `save_order_children` ถือ "เงินก้อนนี้เข้างวดไหน" ไปด้วย.

  ตัวเดิมทั้งดุ้น (0077) บวกคอลัมน์เดียว: `installment_uid` มาจาก payload ของ
  การรับเงิน เหมือน `method` หรือ `chequeNo` — เพราะคนกรอกเลือกงวดตอนที่พิมพ์
  รายการรับเงินนั้น ไม่ใช่เหตุการณ์ในวงจรชีวิตของเช็คที่ฐานข้อมูลต้องหวงไว้
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
    coalesce(it->>'uid', '')
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

select 'release-0078 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0078', 'order_installments') on conflict (version) do nothing;
