-- supabase/migrations/0075_pin_search_path.sql
--
-- ปักหมุด search_path ให้ current_user_sees_all_shops อีกครั้ง
--
-- 0007 created it as SECURITY DEFINER with `set search_path = pos`. 0008
-- re-created it with `create or replace` and no `set` clause, and
-- `create or replace` REPLACES the function's configuration along with its body
-- — so the pin silently disappeared. A SECURITY DEFINER function without a fixed
-- search_path resolves unqualified names through whatever path the caller has
-- set, which is the textbook way to make a privileged function run somebody
-- else's code. It is the only function in `pos` in that state (every other one
-- pins it; checked below).
--
-- `alter function … set` changes only the configuration, not the body, so the
-- function behaves exactly as it did.

set search_path = pos, public, extensions;

alter function pos.current_user_sees_all_shops() set search_path = pos;

-- Every SECURITY DEFINER function in pos must pin its search_path. Fails the
-- migration rather than letting another one slip through the same way.
do $$
declare
  v_missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pos'
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
     );
  if v_missing is not null then
    raise exception 'SECURITY DEFINER functions without a pinned search_path: %', v_missing;
  end if;
end $$;
