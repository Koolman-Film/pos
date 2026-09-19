-- supabase/release-0060.sql
--
-- วันที่รับเงินของใบงาน ต้องไม่ถูกเขียนทับเป็นวันนี้
--
-- รันต่อจาก release-0059.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace. การ update เติม uid แตะเฉพาะแถวที่ uid ยังว่าง จึงไม่เขียน
-- ทับของที่เติมไปแล้ว ไม่มีการแก้จำนวนเงินหรือวันที่ของข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * ทุกรายการรับเงินในใบงานมี uid ประจำตัว ที่อยู่รอดข้ามการกดบันทึก
--   * การบันทึกใบงานที่ไม่ได้ส่งวันที่รับเงินมา จะใช้วันที่เดิมของรายการนั้น
--     แทนที่จะย้ายเงินมาไว้วันที่ปัจจุบัน
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกัน — โค้ดใหม่เพิ่มช่อง "วันที่รับเงิน" ในแต่ละ
--     รายการ และส่ง uid มาด้วย โค้ดเดิมยังบันทึกได้ แต่จะไม่ส่ง uid จึงจับคู่
--     วันที่เดิมไม่ได้ (ตกไปใช้วันที่ที่ส่งมาเหมือนเดิม)

set search_path = pos, public, extensions;

-- ---- 1. กุญแจประจำรายการรับเงิน --------------------------------------------
alter table ticket_payments
  add column if not exists uid text not null default '';

comment on column ticket_payments.uid is
  'คีย์ประจำรายการรับเงินที่หน้าจอสร้างครั้งเดียวตอนเพิ่มแถว — save_ticket_children ลบแล้วเขียนใหม่ทุกครั้ง id จึงไม่คงที่ (0060).';

-- แถวก่อน 0060 ไม่มี uid ให้เติมให้ เพื่อให้การบันทึกครั้งถัดไปจับคู่วันที่เดิมได้
-- แทนที่จะตกไปเป็นวันนี้ ใช้ id เป็นฐานเพราะไม่ซ้ำอยู่แล้ว
update ticket_payments set uid = 'p' || id::text where uid = '';

create unique index if not exists ticket_payments_ticket_uid_key
  on ticket_payments (ticket_id, uid)
  where uid <> '';

comment on index ticket_payments_ticket_uid_key is
  'uid ต้องไม่ซ้ำในใบงานเดียวกัน — กัน payload ที่ส่ง uid ซ้ำเพื่อให้แถวใหม่สืบวันที่รับเงินของแถวเดิม (0060).';

-- ---- 2. บันทึกแล้ววันที่ต้องไม่หาย -----------------------------------------
-- เนื้อในเหมือน 0018 ทุกอย่าง (`create or replace` แก้ทีละบรรทัดไม่ได้ จึงต้อง
-- ยกมาทั้งก้อน รวมด่านล็อกใบงานจาก 0017 ด้วย) เพิ่มเฉพาะ uid และการจำวันที่เดิม
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
  v_prior_paid jsonb;
  v_dupe_count int;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- uid ซ้ำใน payload เดียวกันไม่ใช่การพิมพ์ผิดของผู้ใช้ — หน้าจอสร้าง uid ใหม่
  -- ทุกครั้งที่กดเพิ่มรายการ ถ้าซ้ำแปลว่า payload ถูกแก้มา จึงปฏิเสธทั้งชุด
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

  -- วันที่ของสิ่งที่เก็บอยู่แล้ว คีย์ด้วย uid เก็บไว้ก่อนที่ delete ข้างล่างจะทิ้ง
  select coalesce(jsonb_object_agg(uid, paid_at), '{}'::jsonb)
    into v_prior_paid
    from ticket_payments
   where ticket_id = p_ticket_id and uid <> '';

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at, uid, attachments)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    -- วันที่ที่ส่งมา → วันที่เดิมของ uid นี้ → วันนี้. ลำดับกลางคือสิ่งที่ 0060
    -- เพิ่ม: การบันทึกที่ไม่ได้ส่งวันที่มา จะไม่ย้ายเงินมาไว้วันนี้อีกต่อไป
    coalesce(
      nullif(pay->>'paidAt', '')::date,
      (v_prior_paid ->> coalesce(pay->>'uid', ''))::date,
      current_date
    ),
    coalesce(pay->>'uid', ''),
    -- `jsonb_array_elements_text` over an absent key yields no rows, which
    -- aggregates to NULL — coalesce keeps the NOT NULL default shape.
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(pay->'attachments', '[]'::jsonb))),
      '{}'
    )
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0060', 'ticket_payment_date') on conflict (version) do nothing;
