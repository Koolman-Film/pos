-- supabase/release-0072.sql
--
-- เลขที่เอกสารจาก PEAK สำหรับรายได้ Finnix
--
-- รันต่อจาก release-0071.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: เพิ่มคอลัมน์แบบ if not exists และ create or replace function
--
-- หลังรันไฟล์นี้ ใบงานที่มีรายได้ Finnix จะมีช่องกรอกเลขที่เอกสาร PEAK
-- กรอกได้แม้ใบงานปิดแล้ว เพราะเลขมักมาจากฝ่ายบัญชีหลังรถออกไปแล้ว
-- และเลขนี้โผล่ในชีท รายได้ Finnix ของรายงานรายได้ ไว้กระทบยอด

--
-- เลขที่เอกสารจาก PEAK สำหรับรายได้ Finnix
--
-- รายได้ Finnix ที่รับเงินไว้ที่สาขา ต้องไปกระทบยอดกับเอกสารในระบบบัญชี PEAK
-- อีกที และคนที่ทำรายการนั้นคือคนที่เปิดใบงานใบนี้ — ตอนนี้เขาไม่มีที่ให้จด
-- เลขเอกสารเลย ต้องไปจำเอาเอง หรือเปิด PEAK ค้นย้อนหลังทีหลัง (ร้านขอ 26 ก.ย.
-- 2569)
--
-- ONE NUMBER PER JOB, not per line. The lines say which money is Finnix's;
-- the document covers what was settled with them for this car, and that is one
-- transaction however many lines it came from. Splitting it per line would ask
-- the counter the same question three times and give the report three answers
-- to reconcile instead of one.
--
-- แก้ได้แม้ใบงานปิดแล้ว. The number arrives from the accounts, often days after
-- the car has gone and the ticket has closed — the same reason ข้อมูลเพิ่มเติม
-- (0022) and ข้อมูลของช่าง (0066) are allowed through the lock. It carries no
-- money of its own: it is a reference to a document that exists elsewhere, so
-- letting it through changes no figure on any report.

set search_path = pos, public, extensions;

alter table tickets
  add column if not exists finnix_doc_no text not null default '';

comment on column tickets.finnix_doc_no is
  'เลขที่เอกสารใน PEAK ของรายได้ Finnix บนใบงานนี้ (0072). ว่าง = ยังไม่ได้กรอก';

-- อ่านตอนกระทบยอดกับ PEAK: which held jobs still have no document number.
create index if not exists tickets_finnix_doc_idx
  on tickets (shop_id)
  where finnix_doc_no = '' and deleted_at is null;

/*
  ปลดล็อกให้แก้เลขเอกสารได้ เหมือน extras และ tech_by_category.

  0066's body with one more column on the list. Every reason given there still
  applies: the lock is about ยอดขายและค่าคอมมิชชั่น, and none of these three
  can move either.
*/
create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  if old.locked and not current_user_can('list.unlock') then
    -- ข้อมูลเพิ่มเติม (0022), ข้อมูลของช่าง (0066) และเลขที่เอกสาร PEAK (0072).
    -- Dropping those keys from both sides makes this true exactly when nothing
    -- else moved — including `locked` itself, which is why none of them can
    -- quietly reopen the ticket.
    if to_jsonb(new) - 'extras' - 'tech_by_category' - 'finnix_doc_no'
       = to_jsonb(old) - 'extras' - 'tech_by_category' - 'finnix_doc_no' then
      return new;
    end if;
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

/**
 * บันทึกเลขที่เอกสาร PEAK อย่างเดียว — ใช้ได้แม้ใบงานถูกล็อกแล้ว.
 *
 * The narrow write path, like `save_ticket_extras` (0022) and
 * `save_ticket_tech` (0066): it can reach this one column and nothing else, so
 * "the document number is editable" can never widen into "the ticket is open".
 */
create or replace function save_ticket_finnix_doc(p_ticket_id text, p_doc_no text)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  update tickets set finnix_doc_no = coalesce(btrim(p_doc_no), '') where id = p_ticket_id;
  if not found then
    raise exception 'ไม่พบใบงานนี้' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function save_ticket_finnix_doc(text, text) from public, anon;
grant execute on function save_ticket_finnix_doc(text, text) to authenticated;

select 'release-0072 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0072', 'finnix_peak_doc') on conflict (version) do nothing;
