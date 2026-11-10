-- supabase/snippets/revert-0086-0089.sql
--
-- Puts the pos schema's BEHAVIOUR back to 0085, using the snapshot taken just
-- before the 2026-11-10 release (supabase/snippets/snapshot-before-0086.sql →
-- pos_backup_20261110).
--
-- Order of a full rollback:
--   1. App first:  vercel promote <previous deployment, see HANDOFF.md> --yes
--   2. Then run this file once (MCP execute_sql or `supabase db query --linked -f`).
--      It runs as one transaction: it either all applies or nothing does.
--
-- What it does:
--   - restores every function that existed at 0085 to its exact 0085 body
--     (save_order_children, save_ticket_children);
--   - drops every pos function and trigger that did not exist at 0085
--     (save_money_transfer, delete_money_transfer);
--   - recreates any 0085 trigger a release dropped;
--   - drops the CHECK constraints 0087–0089 added, and un-stamps 0086–0089.
-- What it leaves alone (harmless to the 0085 app, which never reads them):
--   the new columns — order_payments.attachments, money_transfers.fee*,
--   stock.unit_size / unit_label, ticket_items.received_at / delivered_at —
--   so nothing typed in after the release is lost. Re-running release-0086 …
--   0089 later is safe (every statement is idempotent).
--   Data: nothing is deleted. To restore row values too, copy from the
--   pos_backup_20261110 tables (same columns as 0085).
--   Note: once the 0085 app is back, saving a ticket rewrites its items without
--   received_at / delivered_at, so per-item dates entered after the release are
--   cleared on that ticket's next save.

begin;

set local search_path = pg_catalog;

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'pos_backup_20261110') then
    raise exception 'pos_backup_20261110 is missing — nothing to restore from';
  end if;

  -- 1. triggers that 0086–0089 added
  for r in
    select c.relname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'pos'::regnamespace and not t.tgisinternal
       and not exists (
         select 1 from pos_backup_20261110.object_defs d
          where d.kind = 'trigger' and d.name = c.relname || '.' || t.tgname)
  loop
    execute format('drop trigger %I on pos.%I', r.tgname, r.relname);
    raise notice 'dropped trigger %.%', r.relname, r.tgname;
  end loop;

  -- 2. functions that 0086–0089 added
  for r in
    select p.oid::regprocedure::text as name
      from pg_proc p
     where p.pronamespace = 'pos'::regnamespace and p.prokind in ('f', 'p')
       and not exists (
         select 1 from pos_backup_20261110.object_defs d
          where d.kind = 'function' and d.name = p.oid::regprocedure::text)
  loop
    execute format('drop function %s', r.name);
    raise notice 'dropped function %', r.name;
  end loop;

  -- 3. functions back to their 0085 bodies (only the ones that changed)
  for r in
    select d.name, d.def
      from pos_backup_20261110.object_defs d
     where d.kind = 'function'
       and d.def is distinct from (
         select pg_get_functiondef(p.oid)
           from pg_proc p
          where p.pronamespace = 'pos'::regnamespace
            and p.oid::regprocedure::text = d.name)
  loop
    execute r.def;
    raise notice 'restored function %', r.name;
  end loop;

  -- 4. 0085 triggers a release removed
  for r in
    select d.name, d.def
      from pos_backup_20261110.object_defs d
     where d.kind = 'trigger'
       and not exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'pos'::regnamespace
            and c.relname || '.' || t.tgname = d.name)
  loop
    execute r.def;
    raise notice 'recreated trigger %', r.name;
  end loop;
end
$$;

alter table pos.money_transfers drop constraint if exists money_transfers_fee_not_negative;
alter table pos.money_transfers drop constraint if exists money_transfers_fee_below_amount;
alter table pos.stock drop constraint if exists stock_unit_size_not_negative;
alter table pos.ticket_items drop constraint if exists ticket_items_dates_in_order;

delete from supabase_migrations.schema_migrations where version in ('0086', '0087', '0088', '0089');

commit;
