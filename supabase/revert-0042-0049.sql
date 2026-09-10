-- supabase/revert-0042-0049.sql
--
-- ทางถอยกลับของ 0042-0049 — ใช้เมื่อจำเป็นเท่านั้น
--
-- ลำดับที่ควรใช้จริง:
--   1. ถอย CODE ที่ Vercel ก่อนเสมอ (rollback ทันที ไม่เสียข้อมูล). สคีมาชุดนี้
--      เข้ากันได้กับโค้ดเก่าทั้งหมด — คอลัมน์ใหม่ทุกตัวเป็น NOT NULL ที่มี DEFAULT
--      หรือไม่ก็ยอมให้ NULL ได้ ตารางใหม่ทุกตารางเป็นตารางใหม่จริง ๆ ไม่มีคอลัมน์
--      หรือฟังก์ชันไหนถูกลบ และฟังก์ชันใหม่ (confirm_order_payment,
--      bounce_order_payment) ก็ชื่อใหม่ทั้งหมด โค้ดเก่าจึงทำงานบนสคีมาใหม่ได้
--   2. รันไฟล์นี้เฉพาะเมื่อต้องถอยสคีมาจริง ๆ เท่านั้น
--
-- ข้อมูลที่จะหายเมื่อรันไฟล์นี้ (ยอมรับก่อนรัน):
--   - money_accounts / money_transfers / money_reconciliations
--       ทะเบียนแหล่งเงินทั้งหมด ยอดตั้งต้น การโอนเงินระหว่างแหล่งเงิน และการ
--       กระทบยอด — ทั้งโมดูลการจัดการเงินหายทั้งก้อน
--   - sales_people + orders.sales_by   ทะเบียนพนักงานขาย และ PO ไหนเป็นของใคร
--   - orders.delivered_at              วันส่งของของ PO (0046 เติมย้อนหลังไว้ด้วย)
--   - order_returns.returned_at        วันที่รับคืนสินค้า (จะกลับไปใช้วันที่บันทึก)
--   - order_payments: uid, status, cheque_no, cheque_bank, cheque_date,
--     reported_by, reported_at, cleared_at, cleared_by, bounced_at, bounce_note
--
-- อ่านตรงนี้ก่อนถอย 0048:
--   ก่อน 0048 ระบบนับ "รับเช็คแล้ว" เท่ากับ "ได้เงินแล้ว" การถอยจึงทำให้เช็คที่
--   ยังไม่ขึ้นเงิน และเช็คที่เด้งไปแล้ว กลับมาถูกนับเป็นเงินที่ได้รับทั้งหมด
--   ยอดค้างรับจะน้อยกว่าความจริง ให้พิมพ์รายงานเช็คค้างเก็บไว้ก่อนรัน:
--
--     select o.shop_id, p.order_id, p.amount, p.cheque_no, p.cheque_bank,
--            p.cheque_date, p.status, p.bounced_at, p.bounce_note
--       from pos.order_payments p
--       join pos.orders o on o.id = p.order_id
--      where p.status <> 'รับเงินแล้ว'
--      order by o.shop_id, p.cheque_date;
--
-- สิ่งที่จงใจไม่ถอย เพราะถอยแล้วเสียมากกว่าได้:
--   - แถวสิทธิ์ที่ 0042/0044/0048 เพิ่มไว้ และตัว reset_permissions_to_defaults()
--     เอง — ไม่มีโค้ดเก่าอ่านคีย์ใหม่ จึงไม่มีผล และการลบทิ้งอาจลบค่าที่แอดมิน
--     ตั้งเองไปด้วย (เหตุผลเดียวกับ revert-0031-0041.sql)
--   - shop_info / shops ที่ save_shop เคยสร้างให้สาขาใหม่ — เป็นข้อมูลสาขาจริง

set search_path = pos, public, extensions;

