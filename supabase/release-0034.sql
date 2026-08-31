-- supabase/release-0034.sql
--
-- เพิ่ม/แก้ไขชื่อสาขาได้จากหน้าจัดการสิทธิ์
--
-- รันต่อจาก release-0033.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function อย่างเดียว ไม่แก้ข้อมูล
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0034_manage_shops.sql
--
-- เพิ่ม/แก้ไขชื่อสาขา ได้จากหน้าจัดการสิทธิ์
--
-- The five branches were seeded by migration 0001 and there has been no way to
-- add a sixth since. Opening a new shop — one that only does ขายส่ง, say — meant
-- asking a developer to write SQL, which is not a thing a shop should have to do
-- to open a shop.
--
-- `shops` carries a select-only policy (migration 0007), so this is a
-- `security definer` function rather than an insert policy: the admin check then
-- lives in the database and holds for any caller, not only for the screen that
-- has the button.
--
-- No delete. `shops.id` is referenced by tickets, orders, stock, expenses, petty
-- cash, commission rules and more; removing a branch would either fail on those
-- constraints or, worse, take its history with it. A branch that closes is a
-- branch nobody is given access to.

set search_path = pos, public, extensions;

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

  return v_id;
end;
$$;

revoke all on function save_shop(text, text, integer) from public, anon;
grant execute on function save_shop(text, text, integer) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0034', 'manage_shops') on conflict (version) do nothing;
