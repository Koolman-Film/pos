-- supabase/migrations/0030_hot_path_indexes.sql
--
-- ดัชนีของตารางลูก — หน้าเว็บช้าลงเรื่อย ๆ ตามจำนวนใบงานที่สะสม
--
-- The tables from migrations 0004-0006 — tickets, orders and every child row
-- that hangs off them — were created with no index except their primary key.
-- Nothing pointed at `ticket_items.ticket_id`, so reading one ticket's items
-- meant scanning EVERY row of `ticket_items`; and every page that lists tickets
-- embeds their items, payments and status history, so one page view scanned the
-- child tables once per ticket on screen.
--
-- That is quadratic. With the eight tickets a test database holds it is
-- invisible. Measured on this schema at 2,000 tickets, as a signed-in admin with
-- RLS on, the dashboard's ticket query took:
--
--     before   4,033 ms
--     after       25 ms
--
-- Doubling the tickets quadruples the "before" figure and merely doubles the
-- "after" one, which is why the app felt fine in testing and got slower every
-- week it was actually used.
--
-- Indexes only: no table, column, policy or function changes, nothing to roll
-- back, and no application code depends on this file. It is written to run on a
-- database at ANY migration level — every statement is skipped when its table is
-- not there yet — so it can be applied before the other pending releases.

set search_path = pos, public, extensions;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- ---- the hot path: one ticket list = one scan per ticket, per child table
      ('ticket_items',          'ticket_items_ticket_idx',
       'on ticket_items (ticket_id)'),
      ('ticket_item_positions', 'ticket_item_positions_item_idx',
       'on ticket_item_positions (ticket_item_id)'),
      ('ticket_payments',       'ticket_payments_ticket_idx',
       'on ticket_payments (ticket_id)'),
      ('ticket_status_history', 'ticket_status_history_ticket_idx',
       'on ticket_status_history (ticket_id, changed_at desc)'),

      -- ---- the same shape on the wholesale side
      ('order_items',           'order_items_order_idx',       'on order_items (order_id)'),
      ('order_payments',        'order_payments_order_idx',    'on order_payments (order_id)'),
      ('order_returns',         'order_returns_order_idx',     'on order_returns (order_id)'),
      ('order_adjustments',     'order_adjustments_order_idx', 'on order_adjustments (order_id)'),

      -- ---- the orders every page sorts by, without sorting the whole table
      --      (`tickets_live_idx` from 0013 covers shop_id only)
      ('tickets', 'tickets_live_dropoff_idx',
       'on tickets (drop_off_date desc) where deleted_at is null'),
      ('tickets', 'tickets_live_created_idx',
       'on tickets (created_at desc) where deleted_at is null'),
      ('tickets', 'tickets_deleted_idx',
       'on tickets (deleted_at desc) where deleted_at is not null'),
      ('tickets', 'tickets_retail_customer_idx',
       'on tickets (retail_customer_id) where retail_customer_id is not null'),

      -- ---- RLS filters on shop_id for every read of these
      ('orders',      'orders_shop_idx',      'on orders (shop_id)'),
      ('expenses',    'expenses_shop_idx',    'on expenses (shop_id)'),
      ('petty_cash',  'petty_cash_shop_idx',  'on petty_cash (shop_id)'),
      ('withdrawals', 'withdrawals_shop_idx', 'on withdrawals (shop_id)'),
      ('stock',       'stock_shop_idx',       'on stock (shop_id)'),

      -- ---- โมดูลรายได้ reads the whole ledger looking for job consumption; the
      --      ledger is the fastest-growing table in the schema (migration 0026)
      ('stock_movements', 'stock_movements_job_cost_idx',
       'on stock_movements (document_id) where kind in (''ใบงาน'', ''ยกเลิกใบงาน'', ''กู้คืนใบงาน'')')
    ) as t(tbl, idx, def)
  loop
    if to_regclass('pos.' || spec.tbl) is null then
      raise notice 'ข้าม %: ยังไม่มีตาราง % ในฐานข้อมูลนี้', spec.idx, spec.tbl;
      continue;
    end if;
    execute format('create index if not exists %I %s', spec.idx, spec.def);
  end loop;
end $$;

-- The planner has no statistics for a column it has never been asked about.
analyze tickets;
analyze ticket_items;
analyze ticket_payments;
analyze ticket_status_history;