-- ---- 0049: uid ของการรับเงินห้ามซ้ำ ----------------------------------------
-- ตัว index อย่างเดียว ไม่แตะข้อมูล ถ้าถอยแค่ 0049 ให้หยุดตรงนี้
drop index if exists order_payments_order_uid_key;

-- ---- 0048: เช็คลงวันที่ล่วงหน้า และการยืนยันเงินเข้า -------------------------
drop function if exists confirm_order_payment(text, text, date);
drop function if exists bounce_order_payment(text, text, date, text);

drop index if exists order_payments_status_idx;

alter table order_payments
  drop constraint if exists order_payments_status_ck;

alter table order_payments
  drop column if exists uid,
  drop column if exists status,
  drop column if exists cheque_no,
  drop column if exists cheque_bank,
  drop column if exists cheque_date,
  drop column if exists reported_by,
  drop column if exists reported_at,
  drop column if exists cleared_at,
  drop column if exists cleared_by,
  drop column if exists bounced_at,
  drop column if exists bounce_note;

-- ---- 0047: พนักงานขาย ------------------------------------------------------
drop index if exists orders_sales_by_idx;
alter table orders drop column if exists sales_by;
drop table if exists sales_people;

-- ---- 0046: เติมวันส่งของย้อนหลัง -------------------------------------------
-- ไม่มีสคีมาเป็นของตัวเอง เขียนค่าลง orders.delivered_at อย่างเดียว ซึ่งถูก drop
-- ในส่วนของ 0045 ข้างล่าง

-- ---- 0045: ใบส่งของ ใบรับคืนสินค้า และวันที่ที่ยอดขายต้องใช้ ----------------
drop index if exists orders_delivered_idx;
drop index if exists order_returns_returned_idx;
alter table orders drop column if exists delivered_at;
alter table order_returns drop column if exists returned_at;

-- กลับไปใช้ตัวของ 0011: ไม่มี uid ไม่มีการคัดลอกสถานะการยืนยัน และลงวันที่ของ
-- ทั้ง adjustments/payments ด้วยวันที่บันทึก
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
begin
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

  insert into order_returns (order_id, item_name, qty, reason)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', '')
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    p_saved_on
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (order_id, amount, method, paid_at)
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    p_saved_on
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

-- กลับไปใช้ตัวของ 0034: ไม่เปิดแหล่งเงินตั้งต้นให้สาขาใหม่ (โมดูลเงินถูกถอยแล้ว)
create or replace function save_shop(p_id text, p_name text, p_sort integer default null)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_id   text := lower(trim(coalesce(p_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_sort integer;
begin
  if coalesce(current_user_role(), '') <> 'admin' then
    raise exception 'forbidden: เฉพาะแอดมินเท่านั้นที่เพิ่ม/แก้ไขสาขาได้';
  end if;

  if v_id !~ '^[a-z0-9]{2,10}$' then
    raise exception 'รหัสสาขาต้องเป็น a-z หรือ 0-9 ความยาว 2-10 ตัว (เช่น north)';
  end if;
  if v_name = '' then
    raise exception 'ต้องระบุชื่อสาขา';
  end if;

  v_sort := coalesce(
    p_sort,
    (select sort_order from shops where id = v_id),
    (select coalesce(max(sort_order), 0) + 1 from shops)
  );

  insert into shops (id, name, sort_order)
  values (v_id, v_name, v_sort)
  on conflict (id) do update
    set name = excluded.name,
        sort_order = excluded.sort_order;

  return v_id;
end;
$$;

-- ---- 0044 / 0042: คีย์สิทธิ์ใหม่ -------------------------------------------
-- จงใจไม่ถอย ดูหัวไฟล์

-- ---- 0043: ทะเบียนแหล่งเงินและการโอน ---------------------------------------
drop trigger if exists money_transfers_accounts_match_shop on money_transfers;
drop function if exists enforce_transfer_accounts_match_shop();

-- เรียงตาม FK: reconciliations และ transfers อ้าง accounts
drop table if exists money_reconciliations;
drop table if exists money_transfers;
drop table if exists money_accounts;
