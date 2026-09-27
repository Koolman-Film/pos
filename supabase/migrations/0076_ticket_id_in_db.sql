-- supabase/migrations/0076_ticket_id_in_db.sql
--
-- เลขใบงานออกโดยฐานข้อมูล เหมือนเลข PO (0036)
--
-- The app used to number a new ticket itself: read every JT-XX-… id of the
-- branch, take the largest, add one. Two things were wrong with that.
--
--   1. The read was unpaged, and PostgREST returns at most 1,000 rows. Once a
--      branch passed 1,000 tickets the "largest" came from an arbitrary 1,000
--      of them, the next number usually existed already, and creating a ticket
--      failed with a duplicate key. Chiang Mai was on course for that around
--      January 2027.
--   2. Two people saving a new ticket at the same moment read the same maximum
--      and collided.
--
-- PO numbers never had either problem because 0036 moved them into the
-- database: a BEFORE INSERT trigger, a per-branch advisory lock, and a max over
-- every row. Tickets now get the same. The format does not change —
-- JT-<SHOP>-00001, five digits, lpad so a branch past 99999 keeps counting.
--
-- An id already on the row is kept: that is how seeds, imports and repair
-- scripts keep the numbers they came with. The app sends an empty id.

set search_path = pos, public, extensions;

create or replace function next_ticket_id(p_shop text)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text := 'JT-' || upper(p_shop) || '-';
  v_seq    integer;
begin
  -- Only rows whose tail is entirely digits count, so an odd hand-made id
  -- (JT-CM-T0066) can neither break the max nor be mistaken for a number.
  select coalesce(max(substr(id, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from tickets
   where id like v_prefix || '%'
     and substr(id, length(v_prefix) + 1) ~ '^[0-9]+$';

  return v_prefix || lpad(v_seq::text, 5, '0');
end;
$$;

revoke all on function next_ticket_id(text) from public, anon;
grant execute on function next_ticket_id(text) to authenticated;

create or replace function assign_ticket_id()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.id is not null and btrim(new.id) <> '' then
    return new;
  end if;

  -- Serialises numbering per branch for the rest of the transaction: the second
  -- of two simultaneous saves waits here and then sees the first one's row.
  perform pg_advisory_xact_lock(hashtext('ticket_id:' || new.shop_id));
  new.id := next_ticket_id(new.shop_id);
  return new;
end;
$$;

revoke all on function assign_ticket_id() from public, anon, authenticated;

drop trigger if exists tickets_assign_id on tickets;
create trigger tickets_assign_id
  before insert on tickets
  for each row
  execute function assign_ticket_id();
