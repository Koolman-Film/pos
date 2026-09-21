-- supabase/release-0062.sql
--
-- บัญชีรับชำระบนใบแจ้งหนี้ (ขายส่ง) และใบเสนอราคา (Book งาน)
--
-- รันต่อจาก release-0061.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create or replace /
-- drop trigger if exists ก่อนสร้างใหม่ ไม่แก้ข้อมูลเดิม
--
-- หลังรันไฟล์นี้:
--   * PO และใบงานเก็บ "บัญชีรับชำระ" ได้ — แหล่งเงินของสาขาเดียวกันเท่านั้น
--   * ใบแจ้งหนี้พิมพ์บัญชีที่เลือก ถ้าไม่เลือกพิมพ์ช่องทางการชำระเงินของสาขาเหมือนเดิม
--   * ใบเสนอราคาพิมพ์บัญชีที่เลือก ถ้าไม่เลือกก็ไม่พิมพ์ (เหมือนเดิม)
--   * ต้องขึ้นโค้ดเวอร์ชันใหม่พร้อมกัน โค้ดเดิมไม่รู้จักคอลัมน์นี้แต่ก็ไม่พัง
--   * ใส่ชื่อธนาคารและเลขบัญชีจริงของแต่ละแหล่งเงินได้ที่ การจัดการเงิน/บัญชี

set search_path = pos, public, extensions;

alter table orders
  add column if not exists pay_to_account_id bigint
    references money_accounts(id) on delete set null;

alter table tickets
  add column if not exists pay_to_account_id bigint
    references money_accounts(id) on delete set null;

comment on column orders.pay_to_account_id is
  'บัญชีที่พิมพ์ในใบแจ้งหนี้ให้ลูกค้าโอนเข้า — ต้องเป็นแหล่งเงินของสาขาเดียวกัน (0062).';
comment on column tickets.pay_to_account_id is
  'บัญชีที่พิมพ์ในใบเสนอราคาให้ลูกค้าโอนเข้า — ต้องเป็นแหล่งเงินของสาขาเดียวกัน (0062).';

create or replace function enforce_pay_to_account_shop() returns trigger
language plpgsql
set search_path = pos
as $$
begin
  if new.pay_to_account_id is not null and not exists (
    select 1 from money_accounts
     where id = new.pay_to_account_id and shop_id = new.shop_id
  ) then
    raise exception 'บัญชีรับชำระต้องเป็นแหล่งเงินของสาขาเดียวกับเอกสาร'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_pay_to_account_shop on orders;
create trigger orders_pay_to_account_shop
  before insert or update of pay_to_account_id, shop_id on orders
  for each row execute function enforce_pay_to_account_shop();

drop trigger if exists tickets_pay_to_account_shop on tickets;
create trigger tickets_pay_to_account_shop
  before insert or update of pay_to_account_id, shop_id on tickets
  for each row execute function enforce_pay_to_account_shop();

insert into supabase_migrations.schema_migrations(version, name) values ('0062', 'pay_to_account') on conflict (version) do nothing;
