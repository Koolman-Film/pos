-- supabase/release-0081.sql
--
-- สถานะ PO เปลี่ยนเองตามกิจกรรมที่เกิดขึ้น
--
-- รันต่อจาก release-0080.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: insert สถานะใหม่แบบ on conflict do nothing, create or
-- replace function และ drop/create trigger
--
-- หลังรันไฟล์นี้ สถานะของ PO ไม่ใช่ช่องที่คนเลือกอีกต่อไป แต่คำนวณจากสิ่งที่
-- เกิดขึ้นจริงกับใบนั้น
--
--   รออนุมัติราคา        เปิด PO ที่มีส่วนลดต่ำกว่าราคามาตรฐาน หรือมีการปรับราคารออนุมัติ
--   รอจัดส่ง             ราคาไม่ต้องรอใคร หรืออนุมัติแล้ว และยังไม่ได้ส่งของ
--   จัดส่งแล้วบางส่วน      ส่งของแล้วแต่ยังไม่ครบ และเก็บเงินครบแล้ว
--   ค้างชำระ             ส่งของแล้ว (ครบหรือบางส่วน) และยังเก็บเงินไม่ครบ
--   เสร็จสิ้น/ปิดงานแล้ว   ส่งครบและเก็บเงินครบ (ชื่อตามที่ร้านตั้งไว้ในทะเบียนสถานะ)
--
-- เพิ่มสองสถานะในทะเบียน: "จัดส่งแล้วบางส่วน" และ "ตัดหนี้สูญ"
--
-- "ตัดหนี้สูญ" แยกออกจาก "ค้างชำระ" เพราะค้างชำระกลายเป็นสิ่งที่ระบบตั้งเอง
-- ปุ่มตัดหนี้สูญที่เคยตั้งค่าเดียวกันจึงไม่มีความหมาย และหนี้ที่ตัดทิ้งแล้วไม่ควร
-- อยู่ในยอดค้างรับให้คนไล่ตามต่อ — สถานะนี้จึงไม่นับเป็นงานที่ยังเปิดอยู่
--
-- PO เก่าไม่ถูกไล่คำนวณใหม่ตอนรัน สถานะจะขยับเมื่อมีกิจกรรมถัดไปเกิดกับใบนั้น

--
-- สถานะ PO เปลี่ยนเองตามกิจกรรมที่เกิดขึ้น
--
-- สถานะเคยเป็นช่องที่คนเลือกเอง ซึ่งแปลว่ามันบอกได้แค่ว่า "ใครคนหนึ่งเคยคิดว่า
-- งานอยู่ตรงไหน" ไม่ใช่ว่างานอยู่ตรงไหนจริง ๆ ใบที่ส่งของไปแล้วแต่ไม่มีใครไป
-- เปลี่ยนสถานะ ยังค้างเป็น "รอจัดส่ง" อยู่ในรายการ และใบที่เก็บเงินครบแล้วก็ยัง
-- ค้างเป็น "ค้างชำระ" จนกว่าจะมีคนนึกได้ (ร้านขอ 2 ต.ค. 2569)
--
-- ลำดับที่ร้านกำหนด:
--   รออนุมัติราคา        เปิด PO
--   รอจัดส่ง             อนุมัติราคาแล้ว
--   จัดส่งแล้วบางส่วน      ส่งของแล้วแต่ยังไม่ครบทุกรายการ
--   ค้างชำระ             ส่งของแล้ว (ครบหรือบางส่วน) และยังเก็บเงินไม่ครบ
--   เสร็จสิ้น            ส่งครบ และเก็บเงินครบ
--
-- "จัดส่งแล้ว" ไม่ถูกตั้งโดยอัตโนมัติอีกต่อไป และเป็นเรื่องตั้งใจ: ขายส่งส่งของ
-- ก่อนเก็บเงินเสมอ ใบที่ส่งครบจึงเป็น "ค้างชำระ" ทันทีจนกว่าเงินจะเข้าครบ แล้ว
-- กลายเป็น "เสร็จสิ้น" — ไม่มีช่วงไหนที่มันควรค้างอยู่ที่ "จัดส่งแล้ว" (ร้าน
-- ยืนยันกติกานี้หลังเห็นผลข้างเคียงข้อนี้แล้ว) สถานะยังอยู่ในทะเบียนเพราะ PO
-- เก่าถืออยู่ และยังเลือกมือได้จากหน้าจัดการสถานะ
--
-- "ตัดหนี้สูญ" เป็นสถานะใหม่ของตัวเอง ไม่ใช่ "ค้างชำระ" เหมือนเดิม — เพราะตอนนี้
-- ค้างชำระ เป็นสิ่งที่ระบบคำนวณเอง ปุ่มตัดหนี้สูญที่ตั้งค่าเดียวกันจึงกลายเป็น
-- ปุ่มที่กดแล้วไม่เกิดอะไร และหนี้ที่ตัดทิ้งแล้วก็ไม่ควรอยู่ในยอดค้างรับอีก

