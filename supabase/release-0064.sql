-- supabase/release-0064.sql
--
-- การชำระเงิน / แหล่งเงิน / ช่องทางการชำระเงิน เป็นรายการเดียวทุกโมดูล
--
-- รันต่อจาก release-0063.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create index if not exists / create or replace /
-- drop trigger if exists / add column if not exists การตั้งค่าเช็คให้รายการเก่า
-- แตะเฉพาะแถวที่ยังไม่ได้ตั้ง ไม่แก้จำนวนเงิน วันที่ หรือวิธีชำระของรายการเดิม
--
-- ถ้ารันแล้วขึ้นว่า "มีแหล่งเงินชื่อซ้ำกันในสาขาเดียวกัน" ให้เปลี่ยนชื่อแหล่งเงินที่
-- ซ้ำให้ไม่ซ้ำที่ การจัดการเงิน/บัญชี แล้วรันไฟล์นี้ใหม่
--
-- หลังรันไฟล์นี้ (ต้องขึ้นโค้ดชุดใหม่พร้อมกัน):
--   * วิธีชำระในใบงาน วิธีชำระในขายส่ง และจ่ายจากในค่าใช้จ่าย เลือกจากแหล่งเงิน
--     ของสาขานั้นเท่านั้น เงินเข้าบัญชีที่เลือกตรง ๆ
--   * เช็คในขายส่งเป็นช่องติ๊กของตัวเอง รายการเก่าที่วิธีชำระมีคำว่าเช็ค ถูกตั้งให้แล้ว
--   * เปลี่ยนชื่อแหล่งเงินแล้ว รายการเก่ายังนับเข้าบัญชีเดิม
--   * ควรตั้งชื่อแหล่งเงินของทุกสาขาให้อ่านรู้เรื่องก่อนใช้ เพราะเป็นคำที่พนักงาน
--     เลือกทุกวันและพิมพ์บนใบเสร็จ

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ชื่อแหล่งเงินห้ามซ้ำในสาขาเดียวกัน
-- ---------------------------------------------------------------------------
-- ไม่รวมให้เอง: สองบัญชีชื่อเดียวกันอาจมียอดตั้งต้นต่างกัน ต้องมีคนตัดสินใจ
do $$
declare
  v_dupes text;
begin
  select string_agg(distinct shop_id || ': ' || name, ', ')
    into v_dupes
    from (
      select shop_id, name, count(*) over (partition by shop_id, lower(btrim(name))) as n
        from money_accounts
    ) d
   where n > 1;
  if v_dupes is not null then
    raise exception
      'มีแหล่งเงินชื่อซ้ำกันในสาขาเดียวกัน: %. เปลี่ยนชื่อให้ไม่ซ้ำที่ การจัดการเงิน/บัญชี ก่อน แล้วรันไฟล์นี้ใหม่',
      v_dupes;
  end if;
end;
$$;

create unique index if not exists money_accounts_shop_name_key
  on money_accounts (shop_id, lower(btrim(name)));

comment on index money_accounts_shop_name_key is
  'ชื่อแหล่งเงินห้ามซ้ำในสาขา — ชื่อคือตัวเชื่อมรายการรับ/จ่ายเงินเข้ากับบัญชี (0064).';

-- ---------------------------------------------------------------------------
-- 2. เปลี่ยนชื่อแล้ว ชื่อเดิมยังพาเงินเก่ามาที่บัญชีนี้
-- ---------------------------------------------------------------------------
create or replace function keep_old_money_account_name() returns trigger
language plpgsql
set search_path = pos
as $$
begin
  if btrim(old.name) <> btrim(new.name)
     and not (btrim(old.name) = any (coalesce(new.match_names, '{}'))) then
    new.match_names := coalesce(new.match_names, '{}') || btrim(old.name);
  end if;
  return new;
end;
$$;

drop trigger if exists money_accounts_keep_old_name on money_accounts;
create trigger money_accounts_keep_old_name
  before update of name on money_accounts
  for each row execute function keep_old_money_account_name();

-- ---------------------------------------------------------------------------
-- 3. เช็คเป็นช่องของตัวเอง
-- ---------------------------------------------------------------------------
alter table order_payments
  add column if not exists is_cheque boolean not null default false;

comment on column order_payments.is_cheque is
  'ชำระด้วยเช็ค — แยกจาก method ซึ่งตั้งแต่ 0064 คือชื่อแหล่งเงินที่เงินจะเข้า.';

-- รายการเก่า: วิธีชำระมีคำว่าเช็ค หรือกรอกข้อมูลเช็คไว้
update order_payments
   set is_cheque = true
 where not is_cheque
   and (method like '%เช็ค%' or cheque_no <> '' or cheque_bank <> '' or cheque_date is not null);

-- save_order_children: เหมือน 0054 ทุกอย่าง (`create or replace` เขียนทับทั้ง
-- ฟังก์ชัน จึงยกมาทั้งก้อน รวมด่าน uid ซ้ำจาก 0049) เพิ่มเฉพาะ is_cheque
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
    cheque_no, cheque_bank, cheque_date, is_cheque,
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

insert into supabase_migrations.schema_migrations(version, name) values ('0064', 'one_money_list') on conflict (version) do nothing;
