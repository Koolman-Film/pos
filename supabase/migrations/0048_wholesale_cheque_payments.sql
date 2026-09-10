-- supabase/migrations/0048_wholesale_cheque_payments.sql
--
-- การรับเงินขายส่ง — เช็คลงวันที่ล่วงหน้า และการยืนยันเงินเข้า
--
-- Wholesale is paid mostly by cheque, usually post-dated. That makes ONE row in
-- `order_payments` today stand for three different events on three different
-- days: a sale takes a piece of paper, someone banks it, and some time later the
-- money either arrives or the cheque bounces. The table records amount, method
-- and one date, so the system cannot tell "we hold a cheque" from "we have the
-- money" — and it counted the first as the second, clearing the customer's debt
-- and moving the money card on the strength of a promise.
--
-- WHAT THE SHOP DECIDED (docs/DESIGN-wholesale-sales-and-channel.md § 3):
--   - หนี้ถูกตัดเมื่อเช็คผ่านจริง — the customer still owes until money lands.
--   - ออกใบเสร็จตอนรับเช็ค — the receipt goes out with the cheque, as it does now.
--   - sale แจ้งได้ แอดมิน/ผู้บริหารยืนยัน — a sale records what they received;
--     only `wholesale.confirmPayment` turns it into money.
--
-- Those first two together mean a receipt exists for money not yet received.
-- That is the shop's real practice, not a contradiction to design away, so the
-- receipt has to carry the cheque's own number, bank and date — a receipt that
-- says only "รับเงินแล้ว 50,000" for a cheque dated next month misleads both
-- sides — and a bounce has to be recordable after the fact.
--
-- WHY `uid` AND NOT THE PRIMARY KEY. `save_order_children` deletes every child
-- row and re-inserts it on each save, so `order_payments.id` changes every time
-- anybody edits the PO. A confirmation keyed on it would not survive the next
-- save, and a confirmation sent up from the browser could be forged by anyone
-- who can POST to the Server Action (CORRECTION C2). So each payment carries a
-- client-generated `uid` that survives the round trip, the save function copies
-- the confirmation columns forward by that uid and ignores whatever the client
-- says about them, and confirming is a separate security-definer function that
-- checks the capability itself.

set search_path = pos, public, extensions;

alter table order_payments
  -- Stable across the delete-and-reinsert in `save_order_children`. Empty for
  -- rows written before this migration; those are already confirmed, so nothing
  -- needs to be matched to them.
  add column uid text not null default '',
  -- แจ้งแล้ว → รับเงินแล้ว → เด้ง. Existing rows are backfilled to รับเงินแล้ว
  -- below: they were counted as money before this migration, and re-opening
  -- settled debts across every branch is not a migration's decision to make.
  add column status text not null default 'แจ้งแล้ว',
  add column cheque_no text not null default '',
  add column cheque_bank text not null default '',
  -- วันที่หน้าเช็ค. The date the money is EXPECTED, which is what makes
  -- "เดือนหน้าจะมีเงินเข้าเท่าไหร่" answerable.
  add column cheque_date date,
  add column reported_by uuid references auth.users(id),
  add column reported_at timestamptz,
  -- วันที่เงินเข้าจริง. The money register dates the movement by THIS, not by
  -- `paid_at` — a cheque received in March and cleared in May is May's cash.
  add column cleared_at date,
  add column cleared_by uuid references auth.users(id),
  add column bounced_at date,
  add column bounce_note text not null default '';

alter table order_payments
  add constraint order_payments_status_ck
  check (status in ('แจ้งแล้ว', 'รับเงินแล้ว', 'เด้ง'));

comment on column order_payments.uid is
  'คีย์ฝั่งไคลเอนต์ที่อยู่รอดข้ามการบันทึก — ใช้จับคู่แถวเดิมกับแถวใหม่ใน save_order_children.';
comment on column order_payments.status is
  'แจ้งแล้ว (ยังไม่ใช่เงิน) / รับเงินแล้ว (เงินเข้าจริง) / เด้ง (เช็คไม่ผ่าน).';
comment on column order_payments.cleared_at is
  'วันที่เงินเข้าจริง — วันที่ที่ใช้ในการ์ดเงินอยู่ที่ไหนบ้าง.';

