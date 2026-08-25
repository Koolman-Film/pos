-- supabase/release-0027.sql
--
-- ต้นทุนตามล็อต — รับของแต่ละรอบเก็บราคาของตัวเอง, ตัดของเก่าก่อน (FIFO)
--
-- รันต่อจาก release-0026.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, add column if not exists, insert แบบ guard ด้วย not exists
--
-- หมายเหตุสำคัญ:
--   1) ของที่มีอยู่ตอนนี้จะถูกตั้งเป็น "ล็อตยกมา" ล็อตเดียว ใช้ราคาทุนปัจจุบัน
--      ย้อนหลังแยกเป็นรอบ ๆ ไม่ได้เพราะไม่เคยเก็บไว้ — ตั้งแต่รันไฟล์นี้ทุกรอบแยกกัน
--   2) stock.cost เลิกพิมพ์เอง กลายเป็นค่าเฉลี่ยถ่วงน้ำหนักของล็อตที่เหลือ
--      คำนวณอัตโนมัติทุกครั้งที่สต็อกขยับ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0027_stock_batches.sql
--
-- ต้นทุนตามล็อต — รับของแต่ละรอบเก็บราคาของตัวเอง, ตัดของเก่าก่อน (FIFO)
--
-- `stock.cost` was one number per product, overwritten every time a delivery
-- arrived. Buy ten rolls at 800 and ten more at 950, and the shop is told all
-- twenty cost 950: the stock is valued 1,500 too high and the cost of any one
-- job cannot be worked out at all.
--
-- A LOT is one delivery. It carries its own unit cost and remembers how much of
-- it is left, so "what did we pay that round" stays answerable for as long as
-- the goods are on the shelf. Consumption draws from the oldest lot first, which
-- is what the shop already does physically — you finish the roll that is open.
--
-- Three pieces:
--   stock_batches           — one row per delivery
--   stock_movement_batches  — which lots a movement drew from, and at what cost
--   move_stock / receive_stock — allocate, cost, and record, in one call
--
-- `stock.cost` stops being typed in and becomes the weighted average of what is
-- left. It is derived now, so it cannot be wrong.
--
-- Lots start the day this runs. Whatever is on the shelf becomes ONE opening lot
-- at the cost currently recorded — the earlier rounds were never kept, so there
-- is nothing to split it into.

set search_path = pos, public, extensions;

create table if not exists stock_batches (
  id bigint generated always as identity primary key,
  stock_id bigint not null references stock(id) on delete cascade,
  -- Denormalised so RLS can scope without joining, like stock_movements.
  shop_id text not null references shops(id) on delete cascade,

  received_at date not null default current_date,
  -- Where it came from. The moment of receiving is the only time anyone knows
  -- this, and it was never captured before.
  supplier text not null default '',
  doc_no text not null default '',

  qty_received numeric(12, 2) not null,
  -- Drawn down by consumption; a lot at zero is spent but stays for its history.
  qty_remaining numeric(12, 2) not null,
  unit_cost numeric(12, 2) not null default 0,

  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null,
  created_by_name text not null default ''
);

comment on table stock_batches is
  'ล็อตสินค้า — การรับของหนึ่งรอบ พร้อมต้นทุนของรอบนั้นและจำนวนคงเหลือ';

-- FIFO reads this every time stock is consumed, oldest first.
create index if not exists stock_batches_fifo_idx
  on stock_batches (stock_id, received_at, id)
  where qty_remaining > 0;
create index if not exists stock_batches_stock_idx on stock_batches (stock_id, received_at desc);

alter table stock_batches enable row level security;
drop policy if exists stock_batches_rw on stock_batches;
create policy stock_batches_rw on stock_batches for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

/**
 * ล็อตที่การเคลื่อนไหวหนึ่งครั้งไปตัดมา.
 *
 * A job that needs six rolls when the open lot has four takes from two lots at
 * two different prices. This is that split — it is what makes the cost of the
 * job a real figure rather than an average, and what lets a cancellation put
 * each roll back where it came from.
 */
create table if not exists stock_movement_batches (
  id bigint generated always as identity primary key,
  movement_id bigint not null references stock_movements(id) on delete cascade,
  batch_id bigint not null references stock_batches(id) on delete cascade,
  qty numeric(12, 2) not null,
  unit_cost numeric(12, 2) not null
);

create index if not exists stock_movement_batches_movement_idx
  on stock_movement_batches (movement_id);
create index if not exists stock_movement_batches_batch_idx on stock_movement_batches (batch_id);

alter table stock_movement_batches enable row level security;
drop policy if exists stock_movement_batches_rw on stock_movement_batches;
create policy stock_movement_batches_rw on stock_movement_batches for all
  using (movement_id in (select id from stock_movements where shop_id in (select current_user_shops())))
  with check (movement_id in (select id from stock_movements where shop_id in (select current_user_shops())));

