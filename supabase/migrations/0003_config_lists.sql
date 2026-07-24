-- supabase/migrations/0003_config_lists.sql
create table option_lists (
  id bigint generated always as identity primary key,
  list_key text not null,
  value text not null,
  shop_id text references shops(id) on delete cascade,
  sort_order int not null default 0,
  unique (list_key, value, shop_id)
);

-- flat lists ported from reference/v0.4/finnix-film.html:270-280,346-347,360-361,302
insert into option_lists (list_key, value, sort_order) values
  ('booking_channels','Walk-in',1), ('booking_channels','เพจร้าน',2), ('booking_channels','Dex',3), ('booking_channels','33Film',4), ('booking_channels','FINNIX บางแค',5),
  ('service_types','เข้าชม',1), ('service_types','เข้าทำ/ติดตั้ง',2),
  ('car_types','เก๋งเล็ก',1), ('car_types','เก๋งใหญ่',2), ('car_types','SUV',3), ('car_types','กระบะ',4), ('car_types','ตู้/แวน',5),
  ('car_brands','Toyota',1), ('car_brands','Honda',2), ('car_brands','Mazda',3), ('car_brands','Isuzu',4), ('car_brands','Ford',5),
  ('time_slots','08:00',1), ('time_slots','09:00',2), ('time_slots','10:00',3), ('time_slots','11:00',4), ('time_slots','12:00',5),
  ('time_slots','13:00',6), ('time_slots','14:00',7), ('time_slots','15:00',8), ('time_slots','16:00',9), ('time_slots','17:00',10),
  ('time_slots','18:00',11), ('time_slots','19:00',12),
  ('film_positions','บานหน้า',1), ('film_positions','คู่หน้า',2), ('film_positions','คู่หลัง',3), ('film_positions','บานตาย',4), ('film_positions','บานหลัง',5), ('film_positions','Sunroof',6), ('film_positions','ฟิล์มอาคาร',7),
  ('wrap_positions','เต็มคัน',1), ('wrap_positions','เฉพาะส่วน',2),
  ('extra_options','รถสไลด์',1), ('extra_options','ประกัน',2), ('extra_options','นอกสถานที่',3), ('extra_options','แก้งาน',4), ('extra_options','Service',5),
  ('slide_types','Walk-in',1), ('slide_types','Showroom',2), ('slide_types','สไลด์ส่วนตัว',3),
  ('technicians','ช่างเอก',1), ('technicians','ช่างบอย',2), ('technicians','ช่างนัท',3), ('technicians','ช่างเอ',4),
  ('product_categories','ฟิล์มกรองแสง',1), ('product_categories','ฟิล์มกันรอย',2), ('product_categories','เครื่องเสียง',3), ('product_categories','สปอยเลอร์',4), ('product_categories','ประกัน',5), ('product_categories','งานบริการ',6),
  ('service_items','ประกัน',1), ('service_items','ล้างรถ',2), ('service_items','ลอกฟิล์ม',3),
  ('expense_categories','ค่าเช่า',1), ('expense_categories','ค่าน้ำ-ไฟ',2), ('expense_categories','เงินเดือน',3), ('expense_categories','ค่าวัสดุสิ้นเปลือง',4), ('expense_categories','การตลาด',5),
  ('payment_sources','เงินสดย่อย',1), ('payment_sources','บัญชีธนาคารสาขา',2), ('payment_sources','บัตรเครดิตบริษัท',3),
  ('payment_methods','เงินสด',1), ('payment_methods','โอนเงิน',2), ('payment_methods','บัตรเครดิต',3);

create table statuses (
  key text primary key,
  short text not null,
  bg text not null,
  text_color text not null,
  dot text not null,
  sort_order int not null default 0
);
insert into statuses (key, short, bg, text_color, dot, sort_order) values
  ('จองแล้ว','จองแล้ว','#F1EDE7','#6B5F55','#B5AAA1',1),
  ('กำลัง QC ก่อนติดตั้ง','รอ QC','#FBF1DA','#8A5A12','#E8B23D',2),
  ('กำลังติดตั้ง','กำลังติดตั้ง','#DEEEEC','#286B62','#2F8F82',3),
  ('รอส่งมอบ','รอส่งมอบ','#E6EFDC','#4C7A3E','#6BA24F',4),
  ('ส่งมอบแล้ว','ส่งมอบแล้ว','#F1EDE7','#6B5F55','#B5AAA1',5),
  ('ค้างชำระ','ค้างชำระ','#FBEAEC','#B23A48','#C24B57',6);

create table ws_statuses (
  key text primary key,
  bg text not null,
  text_color text not null,
  dot text not null,
  sort_order int not null default 0
);
insert into ws_statuses (key, bg, text_color, dot, sort_order) values
  ('รออนุมัติราคา','#FBF1DA','#8A5A12','#E8B23D',1),
  ('รอจัดส่ง','#DEEEEC','#286B62','#2F8F82',2),
  ('จัดส่งแล้ว','#E6EFDC','#4C7A3E','#6BA24F',3),
  ('ค้างชำระ','#FBEAEC','#B23A48','#C24B57',4),
  ('ปิดงานแล้ว','#F1EDE7','#6B5F55','#B5AAA1',5);

-- structured lookups (NOT flat strings — see spec §5)
create table car_models (
  id bigint generated always as identity primary key,
  model text not null,
  brand text not null,
  car_type text not null
);
insert into car_models (model, brand, car_type) values
  ('Vios','Toyota','เก๋งเล็ก'), ('City','Honda','เก๋งเล็ก'), ('2','Mazda','SUV'), ('D-Max','Isuzu','กระบะ'), ('Camry','Toyota','เก๋งใหญ่');

create table price_matrix (
  id bigint generated always as identity primary key,
  car_type text not null,
  product text not null,
  price numeric not null,
  unique (car_type, product)
);

create table film_price_matrix (
  id bigint generated always as identity primary key,
  category text not null,
  product text not null,
  position text not null,
  car_type text not null,
  price numeric not null,
  unique (category, product, position, car_type)
);

create table corporate_buyers (
  id bigint generated always as identity primary key,
  name text not null,
  address text not null default '',
  tax_id text not null default ''
);