-- Every payment recorded before today was treated as received the moment it was
-- typed, and every downstream figure was built on that. Backfilling to
-- รับเงินแล้ว keeps all of them exactly where they are.
update order_payments
set status = 'รับเงินแล้ว',
    cleared_at = coalesce(cleared_at, paid_at)
where status = 'แจ้งแล้ว' and cleared_at is null;

-- Two questions this index exists for: what is still unconfirmed, and which
-- cheques come due when.
create index order_payments_status_idx on order_payments (status, cheque_date);

/*
  การยืนยันไม่ผ่านหน้าจอแก้ไข PO.

  `p_payments` still carries the cheque details and the amount — a sale types
  those. It does NOT carry status: the function reads the previous state for
  each uid and writes it back, so a forged payload cannot promote a payment to
  รับเงินแล้ว. A row with no matching uid is new, and new payments start
  แจ้งแล้ว whoever saved them, including an admin — one deliberate click
  confirms it, which is the point of having a confirmation at all.
*/
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_prior jsonb;
begin
  -- The confirmation state of what is already stored, keyed by uid, captured
  -- before the delete below throws the rows away.
  select coalesce(
    jsonb_object_agg(
      uid,
      jsonb_build_object(
        'status', status,
        'cleared_at', cleared_at,
        'cleared_by', cleared_by,
        'bounced_at', bounced_at,
        'bounce_note', bounce_note,
        'reported_by', reported_by,
        'reported_at', reported_at
      )
    ),
    '{}'::jsonb
  )
  into v_prior
  from order_payments
  where order_id = p_order_id and uid <> '';

  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason, returned_at)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', ''),
    coalesce(nullif(r->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    coalesce(nullif(a->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (
    order_id, amount, method, paid_at, uid,
    cheque_no, cheque_bank, cheque_date,
    status, cleared_at, cleared_by, bounced_at, bounce_note,
    reported_by, reported_at
  )
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on),
    coalesce(pay->>'uid', ''),
    coalesce(pay->>'chequeNo', ''),
    coalesce(pay->>'chequeBank', ''),
    nullif(pay->>'chequeDate', '')::date,
    -- Everything from here down comes from the database, never from the caller.
    coalesce(prior.v->>'status', 'แจ้งแล้ว'),
    (prior.v->>'cleared_at')::date,
    (prior.v->>'cleared_by')::uuid,
    (prior.v->>'bounced_at')::date,
    coalesce(prior.v->>'bounce_note', ''),
    coalesce((prior.v->>'reported_by')::uuid, auth.uid()),
    coalesce((prior.v->>'reported_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay
  left join lateral (
    select v_prior -> coalesce(pay->>'uid', '') as v
  ) as prior on true;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

/*
  ยืนยันเงินเข้า.

  security definer with the capability checked inside, because the button is not
  the gate — a Server Action is a plain POST. `p_on` is the date the money
  actually landed, which the confirmer types: a cheque banked on Friday and
  credited on Monday belongs to Monday, and only the person holding the
  statement knows which.
*/
create or replace function confirm_order_payment(
  p_order_id text,
  p_uid text,
  p_on date default null
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.confirmPayment') then
    raise exception 'forbidden: ไม่มีสิทธิ์ยืนยันการรับเงิน';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  -- security definer bypasses RLS, so the branch check has to be made here.
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_payments
  set status = 'รับเงินแล้ว',
      cleared_at = coalesce(p_on, current_date),
      cleared_by = auth.uid(),
      -- A bounced cheque the customer made good on is confirmed, not haunted by
      -- the old bounce date.
      bounced_at = null
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการรับเงินที่ต้องการยืนยัน';
  end if;
end;
$$;

revoke all on function confirm_order_payment(text, text, date) from public, anon;
grant execute on function confirm_order_payment(text, text, date) to authenticated;

/*
  เช็คเด้ง.

  The debt comes back on its own, because ค้างรับ counts only รับเงินแล้ว. The
  receipt already issued is NOT deleted — it is in the customer's hands, and
  destroying the record that it was issued destroys the evidence of what
  happened. The reason is required: "เด้ง" with no note is unactionable a month
  later.
*/
create or replace function bounce_order_payment(
  p_order_id text,
  p_uid text,
  p_on date default null,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_shop text;
begin
  if not current_user_can('wholesale.confirmPayment') then
    raise exception 'forbidden: ไม่มีสิทธิ์บันทึกเช็คเด้ง';
  end if;

  select shop_id into v_shop from orders where id = p_order_id;
  if v_shop is null then
    raise exception 'ไม่พบ PO นี้';
  end if;
  if v_shop not in (select current_user_shops()) then
    raise exception 'forbidden: PO นี้ไม่ได้อยู่ในสาขาของคุณ';
  end if;

  update order_payments
  set status = 'เด้ง',
      bounced_at = coalesce(p_on, current_date),
      bounce_note = coalesce(nullif(trim(p_note), ''), 'ไม่ได้ระบุเหตุผล'),
      -- It never cleared, so the money card must stop counting it.
      cleared_at = null,
      cleared_by = null
  where order_id = p_order_id and uid = p_uid and p_uid <> '';

  if not found then
    raise exception 'ไม่พบรายการรับเงินที่ต้องการบันทึก';
  end if;
end;
$$;

revoke all on function bounce_order_payment(text, text, date, text) from public, anon;
grant execute on function bounce_order_payment(text, text, date, text) to authenticated;

-- สิทธิ์ใหม่: ขายส่ง: ยืนยันเงินเข้า. Admin and ผู้บริหาร by default; a sale
-- records what they received and cannot promote it to money.
insert into role_permissions (role_id, permission_type, permission_key, allowed)
select r.id, 'module_capability', 'wholesale.confirmPayment', r.id in ('admin', 'exec')
from roles r
on conflict (role_id, permission_type, permission_key) do nothing;

/*
  `reset_permissions_to_defaults()` rebuilt to carry `wholesale.confirmPayment`.

  A reset that dropped the key would leave nobody able to confirm a payment,
  which stops money being recognised at all — the module would look like it had
  simply stopped working. Everything else here is 0044 unchanged; `create or
  replace` cannot patch one statement.
*/
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  -- Scoped to the four built-ins on purpose. A custom role has no "default" to
  -- restore, so its rows are left exactly as the admin set them.
  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','money',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','money',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','money',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','money',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','insuranceExpiry',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','branchCompare',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','insuranceExpiry',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','branchCompare',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','insuranceExpiry',true), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','branchCompare',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','insuranceExpiry',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','branchCompare',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.updateStatus'),('wholesale.export'),
      ('wholesale.delete'),('wholesale.confirmPayment'),
      ('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.approveWithdraw'),('stock.editDelete'),('stock.export'),
      ('commission.addRule'),('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys. 0016 and 0017 both say so in as many words ("options.manage
  -- — who may add or remove entries in the admin-managed option lists", "WHO CAN
  -- REOPEN: list.unlock, admin only"). They must not ride along in the admin+exec
  -- grant above, which is exactly how exec picked them up.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    -- กู้คืน PO is the same decision as กู้คืนใบงาน: admin and ผู้บริหาร only.
    ('admin','module_capability','wholesale.restore',true),
    ('exec','module_capability','wholesale.restore',true);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true),
    ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','list.unlock',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','options.manage',false),
    ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false),
    ('sales','module_capability','wholesale.updateStatus',true),
    ('sales','module_capability','wholesale.delete',true), ('sales','module_capability','wholesale.restore',false),
    ('sales','module_capability','wholesale.confirmPayment',false),
    ('sales','module_capability','wholesale.export',false), ('sales','module_capability','stock.addProduct',false),
    ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.approveWithdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false),
    ('sales','module_capability','commission.addRule',false), ('sales','module_capability','accounting.addExpense',false),
    ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),

    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true),
    ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','list.unlock',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','options.manage',false),
    ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false),
    ('tech','module_capability','wholesale.updateStatus',true),
    ('tech','module_capability','wholesale.delete',false), ('tech','module_capability','wholesale.restore',false),
    ('tech','module_capability','wholesale.confirmPayment',false),
    ('tech','module_capability','wholesale.export',false), ('tech','module_capability','stock.addProduct',false),
    ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.approveWithdraw',false),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true),
    ('tech','module_capability','commission.addRule',false), ('tech','module_capability','accounting.addExpense',false),
    ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;