-- The money side of a movement: what the goods that moved actually cost.
alter table stock_movements
  add column if not exists cost_total numeric(12, 2) not null default 0;

comment on column stock_movements.cost_total is
  'ต้นทุนของที่เคลื่อนไหวครั้งนี้ (บวกเมื่อรับเข้า, ลบเมื่อตัดออก) — มาจากล็อตจริง ไม่ใช่ค่าเฉลี่ย';

/**
 * ต้นทุนเฉลี่ยของที่เหลือ — เขียนกลับลง stock.cost.
 *
 * `cost` used to be typed in and overwritten; it is derived now, so it cannot
 * disagree with the lots. A product with nothing left keeps its last known cost
 * rather than dropping to zero, because zero would read as "free" on the next
 * report rather than "none in stock".
 */
create or replace function refresh_stock_cost(p_stock_id bigint)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_qty numeric;
  v_value numeric;
begin
  select coalesce(sum(qty_remaining), 0), coalesce(sum(qty_remaining * unit_cost), 0)
    into v_qty, v_value
    from stock_batches
   where stock_id = p_stock_id;

  if v_qty > 0 then
    update stock set cost = round(v_value / v_qty, 2) where id = p_stock_id;
  end if;
end;
$$;

revoke all on function refresh_stock_cost(bigint) from public, anon;
grant execute on function refresh_stock_cost(bigint) to authenticated;

/**
 * รับของเข้า — สร้างล็อตใหม่พร้อมต้นทุนของรอบนี้.
 *
 * Receiving is the one movement that CREATES cost rather than spending it, so
 * it gets its own entry point. The lot, the quantity and the ledger line are
 * written together; `stock.cost` is recomputed from the lots afterwards rather
 * than being overwritten with whatever this delivery happened to cost.
 */
