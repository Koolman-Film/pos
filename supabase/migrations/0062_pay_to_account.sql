/*
  บัญชีรับชำระบนใบแจ้งหนี้และใบเสนอราคา (ร้านขอ 21 ก.ย. 2569)

  "ให้สามารถระบุแหล่งเงินได้ เพื่อให้แหล่งเงินแสดงในเอกสารใบแจ้งหนี้ เพื่อให้ลูกค้า
  รู้ว่าจ่ายเงินไปที่ไหน" — และใบเสนอราคาใน Book งานก็เช่นกัน

  ใบแจ้งหนี้ขายส่งเคยพิมพ์ "ช่องทางการชำระเงิน" ทั้งหมดของสาขา (ถ้าตั้งไว้) และ
  ใบเสนอราคาไม่พิมพ์อะไรเลย ลูกค้าจึงไม่รู้ว่าจะโอนเข้าบัญชีไหน ทั้งที่ระบบมีแหล่งเงิน
  ของแต่ละสาขาอยู่แล้ว (0043)

  เก็บไว้ที่ตัวเอกสาร — orders และ tickets — ไม่ใช่เลือกตอนพิมพ์แล้วหายไป: ใบแจ้งหนี้
  ถูกพิมพ์ซ้ำ และแต่ละครั้งต้องบอกบัญชีเดียวกัน

  บัญชีต้องเป็นของสาขาเดียวกับเอกสาร ตรวจด้วย trigger ไม่ใช่แค่ที่หน้าจอ — ใบแจ้งหนี้
  ของสาขาหนึ่งที่พิมพ์เลขบัญชีของอีกสาขา คือเงินที่ลูกค้าโอนไปผิดที่

  ลบแหล่งเงินทิ้ง → on delete set null เอกสารกลับไปใช้ค่าเดิม (ช่องทางของสาขา)
  ไม่แก้ข้อมูลเดิม
*/

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
