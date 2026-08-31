-- supabase/migrations/0031_ticket_revenue_kind.sql
--
-- ใบงานนี้เป็น "รายได้" หรือ "รับแทน"
--
-- Some jobs are taken at one branch but belong to another Finnix shop: the
-- customer pays here, and the money is held until it goes back. It is not this
-- shop's takings, and counting it as such overstates every sales figure on the
-- system — the dashboard, โมดูลรายได้, and anything read off them.
--
-- One column on the ticket, because that is the grain the shop works at: a whole
-- job is either ours or held for Finnix, never half of each. `รายได้` is the
-- default, so every ticket already recorded keeps counting exactly as it does
-- today and nothing has to be back-filled.
--
-- The money itself is NOT hidden: `ticket_payments` still records what was
-- collected, so the cash in the drawer still reconciles. Only which pile the
-- total lands in changes.

set search_path = pos, public, extensions;

alter table tickets
  add column if not exists revenue_kind text not null default 'รายได้';

do $$
begin
  alter table tickets
    add constraint tickets_revenue_kind_check
    check (revenue_kind in ('รายได้', 'รับแทน'));
exception
  when duplicate_object then null;
end $$;

comment on column tickets.revenue_kind is
  'รายได้ = ยอดขายของสาขานี้; รับแทน = เงินรอคืน Finnix ไม่นับเป็นยอดขาย';

-- The report reads only the held ones, and they are the small minority.
create index if not exists tickets_held_idx
  on tickets (shop_id, drop_off_date desc)
  where revenue_kind = 'รับแทน' and deleted_at is null;
