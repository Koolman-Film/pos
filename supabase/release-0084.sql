-- supabase/release-0084.sql
--
-- รายได้ Finnix ระบุเป็นจำนวนเงินได้ ไม่ใช่ทั้งบรรทัดหรือไม่เอาเลย
--
-- รันต่อจาก release-0083.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists, update เฉพาะแถวที่ยังเป็น 0
-- และ create or replace function
--
-- หลังรันไฟล์นี้ แต่ละรายการสินค้าในใบงานระบุได้ว่า "ส่วนนี้กี่บาทเป็นของ
-- Finnix" ส่วนที่เหลือเป็นของสาขา — เดิมเลือกได้แค่ทั้งบรรทัดหรือไม่เอาเลย
--
-- และหน้าการชำระเงินของใบงานสรุปให้สามบรรทัด: ขายเป็นรายได้ Finnix เท่าไหร่ ·
-- เข้าบัญชีที่เจ้าของเป็น Finnix แล้วเท่าไหร่ (อ่านจาก 0069 ไม่ต้องกรอกซ้ำ) ·
-- เหลือต้องจ่ายคืนเท่าไหร่
--
-- รายงานรายได้แยกบรรทัดที่แบ่งกันออกเป็นสองบรรทัด — ฝั่งสาขาเข้ายอดขาย ฝั่ง
-- Finnix เข้าเงินรอคืน ซึ่งเป็นกติกาเดิมของรายงานทุกประการ
--
-- ของเดิมไม่ขยับ: ทุกบรรทัดที่เป็น 'รับแทน' ได้ finnix_amount เท่ายอดสุทธิของ
-- ตัวเอง ที่เหลือได้ 0 ใบงานที่บันทึกไปแล้วจึงนับเหมือนเมื่อวานทุกบาท

set search_path = pos, public, extensions;

alter table ticket_items
  add column if not exists finnix_amount numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.ticket_items'::regclass
       and conname = 'ticket_items_finnix_amount_check'
  ) then
    alter table ticket_items
      add constraint ticket_items_finnix_amount_check check (finnix_amount >= 0);
  end if;
end $$;

comment on column ticket_items.finnix_amount is
  'บาทของบรรทัดนี้ที่เป็นรายได้ Finnix ส่วนที่เหลือเป็นของสาขา (0084). 0 = ของสาขาทั้งบรรทัด';

/*
  ยอดสุทธิของหนึ่งบรรทัด — ราคาขายหักส่วนลดของบรรทัดนั้น.

  สูตรเดียวกับ `itemNetPrice` ใน lib/domain/tickets.ts ซึ่งเป็นสูตรที่ทั้งแอป
  ใช้คิดเงิน มีสองที่ก็จริง แต่ที่นี่ต้องใช้ตอน backfill และตอนตัดเพดานใน
  `save_ticket_children` ซึ่งเป็นงานของฐานข้อมูล ไม่ใช่ของหน้าจอ
*/
create or replace function ticket_item_net(
  p_sold_price numeric,
  p_discount_type text,
  p_discount_value numeric
) returns numeric
language sql immutable
as $$
  select greatest(
    0,
    case
      when p_discount_type is null or p_discount_value is null then coalesce(p_sold_price, 0)
      when p_discount_type = 'percent'
        then coalesce(p_sold_price, 0) - coalesce(p_sold_price, 0) * p_discount_value / 100
      else coalesce(p_sold_price, 0) - p_discount_value
    end
  );
$$;

-- ของเดิม: 'รับแทน' = ทั้งบรรทัดเป็นของ Finnix
update ticket_items
   set finnix_amount = ticket_item_net(sold_price, discount_type, discount_value)
 where revenue_kind = 'รับแทน'
   and finnix_amount = 0;

/*
  `save_ticket_children` รับ finnixAmount และคำนวณ revenue_kind ให้เอง.

  ตัวเดิมของ 0073 ทั้งดุ้น เปลี่ยนเฉพาะการเขียนสองคอลัมน์นี้ — `create or
  replace` เขียนทับทั้งตัว อะไรที่ไม่เขียนกลับมาคือของที่หายไป

  ตัดเพดานที่ยอดสุทธิของบรรทัด: ยอด Finnix ที่มากกว่าที่ขายได้ไม่ใช่ข้อมูล
  มันคือการพิมพ์ผิด และถ้าปล่อยผ่าน รายได้สาขาจะกลายเป็นติดลบ
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
      revenue_kind, finnix_doc_no, finnix_amount
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
      v_finnix
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

select 'release-0084 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0084', 'item_finnix_amount') on conflict (version) do nothing;
