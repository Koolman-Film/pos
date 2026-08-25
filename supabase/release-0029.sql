-- supabase/release-0029.sql
--
-- ราคาฟิล์ม/กันรอย แยกตามสาขาได้
--
-- รันต่อจาก release-0028.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0029_film_price_per_shop.sql
--
-- ราคาฟิล์ม/กันรอย แยกตามสาขาได้ — สาขาเดียวกันสินค้าเดียวกันขายคนละราคาได้
--
-- The shop sells the same product at different prices at different branches.
-- `stock.sell_price` already allowed that, because a stock row belongs to one
-- shop. `film_price_matrix` did not: it had no shop column at all, so ONE price
-- per (ชนิดสินค้า × สินค้า × ตำแหน่งติดตั้ง × ประเภทรถ) was shared by all five
-- branches — and an admin setting Lampang's price silently changed Chiang Mai's,
-- with nothing on screen to say it had happened.
--
-- `shop_id` is nullable and means what it means everywhere else in this schema
-- (`commission_rules`, `insurance_plans`): NULL is the ราคากลาง every branch
-- falls back to, and a row with a shop overrides it for that branch only.
-- Existing rows stay NULL, so nothing changes for a shop that has not set a
-- branch price — which is every shop today.

set search_path = pos, public, extensions;

alter table film_price_matrix
  add column if not exists shop_id text references shops(id) on delete cascade;

comment on column film_price_matrix.shop_id is
  'NULL = ราคากลางใช้ทุกสาขา; ระบุสาขา = ราคาเฉพาะสาขานั้น ทับราคากลาง';

/*
  The old constraint has to go first.

  `unique (category, product, position, car_type)` from migration 0003 knows
  nothing about shops, so with it in place a branch price and the ราคากลาง for
  the same combination could not both exist — the second insert failed. The two
  partial indexes below say the same thing correctly, once per scope.
*/
alter table film_price_matrix
  drop constraint if exists film_price_matrix_category_product_position_car_type_key;

/*
  One price per combination per scope.

  Two indexes rather than one, because NULL is not equal to itself in a unique
  index: without the first, a branch could accumulate any number of duplicate
  ราคากลาง rows and the lookup would pick between them arbitrarily.
*/
create unique index if not exists film_price_matrix_global_key
  on film_price_matrix (category, product, "position", car_type)
  where shop_id is null;

create unique index if not exists film_price_matrix_shop_key
  on film_price_matrix (shop_id, category, product, "position", car_type)
  where shop_id is not null;

insert into supabase_migrations.schema_migrations(version, name) values ('0029', 'film_price_per_shop') on conflict (version) do nothing;
