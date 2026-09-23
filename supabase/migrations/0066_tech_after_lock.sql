-- supabase/migrations/0066_tech_after_lock.sql
--
-- ใบงานที่ปิดงานแล้ว: ช่างยังกรอก "ข้อมูลของช่าง" ย้อนหลังได้
--
-- 0017 froze a delivered-and-paid ticket; 0022 let ข้อมูลเพิ่มเติม out of the
-- freeze, because a car comes back for service long after the money is settled.
-- ข้อมูลของช่าง is the same story told by the other half of the shop: the car
-- leaves on Friday and the customer pays at the counter, and on Monday the
-- technician writes down which roll the film actually came off. By then the
-- ticket had locked itself, so recording materials that had already left the
-- shelf needed an admin to reopen a finished job (ร้านขอ 23 ก.ย. 2569).
--
-- WHAT THE LOCK IS FOR is unchanged: ยอดขายและค่าคอมมิชชั่น must not move after
-- the fact. Actual usage is not either of those. It moves STOCK — it says what
-- physically went out of the building — and stock that is wrong is wrong
-- whether or not the ticket is closed. So the freeze narrows once more, to the
-- numbers it was always about.
--
-- Four pieces, the last of which closes a hole this work uncovered:
--   1. `enforce_ticket_lock` accepts an update whose ONLY changed columns are
--      `extras` and `tech_by_category`. Column-by-column via `to_jsonb`, so a
--      column added tomorrow is frozen by default rather than let through.
--   2. `save_ticket_tech()` is the write path the app uses. It sets those two
--      columns and each item's `actual_qty`, and can reach nothing else — not
--      a price, not a payment, not `locked`. "The technician block is open"
--      therefore cannot widen into "the ticket is open".
--   3. Quantities are matched to items BY POSITION, guarded by a count check.
--      That is safe precisely because the ticket is locked: `save_ticket_children`
--      is the only thing that adds or removes items and it refuses a locked
--      ticket, so the list the form is looking at is the list in the table.
--      Items are ordered by `id`, which is the order the form loads them in.
--   4. `enforce_ticket_item_lock` holds the item rows themselves to
--      `actual_qty` while the ticket is locked. See the note above it: the
--      price on a closed job's line could be changed by a direct PostgREST
--      call, and that had to be shut before `actual_qty` was let through.
--
-- WHICH ROWS ARE STILL OPEN — while a quantity is blank, or when แก้งาน is
-- ticked — is decided in TypeScript (`lib/domain/techQty.ts`), for the same
-- reason 0017 left the lock CONDITION there: the rows come from each item's
-- positions and sold product, and a second copy of that in SQL would be free to
-- drift from the boxes the technician actually sees. The database's job here is
-- to bound what such a save may touch, which it does completely.

set search_path = pos, public, extensions;

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

/**
 * บันทึกเฉพาะ ข้อมูลของช่าง — ใช้ได้แม้ใบงานถูกล็อกแล้ว.
 *
 * `p_extras` carries the QC fields too: ผู้รับผิดชอบ, the QC photos, the album
 * link and the install confirmation all live under `extras.__meta` (see
 * components/tickets/serialize.ts), so writing them is writing `extras`.
 *
 * `p_actual_qty` is one jsonb object per ticket item, in the order the items
 * load — `[{"ฟิล์ม 3M CR70": 2}, {}]`. It must have exactly as many entries as
 * the ticket has items, or the form is looking at a stale list and the save is
 * refused rather than written to the wrong row.
 *
 * Stock is NOT moved here. The caller reads the stored totals before this runs
 * and applies the difference afterwards, exactly as a normal ticket save does
 * (app/(app)/tickets/actions.ts), so one product's usage is logged and deducted
 * in one place no matter which of the two paths recorded it.
 */
create or replace function save_ticket_tech(
  p_ticket_id text,
  p_extras jsonb,
  p_tech_by_category jsonb,
  p_actual_qty jsonb
)
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
  v_given := jsonb_array_length(coalesce(p_actual_qty, '[]'::jsonb));

  if v_given <> v_items then
    raise exception 'รายการสินค้าในใบงานเปลี่ยนไปแล้ว กรุณาเปิดใบงานใหม่แล้วบันทึกอีกครั้ง'
      using errcode = '55000';
  end if;

  update tickets
     set extras           = coalesce(p_extras, '{}'::jsonb),
         tech_by_category = coalesce(p_tech_by_category, '{}'::jsonb)
   where id = p_ticket_id;
  if not found then
    raise exception 'ไม่พบใบงานนี้' using errcode = 'P0002';
  end if;

  -- `ordinality` is 1-based and so is `row_number()`, so the nth object lands
  -- on the nth item.
  with ord as (
    select id, row_number() over (order by id) as seq
      from ticket_items
     where ticket_id = p_ticket_id
  ), given as (
    select value, n
      from jsonb_array_elements(coalesce(p_actual_qty, '[]'::jsonb)) with ordinality as e(value, n)
  )
  update ticket_items i
     set actual_qty = coalesce(given.value, '{}'::jsonb)
    from ord
    join given on given.n = ord.seq
   where i.id = ord.id;
end;
$$;

revoke all on function save_ticket_tech(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_tech(text, jsonb, jsonb, jsonb) to authenticated;

/*
  รายการสินค้าในใบงานที่ล็อกแล้ว: แก้ได้แค่จำนวนที่ใช้จริง.

  The lock on the ITEM rows lived only inside `save_ticket_children` — the row
  policy `ticket_items_rw` (0007) lets any member of the branch update any line
  of any ticket, so `sold_price` on a closed job could be changed with a direct
  PostgREST call without ever going near that function. Writing this migration
  is what turned that up, and it has to be shut before `actual_qty` is invited
  through the same door: "ข้อมูลของช่างเปิดอยู่ แต่เงินยังล็อก" is only true if
  the money on these rows is actually held.

  UPDATE only, deliberately. A `before delete` trigger here would also fire
  when a locked ticket is deleted and the rows cascade, and inserts and deletes
  on a closed ticket's lines still have no path through the app —
  `save_ticket_children` refuses the ticket before it reaches them. Those two
  remain as they were today; this closes the one that can move a number.
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
    -- จำนวนที่ใช้จริง only (0066). Everything else — price, discount, the
    -- product sold — is what the lock is for.
    if to_jsonb(new) - 'actual_qty' = to_jsonb(old) - 'actual_qty' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขรายการสินค้าไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_items_lock_guard on ticket_items;
create trigger ticket_items_lock_guard
  before update on ticket_items
  for each row execute function enforce_ticket_item_lock();