set search_path = pos, public, extensions;

/*
  สองสถานะใหม่ และลำดับใหม่.

  `on conflict do nothing` ที่คีย์ แล้วค่อยอัปเดตลำดับแยก เพื่อให้สีที่ร้านแก้เอง
  ไว้แล้วไม่ถูกเขียนทับเมื่อรันซ้ำ
*/
insert into ws_statuses (key, bg, text_color, dot, sort_order) values
  ('จัดส่งแล้วบางส่วน', '#FBF1DA', '#8A5A12', '#E8B23D', 3),
  ('ตัดหนี้สูญ', '#EDE7E3', '#6B5F55', '#9A8F86', 7)
on conflict (key) do nothing;

update ws_statuses set sort_order = v.sort_order
  from (values
    ('รออนุมัติราคา', 1),
    ('รอจัดส่ง', 2),
    ('จัดส่งแล้วบางส่วน', 3),
    ('จัดส่งแล้ว', 4),
    ('ค้างชำระ', 5),
    ('ปิดงานแล้ว', 6),
    ('เสร็จสิ้น', 6),
    ('ตัดหนี้สูญ', 7)
  ) as v(key, sort_order)
 where ws_statuses.key = v.key and ws_statuses.sort_order is distinct from v.sort_order;

/**
 * ยอดที่ต้องเก็บ และยอดที่เก็บได้แล้ว ของ PO ใบหนึ่ง.
 *
 * กติกาเดียวกับฝั่งแอป (`lib/domain/orders.ts`): ยอดสุทธิคือสินค้า หักของที่คืน
 * ตามราคาบรรทัดที่มันถูกขายไป (0080) หักการปรับราคาที่อนุมัติแล้ว (0051) ส่วน
 * เงินนับเฉพาะที่รับจริง เช็คที่แค่แจ้งไว้ยังไม่ใช่เงิน (0048)
 */
create or replace function order_money(p_order_id text)
returns table (total numeric, paid numeric)
language sql
stable
security invoker
set search_path = pos
as $$
  select
    coalesce((select sum(i.qty * i.requested_price) from order_items i where i.order_id = p_order_id), 0)
    - coalesce((
        select sum(r.qty * coalesce(
          (select i.requested_price from order_items i
            where i.order_id = p_order_id and i.uid = r.item_uid and r.item_uid <> ''),
          (select i2.requested_price from order_items i2
            where i2.order_id = p_order_id and i2.name = r.item_name order by i2.id limit 1),
          0))
          from order_returns r where r.order_id = p_order_id
      ), 0)
    - coalesce((
        select sum(a.amount) from order_adjustments a
         where a.order_id = p_order_id and a.status = 'อนุมัติแล้ว'
      ), 0) as total,
    coalesce((
      select sum(p.amount) from order_payments p
       where p.order_id = p_order_id and p.status = 'รับเงินแล้ว'
    ), 0) as paid;
$$;

revoke all on function order_money(text) from public, anon;
grant execute on function order_money(text) to authenticated;

/**
 * สถานะที่ PO ใบนี้ "ควรจะเป็น" ตามสิ่งที่เกิดขึ้นกับมันจริง ๆ.
 *
 * คืน null เมื่อไม่ควรแตะ — สถานะที่คนตัดสินใจไว้เอง (ตัดหนี้สูญ) และสถานะปิดงาน
 * ที่ร้านตั้งเอง ไม่ใช่สิ่งที่กิจกรรมจะมาเขียนทับ
 */
