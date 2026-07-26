-- supabase/migrations/0010_ticket_item_actual_qty.sql
--
-- Persists the per-product quantities a technician actually used on a job, and
-- makes automatic stock movement real.
--
-- The prototype tracked this as `item.actualQtyMap` (a product -> qty map on each
-- ticket item, reference/v0.4/finnix-film.html:1409-1421) and, whenever a number
-- changed, immediately decremented `stock.qty` for that product at that shop and
-- appended a withdrawal log row typed `ตัดสต็อกจากใบงาน (<ticket id>)` with status
-- `อนุมัติแล้ว`. The same happened on the wholesale side at :2700-2712, typed
-- `ตัดสต็อกจากขายส่ง (<order id>)`.
--
-- The port had ported the *arithmetic* but not the *persistence*: the map was
-- dropped in serialize.ts and never sent to the server, and the stock decrement
-- was applied to a client-side `useState` copy that vanished on the next
-- navigation. So recording actual usage changed nothing, and no audit row was ever
-- written — a silent functional regression against the prototype, in the one area
-- where the shop's physical inventory has to match the system.
--
-- `jsonb` mirrors the prototype's map shape and the existing `tech_by_category` /
-- `extras` columns: it is edited only through the ticket form as a whole and is
-- never filtered on independently, so normalising it into a table would buy
-- nothing.
--
-- No new table is needed for the audit trail: `withdrawals` (migration 0006)
-- already has item / shop / qty / type / withdrawn_by / withdrawn_at / status,
-- which is exactly the shape the prototype's log entries used. A system-generated
-- movement is distinguished by its `type` prefix and by `withdrawn_by` being
-- `ระบบ (ใบงาน)` / `ระบบ (ขายส่ง)`, and lands as `อนุมัติแล้ว` because it records
-- something that already physically happened rather than requesting it.

-- Everything below is created in the `pos` schema, not `public` — see
-- 0000_pos_schema.sql for why. This applies for the rest of the file.
set search_path = pos, public, extensions;

alter table ticket_items
  add column actual_qty jsonb not null default '{}';

comment on column ticket_items.actual_qty is
  'Product name -> quantity actually used on this job item. Drives automatic stock movement on save; see lib/stock/movements.ts.';

-- A negative withdrawal quantity is meaningful here: it is a return to stock
-- (`คืนสต็อกจาก...`), which is how the prototype represented a downward revision
-- of actual usage. Documented so a future `check (qty > 0)` is not added by
-- reflex.
comment on column withdrawals.qty is
  'Signed. Positive = taken out of stock, negative = returned to stock (a downward revision of recorded usage).';
