-- supabase/migrations/0028_stock_transfer.sql
--
-- โอนสต็อกระหว่างสาขา — ต้นทุนเดินทางไปกับของ
--
-- Moving stock between branches had no operation at all. The shop did it by
-- withdrawing at one branch and adding at the other, which produced two
-- unrelated records, broke the history in half, and — since receiving asked for
-- a price — let the same goods arrive at a cost somebody typed from memory.
--
-- A transfer is ONE act with two ends. It draws FIFO from the source, and lands
-- at the destination as lots carrying THE SAME unit costs: the goods did not
-- become cheaper or dearer by being driven down the road. Both ends are written
-- to the ledger, each pointing at the other's branch, so the pair can be read
-- back as one movement.
--
-- The destination row is found by name within that branch, or created empty and
-- received into — the same rule the rest of the module uses to match a product
-- across shops (migration 0025's unique index makes it unambiguous).

set search_path = pos, public, extensions;

/**
 * โอนสินค้าจากสาขาหนึ่งไปอีกสาขา.
 *
 * Refuses to move more than the source holds. Consumption elsewhere may go
 * negative deliberately — that is a miscount worth seeing — but a transfer of
 * goods that are not there is not a signal, it is a mistake, and it would create
 * stock at the destination out of nothing.
 *
 * Returns the destination `stock.id`, which the caller needs to show where the
 * goods went.
 */
create or replace function transfer_stock(
  p_from_stock_id bigint,
  p_to_shop_id text,
  p_qty numeric,
  p_by_name text,
  p_note text default ''
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_src stock%rowtype;
  v_dest_id bigint;
  v_before_src numeric;
  v_before_dst numeric;
  v_out_movement bigint;
  v_in_movement bigint;
  v_new_batch bigint;
  v_left numeric;
  v_take numeric;
  v_cost numeric := 0;
  b record;
begin
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'จำนวนที่โอนต้องมากกว่า 0';
  end if;

  select * into v_src from stock where id = p_from_stock_id for update;
  if not found then
    raise exception 'ไม่พบสินค้าต้นทาง' using errcode = 'P0002';
  end if;
  if v_src.shop_id = p_to_shop_id then
    raise exception 'สาขาต้นทางและปลายทางเป็นสาขาเดียวกัน';
  end if;
  if v_src.qty < p_qty then
    raise exception 'สต็อกต้นทางไม่พอ (มี %, ต้องการโอน %)', v_src.qty, p_qty;
  end if;

  -- The same product at the destination, or a new row for it. Created EMPTY:
  -- the quantity arrives through the lots below, so it is always backed by cost.
  select id into v_dest_id from stock where shop_id = p_to_shop_id and name = v_src.name;
  if v_dest_id is null then
    insert into stock (sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price)
    values (
      -- `sku` is unique across the whole system, so a per-branch suffix is the
      -- only way the same product can exist at two shops.
      v_src.sku || '-' || upper(p_to_shop_id),
      v_src.name, v_src.short_name, v_src.category,
      p_to_shop_id, 0, v_src.min_qty, 0, v_src.sell_price
    )
    returning id into v_dest_id;
  end if;

  select qty into v_before_dst from stock where id = v_dest_id for update;
  v_before_src := v_src.qty;

  update stock set qty = v_before_src - p_qty where id = p_from_stock_id;
  update stock set qty = v_before_dst + p_qty where id = v_dest_id;

  -- Each end names the OTHER branch, so one row explains where the goods went
  -- and the other where they came from.
  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    p_from_stock_id, v_src.name, v_src.shop_id, 'โอนออก', p_to_shop_id,
    -p_qty, v_before_src, v_before_src - p_qty, 0,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_out_movement;

  insert into stock_movements (
    stock_id, item_name, shop_id, kind, document_id,
    change, qty_before, qty_after, cost_total, moved_by, moved_by_name, note
  ) values (
    v_dest_id, v_src.name, p_to_shop_id, 'โอนเข้า', v_src.shop_id,
    p_qty, v_before_dst, v_before_dst + p_qty, 0,
    auth.uid(), coalesce(p_by_name, ''), coalesce(p_note, '')
  )
  returning id into v_in_movement;

  -- FIFO out of the source, mirrored into the destination lot by lot. The unit
  -- cost is carried across unchanged: goods do not change price by moving.
  v_left := p_qty;
  for b in
    select id, qty_remaining, unit_cost, supplier, doc_no
      from stock_batches
     where stock_id = p_from_stock_id and qty_remaining > 0
     order by received_at, id
       for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, b.qty_remaining);

    update stock_batches set qty_remaining = qty_remaining - v_take where id = b.id;
    insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
    values (v_out_movement, b.id, -v_take, b.unit_cost);

    insert into stock_batches (
      stock_id, shop_id, received_at, supplier, doc_no,
      qty_received, qty_remaining, unit_cost, note, created_by, created_by_name
    ) values (
      v_dest_id, p_to_shop_id, current_date, b.supplier, b.doc_no,
      v_take, v_take, b.unit_cost, 'โอนจากสาขา ' || v_src.shop_id,
      auth.uid(), coalesce(p_by_name, '')
    )
    returning id into v_new_batch;

    insert into stock_movement_batches (movement_id, batch_id, qty, unit_cost)
    values (v_in_movement, v_new_batch, v_take, b.unit_cost);

    v_cost := v_cost + v_take * b.unit_cost;
    v_left := v_left - v_take;
  end loop;

  update stock_movements set cost_total = -v_cost where id = v_out_movement;
  update stock_movements set cost_total = v_cost where id = v_in_movement;

  perform refresh_stock_cost(p_from_stock_id);
  perform refresh_stock_cost(v_dest_id);

  return v_dest_id;
end;
$$;

revoke all on function transfer_stock(bigint, text, numeric, text, text) from public, anon;
grant execute on function transfer_stock(bigint, text, numeric, text, text) to authenticated;
