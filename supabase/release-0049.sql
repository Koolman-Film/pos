-- supabase/release-0049.sql
--
-- กำหนดชำระเงินของ PO ขายส่ง
--
-- รันต่อจาก release-GO-LIVE.sql (หรือ release-0048.sql)
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
--
-- ขายส่งส่งของก่อน แล้วค่อยเก็บเงินทีหลัง — so every PO carries an unspoken credit
-- term, and until now the system held no record of it anywhere. The invoice and
-- the delivery note went out saying what was owed and saying nothing about when,
-- which leaves the shop chasing on memory and gives the customer nothing to
-- answer to.
--
-- Deliberately a DATE the shop sets per PO rather than a term in days on the
-- customer: the same buyer gets 30 days on one order and cash-on-delivery on the
-- next, and a stored term would be quietly wrong on the exception rather than
-- absent. Null means nobody agreed a date — the documents then print nothing at
-- all, which is honest, rather than inventing one from the delivery date.

set search_path = pos, public, extensions;

alter table orders
  add column if not exists due_at date;

comment on column orders.due_at is
  'กำหนดชำระเงินของ PO ใบนี้ — พิมพ์บนใบแจ้งหนี้และใบส่งของ. null = ยังไม่ได้ตกลงวันไว้.';

-- The question this index answers: which POs are past their date and still owed.
create index if not exists orders_due_idx on orders (due_at)
  where due_at is not null;
insert into supabase_migrations.schema_migrations(version, name) values ('0049', 'order_due_date') on conflict (version) do nothing;
