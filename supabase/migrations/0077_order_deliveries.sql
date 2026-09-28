-- supabase/migrations/0077_order_deliveries.sql
--
-- ส่งของหลายรอบใน PO เดียว
--
-- ระบบเดิมคิดว่า PO หนึ่งใบส่งครั้งเดียวจบ: `orders.delivered_at` มีวันเดียว
-- `delivery_note` กับ `delivery_attachments` มีชุดเดียว และสต๊อกถูกตัดทั้งใบ
-- ในครั้งแรกที่ออกใบส่งของ (0054) ของจริงไม่ได้เป็นแบบนั้น — ลูกค้าส่งสั่ง 200
-- ม้วน รับไปก่อน 80 ที่เหลือรออีกสองสัปดาห์ (ร้านแจ้ง 28 ก.ย. 2569)
--
-- ผลที่ตามมาไม่ใช่แค่ความไม่สะดวก: ของที่ยังอยู่บนชั้นถูกตัดออกไปแล้วตั้งแต่รอบ
-- แรก และยอดขายทั้ง PO ถูกบันทึกลงเดือนที่ส่งรอบแรกทั้งก้อน PO ที่ส่งคร่อมเดือน
-- จึงรายงานผิดทั้งสองเดือน
--
-- โครงใหม่: **รอบส่งของเป็นแถวของตัวเอง** (`order_deliveries`) แต่ละรอบมีวันที่
-- หลักฐาน และจำนวนที่ส่งแยกรายสินค้า (`order_delivery_items`) สต๊อกตัดทีละรอบ
-- และยอดขายรับรู้ตามวันของรอบนั้น
--
-- `orders.delivered_at` ยังอยู่ และยังหมายถึงวันที่ส่งรอบแรก — รายงานและ
-- แดชบอร์ดที่อ่านคอลัมน์นี้อยู่จึงไม่พังระหว่างทาง ส่วน `delivery_note` และ
-- `delivery_attachments` กลายเป็น "ของรอบล่าสุด" เพราะด่านหลักฐาน (0055) อ่าน
-- สองคอลัมน์นี้ตอนเปลี่ยนสถานะ
--
-- ของเดิมไม่ถูกแตะ: PO ที่ส่งไปแล้วทุกใบได้รอบส่งของหนึ่งรอบที่สร้างจากข้อมูล
-- ของมันเอง พร้อม `stock_deducted_at` ที่คัดลอกมา กติกาใหม่จึงไม่ตัดสต๊อกซ้ำ

set search_path = pos, public, extensions;

/*
  คีย์ประจำรายการสินค้า ที่อยู่รอดข้ามการบันทึก.

  `save_order_children` ลบลูกทั้งหมดแล้วใส่กลับใหม่ทุกครั้งที่บันทึก PO — id ของ
  แถวจึงเปลี่ยนทุกครั้ง นี่คือเหตุผลที่การรับเงิน (0048) การปรับราคา (0051) และ
  การคืนของ (0054) ต่างมี uid ของตัวเอง ตอนนี้รายการสินค้าต้องมีบ้าง เพราะรอบ
  ส่งของชี้มาที่รายการ และการชี้ด้วย "ชื่อสินค้า" พังทันทีที่ PO มีสินค้าชื่อ
  เดียวกันสองบรรทัดคนละราคา
*/
alter table order_items
  add column if not exists uid text not null default '';

comment on column order_items.uid is
  'คีย์ประจำรายการที่ไคลเอนต์สร้าง อยู่รอดข้ามการบันทึก (0077). รอบส่งของชี้มาที่คีย์นี้';

-- ของเดิมได้คีย์จาก id ที่มันถืออยู่ตอนนี้ — เสถียรพอ เพราะทำก่อนการบันทึกครั้งต่อไป
update order_items set uid = 'legacy-' || id where uid = '';

create unique index if not exists order_items_uid_idx
  on order_items (order_id, uid)
  where uid <> '';

