-- supabase/seed.sql — the prototype's sample business data (Task 20, spec §7).
--
-- Run automatically by `supabase db reset`. It ends with ONE working admin login
-- (admin@finnixfilm.com) so a bare reset leaves you able to sign in; the other
-- three sample accounts (exec / sales / tech) still come from
-- `supabase/seed.ts` (`npm run db:seed`), which needs the Auth Admin API.
--
-- Everything below is `reference/v0.4/finnix-film.html:238-372` — initialTickets,
-- initialRetailCustomers, initialCustomers, initialOrders, initialStock,
-- initialWithdrawals, initialCommissionRules, initialExpenses, initialPettyCash —
-- translated to the schema from migrations 0001-0008. The config tables
-- (statuses, ws_statuses, option_lists, car_models, shops, roles,
-- role_permissions) are already seeded by those migrations and are not repeated.
-- price_matrix, film_price_matrix and corporate_buyers start empty because the
-- prototype starts them empty (`useState([])` at :4358-4370).
--
-- ทุกใบงานอยู่ในอนาคต. Every sample ticket is booked between today and a week
-- out, one per สถานะ, so the dashboard demonstrates ALL SIX at once — the card,
-- the calendar and the status bars only reach a few days either side of today,
-- so a sample sitting in the past proves nothing about how it looks. The two
-- finished states (ส่งมอบแล้ว, ค้างชำระ) sit at the far end of that window: a job
-- delivered on a future date is not a thing that happens, and this is sample
-- data whose whole purpose is showing the shop what each state looks like.
--
-- DATES. The prototype expresses ticket dates relatively, as `daysFromNow(n)`
-- (:239-273), and its `daysFromNow` also pins the time to 09:00 local. Those stay
-- relative here, so the dashboard's "today" filter and its 7-day booking window
-- always have data no matter when the seed is run — a fixed-date seed would make
-- the dashboard look broken a week later. Where the prototype used a real
-- absolute date (the expense `dateObj`s, all July 2026) or a Thai date string
-- ('20 ก.ค. 2569'), that exact date is preserved: 2569 BE = 2026 CE, ก.ค. = July.
--
-- Idempotent: truncating first means `db reset` and a manual re-run behave the
-- same. Order respects the FKs; the identity sequences restart so the
-- integer ids below (customer 1..5, stock 1..5) match the prototype's.

-- Seeds this app's own schema; `auth.*` and `extensions.*` stay qualified.
set search_path = pos, public, extensions;

truncate table
  -- service_visits / insurance_* would come along by cascade from tickets;
  -- naming them keeps the list readable as "what this file owns".
  service_visit_points, service_visits, insurance_claims, insurance_policies,
  ticket_item_positions, ticket_items, ticket_payments, ticket_status_history, tickets,
  order_items, order_returns, order_payments, order_adjustments, orders,
  commission_rule_teams, commission_rules,
  withdrawals, stock, expenses, petty_cash,
  retail_customers, wholesale_customers
restart identity cascade;

-- ---------------------------------------------------------------- customers --

insert into retail_customers (name, phone) values
  ('คุณ เอ', '081-234-5678'),
  ('คุณ สมชาย', '082-345-6789'),
  ('คุณ วิภา', '083-456-7890'),
  ('คุณ ปรีชา', '084-567-8901'),
  ('คุณ นภา', '085-678-9012');

/*
  Finnix North — the wholesale-only branch.

  Created in the live system already; added here so development can exercise a
  branch that sells through ขายส่ง and nothing else. `on conflict do nothing`
  because 0001 owns the original five and this file must stay re-runnable.
*/
insert into shops (id, name, sort_order) values ('north', 'Finnix North', 6)
  on conflict (id) do nothing;
insert into shop_info (shop_id) values ('north') on conflict (shop_id) do nothing;

