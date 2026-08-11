-- supabase/migrations/0013_ticket_soft_delete.sql
--
-- "ลบใบงาน" from the ticket screen, as a SOFT delete.
--
-- A ticket is the record of money taken, stock consumed and commission earned,
-- and the delete button is one tap away from a list row, so a hard delete is the
-- wrong default: `on delete cascade` would take items, positions, payments and
-- the status history with it and nothing could bring them back. Instead the row
-- is flagged and disappears from every list; a caller holding `list.restore`
-- (แอดมิน/ผู้บริหาร) can see the bin and put it back.
--
-- Two consequences worth stating:
--   * a deleted ticket still holds its job number, so `JT-CM-00053` is not
--     handed out again — restoring it cannot collide with a newer ticket;
--   * stock movements already written for the ticket are NOT rewound. Deleting
--     is "this ticket should not appear", not "undo everything it did"; a wrong
--     stock figure is corrected in สต็อก → ปรับสต็อก, where it is logged.

set search_path = pos, public, extensions;

alter table tickets
  add column deleted_at timestamptz,
  add column deleted_by uuid references app_users(id);

-- Every list query filters on this, and the bin view is the rare case, so index
-- the live rows rather than the whole column.
create index tickets_live_idx on tickets (shop_id) where deleted_at is null;

comment on column tickets.deleted_at is
  'Soft-delete flag. NULL = live. Set by the ลบใบงาน action (capability list.delete), cleared by กู้คืน (capability list.restore).';

-- The capability check lives in the database, not only in the server action:
-- `tickets_rw` already lets anyone with the shop and the `list` nav update a
-- ticket, so without this a caller lacking `list.delete` could still flip the
-- flag by hand through PostgREST.
create or replace function enforce_ticket_delete_capability()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null and not current_user_can('list.delete') then
      raise exception 'ไม่มีสิทธิ์ลบใบงาน' using errcode = '42501';
    end if;
    if new.deleted_at is null and not current_user_can('list.restore') then
      raise exception 'ไม่มีสิทธิ์กู้คืนใบงาน' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger tickets_delete_capability
  before update of deleted_at on tickets
  for each row execute function enforce_ticket_delete_capability();
