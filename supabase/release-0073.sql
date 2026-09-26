-- supabase/release-0073.sql
--
-- เลขที่เอกสารจาก PEAK แยกทีละรายการสินค้า
--
-- รันต่อจาก release-0072.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์แบบ if not exists, create or replace function
-- และการย้ายเลขเดิมจากใบงานมาไว้ที่รายการ ทำเฉพาะรอบที่คอลัมน์เดิมยังอยู่
--
-- หลังรันไฟล์นี้ ช่องเลขที่เอกสาร PEAK จะอยู่ใต้ปุ่ม "รายได้ Finnix" ของแต่ละ
-- รายการ ใบงานที่มีของ Finnix สองชนิดจึงเก็บได้สองเลข เลขที่กรอกไว้ก่อนหน้านี้
-- ทีละใบงาน (0072) จะถูกย้ายไปใส่ทุกรายการที่เป็นรายได้ Finnix ของใบงานนั้น
-- แล้วคอลัมน์เดิมบน tickets จะถูกลบทิ้ง
--
-- กรอกได้แม้ใบงานปิดแล้วเหมือนเดิม เพราะเลขมักมาจากฝ่ายบัญชีหลังรถออกไปแล้ว
-- และเลขนี้โผล่ในชีท รายได้ Finnix ของรายงานรายได้ ไว้กระทบยอด

--
-- เลขที่เอกสาร PEAK แยกทีละรายการสินค้า
--
-- 0072 เก็บเลขไว้หนึ่งเลขต่อหนึ่งใบงาน โดยให้เหตุผลว่าการเคลียร์กับ Finnix
-- สำหรับรถคันหนึ่งคือรายการเดียว ร้านบอกว่าไม่ใช่: Finnix ออกเอกสารแยกตาม
-- ชนิดสินค้า ใบงานที่มีของ Finnix สองรายการจึงมีสองเลข (ร้านเลือก 26 ก.ย. 2569)
--
-- So the number follows the line, like the รายได้ Finnix flag it belongs to
-- (0068). `tickets.finnix_doc_no` is moved onto that ticket's held lines and
-- then dropped: two places to write the same fact is how they end up
-- disagreeing, and the report would have to pick one.
--
-- แก้ได้แม้ใบงานปิดแล้ว, as in 0072 — the number arrives from the accounts days
-- after the car has gone. That needs two things now that it lives on the line:
-- the item lock (0066) has to let this column through, and there has to be a
-- write path that touches nothing else.

set search_path = pos, public, extensions;

alter table ticket_items
  add column if not exists finnix_doc_no text not null default '';

comment on column ticket_items.finnix_doc_no is
  'เลขที่เอกสารใน PEAK ของรายการนี้ เมื่อเป็นรายได้ Finnix (0073). ว่าง = ยังไม่ได้กรอก';

-- ย้ายของเดิมจากใบงานมาไว้ที่รายการที่เป็นของ Finnix, then drop the old home.
-- Guarded on the column still existing: the second run has nothing to move,
-- and naming a dropped column is a parse error, not a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'tickets' and column_name = 'finnix_doc_no'
  ) then
    execute $move$
      update ticket_items i
         set finnix_doc_no = t.finnix_doc_no
        from tickets t
       where t.id = i.ticket_id
         and coalesce(t.finnix_doc_no, '') <> ''
         and i.revenue_kind = 'รับแทน'
         and i.finnix_doc_no = ''
    $move$;
    alter table tickets drop column finnix_doc_no;
  end if;
end $$;

-- อ่านตอนกระทบยอดกับ PEAK: which held lines still have no document number.
create index if not exists ticket_items_finnix_doc_idx
  on ticket_items (ticket_id)
  where revenue_kind = 'รับแทน' and finnix_doc_no = '';

