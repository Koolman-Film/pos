-- supabase/snippets/revert-0077-0085.sql
--
-- Puts the pos schema's BEHAVIOUR back to 0076, using the snapshot taken just
-- before the 2026-10-16 release (pos_backup_20261016.object_defs).
--
-- Order of a full rollback:
--   1. App first:  vercel promote pos-1cd367gec-vivatchais-projects.vercel.app --yes
--   2. Then run this file once (MCP execute_sql or `supabase db query --linked -f`).
--      It runs as one transaction: it either all applies or nothing does.
--
-- What it does:
--   - drops every trigger in pos that did not exist at 0076 (auto PO status,
--     ticket date rule, memo stamp, ...);
--   - restores every function that existed at 0076 to its exact 0076 body
--     (save_order_children, save_ticket_children, save_insurance_policy, ...);
--   - recreates any 0076 trigger that a release dropped.
-- What it leaves alone (harmless to the 0076 app, which never reads them):
--   new tables (order_deliveries, order_delivery_items, order_installments,
--   ticket_memos), new columns, the two new ws_statuses rows, new functions.
--   Data: nothing is deleted. To restore row values too, copy from the
--   pos_backup_20261016 tables (same columns as 0076).

do $$
declare
  r record;
begin
  -- 1. triggers that 0077–0085 added
  for r in
    select c.relname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'pos' and not t.tgisinternal
       and not exists (
         select 1 from pos_backup_20261016.object_defs d
          where d.kind = 'trigger' and d.name = c.relname || '.' || t.tgname)
  loop
    execute format('drop trigger %I on pos.%I', r.tgname, r.relname);
    raise notice 'dropped trigger %.%', r.relname, r.tgname;
  end loop;

  -- 2. functions back to their 0076 bodies (only the ones that changed)
  for r in
    select d.name, d.def
      from pos_backup_20261016.object_defs d
     where d.kind = 'function'
       and d.def is distinct from (
         select pg_get_functiondef(p.oid)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'pos' and p.oid::regprocedure::text = d.name)
  loop
    execute r.def;
    raise notice 'restored function %', r.name;
  end loop;

  -- 3. 0076 triggers a release removed
  for r in
    select d.name, d.def
      from pos_backup_20261016.object_defs d
     where d.kind = 'trigger'
       and not exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'pos' and c.relname || '.' || t.tgname = d.name)
  loop
    execute r.def;
    raise notice 'recreated trigger %', r.name;
  end loop;
end
$$;
