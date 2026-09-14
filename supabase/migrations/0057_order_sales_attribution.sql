-- supabase/migrations/0057_order_sales_attribution.sql
--
-- ยอดขายของ PO เป็นของเซลล์ที่เลือก ไม่ใช่ของคนที่เปิด PO
--
-- Finnix North sells through โหน่ง and เคน, but they are not always the ones at
-- the keyboard: a rep on the road rings the office and somebody else raises the
-- PO for them. The shop needs that sale credited to the rep — it is their
-- customer, their phone on the documents, their figure in the per-rep summary —
-- while still knowing who actually keyed it in.
--
-- The module already credits by `orders.sales_by`, never by the logged-in user,
-- so the attribution itself was right. Two things were missing:
--
--   1. ใครเปิด PO. Nothing recorded it, so a PO raised on somebody's behalf was
--      indistinguishable from one they raised themselves, and a disputed PO had
--      no one to ask. `orders.created_by` is set from the session on insert and
--      can never be changed afterwards — like a document number, the record of
--      who raised it is only worth anything if nobody can edit it.
--
--   2. เซลล์ต้องถูกเลือก. A branch with a sales team could save a PO with no rep,
--      and that sale then belonged to nobody: it vanished from every rep's total
--      and the documents printed no one to call. In a branch that HAS reps, a new
--      PO must name one, and a PO that names one cannot be cleared back to
--      nobody.
--
-- **ของเก่าไม่ถูกแตะ.** Existing POs keep `created_by` null (shown as not
-- recorded) and a PO that was already saved without a rep can still be edited
-- — the rule only refuses creating a new unassigned PO, or un-assigning one.

set search_path = pos, public, extensions;

alter table orders
  add column if not exists created_by uuid
    references app_users(id) on delete set null
    default auth.uid();

comment on column orders.created_by is
  'ผู้ใช้ที่เปิด PO — ตั้งจากผู้ที่ล็อกอินตอนสร้าง แก้ไม่ได้ (0057). ยอดขายเป็นของ sales_by ไม่ใช่คนนี้.';

/*
  security definer so the rep lookup does not depend on the caller being able
  to read `sales_people`; nothing here widens what the caller can write, it only
  refuses rows.

  service_role passes untouched, as in 0052: seeds and repair scripts have no
  session to take `created_by` from, and backfilling history is exactly what
  they are for.
*/
create or replace function enforce_order_sales_attribution()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- ใครเปิด PO — from the session, never from the payload, and fixed for good.
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;

  if coalesce(trim(new.sales_by), '') = ''
     and (tg_op = 'INSERT' or coalesce(trim(old.sales_by), '') <> '')
     and exists (
       select 1 from sales_people p
       where p.shop_id = new.shop_id and p.active
     ) then
    raise exception 'ต้องเลือกพนักงานขายเจ้าของยอดขายของ PO นี้';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_sales_attribution on orders;
create trigger orders_sales_attribution
  before insert or update on orders
  for each row
  execute function enforce_order_sales_attribution();