-- 0045 backfills money accounts for every shop that exists when it RUNS, and
-- migrations run before this file. North is created here, so it needs its own
-- four. A branch added through the app gets them from `save_shop`.
insert into money_accounts (shop_id, name, kind, match_names, sort_order)
select 'north', a.name, a.kind, a.match_names, a.sort_order
from (values
  ('เงินสดหน้าร้าน', 'cash',  array['เงินสด'],                                       1),
  ('บัญชีธนาคารสาขา', 'bank',  array['บัญชีธนาคารสาขา','โอนเงิน','โอน TTB','โอน BBK'], 2),
  ('เงินสดย่อย',      'petty', array['เงินสดย่อย'],                                   3),
  ('บัตรเครดิตบริษัท',  'credit', array['บัตรเครดิตบริษัท','บัตรเครดิต'],                  4)
) as a(name, kind, match_names, sort_order)
on conflict (shop_id, name) do nothing;

-- โหน่ง และ เคน ขายภายใต้ชื่อ Finnix North. Scoped to that branch, so the two
-- names do not appear in the pickers of shops they do not work at.
insert into option_lists (list_key, value, sort_order, shop_id) values
  ('sales_people', 'โหน่ง', 1, 'north'),
  ('sales_people', 'เคน', 2, 'north')
  on conflict do nothing;

insert into wholesale_customers (name, phone, address) values
  ('ร้านออโต้สไตล์', '081-234-5678', 'เชียงใหม่'),
  ('ร้านออโต้เซอร์วิส บางแค', '082-345-6789', 'กรุงเทพฯ'),
  ('ร้านดีคาร์แคร์', '083-456-7890', 'ลำพูน'),
  ('ร้านทีเอสออโต้', '084-567-8901', 'พะเยา'),
  ('ร้านเจริญยนต์', '085-678-9012', 'ลำปาง');

-- ------------------------------------------------------------------ tickets --
-- `daysFromNow(n)` = midnight + n days at 09:00, matching the prototype helper.

