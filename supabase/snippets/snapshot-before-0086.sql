-- supabase/snippets/snapshot-before-0086.sql
--
-- Run ONCE on production, at 0085, before release-0086 … release-0089.
-- It is the backup that supabase/snippets/revert-0086-0089.sql restores from.
--
-- POS-only on purpose: Supabase's daily backup restores the WHOLE database,
-- which would roll the Koolman finance app back too.
--
-- What it keeps:
--   object_defs — the exact definition of every pos function and trigger at
--                 0085 (pg_get_functiondef / pg_get_triggerdef);
--   copies of every table release-0086 … 0089 alters or that the replaced
--                 functions rewrite (they delete and re-insert children).
--
-- Drop the schema about a week after the release has proved itself:
--   drop schema pos_backup_20261110 cascade;

begin;

-- regprocedure prints names relative to search_path: pin it so names are
-- always schema-qualified ("pos.fn(text, …)"), here and in the revert.
set local search_path = pg_catalog;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'pos_backup_20261110') then
    raise exception 'pos_backup_20261110 already exists — not overwriting a backup';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^\d{4}$') <> '0085' then
    raise exception 'expected the database at 0085 — this snapshot is for the 0086–0089 release';
  end if;
end
$$;

create schema pos_backup_20261110;
revoke all on schema pos_backup_20261110 from public, anon, authenticated;

create table pos_backup_20261110.object_defs as
  select 'function'::text as kind,
         p.oid::regprocedure::text as name,
         pg_get_functiondef(p.oid) as def
    from pg_proc p
   where p.pronamespace = 'pos'::regnamespace
     and p.prokind in ('f', 'p')
  union all
  select 'trigger',
         c.relname || '.' || t.tgname,
         pg_get_triggerdef(t.oid)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'pos'::regnamespace
     and not t.tgisinternal;

create table pos_backup_20261110.order_items           as table pos.order_items;
create table pos_backup_20261110.order_returns         as table pos.order_returns;
create table pos_backup_20261110.order_adjustments     as table pos.order_adjustments;
create table pos_backup_20261110.order_payments        as table pos.order_payments;
create table pos_backup_20261110.ticket_items          as table pos.ticket_items;
create table pos_backup_20261110.ticket_item_positions as table pos.ticket_item_positions;
create table pos_backup_20261110.ticket_payments       as table pos.ticket_payments;
create table pos_backup_20261110.money_transfers       as table pos.money_transfers;
create table pos_backup_20261110.expenses              as table pos.expenses;
create table pos_backup_20261110.stock                 as table pos.stock;

-- What was taken, so a restore can be checked against it.
create table pos_backup_20261110.manifest as
  select now() as taken_at,
         (select count(*) from pos_backup_20261110.object_defs where kind = 'function') as functions,
         (select count(*) from pos_backup_20261110.object_defs where kind = 'trigger') as triggers,
         (select count(*) from pos.order_items) as order_items,
         (select count(*) from pos.order_payments) as order_payments,
         (select count(*) from pos.ticket_items) as ticket_items,
         (select count(*) from pos.ticket_payments) as ticket_payments,
         (select count(*) from pos.money_transfers) as money_transfers,
         (select count(*) from pos.expenses) as expenses,
         (select count(*) from pos.stock) as stock;

commit;

select * from pos_backup_20261110.manifest;
