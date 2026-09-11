-- supabase/migrations/0051_price_decision_trail.sql
--
-- อนุมัติราคาให้ทิ้งร่องรอย และล็อกการเปลี่ยนสถานะ PO ที่ฐานข้อมูล
--
-- สองช่องโหว่ที่เหลือจากการตรวจโมดูลขายส่ง
--
-- 1. อนุมัติราคาไม่ทิ้งร่องรอย. Approving a below-standard price only moved the
--    PO from รออนุมัติราคา to รอจัดส่ง. Nothing recorded WHO approved it or WHEN,
--    so "ส่วนลดผ่านไปแล้วสาวกลับไม่ได้ว่าใครอนุมัติ" was literally true: the only
--    evidence was a status that anybody could have set. Compare the adjustment
--    approval added in 0050, which records both — the two decisions give away the
--    same money and should leave the same trail.
--
-- 2. ใครก็เปลี่ยนสถานะ PO ได้. `wholesale.updateStatus` was checked in the Server
--    Action and nowhere else, and `orders_rw` lets any member of the branch
--    UPDATE the row — so a signed-in token could PATCH the status straight
--    through PostgREST without ever loading the screen that has the control.
--    Same hole, and the same fix, as ลบ/กู้คืน PO in migration 0040.

set search_path = pos, public, extensions;

alter table orders
  -- 'อนุมัติ' / 'ปฏิเสธ' / '' — the last decision made about this PO's price.
  add column price_decision text not null default '',
  add column price_decided_at date,
  add column price_decided_by uuid references auth.users(id);

alter table orders
  add constraint orders_price_decision_ck
  check (price_decision in ('', 'อนุมัติ', 'ปฏิเสธ'));

comment on column orders.price_decision is
  'ผลการตัดสินใจเรื่องราคาล่าสุด — ใครอนุมัติ/ปฏิเสธ และเมื่อไหร่ อยู่ในอีกสองคอลัมน์.';

/*
  ตัดสินใจเรื่องราคา — อนุมัติ หรือ ปฏิเสธ.

  Replaces two Server Actions that each did a bare `update orders set status`.
  The capability is checked HERE, not only in the action, because the action is a
  plain POST anyone can send (CORRECTION C2) — and the status it writes is now
  also guarded by the trigger below, which this function has to satisfy legally
  rather than sneak past.
*/
create or replace function decide_order_price(p_order_id text, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.priceApproval') then
    raise exception 'forbidden: ไม่มีสิทธิ์อนุมัติราคา';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  -- security definer bypasses RLS, so the branch check has to be made here.
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update orders
  set status = case when p_approve then 'รอจัดส่ง' else 'รออนุมัติราคา' end,
      price_decision = case when p_approve then 'อนุมัติ' else 'ปฏิเสธ' end,
      price_decided_at = current_date,
      price_decided_by = auth.uid()
  where id = p_order_id;
end;
$$;

revoke all on function decide_order_price(text, boolean) from public, anon;
grant execute on function decide_order_price(text, boolean) to authenticated;

/*
  เปลี่ยนสถานะ PO ต้องมีสิทธิ์ — ตรวจที่ฐานข้อมูล.

  Checked per TRANSITION rather than with one blanket key, because three
  different people legitimately move a PO and they hold three different keys:

    - `wholesale.updateStatus` — the general one, any transition.
    - `wholesale.priceApproval` — moves it to รอจัดส่ง or back to รออนุมัติราคา,
      which is what `decide_order_price` above does.
    - `wholesale.badDebt` — moves it to ค้างชำระ when a balance is written off.

  And one transition belongs to no key at all: stamping the delivery date for
  the FIRST time moves the PO to จัดส่งแล้ว. That is not somebody editing a
  status, it is the ใบส่งของ being issued — so it is allowed only in the same
  statement that fills `delivered_at`, and only while it was empty.

  A save that does not touch the status is untouched by any of this, which is
  the common case: most edits to a PO are lines and prices.
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'จัดส่งแล้ว'
       and old.delivered_at is null
       and new.delivered_at is not null then
      return new;
    end if;
    raise exception 'forbidden: ไม่มีสิทธิ์เปลี่ยนสถานะ PO';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_capability on orders;
create trigger orders_status_capability
  before update on orders
  for each row
  execute function enforce_order_status_capability();
