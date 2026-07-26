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
   (current_date - 2) + time '09:00', (current_date - 1) + time '09:00',
   '{"ประกัน": {"checked": true}}'::jsonb),

  ('JT-CM-00212', 'cm', (select id from retail_customers where name = 'คุณ สมชาย'),
   'คุณ สมชาย', '082-345-6789', '1กข 4521', 'เก๋งเล็ก', 'Honda', 'City', 'ดำ',
   'เข้าทำ/ติดตั้ง', 'กำลังติดตั้ง', 'เพจร้าน',
   '{"เครื่องเสียง": ["ช่างบอย"], "ฟิล์มกันรอย": ["ช่างเอ"]}'::jsonb,
   (current_date - 3) + time '09:00', (current_date - 2) + time '09:00',
   '{}'::jsonb),

  ('JT-CM-00209', 'cm', (select id from retail_customers where name = 'คุณ วิภา'),
   'คุณ วิภา', '083-456-7890', 'กท 8890', 'SUV', 'Mazda', '2', 'แดง',
   'เข้าทำ/ติดตั้ง', 'รอส่งมอบ', 'Dex',
   '{"เครื่องเสียง": ["ช่างนัท"]}'::jsonb,
   (current_date - 4) + time '09:00', (current_date - 3) + time '09:00',
   '{}'::jsonb),

  ('JT-LP-00088', 'lp', (select id from retail_customers where name = 'คุณ ปรีชา'),
   'คุณ ปรีชา', '084-567-8901', '3ขค 112', 'กระบะ', 'Isuzu', 'D-Max', 'บรอนซ์',
   'เข้าทำ/ติดตั้ง', 'ค้างชำระ', '33Film',
   '{"ฟิล์มกรองแสง": ["ช่างเอ"]}'::jsonb,
   (current_date - 6) + time '09:00', (current_date - 5) + time '09:00',
   '{"นอกสถานที่": {"checked": true, "mapLink": "https://maps.google.com/?q=13.7563,100.5018"}}'::jsonb),

  -- The only future booking: lands inside the dashboard's next-7-days window.
  ('JT-CM-00207', 'cm', (select id from retail_customers where name = 'คุณ นภา'),
   'คุณ นภา', '085-678-9012', '9กท 220', 'เก๋งใหญ่', 'Toyota', 'Camry', 'เทา',
   'เข้าทำ/ติดตั้ง', 'จองแล้ว', 'FINNIX บางแค',
   '{}'::jsonb,
   (current_date + 2) + time '09:00', (current_date + 3) + time '09:00',
   '{"รถสไลด์": {"checked": true, "slideType": "Showroom"}}'::jsonb);

insert into ticket_items (ticket_id, category, booked, booked_price, sold, sold_price) values
  ('JT-CM-00214', 'ฟิล์มกรองแสง', '', 0,
   'บานหน้า: ฟิล์ม FINNIX CT 40%, คู่หน้า: ฟิล์ม 3M CRM 60%, คู่หลัง: ฟิล์ม 3M CRM 60%', 5100),
  ('JT-CM-00214', 'เครื่องเสียง', 'ลำโพงคู่มาตรฐาน', 3500, 'ลำโพงคู่ JBL Stage', 4500),
  ('JT-CM-00212', 'เครื่องเสียง', 'ลำโพงคู่มาตรฐาน', 3500, 'ลำโพงคู่ JBL Stage', 4500),
  ('JT-CM-00212', 'ฟิล์มกันรอย', '', 0, 'เต็มคัน: TPU กันรอยเกรดพรีเมียม', 2200),
  ('JT-CM-00209', 'เครื่องเสียง', 'จอ 7 นิ้ว', 5000, 'จอแอนดรอยด์ 9 นิ้ว', 6500),
  ('JT-LP-00088', 'ฟิล์มกรองแสง', '', 0,
   'บานหน้า: ฟิล์ม 3M CRM 60%, บานหลัง: ฟิล์ม 3M CRM 60%', 3800),
  ('JT-CM-00207', 'ฟิล์มกรองแสง', 'ฟิล์ม 3M CRM', 9000, '', 0);

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
   'บานหลัง', 'ฟิล์ม 3M CRM 60%', 1900);

insert into ticket_payments (ticket_id, type, method, amount, paid_at) values
  ('JT-CM-00214', 'มัดจำ', 'โอน TTB', 2000, date '2026-07-20'),
  ('JT-CM-00209', 'ชำระเต็มจำนวน', 'เงินสด', 6500, date '2026-07-26');

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
  ('JT-CM-00207', 'จองแล้ว', current_date + time '09:00');

-- ---------------------------------------------------------------- wholesale --

insert into orders (id, shop_id, customer_id, status) values
  ('WS-CM-0091', 'cm', (select id from wholesale_customers where name = 'ร้านออโต้สไตล์'), 'รออนุมัติราคา'),
  ('WS-CM-0088', 'cm', (select id from wholesale_customers where name = 'ร้านออโต้เซอร์วิส บางแค'), 'ค้างชำระ'),
  ('WS-LP-0044', 'lp', (select id from wholesale_customers where name = 'ร้านดีคาร์แคร์'), 'จัดส่งแล้ว'),
  ('WS-PY-0012', 'py', (select id from wholesale_customers where name = 'ร้านทีเอสออโต้'), 'รอจัดส่ง'),
  ('WS-LPG-0005', 'lpg', (select id from wholesale_customers where name = 'ร้านเจริญยนต์'), 'ปิดงานแล้ว');

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

insert into expenses (shop_id, description, category, source, amount, status, paid_at, due_at) values
  ('cm', 'ค่าเช่าร้านเดือนกรกฎาคม', 'ค่าเช่า', 'บัญชีธนาคารสาขา', 35000, 'จ่ายแล้ว', date '2026-07-01', null),
  ('cm', 'ค่ากาแฟรับลูกค้า', 'การตลาด', 'เงินสดย่อย', 150, 'จ่ายแล้ว', date '2026-07-16', null),
  ('cm', 'ค่าน้ำมันรถส่งของ', 'ค่าวัสดุสิ้นเปลือง', 'เงินสดย่อย', 400, 'จ่ายแล้ว', date '2026-07-15', null),
  ('cm', 'ค่าไฟฟ้าเดือนกรกฎาคม', 'ค่าน้ำ-ไฟ', 'บัญชีธนาคารสาขา', 12400, 'รอจ่าย', null, date '2026-07-25'),
  ('cm', 'เงินเดือนพนักงานเดือนกรกฎาคม', 'เงินเดือน', 'บัญชีธนาคารสาขา', 96000, 'รอจ่าย', null, date '2026-07-30');

-- Petty cash: 10,000 topped up, 550 spent from เงินสดย่อย above → balance 9,450.
insert into petty_cash (shop_id, type, amount, entry_at, note) values
  ('cm', 'เติมเงิน', 10000, date '2026-07-10', 'อนุมัติโดยแอดมิน');

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
