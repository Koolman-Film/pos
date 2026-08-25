-- supabase/release-0022.sql
--
-- ใบงานที่ปิดงานแล้ว: ยังแก้ "ข้อมูลเพิ่มเติม" ได้ (เซอร์วิส / ประกัน)
--
-- รันต่อจาก release-0021.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function ทั้งสองตัว
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0022_extras_after_lock.sql
--
-- ใบงานที่ปิดงานแล้ว: ยังแก้ "ข้อมูลเพิ่มเติม" ได้
--
-- 0017 froze a delivered-and-paid ticket because commission, revenue and any
-- later dispute are read from it. That is still right for the money — but the
-- job does not end at delivery. The car comes back to be serviced, sometimes
-- for years, and the customer may take out ประกัน afterwards. Freezing the
-- ข้อมูลเพิ่มเติม block along with the rest meant the shop had to have an admin
-- unlock a closed ticket to write down a service visit, which is the opposite of
-- what the lock is for.
--
-- So the lock narrows to what it actually protects: the numbers. `extras` (the
-- ข้อมูลเพิ่มเติม jsonb) becomes editable on a locked ticket; every other column,
-- every item, every payment stays frozen.
--
-- Two pieces:
--   1. `enforce_ticket_lock` lets an update through when `extras` is the ONLY
--      column that changed. Column-by-column via `to_jsonb`, so a future column
--      is frozen by default rather than accidentally let through.
--   2. `save_ticket_extras()` is the only write path the app uses for this. It
--      cannot touch anything else, so "the extras section is open" can never
--      widen into "the ticket is open".

set search_path = pos, public, extensions;

create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if old.locked and not current_user_can('list.unlock') then
    -- ข้อมูลเพิ่มเติม only. `- 'extras'` drops that one key from both sides, so
    -- this is true exactly when nothing else moved — including `locked` itself,
    -- which is why this cannot be used to quietly reopen the ticket.
    if to_jsonb(new) - 'extras' = to_jsonb(old) - 'extras' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

/**
 * บันทึกเฉพาะ ข้อมูลเพิ่มเติม — ใช้ได้แม้ใบงานถูกล็อกแล้ว.
 *
 * `p_insurance` mirrors the ประกัน tick onto the auto-added ประกัน line, because
 * the tick and that line are one decision made in one place. The line is created
 * at ราคา 0: recording that the customer took ประกัน is an extra, but PRICING it
 * is revenue, and revenue on a closed ticket still needs `list.unlock`. Removing
 * it is likewise refused once someone has priced it — that would be deleting
 * money from a closed record.
 */
create or replace function save_ticket_extras(
  p_ticket_id text,
  p_extras jsonb,
  p_insurance boolean
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  update tickets set extras = coalesce(p_extras, '{}'::jsonb) where id = p_ticket_id;
  if not found then
    raise exception 'ไม่พบใบงานนี้' using errcode = 'P0002';
  end if;

  if p_insurance then
    if not exists (
      select 1 from ticket_items
       where ticket_id = p_ticket_id and category = 'ประกัน' and sold = 'ประกัน'
    ) then
      insert into ticket_items (ticket_id, category, booked, booked_price, sold, sold_price)
      values (p_ticket_id, 'ประกัน', 'ประกัน', 0, 'ประกัน', 0);
    end if;
  else
    delete from ticket_items
     where ticket_id = p_ticket_id
       and category = 'ประกัน'
       and sold = 'ประกัน'
       and coalesce(sold_price, 0) = 0
       and coalesce(booked_price, 0) = 0;
  end if;
end;
$$;

revoke all on function save_ticket_extras(text, jsonb, boolean) from public, anon;
grant execute on function save_ticket_extras(text, jsonb, boolean) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0022', 'extras_after_lock') on conflict (version) do nothing;
