-- supabase/check-duplicate-stock-names.sql
--
-- ชื่อสินค้าซ้ำกันในสาขาเดียวกัน — รันก่อนหรือหลัง release-0025.sql ก็ได้
--
-- Stock movement matches a ticket's recorded usage to a product by NAME, so two
-- rows sharing a name at one branch make that match arbitrary. Merge them (move
-- the quantity onto one row and delete the other) and re-run release-0025.sql to
-- get the unique index it skipped.

set search_path = pos, public;

select
  s.shop_id                        as shop,
  s.name                           as product_name,
  count(*)                         as row_count,
  string_agg(s.sku, ', ' order by s.id)  as skus,
  string_agg(s.qty::text, ', ' order by s.id) as quantities
from stock s
group by s.shop_id, s.name
having count(*) > 1
order by s.shop_id, s.name;
