-- supabase/migrations/0036_order_doc_no.sql
--
-- เลขที่ PO ออกโดยฐานข้อมูล — WS-CM-0092
--
-- A PO created through the app was numbered `'WS-NEW-' + random(1000..9999)` in
-- the browser, and that number became its primary key for ever. Three things
-- are wrong with it, in increasing order of seriousness:
--
--   * it carries no branch and no order, so the numbers say nothing;
--   * it is not sequential, so a missing PO cannot be noticed; and
--   * it COLLIDES. Nine thousand numbers sounds like plenty, but the chance two
--     POs share one passes 50% at about 112 POs — and the save is an upsert, so
--     a collision silently overwrites the earlier PO's header and replaces all
--     of its items, returns, payments and adjustments.
--
-- The seeded POs (WS-CM-0088 and friends) already carry the right shape, which
-- is exactly why this went unnoticed: the demo data looks correct and only real
-- use produces WS-NEW-4823.
--
-- Numbered the way expenses are (migration 0019): in the database, under an
-- advisory lock, by a BEFORE INSERT trigger. Two people raising a PO for the
-- same branch at the same moment cannot both be handed 0092, and the number
-- never changes once issued because a customer is holding a document with it.

set search_path = pos, public, extensions;

/**
 * The next unused PO number for a branch.
 *
 * `security definer` so the scan covers every PO, not only the ones the caller
 * may read — a Lampang number must not be reissued because the person raising
 * it cannot see Lampang's other orders.
 */
create or replace function next_order_id(p_shop text)
returns text
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_prefix text := 'WS-' || upper(p_shop) || '-';
  v_seq    integer;
begin
  -- Everything after the prefix is the sequence, and only rows whose tail is
  -- entirely digits count: the old random ids (WS-NEW-4823) live under a
  -- different prefix, but a hand-typed one must not break the max either.
  select coalesce(max(substr(id, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from orders
   where id like v_prefix || '%'
     and substr(id, length(v_prefix) + 1) ~ '^[0-9]+$';

  -- lpad, not a fixed format: a branch that passes 9999 POs gets 10000 rather
  -- than a row of hashes.
  return v_prefix || lpad(v_seq::text, 4, '0');
end;
$$;

revoke all on function next_order_id(text) from public, anon;
grant execute on function next_order_id(text) to authenticated;

create or replace function assign_order_id()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  -- A real number already on the row wins: this is how a data migration, or a
  -- future import, keeps the numbers it came with.
  if new.id is not null and new.id not like 'WS-NEW-%' and btrim(new.id) <> '' then
    return new;
  end if;

  -- Serialise numbering for this branch. Transaction-scoped, so it is released
  -- when the insert commits and can never leak.
  perform pg_advisory_xact_lock(hashtext('order_id:' || new.shop_id));

  new.id := next_order_id(new.shop_id);
  return new;
end;
$$;

drop trigger if exists orders_assign_id on orders;
create trigger orders_assign_id
  before insert on orders
  for each row
  execute function assign_order_id();

/*
  Repair what the random numbering already produced.

  Renumbered oldest-first per branch so the running order matches the order the
  POs were actually raised. The children follow by `on update cascade`… which
  the original foreign keys do not have, so they are replaced first. Nothing
  happens at all on a database that has no WS-NEW-% rows, which is the expected
  case for a shop that has not raised a PO through the app yet.
*/
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from orders where id like 'WS-NEW-%';
  if v_bad = 0 then
    raise notice 'ไม่มี PO ที่ใช้เลขสุ่ม ไม่ต้องแก้เลขย้อนหลัง';
    return;
  end if;

  alter table order_items drop constraint order_items_order_id_fkey;
  alter table order_items add constraint order_items_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_returns drop constraint order_returns_order_id_fkey;
  alter table order_returns add constraint order_returns_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_adjustments drop constraint order_adjustments_order_id_fkey;
  alter table order_adjustments add constraint order_adjustments_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;
  alter table order_payments drop constraint order_payments_order_id_fkey;
  alter table order_payments add constraint order_payments_order_id_fkey
    foreign key (order_id) references orders(id) on update cascade on delete cascade;

  with renumbered as (
    select o.id as old_id,
           'WS-' || upper(o.shop_id) || '-' || lpad(
             (
               coalesce((
                 select max(substr(x.id, length('WS-' || upper(o.shop_id) || '-') + 1)::int)
                   from orders x
                  where x.id like 'WS-' || upper(o.shop_id) || '-%'
                    and substr(x.id, length('WS-' || upper(o.shop_id) || '-') + 1) ~ '^[0-9]+$'
               ), 0)
               + row_number() over (partition by o.shop_id order by o.created_at, o.id)
             )::text, 4, '0') as new_id
      from orders o
     where o.id like 'WS-NEW-%'
  )
  update orders o
     set id = r.new_id
    from renumbered r
   where o.id = r.old_id;

  raise notice 'แก้เลข PO ที่เป็นเลขสุ่มแล้ว % ใบ', v_bad;
end $$;