insert into tickets (
  id, shop_id, retail_customer_id, customer_name, phone, plate, car_type, brand, model, color,
  service_type, status, booking_channel, tech_by_category, drop_off_date, pickup_date, extras
) values
  ('JT-CM-00214', 'cm', (select id from retail_customers where name = 'คุณ เอ'),
   'คุณ เอ', '081-234-5678', '250 กก', 'เก๋งเล็ก', 'Toyota', 'Vios', 'ขาว',
   'เข้าทำ/ติดตั้ง', 'กำลัง QC ก่อนติดตั้ง', 'Walk-in',
   '{"ฟิล์มกรองแสง": ["ช่างเอก"], "เครื่องเสียง": ["ช่างบอย"]}'::jsonb,
   (current_date + 1) + time '09:00', (current_date + 1) + time '17:00',
   '{"ประกัน": {"checked": true}}'::jsonb),

  ('JT-CM-00212', 'cm', (select id from retail_customers where name = 'คุณ สมชาย'),
   'คุณ สมชาย', '082-345-6789', '1กข 4521', 'เก๋งเล็ก', 'Honda', 'City', 'ดำ',
   'เข้าทำ/ติดตั้ง', 'กำลังติดตั้ง', 'เพจร้าน',
   '{"เครื่องเสียง": ["ช่างบอย"], "ฟิล์มกันรอย": ["ช่างเอ"]}'::jsonb,
   (current_date + 2) + time '10:00', (current_date + 2) + time '16:00',
   -- Service ticked, so the recorded visit further down has something to hang
   -- off and the ใบงาน shows its own dates in the header. `serviceDate` is the
   -- next visit the customer is entitled to; the visits themselves are rows.
   jsonb_build_object('Service', jsonb_build_object(
     'checked', true,
     'serviceCount', 12,
     'serviceDate', to_char(current_date + 4, 'YYYY-MM-DD')))),

  ('JT-CM-00209', 'cm', (select id from retail_customers where name = 'คุณ วิภา'),
   'คุณ วิภา', '083-456-7890', 'กท 8890', 'SUV', 'Mazda', '2', 'แดง',
   'เข้าทำ/ติดตั้ง', 'รอส่งมอบ', 'Dex',
   '{"เครื่องเสียง": ["ช่างนัท"]}'::jsonb,
   -- Came in yesterday, due back in three days: รอส่งมอบ is the one status the
   -- card windows on the pickup, so that is the day it appears under.
   (current_date - 1) + time '09:00', (current_date + 3) + time '14:00',
   '{}'::jsonb),

  ('JT-LP-00088', 'lp', (select id from retail_customers where name = 'คุณ ปรีชา'),
   'คุณ ปรีชา', '084-567-8901', '3ขค 112', 'กระบะ', 'Isuzu', 'D-Max', 'บรอนซ์',
   'เข้าทำ/ติดตั้ง', 'ค้างชำระ', '33Film',
   '{"ฟิล์มกรองแสง": ["ช่างเอ"]}'::jsonb,
   (current_date + 6) + time '09:00', (current_date + 6) + time '15:00',
   -- แก้งาน with dates AND times of its own (0041): the car comes back on a
   -- different day from the job it belongs to, and both the ใบงานติดตั้ง and
   -- the dashboard read those rather than the ticket’s.
   jsonb_build_object(
     'นอกสถานที่', jsonb_build_object(
       'checked', true, 'mapLink', 'https://maps.google.com/?q=13.7563,100.5018'),
     'แก้งาน', jsonb_build_object(
       'checked', true,
       'detail', 'ฟิล์มบานหน้ามีฟองอากาศ ต้องลอกแล้วติดใหม่',
       'category', 'ฟิล์มกรองแสง',
       'receivedAt', to_char(current_date + 4, 'YYYY-MM-DD'),
       'receivedTime', '10:00',
       'deliveredAt', to_char(current_date + 4, 'YYYY-MM-DD'),
       'deliveredTime', '16:00'))),

  ('JT-CM-00207', 'cm', (select id from retail_customers where name = 'คุณ นภา'),
   'คุณ นภา', '085-678-9012', '9กท 220', 'เก๋งใหญ่', 'Toyota', 'Camry', 'เทา',
   'เข้าทำ/ติดตั้ง', 'จองแล้ว', 'FINNIX บางแค',
   '{}'::jsonb,
   (current_date + 2) + time '09:00', (current_date + 2) + time '17:00',
   -- รถสไลด์ with both legs dated. The truck fetching the car and the truck
   -- taking it home are two separate days somebody has to be ready for, so
   -- each shows on the dashboard as its own appointment.
   jsonb_build_object('รถสไลด์', jsonb_build_object(
     'checked', true,
     'slideType', 'Showroom',
     'legs', jsonb_build_array(
       jsonb_build_object('from', 'โชว์รูม', 'to', 'ร้าน',
         'date', to_char(current_date + 2, 'YYYY-MM-DD'), 'time', '08:00'),
       jsonb_build_object('from', 'ร้าน', 'to', 'บ้านลูกค้า',
         'date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '17:00'))))),

  -- ส่งมอบแล้ว — the sixth สถานะ, which no sample ticket used, so both the
  -- status bar and the calendar legend carried a permanently empty row.
  ('JT-CM-00218', 'cm', (select id from retail_customers where name = 'คุณ วิภา'),
   'คุณ วิภา', '083-456-7890', 'ขข 4417', 'SUV เล็ก', 'Honda', 'HR-V', 'ขาว',
   'เข้าทำ/ติดตั้ง', 'ส่งมอบแล้ว', 'Walk-in',
   '{"ฟิล์มกรองแสง": ["ช่างเอก"]}'::jsonb,
   (current_date + 5) + time '09:00', (current_date + 5) + time '16:00',
   '{}'::jsonb);

insert into ticket_items (ticket_id, category, booked, booked_price, sold, sold_price) values
  ('JT-CM-00214', 'ฟิล์มกรองแสง', '', 0,
   'บานหน้า: ฟิล์ม FINNIX CT 40%, คู่หน้า: ฟิล์ม 3M CRM 60%, คู่หลัง: ฟิล์ม 3M CRM 60%', 5100),
  ('JT-CM-00214', 'เครื่องเสียง', 'ลำโพงคู่มาตรฐาน', 3500, 'ลำโพงคู่ JBL Stage', 4500),
  ('JT-CM-00212', 'เครื่องเสียง', 'ลำโพงคู่มาตรฐาน', 3500, 'ลำโพงคู่ JBL Stage', 4500),
  ('JT-CM-00212', 'ฟิล์มกันรอย', '', 0, 'เต็มคัน: TPU กันรอยเกรดพรีเมียม', 2200),
  ('JT-CM-00209', 'เครื่องเสียง', 'จอ 7 นิ้ว', 5000, 'จอแอนดรอยด์ 9 นิ้ว', 6500),
  ('JT-LP-00088', 'ฟิล์มกรองแสง', '', 0,
   'บานหน้า: ฟิล์ม 3M CRM 60%, บานหลัง: ฟิล์ม 3M CRM 60%', 3800),
  ('JT-CM-00207', 'ฟิล์มกรองแสง', 'ฟิล์ม 3M CRM', 9000, '', 0),
  ('JT-CM-00218', 'ฟิล์มกรองแสง', '', 0, 'รอบคัน: ฟิล์ม FINNIX CT 40%', 6400);

-- Positions hang off the film/wrap items. Looked up by (ticket, category) rather
-- than by a hardcoded id, since ticket_items.id is an identity column.
insert into ticket_item_positions (ticket_item_id, position, product, price) values
  ((select id from ticket_items where ticket_id = 'JT-CM-00214' and category = 'ฟิล์มกรองแสง'),
   'บานหน้า', 'ฟิล์ม FINNIX CT 40%', 1300),
  ((select id from ticket_items where ticket_id = 'JT-CM-00214' and category = 'ฟิล์มกรองแสง'),
   'คู่หน้า', 'ฟิล์ม 3M CRM 60%', 1900),
  ((select id from ticket_items where ticket_id = 'JT-CM-00214' and category = 'ฟิล์มกรองแสง'),
   'คู่หลัง', 'ฟิล์ม 3M CRM 60%', 1900),
  ((select id from ticket_items where ticket_id = 'JT-CM-00212' and category = 'ฟิล์มกันรอย'),
   'เต็มคัน', 'TPU กันรอยเกรดพรีเมียม', 2200),
  ((select id from ticket_items where ticket_id = 'JT-LP-00088' and category = 'ฟิล์มกรองแสง'),
   'บานหน้า', 'ฟิล์ม 3M CRM 60%', 1900),
  ((select id from ticket_items where ticket_id = 'JT-LP-00088' and category = 'ฟิล์มกรองแสง'),
   'บานหลัง', 'ฟิล์ม 3M CRM 60%', 1900),
  ((select id from ticket_items where ticket_id = 'JT-CM-00218' and category = 'ฟิล์มกรองแสง'),
   'รอบคัน', 'ฟิล์ม FINNIX CT 40%', 6400);

insert into ticket_payments (ticket_id, type, method, amount, paid_at) values
  ('JT-CM-00214', 'มัดจำ', 'โอน TTB', 2000, date '2026-07-20'),
  ('JT-CM-00209', 'ชำระเต็มจำนวน', 'เงินสด', 6500, date '2026-07-26'),
  -- Paid in full, which is what ส่งมอบแล้ว means; the ค้างชำระ ticket
  -- deliberately has none, so the two states differ in the numbers as well as
  -- in the label.
  ('JT-CM-00218', 'ชำระเต็มจำนวน', 'โอน TTB', 6400, current_date);

insert into ticket_status_history (ticket_id, status, changed_at) values
  ('JT-CM-00214', 'จองแล้ว', (current_date - 3) + time '09:00'),
  ('JT-CM-00214', 'กำลัง QC ก่อนติดตั้ง', (current_date - 1) + time '09:00'),
  ('JT-CM-00212', 'จองแล้ว', (current_date - 5) + time '09:00'),
  ('JT-CM-00212', 'กำลัง QC ก่อนติดตั้ง', (current_date - 4) + time '09:00'),
  ('JT-CM-00212', 'กำลังติดตั้ง', (current_date - 3) + time '09:00'),
  ('JT-CM-00209', 'จองแล้ว', (current_date - 6) + time '09:00'),
  ('JT-CM-00209', 'กำลังติดตั้ง', (current_date - 5) + time '09:00'),
  ('JT-CM-00209', 'รอส่งมอบ', (current_date - 3) + time '09:00'),
  ('JT-LP-00088', 'จองแล้ว', (current_date - 8) + time '09:00'),
  ('JT-LP-00088', 'กำลังติดตั้ง', (current_date - 7) + time '09:00'),
  ('JT-LP-00088', 'ค้างชำระ', (current_date - 5) + time '09:00'),
  ('JT-CM-00207', 'จองแล้ว', current_date + time '09:00'),
  ('JT-CM-00218', 'จองแล้ว', (current_date - 2) + time '09:00'),
  ('JT-CM-00218', 'กำลังติดตั้ง', (current_date - 1) + time '09:00'),
  ('JT-CM-00218', 'ส่งมอบแล้ว', current_date + time '09:00');

-- ------------------------------------------------- เซอร์วิส / เคลมประกัน --
--
-- The other two kinds of appointment, so the dashboard shows all four headings
-- and the ใบเซอร์วิส / ใบเคลมประกัน have something real to print. Both carry
-- their OWN date and time (migration 0041) — the whole point of those columns
-- is that a visit is not the job it belongs to.

-- Two visits, and both filled in the way a technician actually leaves the
-- paper form: the walk-around answers in `checks` and the จุดที่ลูกค้าต้องการ
-- แก้ไข rows underneath. An empty visit prints a blank sheet, which shows the
-- layout but not what a finished one looks like.
insert into service_visits (
  ticket_id, visit_no, plate, received_at, received_time, delivered_at, delivered_time,
  sales_by, qc_by, technicians, film_product, customer_waits, overall_ok, checks, notes
) values
  ('JT-CM-00212', 1, '1กข 4521',
   current_date - 30, '09:00', current_date - 30, '11:30',
   'แอดมินระบบ', 'ช่างเอ', '["ช่างเอ"]'::jsonb, 'TPU กันรอยเกรดพรีเมียม',
   false, true,
   '{"หน้าจอ 1": "ปกติ", "หน้าปัดรถ": "ปกติ", "กาบประตู หน้า-ซ้าย": "ปกติ"}'::jsonb,
   'เซอร์วิสรอบแรกหลังติดตั้ง'),

  ('JT-CM-00212', 2, '1กข 4521',
   current_date + 4, '13:00', current_date + 4, '15:00',
   'แอดมินระบบ', 'ช่างเอ', '["ช่างเอ", "ช่างบอย"]'::jsonb, 'TPU กันรอยเกรดพรีเมียม',
   true, true,
   ('{"หน้าจอ 1": "ปกติ", "หน้าจอ 2": "ปกติ", "หน้าปัดรถ": "ปกติ",'
    ' "กาบประตู หน้า-ซ้าย": "มีรอยขีดเล็กน้อย", "กาบประตู หน้า-ขวา": "ปกติ",'
    ' "Piano Black": "ปกติ", "นิรภัยหน้า": "ปกติ"}')::jsonb,
   'ล้างและเคลือบตามรอบ ลูกค้ารอรับรถ');

-- จุดพิเศษที่ลูกค้าต้องการแก้ไข on the upcoming visit.
insert into service_visit_points (visit_id, seq, position, detail, note) values
  ((select id from service_visits where ticket_id = 'JT-CM-00212' and visit_no = 2),
   1, 'กาบประตู หน้า-ซ้าย', 'ฟิล์มเริ่มเปิดขอบ', 'ลอกแล้วติดใหม่'),
  ((select id from service_visits where ticket_id = 'JT-CM-00212' and visit_no = 2),
   2, 'ฝากระโปรงหน้า', 'มีรอยขนแมวจากการล้าง', 'ขัดเคลือบ');

insert into insurance_policies (
  ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
  sold_at, starts_at, ends_at, notes
) values (
  'JT-CM-00214', '250 กก', 'ประกันฟิล์มกันรอย 1 ปี', 2500, 2, 20,
  'คุ้มครองฟองอากาศและการหลุดล่อนจากการติดตั้ง',
  current_date - 30, current_date - 30, current_date + 335, '');

insert into insurance_claims (
  policy_id, claimed_at, big_used, small_used, detail, technician,
  received_at, received_time, delivered_at, delivered_time
) values (
  (select id from insurance_policies where ticket_id = 'JT-CM-00214'),
  current_date + 5, 1, 0, 'กันชนหน้ามีรอยขีด ขอเคลมชิ้นใหญ่ 1 ชิ้น', 'ช่างเอก',
  current_date + 5, '10:00', current_date + 5, '15:00');

-- ---------------------------------------------------------------- wholesale --

/*
  วันส่งของ ของ PO ที่ส่งไปแล้ว.

  0046 backfills this from `created_at` for a live database, but migrations run
  BEFORE this file, so on a fresh reset it finds no orders to fix. Set here
  instead — anchored to the start of the month like every other sample date, so
  the POs land in the period the dashboard opens on.

  The two still at รออนุมัติราคา / รอจัดส่ง keep no date: they have not been
  delivered, and wholesale revenue is earned on delivery.
*/
insert into orders (id, shop_id, customer_id, status, delivered_at) values
  ('WS-CM-0091', 'cm', (select id from wholesale_customers where name = 'ร้านออโต้สไตล์'), 'รออนุมัติราคา', null),
  ('WS-CM-0088', 'cm', (select id from wholesale_customers where name = 'ร้านออโต้เซอร์วิส บางแค'), 'ค้างชำระ',
   least(date_trunc('month', current_date)::date + 3, current_date)),
  ('WS-LP-0044', 'lp', (select id from wholesale_customers where name = 'ร้านดีคาร์แคร์'), 'จัดส่งแล้ว',
   least(date_trunc('month', current_date)::date + 6, current_date)),
  ('WS-PY-0012', 'py', (select id from wholesale_customers where name = 'ร้านทีเอสออโต้'), 'รอจัดส่ง', null),
  ('WS-LPG-0005', 'lpg', (select id from wholesale_customers where name = 'ร้านเจริญยนต์'), 'ปิดงานแล้ว',
   least(date_trunc('month', current_date)::date + 2, current_date));

-- WS-CM-0091 and WS-LPG-0005 are the two with requested < list, i.e. the two the
-- dashboard's "ส่วนลด PO รออนุมัติ" counter looks for (only the first is still
-- awaiting approval, so that counter reads 1).
insert into order_items (order_id, name, qty, list_price, requested_price, reason) values
  ('WS-CM-0091', 'ฟิล์ม 3M CRM (ม้วน)', 10, 1200, 1000, 'ลูกค้าประจำสั่งซ้ำ'),
  ('WS-CM-0088', 'ฟิล์ม 3M CRM (ม้วน)', 10, 1200, 1200, ''),
  ('WS-CM-0088', 'ฟิล์ม FINNIX CT (ม้วน)', 8, 1500, 1500, ''),
  ('WS-LP-0044', 'TPU กันรอยเกรดพรีเมียม', 6, 900, 900, ''),
  ('WS-PY-0012', 'ฟิล์ม FINNIX CT (ม้วน)', 5, 1500, 1500, ''),
  ('WS-LPG-0005', 'ลำโพงคู่ JBL Stage', 2, 4500, 4300, 'ซื้อยกคู่');

insert into order_returns (order_id, item_name, qty, reason) values
  ('WS-CM-0088', 'ฟิล์ม 3M CRM (ม้วน)', 2, 'ของชำรุด');

insert into order_payments (order_id, amount, method, paid_at) values
  ('WS-CM-0088', 5000, 'โอน BBK', date '2026-07-06'),
  ('WS-LP-0044', 5400, 'เงินสด', date '2026-07-02'),
  ('WS-LPG-0005', 8600, 'โอน TTB', date '2026-07-10');

insert into order_adjustments (order_id, amount, reason, adjusted_at) values
  ('WS-LP-0044', 200, 'ลูกค้าต่อรองราคาหลังส่งของ', date '2026-07-03');

-- -------------------------------------------------------------------- stock --
-- SKU-SPK-JBL1 is the low-stock row: qty 6 vs min 5 is NOT low (the threshold is
-- a strict `qty < min`, correction C11), so the dashboard's low-stock count is 0
-- with this data — same as the prototype.

insert into stock (sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price) values
  ('SKU-FLM-3M60', 'ฟิล์ม 3M CRM 60%', '3M60', 'ฟิล์มกรองแสง', 'cm', 15, 10, 850, 1700),
  ('SKU-FLM-FN40', 'ฟิล์ม FINNIX CT 40%', 'FNCT40', 'ฟิล์มกรองแสง', 'cm', 18, 10, 600, 1300),
  ('SKU-TPU-PR01', 'TPU กันรอยเกรดพรีเมียม', 'TPU-PR', 'ฟิล์มกันรอย', 'cm', 22, 8, 1100, 2200),
  ('SKU-SPK-JBL1', 'ลำโพงคู่ JBL Stage', 'JBL-ST', 'เครื่องเสียง', 'cm', 6, 5, 2200, 4500),
  ('SKU-FLM-3M60-LP', 'ฟิล์ม 3M CRM 60%', '3M60', 'ฟิล์มกรองแสง', 'lp', 14, 10, 850, 1700);

insert into withdrawals (item, shop_id, qty, type, withdrawn_by, withdrawn_at, status) values
  ('ฟิล์ม FINNIX CT 40%', 'cm', 1, 'สินค้าตัวอย่าง', 'พนักงาน กมล', date '2026-07-14', 'รออนุมัติ');

-- --------------------------------------------------------------- commission --
-- shop_id null is the prototype's shop:'all'.

insert into commission_rules (category, name, type, value, shop_id, active) values
  ('ค่าคอมพนักงาน', 'ค่าคอมขายรวม 3%', 'percent_of_sale', 3, 'cm', true),
  ('ค่าคอมพนักงาน', 'ค่าคอมทีมติดฟิล์ม 300/งาน', 'fixed_per_job', 300, 'cm', true),
  ('ค่าคอมพนักงาน', 'ค่าคอมขายส่ง 2%', 'percent_of_sale', 2, 'lp', true),
  ('ค่าคอมช่องทางจอง', 'Dex แนะนำลูกค้า 500/งาน', 'fixed_per_job', 500, null, true),
  ('ค่าคอมช่องทางจอง', '33Film 5% ของยอดขาย', 'percent_of_sale', 5, null, true);

insert into commission_rule_teams (commission_rule_id, team_member)
select r.id, t.member
from commission_rules r
join (values
  ('ค่าคอมขายรวม 3%', 'กมล'),
  ('ค่าคอมขายรวม 3%', 'สราวุธ'),
  ('ค่าคอมขายรวม 3%', 'พรทิพย์'),
  ('ค่าคอมทีมติดฟิล์ม 300/งาน', 'ช่างเอก'),
  ('ค่าคอมทีมติดฟิล์ม 300/งาน', 'ช่างบอย'),
  ('ค่าคอมขายส่ง 2%', 'ทีมขายส่งลำพูน'),
  ('Dex แนะนำลูกค้า 500/งาน', 'Dex (พาร์ทเนอร์)'),
  ('33Film 5% ของยอดขาย', '33Film (พาร์ทเนอร์)')
) as t(rule_name, member) on t.rule_name = r.name;

-- --------------------------------------------------------------- accounting --
-- The two 'รอจ่าย' rows are what the dashboard's เจ้าหนี้ card totals: 12,400 +
-- 96,000 = 108,400.

-- Anchored to the START OF THIS MONTH, not to a fixed date.
--
-- They used to be pinned to July 2026, so from August onwards every ค่าใช้จ่าย
-- figure on the dashboard read 0.00 — the sample looked like a shop that had
-- never paid a bill. `current_date - 12` would not fix it either: run on the
-- 7th that lands in LAST month, and the dashboard defaults to รายเดือน.
-- `date_trunc('month')` plus a few days, clamped to today, reads the same on
-- the 1st as on the 28th.
insert into expenses (shop_id, description, category, source, amount, status, paid_at, due_at) values
  ('cm', 'ค่าเช่าร้าน', 'ค่าเช่า', 'บัญชีธนาคารสาขา', 35000, 'จ่ายแล้ว', least(date_trunc('month', current_date)::date + 1, current_date), null),
  ('cm', 'ค่ากาแฟรับลูกค้า', 'การตลาด', 'เงินสดย่อย', 150, 'จ่ายแล้ว', least(date_trunc('month', current_date)::date + 5, current_date), null),
  ('cm', 'ค่าน้ำมันรถส่งของ', 'ค่าวัสดุสิ้นเปลือง', 'เงินสดย่อย', 400, 'จ่ายแล้ว', least(date_trunc('month', current_date)::date + 4, current_date), null),
  ('cm', 'ค่าไฟฟ้า', 'ค่าน้ำ-ไฟ', 'บัญชีธนาคารสาขา', 12400, 'รอจ่าย', null, current_date + 9),
  ('cm', 'เงินเดือนพนักงาน', 'เงินเดือน', 'บัญชีธนาคารสาขา', 96000, 'รอจ่าย', null, current_date + 14);


-- Petty cash: 10,000 topped up, 550 spent from เงินสดย่อย above → 9,450.
insert into petty_cash (shop_id, type, amount, entry_at, note) values
  ('cm', 'เติมเงิน', 10000, least(date_trunc('month', current_date)::date, current_date), 'อนุมัติโดยแอดมิน');

/*
  ...and the same top-up in the money register (migration 0043).

  0043's own copy runs at migration time, before this file inserts anything, so
  on a fresh reset it finds no petty cash to copy. On the live database it runs
  against real history and does the job; here the seed has to say it itself, or
  เงินสดย่อย would read 0 on the dashboard while บัญชี/ค่าใช้จ่าย shows 9,450.

  `from` is เงินสดหน้าร้าน: the shop's cash is where a top-up actually comes
  from, and recording it as a transfer is what stops the same note being
  counted once in the drawer and once in the tin.
*/
insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note)
select
  'cm',
  (select id from money_accounts where shop_id = 'cm' and name = 'เงินสดหน้าร้าน'),
  (select id from money_accounts where shop_id = 'cm' and name = 'เงินสดย่อย'),
  10000,
  least(date_trunc('month', current_date)::date, current_date),
  'เติมเงินสดย่อย · อนุมัติโดยแอดมิน';

/*
  Opening balances, so the card shows what a shop that has done the setup sees
  rather than a column of zeros.

  `opened_at` moves for EVERY account, not just the ones with a figure: it
  defaults to the day the account was created, and anything dated before it is
  excluded on purpose (the opening figure already contains that money). Left at
  today, the whole month of sample movement would be filtered out and every
  account would read as its opening balance exactly.
*/
update money_accounts set opened_at = date_trunc('month', current_date)::date;

update money_accounts set opening_balance = 120000
 where shop_id = 'cm' and name = 'บัญชีธนาคารสาขา';
update money_accounts set opening_balance = 15000
 where shop_id = 'cm' and name = 'เงินสดหน้าร้าน';
update money_accounts set opening_balance = 45000
 where shop_id = 'lp' and name = 'บัญชีธนาคารสาขา';

-- ---------------------------------------------------------------------------
-- A working admin login, so a bare `supabase db reset` leaves you able to sign
-- in without also remembering `npm run db:seed`.
--
-- WHY THIS IS IN seed.sql AND NOT IN A MIGRATION. Migrations are what `supabase
-- db push` applies to the hosted projects, so an account with a hard-coded
-- password in a migration would be a permanent, publicly-known admin in
-- production. seed.sql is only ever run by a local `db reset` — Supabase does
-- not apply it on push — so the credential cannot escape a developer machine.
-- Do not move this block into supabase/migrations/.
--
-- Creating a login in SQL means writing Auth's own tables directly: `auth.users`
-- holds the bcrypt hash, and a matching `auth.identities` row is what the email
-- provider actually authenticates against — without it the password is accepted
-- but no identity is found and sign-in fails. `crypt`/`gen_salt` live in the
-- `extensions` schema on Supabase, not `public`.
--
-- The uuid is fixed rather than generated so fixtures and tests can reference the
-- same admin across resets. The email matches supabase/seed.ts's admin, which is
-- idempotent and will simply update this row if you run it afterwards.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  -- These four are nullable in the schema but GoTrue scans them into plain Go
  -- strings, so a NULL makes every sign-in fail with an opaque 500 rather than an
  -- auth error. They must be empty strings, not NULL. (phone_change already
  -- defaults to '', which is why it is not listed.)
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'admin@finnixfilm.com',
  extensions.crypt('finnix-staging-2026', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  false,
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"admin@finnixfilm.com","email_verified":true,"phone_verified":false}',
  'email',
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

-- The app-side profile. lib/auth/session.ts treats a missing app_users row as
-- "no access" and bounces the user back to /login, so the login is only usable
-- once this exists. sees_all_shops = true means no user_shop_access rows are
-- needed (see migration 0008 / correction C7).
insert into app_users (id, email, name, role_id, active, sees_all_shops) values (
  '00000000-0000-4000-8000-000000000001',
  'admin@finnixfilm.com',
  'แอดมินระบบ',
  'admin',
  true,
  true
)
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  role_id = excluded.role_id,
  active = excluded.active,
  sees_all_shops = excluded.sees_all_shops;
