-- supabase/migrations/0017_ticket_lock.sql
--
-- ล็อกใบงานที่ปิดงานแล้ว.
--
-- A ticket that has been handed over AND paid in full is a closed record: it is
-- what the commission run, the revenue figures and any later dispute are read
-- from. Leaving it editable means a number can move months after the money did.
--
-- WHEN: the server action sets `locked` on save, when the ticket is
-- "ส่งมอบแล้ว" and `ticketPaid >= ticketTotal`. That condition is deliberately
-- evaluated in TypeScript, where `lib/domain/tickets.ts` already owns the
-- discount maths — re-implementing percent/amount discounts in SQL would be a
-- second copy free to drift from the first. The database's job here is to
-- enforce the FLAG, not to recompute the rule.
--
-- WHO CAN REOPEN: `list.unlock`, admin only. Unlocking is a normal update that
-- clears the flag, so the same trigger covers it.
--
-- The trigger is what makes this real: `tickets_rw` lets any member of the shop
-- update the row, so a UI-only lock could be walked around with a direct
-- PostgREST call.

set search_path = pos, public, extensions;

alter table tickets
  add column locked boolean not null default false;

comment on column tickets.locked is
  'Closed record (ส่งมอบแล้ว + ชำระครบ). Blocks edits to the ticket and its children until a list.unlock holder clears it.';

create or replace function enforce_ticket_lock()
returns trigger
language plpgsql
security invoker
set search_path = pos
as $$
begin
  -- Anything at all on a locked ticket — including clearing the flag — needs the
  -- capability. `old.locked` is what matters: a save that is in the act of
  -- locking the ticket must still be allowed through.
  if old.locked and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tickets_lock_guard
  before update on tickets
  for each row execute function enforce_ticket_lock();

-- The children are replaced wholesale by `save_ticket_children`, which is where
-- items, positions and payments would otherwise change without the tickets row
-- being touched at all.
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

-- `list.unlock`: admin only, like options.manage.
--
-- It has to go into `reset_permissions_to_defaults()` as well as the live
-- matrix, or the "รีเซ็ตค่าเริ่มต้น" button would delete the key and lock every
-- closed ticket permanently. Only the two admin-only lines below differ from
-- migration 0016's copy of this function.
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

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys: maintaining the option lists, and reopening a closed ticket.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    ('sales','module_capability','list.unlock',false),
    ('tech','module_capability','list.unlock',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

-- Delta insert so a live matrix keeps whatever the shop has re-toggled.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','module_capability','list.unlock',true),
  ('exec','module_capability','list.unlock',false),
  ('sales','module_capability','list.unlock',false),
  ('tech','module_capability','list.unlock',false)
on conflict (role_id, permission_type, permission_key) do nothing;