/*
  รอบส่งของ.

  หนึ่งแถวคือของออกจากคลังหนึ่งเที่ยว: วันที่ที่ยอดขายของเที่ยวนั้นเกิด ข้อมูล
  การจัดส่ง หลักฐาน และตราประทับว่าตัดสต๊อกไปแล้วหรือยัง
*/
create table if not exists order_deliveries (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  -- คีย์ที่ไคลเอนต์สร้าง กันการกดส่งซ้ำจากการกดปุ่มสองครั้ง
  uid text not null default '',
  delivered_at date not null,
  note text not null default '',
  attachments text[] not null default '{}',
  -- ตัดสต๊อกของรอบนี้ไปแล้วหรือยัง null = ยังไม่ได้ตัด. กันตัดซ้ำแบบเดียวกับ
  -- `orders.stock_deducted_at` (0054) แต่ทีละรอบ
  stock_deducted_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table order_deliveries is
  'รอบส่งของของ PO หนึ่งใบ (0077). หนึ่งแถว = ของออกจากคลังหนึ่งเที่ยว';

create index if not exists order_deliveries_order_idx on order_deliveries (order_id);
create index if not exists order_deliveries_date_idx on order_deliveries (delivered_at);

create unique index if not exists order_deliveries_uid_idx
  on order_deliveries (order_id, uid)
  where uid <> '';

create table if not exists order_delivery_items (
  id bigint generated always as identity primary key,
  delivery_id bigint not null references order_deliveries(id) on delete cascade,
  -- ชี้ที่ `order_items.uid` ไม่ใช่ id: id เปลี่ยนทุกครั้งที่บันทึก PO
  item_uid text not null default '',
  -- ชื่อ ณ วันที่ส่ง เก็บไว้เพื่อให้ใบส่งของย้อนหลังอ่านได้ แม้รายการถูกแก้ชื่อ
  item_name text not null default '',
  qty numeric not null
);

comment on table order_delivery_items is
  'จำนวนที่ส่งจริงของแต่ละรายการ ในรอบส่งของหนึ่งรอบ (0077)';

create index if not exists order_delivery_items_delivery_idx
  on order_delivery_items (delivery_id);

-- RLS เหมือนลูกคนอื่นของ PO: เห็นและแก้ได้เฉพาะ PO ของสาขาตัวเอง
alter table order_deliveries enable row level security;
alter table order_delivery_items enable row level security;

drop policy if exists order_deliveries_rw on order_deliveries;
create policy order_deliveries_rw on order_deliveries
  for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

drop policy if exists order_delivery_items_rw on order_delivery_items;
create policy order_delivery_items_rw on order_delivery_items
  for all
  using (
    delivery_id in (
      select d.id from order_deliveries d
      join orders o on o.id = d.order_id
      where o.shop_id in (select current_user_shops())
    )
  );

grant select, insert, update, delete on order_deliveries to authenticated;
grant select, insert, update, delete on order_delivery_items to authenticated;

/*
  PO ที่ส่งไปแล้ว ได้รอบส่งของหนึ่งรอบจากข้อมูลของตัวเอง.

  ไม่ใช่แค่ความเรียบร้อย: หลังไฟล์นี้ รายงานรายได้อ่านยอดขายจากรอบส่งของ ถ้า PO
  เก่าไม่มีรอบ ยอดขายที่เคยรายงานไปแล้วจะหายไปทั้งก้อน

  `stock_deducted_at` คัดลอกมาจาก PO ตรง ๆ — ของพวกนี้ตัดสต๊อกไปแล้ว การตัดซ้ำคือ
  ความเสียหายจริงบนชั้นวาง
*/
insert into order_deliveries (
  order_id, uid, delivered_at, note, attachments, stock_deducted_at, created_by, created_at
)
select
  o.id,
  'legacy-' || o.id,
  o.delivered_at,
  o.delivery_note,
  o.delivery_attachments,
  o.stock_deducted_at,
  o.created_by,
  o.created_at
from orders o
where o.delivered_at is not null
  and not exists (select 1 from order_deliveries d where d.order_id = o.id);

insert into order_delivery_items (delivery_id, item_uid, item_name, qty)
select d.id, i.uid, i.name, i.qty
from order_deliveries d
join order_items i on i.order_id = d.order_id
where d.uid = 'legacy-' || d.order_id
  and not exists (select 1 from order_delivery_items li where li.delivery_id = d.id);

/**
 * ส่งไปแล้วกี่ชิ้น ต่อรายการ.
 *
 * อ่านจากรอบส่งของ ไม่ใช่จากสถานะ — สถานะบอกได้แค่ว่า "ส่งแล้ว/ยังไม่ส่ง"
 * ส่วนคำถามที่ทุกด่านข้างล่างถามคือ "เหลือให้ส่งอีกเท่าไหร่"
 */
create or replace function order_delivered_qty(p_order_id text)
returns table (item_uid text, qty numeric)
language sql
stable
security invoker
set search_path = pos
as $$
  select li.item_uid, sum(li.qty)
    from order_delivery_items li
    join order_deliveries d on d.id = li.delivery_id
   where d.order_id = p_order_id
   group by li.item_uid;
$$;

/** ส่งครบทุกรายการแล้วหรือยัง. PO ที่ไม่มีรายการสินค้าเลย ยังไม่นับว่าส่งครบ. */
create or replace function order_fully_delivered(p_order_id text)
returns boolean
language sql
stable
security invoker
set search_path = pos
as $$
  select exists (select 1 from order_items where order_id = p_order_id)
     and not exists (
       select 1
         from order_items i
         left join order_delivered_qty(p_order_id) d on d.item_uid = i.uid
        where i.order_id = p_order_id
          and coalesce(d.qty, 0) < i.qty
     );
$$;

revoke all on function order_delivered_qty(text) from public, anon;
revoke all on function order_fully_delivered(text) from public, anon;
grant execute on function order_delivered_qty(text) to authenticated;
grant execute on function order_fully_delivered(text) to authenticated;

/**
 * บันทึกรอบส่งของหนึ่งรอบ.
 *
 * `p_delivery` = { uid, date, note, attachments: [], items: [{uid, name, qty}] }
 *
 * ด่านที่นี่คือด่านจริง ไม่ใช่ที่หน้าจอ: การส่งเกินจำนวนที่สั่งคือของหายจากชั้น
 * โดยไม่มีใบสั่งรองรับ และหลักฐานการจัดส่งคือสิ่งเดียวที่ร้านมีเมื่อลูกค้าบอก
 * ว่าไม่ได้รับของ (เหตุผลเดียวกับ 0055)
 *
 * คืนค่า id ของรอบ เพื่อให้ฝั่งเซิร์ฟเวอร์ไปตัดสต๊อกของรอบนั้นต่อ
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
begin
  if not exists (select 1 from orders where id = p_order_id) then
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

  /*
    คอลัมน์เดิมบน orders ยังต้องตรงกับความจริง.

    `delivered_at` = วันของรอบแรก (รายงานและแดชบอร์ดอ่านอยู่) ส่วนข้อมูลการจัดส่ง
    และหลักฐาน = ของรอบล่าสุด เพราะด่านหลักฐาน (0055) อ่านสองคอลัมน์นี้ตอน
    เปลี่ยนสถานะ
  */
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
 * ลบรอบส่งของที่บันทึกผิด.
 *
 * คืนค่าเป็น jsonb ว่ารอบนั้นตัดสต๊อกไปแล้วหรือยัง และมีอะไรเท่าไหร่ เพื่อให้
 * ฝั่งเซิร์ฟเวอร์เอาของกลับขึ้นชั้นได้ — ฟังก์ชันนี้ไม่ยุ่งกับสต๊อกเอง ด้วยเหตุผล
 * เดียวกับที่การส่งของไม่ยุ่ง: การจับคู่ชื่อสินค้ากับคลังอยู่ที่ชั้นแอป
 *
 * ต้องมีสิทธิ์ `wholesale.updateStatus` — การบันทึกส่งของใครก็ทำได้ แต่การลบทิ้ง
 * คือการย้อนของกลับขึ้นชั้นและเปิด PO ที่ปิดไปแล้วกลับมา จึงเป็นเรื่องของคนที่
 * ดูแลสถานะ PO อยู่แล้ว
 *
 * สถานะที่ปิดไปแล้วเพราะส่งครบ ถูกเปิดกลับเป็น "รอจัดส่ง" เมื่อของไม่ครบอีกต่อไป
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

  update orders
     set delivered_at = (select min(delivered_at) from order_deliveries where order_id = v_order_id),
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
  ด่านสิทธิ์เปลี่ยนสถานะ ต้องรู้จักการส่งหลายรอบ.

  0055's body, ยกมาทั้งดุ้น แก้ข้อเดียว: ทางผ่านสำหรับ "คนส่งของ" เดิมเปิดเฉพาะ
  ตอน `old.delivered_at is null` — ซึ่งพอส่งหลายรอบ รอบปิดท้ายจะมีวันที่อยู่แล้ว
  เสมอ คนที่ส่งของรอบสุดท้ายจึงปิด PO ไม่ได้ทั้งที่ของครบแล้ว เงื่อนไขจึงเปลี่ยน
  เป็น "ส่งครบทุกรายการแล้ว" ซึ่งเป็นสิ่งที่ข้อเดิมพยายามพูดตั้งแต่แรก
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    -- แบ็กเอนด์ที่ถือ service_role (seed, สคริปต์ซ่อมข้อมูล, ชุดทดสอบ) ไม่ได้ผ่าน
    -- หน้าจอ จึงไม่มี auth.uid() ให้ตรวจสิทธิ์ และจะโดนปฏิเสธทุกครั้ง
    if auth.role() = 'service_role' then
      return new;
    end if;

    -- หลักฐานการจัดส่ง ก่อนเรื่องสิทธิ์: this is about the row being complete,
    -- not about who is asking, so it applies to everyone including an admin.
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

    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    -- คนที่เพิ่งส่งของเสร็จ ปิด PO ได้ — ไม่ว่าจะส่งรอบเดียวจบหรือรอบสุดท้าย
    if new.status = 'จัดส่งแล้ว'
       and new.delivered_at is not null
       and (old.delivered_at is null or order_fully_delivered(new.id)) then
      return new;
    end if;
    -- เลิกบอกว่าส่งแล้วทั้งที่ของยังไม่ครบ (เกิดตอนลบรอบส่งของ) ไม่ใช่การ
    -- ตัดสินใจของใคร แต่เป็นการหยุดพูดสิ่งที่ข้อมูลในแถวเองบอกว่าไม่จริง
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

/*
  `save_order_children` ถือ uid ของรายการสินค้า และกันไม่ให้แก้ทับของที่ส่งไปแล้ว.

  ตัวเดิมทั้งดุ้น (0054/0063) บวกสองอย่าง: uid ของรายการ และด่านที่ปฏิเสธการลด
  จำนวนต่ำกว่าที่ส่งไปจริง หรือการลบรายการที่ส่งไปแล้วทิ้ง — ถ้ายอมให้ทำ รอบส่ง
  ของจะชี้ไปที่รายการที่ไม่มีอยู่ และของที่ออกจากคลังไปแล้วจะไม่มีใบสั่งรองรับ
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
