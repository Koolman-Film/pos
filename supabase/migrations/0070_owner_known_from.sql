-- supabase/migrations/0070_owner_known_from.sql
--
-- การจับคู่เงิน Finnix มีผลกับใบงานใหม่เท่านั้น
--
-- 0069 let an account say whose money it holds, and the ticket screen compares
-- that with what was sold. Applied to everything on file, it would start
-- flagging jobs the shop finished and settled months ago — a red box on work
-- nobody is going to redo, about money that was reconciled by hand at the time
-- (ร้านขอ 25 ก.ย. 2569).
--
-- It is also not a fair question to ask of them. Until the shop marked its
-- Finnix accounts, the system had no way to tell where Finnix's money was
-- supposed to go, and neither did the person recording the payment — a job
-- taken before that was recorded under rules that did not include this one.
--
-- So an account records WHEN it entered this era, and the comparison only runs
-- on tickets opened on or after it. Existing accounts are stamped now, which
-- makes today the line for every branch already on the system; a branch set up
-- later starts from its own first account.
--
-- This is about the WARNING only. รายได้ Finnix itself — which lines are whose,
-- and therefore what counts as ยอดขายของสาขา — is untouched, and every ticket
-- already recorded keeps counting exactly as it counted yesterday (0068 filled
-- each line in from its own ticket for precisely that reason).

set search_path = pos, public, extensions;

alter table money_accounts
  add column if not exists owner_set_at timestamptz not null default now();

comment on column money_accounts.owner_set_at is
  'ตั้งแต่เมื่อไหร่ที่ระบบรู้ว่าเงินในบัญชีนี้เป็นของใคร (0070). ใบงานที่เปิดก่อนหน้านี้ ไม่ถูกนำมาจับคู่เงิน Finnix';
