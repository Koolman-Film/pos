-- supabase/migrations/0053_sales_people_manage.sql
--
-- จัดการพนักงานขาย — ใส่ชื่อและเบอร์โทรได้จากหน้า PO
--
-- 0047 created `sales_people` and seeded โหน่ง and เคน with EMPTY phone numbers,
-- and then gave the shop no way to fill them in: there is no screen for this
-- table anywhere in the app. The phone is what a wholesale customer rings off
-- the invoice, the delivery note and the shipping label, so the one field those
-- three documents exist to carry could only be set by hand in SQL.
--
-- The write policy is tightened at the same time. `sales_people_write` let any
-- signed-in member of the branch insert and update — which was survivable while
-- nothing could reach it, and is not now that a screen can. This is the same
-- decision as `options.manage` covers elsewhere: who may edit the shop's own
-- reference lists (technicians, commission teams, การจอง options). A sales rep
-- picking their own name off a list is not the same act as editing the list.

set search_path = pos, public, extensions;

drop policy if exists sales_people_write on sales_people;

create policy sales_people_write on sales_people for all
  using (
    shop_id in (select current_user_shops())
    and current_user_can('options.manage')
  )
  with check (
    shop_id in (select current_user_shops())
    and current_user_can('options.manage')
  );
