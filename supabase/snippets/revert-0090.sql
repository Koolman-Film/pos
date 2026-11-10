-- supabase/snippets/revert-0090.sql
--
-- Puts enforce_ticket_dates() back to its 0085 body (every save of a ticket whose
-- pickup is at or before its drop-off is rejected, even when the dates are untouched).
-- The body below is exactly what production ran before the 2026-11-10 release of 0090
-- (read from production with pg_get_functiondef just before release-0090.sql).
--
-- Order of a full rollback:
--   1. App first:  vercel promote pos-8whn7v5pn-vivatchais-projects.vercel.app --yes
--   2. Then run this file once (`supabase db query --linked -f`). One transaction.
--
-- No data is touched. Re-running release-0090.sql later is safe.

begin;

CREATE OR REPLACE FUNCTION pos.enforce_ticket_dates()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.drop_off_date is not null
     and new.pickup_date is not null
     and new.pickup_date <= new.drop_off_date then
    raise exception 'วันที่ส่งงานต้องอยู่หลังวันที่รับงาน — ถ้าเป็นวันเดียวกัน เวลาส่งงานต้องหลังเวลารับงาน'
      using errcode = '23514';
  end if;
  return new;
end;
$function$
;

delete from supabase_migrations.schema_migrations where version = '0090';

commit;
