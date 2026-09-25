-- supabase/migrations/0069_money_account_owner.sql
--
-- แหล่งเงินนี้เป็นของสาขา หรือของ Finnix
--
-- 0068 let one ใบงาน carry both the branch's own work and Finnix's. What it
-- could not answer is where the money for each part actually WENT: a payment
-- records one amount against the whole job, so the dashboard shares it out in
-- proportion to what was sold. That is the best guess available from the
-- ticket alone — but it is a guess, and the shop does not need to guess,
-- because it already keeps a separate account for Finnix money
-- (ร้านแจ้ง 25 ก.ย. 2569).
--
-- So an account says whose money it holds. A payment names the account it went
-- into, so the two sides of the same job can now be compared:
--
--   what was SOLD:      รายได้สาขา 6,000 · รายได้ Finnix 4,000
--   where it LANDED:    บัญชีสาขา 7,000 · บัญชี Finnix 3,000
--   ส่วนต่าง:            1,000 ของ Finnix อยู่ในบัญชีสาขา — ต้องโอนคืน
--
-- WHICH ONE IS THE REVENUE. The goods decide, not the account (ร้านเลือก 25
-- ก.ย. 2569): ยอดขายของสาขา is what the branch sold, and a customer paying into
-- the wrong account is a cash-handling mistake, not a sale moving between
-- branches. The account tells you where the cash IS, and the difference between
-- the two is a job for somebody — which is exactly what "รอคืน" always meant
-- and could never be measured before.
--
-- ของเดิมเป็นของสาขาทั้งหมด, which is what every account has been until now. The
-- shop marks its Finnix accounts itself; guessing from a name containing
-- "FINNIX" would be wrong the first time a branch account mentions it.

set search_path = pos, public, extensions;

alter table money_accounts
  add column if not exists owner text not null default 'สาขา';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.money_accounts'::regclass
       and conname = 'money_accounts_owner_check'
  ) then
    alter table money_accounts
      add constraint money_accounts_owner_check check (owner in ('สาขา', 'Finnix'));
  end if;
end $$;

comment on column money_accounts.owner is
  'สาขา = เงินของสาขานี้; Finnix = บัญชีที่ถือเงินของ Finnix (0069). ใช้เทียบกับรายได้ที่ขายจริง ไม่ได้ตัดสินว่าอะไรเป็นยอดขาย';
