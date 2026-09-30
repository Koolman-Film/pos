-- supabase/snippets/fingerprint.sql
--
-- Schema fingerprint of the `pos` schema: one md5 per category of object.
-- Read-only. Run it on production after a release and on a local database built
-- from `supabase/migrations/` (`npm run db:reset`); every category should match.
-- Used for every production release since 0053 (checklist 3.4).
--
-- A mismatch means a release file and its migration disagree. To see which
-- object, replace the final SELECT with the per-object form at the bottom and
-- diff the two outputs.
--
-- `rp` (role_permissions) is DATA, not schema: an admin toggling a permission
-- in the app changes it on production. A mismatch there alone is expected;
-- read the diff rather than "fixing" it.
--
-- Comments and whitespace are stripped before hashing, so a release file that
-- differs from its migration only in comments still matches.
--
-- The Supabase MCP `execute_sql` returns only the LAST statement's result, so
-- this is deliberately a single statement.

with defs as (
  select 'fn' as cat, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
         pg_get_functiondef(p.oid) as d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pos' and p.prokind = 'f'
  union all
  select 'tg', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'pos' and not t.tgisinternal
  union all
  select 'pol', schemaname || '.' || tablename || '.' || policyname,
         coalesce(cmd, '') || coalesce(array_to_string(roles, ','), '')
           || coalesce(qual, '') || coalesce(with_check, '')
    from pg_policies
   where schemaname = 'pos' or (schemaname = 'storage' and tablename = 'objects')
  union all
  select 'col', table_name || '.' || column_name,
         data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'pos'
  union all
  select 'idx', indexname, indexdef from pg_indexes where schemaname = 'pos'
  union all
  select 'con', conrelid::regclass || '.' || conname, pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'pos'::regnamespace
  union all
  select 'rp', role_id || '.' || permission_type || '.' || permission_key, allowed::text
    from pos.role_permissions
),
hashed as (
  select cat, k,
         md5(regexp_replace(regexp_replace(d, '--[^\n]*', '', 'g'), '\s+', '', 'g')) as h
    from defs
)
select cat, count(*) as objects, md5(string_agg(k || '|' || h, ',' order by k)) as fingerprint
  from hashed
 group by cat
 order by cat;

-- Per-object form, to find the object behind a mismatch:
--   select cat || ':' || k || '|' || h from hashed order by cat, k;