/*
  ด่านล็อกของใบงาน กลับไปเป็นของ 0066.

  0072 added `finnix_doc_no` to the columns a locked ticket may still change.
  The column is gone from `tickets`, so the list goes back to what it was —
  `to_jsonb` naming a column that no longer exists would be a lie left in the
  code for the next reader to trip over.
*/
create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if old.locked and not current_user_can('list.unlock') then
    -- ข้อมูลเพิ่มเติม (0022) และ ข้อมูลของช่าง (0066) only. Dropping those keys
    -- from both sides makes this true exactly when nothing else moved —
    -- including `locked` itself, which is why neither can quietly reopen the
    -- ticket.
    if to_jsonb(new) - 'extras' - 'tech_by_category'
       = to_jsonb(old) - 'extras' - 'tech_by_category' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop function if exists save_ticket_finnix_doc(text, text);

/*
  ด่านล็อกของรายการสินค้า รับเลขเอกสารเพิ่มอีกหนึ่งคอลัมน์.

  0066's body with `finnix_doc_no` on the list. Same reasoning as the one it
  joins: the lock is about ยอดขายและค่าคอมมิชชั่น, and a reference to a document
  in another system moves neither.
*/
create or replace function enforce_ticket_item_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if exists (select 1 from tickets where id = new.ticket_id and locked)
     and not current_user_can('list.unlock') then
    -- จำนวนที่ใช้จริง (0066) และเลขที่เอกสาร PEAK (0073) only. Everything else
    -- — price, discount, the product sold — is what the lock is for.
    if to_jsonb(new) - 'actual_qty' - 'finnix_doc_no'
       = to_jsonb(old) - 'actual_qty' - 'finnix_doc_no' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขรายการสินค้าไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

/**
 * บันทึกเฉพาะเลขที่เอกสาร PEAK ของแต่ละรายการ — ใช้ได้แม้ใบงานถูกล็อกแล้ว.
 *
 * `p_docs` is one string per ticket item, in the order the items load —
 * `["IV6809-0042", ""]` — matched by position, exactly as `save_ticket_tech`
 * matches quantities, and guarded by the same count check: a mismatch means
 * the form is looking at a stale list, and writing to the wrong row is worse
 * than refusing.
 */
create or replace function save_ticket_item_finnix_docs(p_ticket_id text, p_docs jsonb)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_items bigint;
  v_given int;
begin
  select count(*) into v_items from ticket_items where ticket_id = p_ticket_id;
  v_given := jsonb_array_length(coalesce(p_docs, '[]'::jsonb));

  if v_given <> v_items then
    raise exception 'รายการสินค้าในใบงานเปลี่ยนไปแล้ว กรุณาเปิดใบงานใหม่แล้วบันทึกอีกครั้ง'
      using errcode = '55000';
  end if;

  with ord as (
    select id, row_number() over (order by id) as seq
      from ticket_items
     where ticket_id = p_ticket_id
  ), given as (
    select value, n
      from jsonb_array_elements_text(coalesce(p_docs, '[]'::jsonb)) with ordinality as e(value, n)
  )
  update ticket_items i
     set finnix_doc_no = coalesce(btrim(given.value), '')
    from ord
    join given on given.n = ord.seq
   where i.id = ord.id;
end;
$$;

revoke all on function save_ticket_item_finnix_docs(text, jsonb) from public, anon;
grant execute on function save_ticket_item_finnix_docs(text, jsonb) to authenticated;

/*
  `save_ticket_children` carries the new field.

  0068's body with `finnix_doc_no` added to the insert and nothing else
  touched — the lock guard, the duplicate-uid rejection and the paid_at
  fallback are all still here.
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
      revenue_kind, finnix_doc_no
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
      -- is what every line was before 0068.
      case when v_item->>'revenueKind' = 'รับแทน' then 'รับแทน' else 'รายได้' end,
      coalesce(btrim(v_item->>'finnixDocNo'), '')
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

select 'release-0073 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0073', 'item_finnix_doc') on conflict (version) do nothing;
