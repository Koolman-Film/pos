-- supabase/release-0035.sql
--
-- สาขาที่จดทะเบียนภาษีมูลค่าเพิ่ม ออกใบกำกับภาษีได้เท่านั้น
--
-- รันต่อจาก release-0034.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists และไม่ทับค่าที่แก้ไว้บนหน้าจอ
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0035_vat_registered_shop.sql
--
-- สาขาที่จดทะเบียนภาษีมูลค่าเพิ่ม ออกใบกำกับภาษีได้เท่านั้น
--
-- Only FINNIX FILM เชียงใหม่ is registered for VAT, so only เชียงใหม่ may issue a
-- ใบกำกับภาษี/ใบเสร็จรับเงิน. Any other branch issuing one would be handing a
-- customer a tax document against a registration it does not hold — the kind of
-- mistake that is found by an auditor, months later, on paper already in
-- somebody else's hands.
--
-- A column rather than a branch id written into the code: registrations change,
-- and a shop that registers next year should become able to issue tax invoices
-- by ticking a box in จัดการสิทธิ์, not by waiting for a developer. It sits on
-- `shop_info`, beside the company name and tax id that print on those documents.

set search_path = pos, public, extensions;

alter table shop_info
  add column if not exists vat_registered boolean not null default false;

comment on column shop_info.vat_registered is
  'สาขานี้จดทะเบียนภาษีมูลค่าเพิ่ม จึงออกใบกำกับภาษีได้ (migration 0035)';

-- The one branch that is registered today. Guarded so a re-run cannot undo a
-- change the shop has since made on the screen.
insert into shop_info (shop_id, vat_registered)
values ('cm', true)
on conflict (shop_id) do update
  set vat_registered = true
  where shop_info.vat_registered is distinct from true;

insert into supabase_migrations.schema_migrations(version, name) values ('0035', 'vat_registered_shop') on conflict (version) do nothing;