create or replace function order_auto_status(p_order_id text)
returns text
language plpgsql
stable
security invoker
set search_path = pos
as $$
declare
  v_status text;
  v_items int;
  v_sent numeric;
  v_money record;
  v_closing text;
  v_fully boolean;
begin
  select status into v_status from orders where id = p_order_id;
  if v_status is null then return null; end if;

  -- หนี้ที่ตัดทิ้งแล้ว เป็นการตัดสินใจของคน ไม่ใช่ผลของกิจกรรม
  if v_status = 'ตัดหนี้สูญ' then return null; end if;

  select count(*) into v_items from order_items where order_id = p_order_id;
  -- ใบเปล่ายังไม่ใช่งาน การเดาสถานะให้มันคือการเดาจากความว่าง
  if v_items = 0 then return null; end if;

  select coalesce(sum(li.qty), 0) into v_sent
    from order_delivery_items li
    join order_deliveries d on d.id = li.delivery_id
   where d.order_id = p_order_id;

  select * into v_money from order_money(p_order_id);
  v_fully := order_fully_delivered(p_order_id);

  /*
    ชื่อของสถานะปิดงาน ร้านตั้งเอง (production: เสร็จสิ้น, seed: ปิดงานแล้ว)
    จึงอ่านจากทะเบียน แทนที่จะเขียนชื่อไว้ในโค้ด
  */
  select key into v_closing
    from ws_statuses
   where key not in ('รออนุมัติราคา', 'รอจัดส่ง', 'จัดส่งแล้วบางส่วน', 'จัดส่งแล้ว', 'ค้างชำระ', 'ตัดหนี้สูญ')
   order by sort_order
   limit 1;

  -- ยังไม่ได้ส่งอะไรเลย: อยู่ที่ขั้นราคา
  if v_sent <= 0 then
    -- รอผู้บริหารอยู่ไหม — ส่วนลดต่ำกว่าราคามาตรฐาน หรือการปรับราคาที่ยังไม่อนุมัติ
    if exists (
      select 1 from order_items where order_id = p_order_id and requested_price < list_price
    ) and v_status = 'รออนุมัติราคา' then
      return 'รออนุมัติราคา';
    end if;
    if exists (
      select 1 from order_adjustments where order_id = p_order_id and status = 'รออนุมัติ'
    ) then
      return 'รออนุมัติราคา';
    end if;
    return 'รอจัดส่ง';
  end if;

  -- ส่งของไปแล้ว: เงินเป็นตัวตัดสินที่เหลือ
  if v_money.paid >= v_money.total - 0.005 then
    return case when v_fully then coalesce(v_closing, 'ปิดงานแล้ว') else 'จัดส่งแล้วบางส่วน' end;
  end if;
  return 'ค้างชำระ';
end;
$$;

revoke all on function order_auto_status(text) from public, anon;
grant execute on function order_auto_status(text) to authenticated;

/**
 * เขียนสถานะที่คำนวณได้ลง PO.
 *
 * `security definer` และปักธงไว้ก่อนเขียน เพราะด่านสิทธิ์เปลี่ยนสถานะ (0055)
 * ไม่ควรขวางสิ่งที่ระบบคำนวณเอง — คนที่บันทึกการรับเงินไม่จำเป็นต้องมีสิทธิ์
 * เปลี่ยนสถานะ PO และไม่ควรต้องมี เพราะเขาไม่ได้เป็นคนเลือกสถานะนั้น
 */
create or replace function apply_order_auto_status(p_order_id text)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_next text;
  v_now text;
begin
  v_next := order_auto_status(p_order_id);
  if v_next is null then return; end if;
  select status into v_now from orders where id = p_order_id;
  if v_now is not distinct from v_next then return; end if;

  perform set_config('pos.auto_status', '1', true);
  update orders set status = v_next where id = p_order_id;
  perform set_config('pos.auto_status', '', true);
end;
$$;

revoke all on function apply_order_auto_status(text) from public, anon;
grant execute on function apply_order_auto_status(text) to authenticated;

