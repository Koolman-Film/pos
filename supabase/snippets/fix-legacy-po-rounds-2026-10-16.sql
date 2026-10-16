-- supabase/snippets/fix-legacy-po-rounds-2026-10-16.sql
--
-- One-off data fix after release 0077–0085.
--
-- These POs were marked delivered before delivery rounds existed, but never got
-- `orders.delivered_at`, so 0077's backfill gave them no round. 0081 derives a
-- PO's status from its rounds, so the next edit of any of them (a payment, a
-- line change) would have reset it to รอจัดส่ง. Each gets the same one full
-- round 0077 gives a delivered PO, so its status stays what the shop set.
--
-- What it does NOT change:
--   - stock: every round is stamped stock_deducted_at (the PO's own stamp, or
--     now), so no code path will ever deduct stock for it;
--   - revenue: orders.delivered_at stays null, so the revenue report (which
--     only counts POs with delivered_at) reads these POs exactly as before;
--   - the PO list is explicit — reviewed by the owner on 2026-10-16.
--
-- Safe to re-run: skips a PO that already has a round.
-- Undo: delete from pos.order_deliveries where uid = 'legacy-' || order_id
--       and order_id in (<same list>);  -- items cascade

set search_path = pos, public, extensions;

create temp table fix_targets (id text primary key) on commit drop;
insert into fix_targets values
  -- ค้างชำระ, unpaid — stay ค้างชำระ
  ('WS-FN-0009'), ('WS-FN-0010'), ('WS-FN-0011'), ('WS-FN-0012'),
  ('WS-FN-0013'), ('WS-FN-0026'), ('WS-FN-0050'), ('WS-FN-0051'),
  ('WS-FN-0053'), ('WS-FN-0055'), ('WS-FN-0056'), ('WS-FN-0057'),
  -- เสร็จสิ้น, fully paid — stay เสร็จสิ้น
  ('WS-FN-0005'), ('WS-FN-0006'), ('WS-FN-0054'),
  -- เสร็จสิ้น but 3,000 short (55,500 billed, 52,500 paid) — becomes ค้างชำระ
  ('WS-FN-0007');

insert into order_deliveries (
  order_id, uid, delivered_at, note, attachments, stock_deducted_at, created_by, created_at
)
select
  o.id,
  'legacy-' || o.id,
  coalesce(o.delivered_at, (o.created_at at time zone 'Asia/Bangkok')::date),
  case when o.delivery_note <> '' then o.delivery_note
       else 'รอบย้อนหลัง: PO นี้ถูกบันทึกว่าส่งแล้วก่อนมีระบบรอบส่งของ (เพิ่มให้ 16 ต.ค. 2569)' end,
  o.delivery_attachments,
  coalesce(o.stock_deducted_at, now()),
  null,
  now()
from orders o
join fix_targets t on t.id = o.id
where o.deleted_at is null
  and not exists (select 1 from order_deliveries d where d.order_id = o.id);

insert into order_delivery_items (delivery_id, item_uid, item_name, qty)
select d.id, i.uid, i.name, i.qty
from order_deliveries d
join fix_targets t on t.id = d.order_id
join order_items i on i.order_id = d.order_id
where d.uid = 'legacy-' || d.order_id
  and not exists (select 1 from order_delivery_items li where li.delivery_id = d.id);

-- the auto-status triggers already ran on the inserts; return the result
select o.id, o.status, pos.order_auto_status(o.id) as auto
  from orders o join fix_targets t on t.id = o.id
 order by o.id;
