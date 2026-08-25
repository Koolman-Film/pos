-- supabase/release-0025.sql
--
-- ความถูกต้องของจำนวนสต็อก — คำนวณที่ฐานข้อมูล ไม่ใช่ที่เบราว์เซอร์
--
-- รันต่อจาก release-0024.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create or replace function, create index if not exists
--
-- หมายเหตุ: ถ้ามีชื่อสินค้าซ้ำกันในสาขาเดียวกัน ไฟล์นี้จะข้ามการสร้าง unique index
-- แล้วขึ้น NOTICE บอก — รัน supabase/check-duplicate-stock-names.sql เพื่อดูว่าซ้ำที่ไหน
-- แก้แล้วรันไฟล์นี้ซ้ำได้เลย
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0025_stock_integrity.sql
--
-- ความถูกต้องของจำนวนสต็อก — คำนวณที่ฐานข้อมูล ไม่ใช่ที่เบราว์เซอร์
--
-- Every place that moved stock read `qty` into JavaScript, did the arithmetic
-- there and wrote the result back. Two people saving at the same time both read
-- 10, both write 8, and the shop is one roll short with nothing to show for it —
-- a lost update, and a silent one, because each write succeeded.
--
-- The fix is to let the database do the subtraction: `qty = qty - ?` is applied
-- against whatever the row holds at that instant, so two concurrent changes both
-- land. This is the only way to be correct with more than one counter, and the
-- shop has five branches.
--
-- Also here: a unique index on (สาขา, ชื่อสินค้า). Stock movement matches a
-- ticket's recorded usage to a product BY NAME, so two rows with the same name
-- at one branch made the match arbitrary — whichever came back first won. The
-- index is created only when the data already allows it; on a branch that has
-- duplicates it is skipped with a notice rather than failing the release, and
-- supabase/check-duplicate-stock-names.sql finds them.

set search_path = pos, public, extensions;

/**
 * เปลี่ยนจำนวนสต็อกหลายรายการพร้อมกัน แบบ atomic.
 *
 * `p_changes` is `[{"id": 12, "change": -2}, ...]` where `change` is added to
 * `qty` — negative consumes, positive receives. One statement for the whole set,
 * so a batch is all-or-nothing and no row is read into the client first.
 *
 * NOT clamped at zero, deliberately and consistently. `lib/stock/movements.ts`
 * already documented why: a negative figure means the shop counted wrong or
 * forgot to receive a delivery, and hiding that behind a floor of zero makes the
 * error permanent. The manual-withdrawal path used to clamp, which is the same
 * mistake in the other direction — it now behaves like every other path.
 *
 * RLS still applies (`security invoker`), so a caller can only move stock at a
 * shop they can already see.
 */
create or replace function apply_stock_deltas(p_changes jsonb)
returns void
language sql
security invoker
set search_path = pos
as $$
  update stock s
     set qty = s.qty + c.change
    from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as c(id bigint, change numeric)
   where s.id = c.id;
$$;

revoke all on function apply_stock_deltas(jsonb) from public, anon;
grant execute on function apply_stock_deltas(jsonb) to authenticated;

/*
  One product name per branch.

  Guarded rather than unconditional: a live branch may already carry duplicates,
  and failing the whole release over data the shop can fix in a minute would be
  the wrong trade. When it is skipped the notice says so, and the check script
  lists exactly which names to merge.
*/
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes
    from (select shop_id, name from stock group by shop_id, name having count(*) > 1) d;

  if v_dupes > 0 then
    raise notice 'ข้ามการสร้าง unique index: มีชื่อสินค้าซ้ำในสาขาเดียวกัน % ชื่อ — รัน supabase/check-duplicate-stock-names.sql เพื่อดูรายการ', v_dupes;
  else
    create unique index if not exists stock_shop_name_key on stock (shop_id, name);
    raise notice 'สร้าง unique index (shop_id, name) เรียบร้อย';
  end if;
end $$;

insert into supabase_migrations.schema_migrations(version, name) values ('0025', 'stock_integrity') on conflict (version) do nothing;