/*
  ด่านสิทธิ์เปลี่ยนสถานะ เปิดทางให้สิ่งที่ระบบคำนวณเอง.

  0079's body with one clause added at the top of the capability checks. The
  evidence gate stays above it: a PO still may not claim จัดส่งแล้ว without the
  date, the note and the photograph, whoever — or whatever — is asking.
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    if auth.role() = 'service_role' then
      return new;
    end if;

    if new.status = 'จัดส่งแล้ว' and old.status is distinct from 'จัดส่งแล้ว' then
      if new.delivered_at is null then
        raise exception 'ต้องระบุวันที่จัดส่งก่อน จึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(trim(new.delivery_note), '') = '' then
        raise exception 'ต้องกรอกข้อมูลการจัดส่ง (ขนส่ง/เลขพัสดุ/ผู้รับ) ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(array_length(new.delivery_attachments, 1), 0) = 0 then
        raise exception 'ต้องแนบหลักฐานการจัดส่งอย่างน้อยหนึ่งไฟล์ ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
    end if;

    -- สถานะที่ระบบคำนวณจากกิจกรรม ไม่ใช่สิ่งที่ใครเลือก จึงไม่มีสิทธิ์ให้ตรวจ
    if current_setting('pos.auto_status', true) = '1' then
      return new;
    end if;

    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ตัดหนี้สูญ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'จัดส่งแล้ว'
       and new.delivered_at is not null
       and (old.delivered_at is null or order_fully_delivered(new.id)) then
      return new;
    end if;
    if new.status = 'รอจัดส่ง'
       and old.status = 'จัดส่งแล้ว'
       and not order_fully_delivered(new.id) then
      return new;
    end if;
    raise exception 'forbidden: ไม่มีสิทธิ์เปลี่ยนสถานะ PO';
  end if;
  return new;
end;
$$;

/**
 * ทุกกิจกรรมที่ขยับสถานะได้ เรียกตัวคำนวณซ้ำ.
 *
 * ผูกไว้ที่ตารางลูก ไม่ใช่ที่ชั้นแอป เพราะเส้นทางที่เขียนข้อมูลพวกนี้มีหลายทาง
 * (ฟอร์ม PO, ปุ่มยืนยันเงินเข้า, การบันทึกรอบส่งของ, การลบรอบ) และสถานะที่ถูก
 * เฉพาะบางเส้นทาง คือสถานะที่เชื่อไม่ได้
 */
create or replace function order_child_touched()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_row jsonb;
  v_order text;
begin
  /*
    อ่านแถวผ่าน jsonb เพราะทริกเกอร์ตัวเดียวนี้แขวนอยู่บนหกตาราง.

    การเขียน `new.delivery_id` ไว้ในกิ่งของ CASE ไม่ได้แปลว่ามันจะถูกอ่านเฉพาะ
    ตอนที่กิ่งนั้นเป็นจริง — plpgsql ผูกชื่อฟิลด์ตอนประมวลผลทั้งนิพจน์ ตารางที่
    ไม่มีคอลัมน์นั้นจึงพังทันทีที่ทริกเกอร์ทำงาน
  */
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);

  if tg_table_name = 'order_delivery_items' then
    select d.order_id into v_order
      from order_deliveries d
     where d.id = (v_row->>'delivery_id')::bigint;
  else
    v_order := v_row->>'order_id';
  end if;

  if v_order is not null then
    perform apply_order_auto_status(v_order);
  end if;
  return null;
end;
$$;

drop trigger if exists order_items_auto_status on order_items;
create trigger order_items_auto_status
  after insert or update or delete on order_items
  for each row execute function order_child_touched();

drop trigger if exists order_payments_auto_status on order_payments;
create trigger order_payments_auto_status
  after insert or update or delete on order_payments
  for each row execute function order_child_touched();

drop trigger if exists order_returns_auto_status on order_returns;
create trigger order_returns_auto_status
  after insert or update or delete on order_returns
  for each row execute function order_child_touched();

drop trigger if exists order_adjustments_auto_status on order_adjustments;
create trigger order_adjustments_auto_status
  after insert or update or delete on order_adjustments
  for each row execute function order_child_touched();

drop trigger if exists order_deliveries_auto_status on order_deliveries;
create trigger order_deliveries_auto_status
  after insert or update or delete on order_deliveries
  for each row execute function order_child_touched();

drop trigger if exists order_delivery_items_auto_status on order_delivery_items;
create trigger order_delivery_items_auto_status
  after insert or update or delete on order_delivery_items
  for each row execute function order_child_touched();

select 'release-0081 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0081', 'auto_order_status') on conflict (version) do nothing;
