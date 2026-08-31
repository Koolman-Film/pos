-- supabase/release-0032.sql
--
-- ค่าใช้จ่ายนี้เป็นของสาขา หรือ "จ่ายแทน" Finnix
--
-- รันต่อจาก release-0031.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
-- รายการเดิมทั้งหมดเป็น "ค่าใช้จ่าย" ตามค่าตั้งต้น ตัวเลขเดิมไม่เปลี่ยน
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0032_expense_paid_for_finnix.sql
--
-- ค่าใช้จ่ายนี้เป็นของสาขา หรือ "จ่ายแทน" Finnix
--
-- The mirror of migration 0031 on the money going out: the branch pays a bill
-- that belongs to another Finnix shop and waits to be reimbursed. The cash did
-- leave the drawer, so the row belongs in ค่าใช้จ่าย and in the petty-cash
-- balance — but it is not this branch's cost, and counting it as one understates
-- every profit figure the shop reads.
--
-- One column, same as the ticket, and for the same reason: the shop decides this
-- per document, not per line. `ค่าใช้จ่าย` is the default, so every row already
-- recorded keeps counting exactly as it does today.
--
-- Reimbursement is NOT tracked here. The shop settles with Finnix on the total
-- for a period, which the report answers; a per-row settlement ledger is the
-- larger design that was deliberately set aside.

set search_path = pos, public, extensions;

alter table expenses
  add column if not exists expense_kind text not null default 'ค่าใช้จ่าย';

do $$
begin
  alter table expenses
    add constraint expenses_expense_kind_check
    check (expense_kind in ('ค่าใช้จ่าย', 'จ่ายแทน'));
exception
  when duplicate_object then null;
end $$;

comment on column expenses.expense_kind is
  'ค่าใช้จ่าย = ต้นทุนของสาขานี้; จ่ายแทน = เงินรอรับคืนจาก Finnix ไม่นับเป็นค่าใช้จ่าย';

-- The report reads only the ones paid on behalf of Finnix, a small minority.
create index if not exists expenses_paid_for_finnix_idx
  on expenses (shop_id, paid_at desc)
  where expense_kind = 'จ่ายแทน';

insert into supabase_migrations.schema_migrations(version, name) values ('0032', 'expense_paid_for_finnix') on conflict (version) do nothing;
