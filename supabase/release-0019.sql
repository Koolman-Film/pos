-- supabase/release-0019.sql
--
-- ไฟล์เสริมสำหรับรันบน production ต่อจาก release-0012-0018.sql
-- (ถ้ายังไม่ได้รันไฟล์นั้น ให้รันไฟล์นั้นก่อน แล้วค่อยรันไฟล์นี้)
--
-- เพิ่มเลขที่เอกสารค่าใช้จ่าย เช่น POS-LPG-6908001
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์/ดัชนีแบบ if not exists, สร้างฟังก์ชันแบบ
-- create or replace, และการเติมเลขย้อนหลังแตะเฉพาะแถวที่ยังไม่มีเลข
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0019_expense_doc_no.sql
--
-- เลขที่เอกสารค่าใช้จ่าย — POS-LPG-6908001
--
--   POS   คงที่
--   LPG   รหัสสาขา (shop_id ตัวใหญ่)
--   69    ปี พ.ศ. สองหลักท้าย (2569)
--   08    เดือน
--   001   ลำดับที่ นับใหม่ทุกเดือนของแต่ละสาขา
--
-- Assigned by a BEFORE INSERT trigger rather than by the application, for two
-- reasons. The number must never change once issued — it is on a document
-- somebody filed — so it cannot be recomputed from a date the row can still
-- edit. And two people entering an expense for the same shop in the same month
-- at the same moment must not both be handed 001; the trigger takes a
-- transaction-scoped advisory lock on the prefix, which the application cannot
-- do across an RPC boundary.
--
-- One number per expense ROW. A submission with several lines is several
-- expenses — each has its own amount, category and status — so each gets its
-- own reference.

set search_path = pos, public, extensions;

alter table expenses
  add column if not exists doc_no text;

comment on column expenses.doc_no is
  'เลขที่เอกสาร e.g. POS-LPG-6908001 — ออกโดย trigger ตอน insert ห้ามแก้ภายหลัง';

-- Partial: rows predating this migration keep a NULL until the backfill below,
-- and NULLs must not collide with each other.
create unique index if not exists expenses_doc_no_key
  on expenses (doc_no)
  where doc_no is not null;

/**
 * The next unused number for a shop and a date.
 *
 * `security definer` so the count is over every row, not only the ones the
 * caller's RLS policy lets them see — a Lampang number must not be reissued
 * just because the person entering it cannot read Lampang's other expenses.
 */
create or replace function next_expense_doc_no(p_shop text, p_date date)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text;
  v_seq    integer;
begin
  -- พ.ศ. = ค.ศ. + 543, สองหลักท้าย
  v_prefix := 'POS-' || upper(p_shop) || '-'
              || to_char(((extract(year from p_date)::int + 543) % 100), 'FM00')
              || to_char(p_date, 'MM');

  -- Everything AFTER the prefix is the sequence. Matching a trailing run of
  -- digits instead would swallow the year and month too — there is no separator
  -- before the sequence, so '…-6908002' reads as 6,908,002 and the next number
  -- comes out as 6908003, which does not fit three digits.
  select coalesce(max(substr(doc_no, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from expenses
   where doc_no like v_prefix || '%'
     and substr(doc_no, length(v_prefix) + 1) ~ '^[0-9]+$';

  -- lpad, not to_char('FM000'): a shop that passes 999 expenses in one month
  -- gets 1000, where the fixed three-digit format would render '###'.
  return v_prefix || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function next_expense_doc_no(text, date) from public, anon;
grant execute on function next_expense_doc_no(text, date) to authenticated;

create or replace function assign_expense_doc_no()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_date date;
begin
  if new.doc_no is not null and btrim(new.doc_no) <> '' then
    return new;  -- an explicit number (the backfill, a data migration) wins
  end if;

  -- The document's own date: when it was paid, or when it falls due.
  v_date := coalesce(new.paid_at, new.due_at, current_date);

  -- Serialise number generation for this shop+month. Transaction-scoped, so it
  -- is released when the insert commits and never leaks.
  perform pg_advisory_xact_lock(hashtext('expense_doc_no:' || new.shop_id || ':' || to_char(v_date, 'YYYYMM')));

  new.doc_no := next_expense_doc_no(new.shop_id, v_date);
  return new;
end;
$$;

drop trigger if exists expenses_assign_doc_no on expenses;
create trigger expenses_assign_doc_no
  before insert on expenses
  for each row
  execute function assign_expense_doc_no();

-- Backfill, oldest first, so the running order matches the order the expenses
-- were actually entered. Numbered per shop and per month, exactly as new rows
-- will be. Runs once; rows that already carry a number are left alone.
with numbered as (
  select
    e.id,
    'POS-' || upper(e.shop_id) || '-'
      || to_char(((extract(year from coalesce(e.paid_at, e.due_at, current_date))::int + 543) % 100), 'FM00')
      || to_char(coalesce(e.paid_at, e.due_at, current_date), 'MM')
      || lpad(
           row_number() over (
             partition by
               e.shop_id,
               to_char(coalesce(e.paid_at, e.due_at, current_date), 'YYYYMM')
             order by coalesce(e.paid_at, e.due_at, current_date), e.id
           )::text,
           3,
           '0'
         ) as doc_no
  from expenses e
  where e.doc_no is null
)
update expenses e
   set doc_no = n.doc_no
  from numbered n
 where e.id = n.id;

insert into supabase_migrations.schema_migrations(version, name) values ('0019', 'expense_doc_no') on conflict (version) do nothing;