create or replace function receive_stock(
  p_stock_id bigint,
  p_qty numeric,
  p_unit_cost numeric,
  p_supplier text,
  p_doc_no text,
  p_by_name text,
  p_note text default ''
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
  v_name text;
  v_shop text;
  v_batch_id bigint;
  v_movement_id bigint;
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'จำนวนที่รับเข้าต้องมากกว่า 0';
  end if;

  select qty, name, shop_id into v_before, v_name, v_shop
    from stock where id = p_stock_id for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้' using errcode = 'P0002';
  end if;

  insert into stock_batches (
    stock_id, shop_id, received_at, supplier, doc_no,
    qty_received, qty_remaining, unit_cost, note, created_by, created_by_name
  ) values (
    p_stock_id, v_shop, current_date, coalesce(p_supplier, ''), coalesce(p_doc_no, ''),
    p_qty, p_qty, coalesce(p_unit_cost, 0), coalesce(p_note, ''), auth.uid(), coalesce(p_by_name, '')
  )
  returning id into v_batch_id;

  update stock set qty = v_before + p_qty where id = p_stock_id;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    p_stock_id, v_name, v_shop, 'รับเข้า', coalesce(p_doc_no, ''),
    p_qty, v_before, v_before + p_qty, p_qty * coalesce(p_unit_cost, 0),
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_movement_id;

  insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
  values (v_movement_id, v_batch_id, p_qty, coalesce(p_unit_cost, 0));

  perform refresh_stock_cost(p_stock_id);
  return v_batch_id;
end;
$$;

revoke all on function receive_stock(bigint, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function receive_stock(bigint, numeric, numeric, text, text, text, text) to authenticated;

/**
 * เปลี่ยนจำนวนสต็อก พร้อมลงบัญชีและคิดต้นทุนจากล็อตจริง.
 *
 * Replaces the 0026 version, which moved quantities correctly but had no notion
 * of what they cost.
 *
 *   * CONSUMING draws from the oldest lot with anything left, then the next, and
 *     records the split. Six rolls out of a lot holding four costs 4×800 + 2×950,
 *     not 6× an average.
 *   * RETURNING (a cancelled job, a rejected withdrawal) puts the goods back into
 *     the lots that document took them from, newest allocation first, so the cost
 *     that came off comes back exactly. With nothing to match — stock returned
 *     against no earlier consumption — it lands in the newest open lot.
 *   * Consuming more than the lots hold is allowed and costed at whatever the
 *     lots could cover. The quantity still goes negative, which is the signal
 *     0025 deliberately kept; a shortfall in COST would otherwise be invented.
 */
create or replace function move_stock(
  p_changes jsonb,
  p_kind text,
  p_document_id text,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  r record;
  b record;
  v_before numeric;
  v_name text;
  v_shop text;
  v_movement_id bigint;
  v_left numeric;
  v_take numeric;
  v_cost numeric;
begin
  for r in
    select x.id, x.change
      from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(id bigint, change numeric)
     where x.id is not null and coalesce(x.change, 0) <> 0
  loop
    select qty, name, shop_id into v_before, v_name, v_shop
      from stock where id = r.id for update;
    continue when not found;

    update stock set qty = v_before + r.change where id = r.id;

    insert into stock_movements (
      stock_id, item_name, shop_id, kind, document_id,
      change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
    ) values (
      r.id, v_name, v_shop, p_kind, coalesce(p_document_id, ''),
      r.change, v_before, v_before + r.change, 0,
      auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
    )
    returning id into v_movement_id;

    v_cost := 0;

    if r.change < 0 then
      -- ตัดออก: ของเก่าก่อน
      v_left := -r.change;
      for b in
        select id, qty_remaining, unit_cost
          from stock_batches
         where stock_id = r.id and qty_remaining > 0
         order by received_at, id
           for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, b.qty_remaining);
        update stock_batches set qty_remaining = qty_remaining - v_take where id = b.id;
        insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
        values (v_movement_id, b.id, -v_take, b.unit_cost);
        v_cost := v_cost - v_take * b.unit_cost;
        v_left := v_left - v_take;
      end loop;
    else
      -- คืนเข้า: กลับเข้าล็อตที่เอกสารนี้เคยตัดไป ใหม่สุดก่อน
      v_left := r.change;
      for b in
        select mb.batch_id, mb.unit_cost, sum(-mb.qty) as taken
          from stock_movement_batches mb
          join stock_movements m on m.id = mb.movement_id
         where m.stock_id = r.id
           and m.document_id = coalesce(p_document_id, '')
           and mb.qty < 0
         group by mb.batch_id, mb.unit_cost
         order by mb.batch_id desc
      loop
        exit when v_left <= 0;
        v_take := least(v_left, b.taken);
        update stock_batches set qty_remaining = qty_remaining + v_take where id = b.batch_id;
        insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
        values (v_movement_id, b.batch_id, v_take, b.unit_cost);
        v_cost := v_cost + v_take * b.unit_cost;
        v_left := v_left - v_take;
      end loop;

      -- Nothing to match it against: put the remainder in the newest open lot,
      -- so the quantity and the lots stay in step.
      if v_left > 0 then
        select id, unit_cost into b from stock_batches
         where stock_id = r.id order by received_at desc, id desc limit 1 for update;
        if found then
          update stock_batches set qty_remaining = qty_remaining + v_left where id = b.id;
          insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
          values (v_movement_id, b.id, v_left, b.unit_cost);
          v_cost := v_cost + v_left * b.unit_cost;
        end if;
      end if;
    end if;

    update stock_movements set cost_total = v_cost where id = v_movement_id;
    perform refresh_stock_cost(r.id);
  end loop;
end;
$$;

revoke all on function move_stock(jsonb, text, text, text, text) from public, anon;
grant execute on function move_stock(jsonb, text, text, text, text) to authenticated;

/*
  ล็อตยกมา — whatever is on the shelf today, at the cost currently recorded.

  The earlier rounds were never kept, so this cannot be split into the deliveries
  it really came from. One lot, dated today, marked as carried forward: from here
  on every round stands on its own.
*/
insert into stock_batches (
  stock_id, shop_id, received_at, supplier, doc_no,
  qty_received, qty_remaining, unit_cost, note, created_by_name
)
select s.id, s.shop_id, current_date, '', '',
       s.qty, s.qty, coalesce(s.cost, 0), 'ยกมาก่อนเริ่มระบบล็อต', 'ระบบ'
  from stock s
 where s.qty > 0
   and not exists (select 1 from stock_batches b where b.stock_id = s.id);

/**
 * ปรับสต็อกตามผลนับจริง — ให้ล็อตเดินตามผลนับด้วย.
 *
 * The 0026 version set `qty` and wrote a ledger line, which was right when a
 * quantity was all there was. With lots it is not enough: a count that finds
 * fewer than the lots say leaves the two disagreeing, and `stock.cost` is
 * derived from the lots, so the shop's stock value would quietly stop matching
 * the shelf.
 *
 * It delegates to `move_stock` now. A shortfall is drawn down FIFO — the goods
 * are simply not there, and the oldest are the ones missing. A surplus goes into
 * the newest lot, because that is the most likely price of something found late.
 */
create or replace function count_stock(
  p_id bigint,
  p_counted numeric,
  p_by_name text,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_before numeric;
begin
  select qty into v_before from stock where id = p_id for update;
  if not found or v_before = p_counted then
    return;
  end if;

  perform move_stock(
    jsonb_build_array(jsonb_build_object('id', p_id, 'change', p_counted - v_before)),
    'ปรับสต็อก',
    '',
    p_by_name,
    p_note
  );
end;
$$;

revoke all on function count_stock(bigint, numeric, text, text) from public, anon;
grant execute on function count_stock(bigint, numeric, text, text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0027', 'stock_batches') on conflict (version) do nothing;
