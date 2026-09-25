-- supabase/release-0068.sql
--
-- รายได้สาขา / รับแทน Finnix แยกได้ทีละรายการสินค้า
--
-- รันต่อจาก release-0067.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์แบบ if not exists, เช็ค constraint ก่อนสร้าง,
-- เติมย้อนหลังเฉพาะแถวที่ยังไม่ได้ตั้ง และ create or replace function
--
-- หลังรันไฟล์นี้ ใบงานหนึ่งใบมีได้ทั้งรายการที่เป็นรายได้ของสาขา และรายการที่
-- รับแทน Finnix ปนกัน เงินที่รับมาจะถูกแบ่งตามสัดส่วนราคาของรายการ
-- ข้อมูลเก่าทุกแถวเติมค่าจากใบงานของตัวเอง จึงนับเหมือนเดิมทุกใบ

--
-- รายได้สาขา / รับแทน Finnix แยกได้ทีละรายการสินค้า
--
-- 0031 put รายได้/รับแทน on the TICKET, and said why in as many words: "a whole
-- job is either ours or held for Finnix, never half of each." That was the
-- grain the shop worked at then. It is not any more (ร้านแจ้ง 25 ก.ย. 2569): one
-- job sells several ชนิดสินค้า and only SOME of them belong to another branch —
-- the film is this shop's, the wrap is held, one car, one ใบงาน, one customer
-- paying once.
--
-- With the flag on the ticket the shop had two bad choices: call the whole job
-- ours and overstate its takings by the held part, or call the whole job held
-- and lose the part it really earned. Both put a wrong number on the dashboard
-- and in โมดูลรายได้.
--
-- So the flag moves down to `ticket_items`, one per line.
--
-- `tickets.revenue_kind` STAYS, and the app keeps it in step: รับแทน when every
-- line is held, รายได้ otherwise. Everything reading the ticket column — the
-- tax-invoice guard, the เงินรอคืน Finnix index — therefore keeps answering the
-- question it was actually asking, and a fully-held job reads exactly as it did
-- before. What is new is that a MIXED job is no longer forced to lie.
--
-- ของเดิมไม่ขยับ: every existing line is backfilled from its own ticket, so a
-- job recorded before today counts exactly as it counted yesterday.
--
-- เงินที่รับมาแบ่งตามสัดส่วน. A payment carries no ชนิดสินค้า — the customer
-- hands over one amount for the whole job — so the dashboard already splits each
-- receipt across the ticket's lines in proportion to value
-- (components/dashboard/cashSales.ts). That same split now carries each line's
-- รายได้/รับแทน with it, which is the only honest answer to "how much of this
-- 4,000 baht was ours": the share that bought the lines that were ours.

set search_path = pos, public, extensions;

alter table ticket_items
  add column if not exists revenue_kind text not null default 'รายได้';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.ticket_items'::regclass
       and conname = 'ticket_items_revenue_kind_check'
  ) then
    alter table ticket_items
      add constraint ticket_items_revenue_kind_check
      check (revenue_kind in ('รายได้', 'รับแทน'));
  end if;
end $$;

comment on column ticket_items.revenue_kind is
  'รายได้ = ยอดขายของสาขานี้; รับแทน = เงินรอคืน Finnix ไม่นับเป็นยอดขาย (0068). ทีละรายการ ไม่ใช่ทั้งใบงาน';

-- เติมย้อนหลังจากใบงานของตัวเอง — ของเดิมนับเหมือนเดิมทุกใบ.
update ticket_items i
   set revenue_kind = t.revenue_kind
  from tickets t
 where t.id = i.ticket_id
   and i.revenue_kind = 'รายได้'
   and t.revenue_kind = 'รับแทน';

-- รายงานเงินรอคืน Finnix อ่านจากรายการที่ถือไว้ ซึ่งเป็นส่วนน้อย.
create index if not exists ticket_items_held_idx
  on ticket_items (ticket_id)
  where revenue_kind = 'รับแทน';

/*
  `save_ticket_children` carries the new field.

  0060's body, with `revenue_kind` added to the insert and nothing else touched.
  Reproduced in full because `create or replace function` replaces the whole
  thing — the lock guard, the duplicate-uid rejection and the paid_at fallback
  are all still here, unchanged.
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
      interested, interested_price, discount_type, discount_value, actual_qty,
      revenue_kind
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
      -- A client that does not send it means the line is the branch's, which
      -- is what every line was before this migration.
      case when v_item->>'revenueKind' = 'รับแทน' then 'รับแทน' else 'รายได้' end
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

select 'release-0068 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0068', 'item_revenue_kind') on conflict (version) do nothing;
