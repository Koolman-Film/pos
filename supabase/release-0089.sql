-- supabase/release-0089.sql
--
-- วันที่รับงาน/ส่งงาน รายบรรทัด — สำหรับสินค้าที่ซื้อเพิ่มทีหลัง
--
-- รันต่อจาก release-0088.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists, เช็ก pg_constraint ก่อนเพิ่ม
-- และ create or replace function
--
-- ใบงานหนึ่งใบมีวันรับกับวันส่งคู่เดียว ซึ่งถูกตอนที่รถเข้ามาทำทุกอย่างในรอบ
-- เดียว แต่ของจริงมีกรณีที่ลูกค้ากลับมาซื้อเพิ่มทีหลัง แล้วรายการนั้นถูกเพิ่ม
-- ลงในใบงานใบเดิม (ร้านแจ้ง 7 พ.ย. 2569)
--
-- ตอนนี้บรรทัดที่ซื้อวันที่ 20 กับบรรทัดที่ซื้อวันที่ 5 อ่านว่าเป็นงานวันเดียว
-- กันทั้งคู่ เพราะทั้งสองยืมวันของหัวใบงานไปใช้ ใบงานขายที่พิมพ์ออกมาจึงบอก
-- วันเดียว ทั้งที่ของสองชิ้นนั้นส่งมอบกันคนละวัน
--
-- ทางเลือกที่ไม่เลือก: ให้เปิดใบงานใหม่สำหรับของที่ซื้อเพิ่ม — ซึ่งจะแตก
-- ประวัติของรถคันเดียวออกเป็นหลายใบ ทั้งที่ร้านคิดว่ามันคืองานเดียวกัน และจะ
-- ทำให้ยอดรวมของงานนั้นต้องบวกเอาเองจากหลายใบ
--
-- NULL = ใช้วันของใบงาน ซึ่งเป็นพฤติกรรมเดิมทุกอย่าง ของเก่าทุกแถวจึงไม่ขยับ
-- และงานปกติที่ทำรอบเดียวก็ไม่ต้องกรอกอะไรเพิ่ม
--
-- เก็บเป็น date ไม่ใช่ timestamptz เหมือนหัวใบงาน: คำถามของบรรทัดคือ "ของชิ้น
-- นี้ส่งมอบวันไหน" ไม่ใช่กี่โมง ส่วนเวลานัดยังเป็นของทั้งใบงานเหมือนเดิม

set search_path = pos, public, extensions;

alter table ticket_items
  add column if not exists received_at date,
  add column if not exists delivered_at date;

/*
  ส่งของก่อนรับงานไม่มีอยู่จริง.

  กฎเดียวกับที่ 0085 ใส่ให้หัวใบงาน — ถ้ายอมให้สลับกันได้ ใบงานขายที่แยกตาม
  วันจะเรียงของออกมาผิดลำดับ และไม่มีใครรู้ว่าวันไหนคือวันที่ลูกค้ารับของไป
*/
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_items_dates_in_order'
  ) then
    alter table ticket_items
      add constraint ticket_items_dates_in_order
      check (received_at is null or delivered_at is null or delivered_at >= received_at);
  end if;
end$$;

comment on column ticket_items.received_at is
  'วันที่รับงานของบรรทัดนี้ — NULL = ใช้วันของใบงาน (0089)';
comment on column ticket_items.delivered_at is
  'วันที่ส่งงานของบรรทัดนี้ — NULL = ใช้วันของใบงาน (0089)';

/*
  `save_ticket_children` เก็บสองวันนี้ด้วย.

  ตัวเดิมของ 0084 ทั้งดุ้น เพิ่มเฉพาะสองคอลัมน์ — `create or replace` เขียนทับ
  ทั้งตัว อะไรที่ไม่เขียนกลับมาคือของที่หายไป

  `nullif(..., '')` เพราะช่องวันที่ที่ว่างอยู่ส่งมาเป็นสตริงว่าง ซึ่งแปลว่า
  "ใช้วันของใบงาน" ไม่ใช่วันที่ที่อ่านไม่ออก
*/
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
  v_net numeric;
  v_finnix numeric;
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
    v_net := ticket_item_net(
      coalesce((v_item->>'soldPrice')::numeric, 0),
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric
    );
    /*
      ไม่ส่ง finnixAmount มาเลย = หน้าจอรุ่นเก่า อ่านจากธงเดิมแทน
      ส่งมา = ตัวเลขคือคำตอบ และธงถูกคำนวณจากมัน
    */
    v_finnix := case
      when v_item ? 'finnixAmount'
        then least(greatest(coalesce((v_item->>'finnixAmount')::numeric, 0), 0), v_net)
      when v_item->>'revenueKind' = 'รับแทน' then v_net
      else 0
    end;

    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty,
      revenue_kind, finnix_doc_no, finnix_amount, received_at, delivered_at
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
      coalesce(v_item->'actualQty', '{}'::jsonb),
      /*
        ธงคำนวณจากตัวเลข ไม่รับจากหน้าจอ — บรรทัดที่แบ่งกันเป็น 'รายได้'
        เพราะคำถามที่คอลัมน์นี้ถูกถามจริง ๆ คือ "ใบนี้มีอะไรเป็นของสาขาไหม"
      */
      case
        -- บรรทัดที่ยังไม่มีราคาไม่มีเงินให้แบ่ง ธงที่ส่งมาจึงเป็นคำตอบเดียวที่มี
        when v_net <= 0 then (case when v_item->>'revenueKind' = 'รับแทน' then 'รับแทน' else 'รายได้' end)
        when v_finnix >= v_net - 0.005 then 'รับแทน'
        else 'รายได้'
      end,
      coalesce(btrim(v_item->>'finnixDocNo'), ''),
      v_finnix,
      -- ว่าง = ใช้วันของใบงาน (0089)
      nullif(v_item->>'receivedAt', '')::date,
      nullif(v_item->>'deliveredAt', '')::date
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

select 'release-0089 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0089', 'item_job_dates') on conflict (version) do nothing;
