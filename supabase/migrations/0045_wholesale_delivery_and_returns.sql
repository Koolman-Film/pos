-- supabase/migrations/0045_wholesale_delivery_and_returns.sql
--
-- ใบส่งของ และ ใบรับคืนสินค้า — วันที่ที่ยอดขายส่งต้องใช้
--
-- Wholesale sells on credit: the goods go out, the money comes weeks later. That
-- makes DELIVERY the moment the sale is earned, which the shop confirmed, and it
-- is the one date the system never recorded. `orders` knew the status was
-- จัดส่งแล้ว and nothing about when — so a PO could not be attributed to a month,
-- and wholesale takings appear in no figure anywhere in the app today.
--
-- The same hole exists on the other side: `order_returns` records what came back
-- and how many, with no date, so a return cannot reduce the month it belongs to.
--
-- Both dates arrive with the documents that create them, which is not a
-- coincidence — a ใบส่งของ IS the delivery, and a ใบรับคืนสินค้า IS the return.
--
-- Also fixed here: `save_order_children` stamped every payment and every price
-- adjustment with the date the PO was SAVED, discarding the row's own date. On a
-- business that delivers in March and is paid in May, that put the money in
-- whichever month somebody last opened the record — and the money register
-- (0043) reads exactly this column to say where cash is.

set search_path = pos, public, extensions;

alter table orders
  -- Null on purpose for existing rows. A PO already marked จัดส่งแล้ว really was
  -- delivered, but nobody wrote down when, and inventing a date would put real
  -- revenue in a month it did not happen. The module shows which POs still need
  -- one instead.
  add column delivered_at date;

comment on column orders.delivered_at is
  'วันที่ส่งของ — the date wholesale revenue is recognised on. Set by issuing ใบส่งของ.';

create index orders_delivered_idx on orders (delivered_at)
  where delivered_at is not null;

alter table order_returns
  add column returned_at date not null default current_date;

comment on column order_returns.returned_at is
  'วันที่รับคืนสินค้า — the date the return reduces revenue on.';

create index order_returns_returned_idx on order_returns (returned_at);

/*
  Children keep their OWN dates.

  `p_saved_on` stays as the fallback for a row that carries no date — an older
  client, or a payment typed without one — so nothing ends up with a null date
  in a NOT NULL column. What changes is that a date the form collected is no
  longer thrown away.
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
begin
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

  insert into order_payments (order_id, amount, method, paid_at)
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    coalesce(nullif(pay->>'date', '')::date, p_saved_on)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;

/*
  สาขาที่เพิ่มใหม่ ต้องได้แหล่งเงินตั้งต้นด้วย.

  0043 seeded the four default accounts for every shop that existed when it ran.
  A branch created afterwards got none — which is not a small gap: with no
  accounts, nothing the branch takes or spends can be attributed anywhere, and
  the money card shows it as having no money rather than as unconfigured.

  Finnix North, created for the wholesale team, hit exactly this. Seeding inside
  `save_shop` means the next branch cannot.

  Everything else about the function is unchanged; `create or replace` has no way
  to patch one statement.
*/
create or replace function save_shop(p_id text, p_name text, p_sort integer default null)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_id   text := lower(trim(coalesce(p_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_sort integer;
begin
  -- coalesce, not a bare comparison: `current_user_role()` is NULL for a token
  -- with no `app_users` row, and `NULL <> 'admin'` is NULL — which is not TRUE,
  -- so the guard would have let exactly that caller through.
  if coalesce(current_user_role(), '') <> 'admin' then
    raise exception 'forbidden: เฉพาะแอดมินเท่านั้นที่เพิ่ม/แก้ไขสาขาได้';
  end if;

  -- The id goes into every document number and every export filename, so it is
  -- kept short, lowercase and free of anything that needs escaping.
  if v_id !~ '^[a-z0-9]{2,10}$' then
    raise exception 'รหัสสาขาต้องเป็น a-z หรือ 0-9 ความยาว 2-10 ตัว (เช่น north)';
  end if;
  if v_name = '' then
    raise exception 'ต้องระบุชื่อสาขา';
  end if;

  -- Appended to the end unless told otherwise; renaming must not silently
  -- reorder the sidebar.
  v_sort := coalesce(
    p_sort,
    (select sort_order from shops where id = v_id),
    (select coalesce(max(sort_order), 0) + 1 from shops)
  );

  insert into shops (id, name, sort_order)
  values (v_id, v_name, v_sort)
  on conflict (id) do update
    set name = excluded.name,
        sort_order = excluded.sort_order;

  -- The company details a document prints, and the four places money sits.
  -- `do nothing` on both, so renaming an existing branch changes nothing else.
  insert into shop_info (shop_id) values (v_id) on conflict (shop_id) do nothing;

  insert into money_accounts (shop_id, name, kind, match_names, sort_order)
  select v_id, a.name, a.kind, a.match_names, a.sort_order
  from (values
    ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                                       1),
    ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
    ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                                   3),
    ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],                  4)
  ) as a(name, kind, match_names, sort_order)
  on conflict (shop_id, name) do nothing;

  return v_id;
end;
$$;

revoke all on function save_shop(text, text, integer) from public, anon;
grant execute on function save_shop(text, text, integer) to authenticated;

-- Branches that already exist without accounts — Finnix North today, and any
-- other added between 0043 and now.
insert into money_accounts (shop_id, name, kind, match_names, sort_order)
select s.id, a.name, a.kind, a.match_names, a.sort_order
from shops s
cross join (values
  ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                                       1),
  ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
  ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                                   3),
  ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],                  4)
) as a(name, kind, match_names, sort_order)
on conflict (shop_id, name) do nothing;

insert into shop_info (shop_id)
select s.id from shops s
on conflict (shop_id) do nothing;
