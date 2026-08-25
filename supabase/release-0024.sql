-- supabase/release-0024.sql
--
-- โมดูลรายได้ — ประวัติการออกเอกสารการเงิน และเมนู "รายได้"
--
-- รันต่อจาก release-0023.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: create table/index if not exists, drop policy ก่อน create,
-- create or replace function, insert แบบ on conflict do nothing
--
-- หมายเหตุ: ประวัติการออกใบกำกับภาษีเริ่มนับจากวันที่รันไฟล์นี้เป็นต้นไป
-- ของเดิมไม่เคยถูกบันทึกไว้ จึงไม่มีข้อมูลย้อนหลัง
--
-- รันด้วย connection ปกติได้ ไม่ต้องใช้สิทธิ์เจ้าของ storage.objects
-- supabase/migrations/0024_revenue_report.sql
--
-- โมดูลรายได้ — เก็บประวัติการออกเอกสารการเงิน และเปิดเมนู "รายได้"
--
-- The shop asked for a sales report split by ชนิดสินค้า that also says whether a
-- ใบกำกับภาษี was issued. The first half was already answerable from
-- `ticket_items`; the second half was not answerable at all.
--
-- Issuing a financial document was a PRINT and nothing else: the type (ใบเสร็จ /
-- ใบกำกับภาษี / ใบเสนอราคา), the buyer's นิติบุคคล name and its เลขผู้เสียภาษี
-- lived in React state for as long as the screen was open and then went away. So
-- nobody could answer "which sales did we issue a tax invoice for", which is the
-- question the accountant asks every month.
--
-- `ticket_documents` is that record. One row per (ticket, document type): a
-- reprint is the same document, not a second one, so it updates in place and
-- keeps its original `issued_at`. The number is stored as printed, because that
-- is the string the customer will quote back on the phone.

set search_path = pos, public, extensions;

create table if not exists ticket_documents (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  -- ใบเสร็จรับเงิน | ใบกำกับภาษี/ใบเสร็จรับเงิน | ใบเสนอราคา
  doc_type text not null,
  doc_no text not null default '',
  -- The day it was handed over, kept through a reprint.
  issued_at date not null default current_date,
  -- Snapshot of who it was made out to. `corporate_buyers` is a registry the
  -- shop edits; a document says who it was issued to on the day.
  buyer_name text not null default '',
  buyer_tax_id text not null default '',
  buyer_address text not null default '',
  amount numeric(12, 2) not null default 0,
  issued_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ticket_id, doc_type)
);

comment on table ticket_documents is
  'เอกสารการเงินที่ออกให้ลูกค้าแล้ว — หนึ่งแถวต่อหนึ่งชนิดเอกสารต่อใบงาน พิมพ์ซ้ำไม่นับใหม่';

create index if not exists ticket_documents_issued_idx on ticket_documents (issued_at);
create index if not exists ticket_documents_type_idx on ticket_documents (doc_type);

alter table ticket_documents enable row level security;
drop policy if exists ticket_documents_rw on ticket_documents;
create policy ticket_documents_rw on ticket_documents for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

/**
 * บันทึกว่าออกเอกสารให้ลูกค้าแล้ว.
 *
 * Upsert, not insert: printing the same receipt a second time is the shop
 * handing over another copy of ONE document. `issued_at` therefore survives —
 * the date on the paper the customer already has does not change — while the
 * buyer and the amount are refreshed, because a reprint after an edit should
 * carry what the document now says.
 *
 * No `locked` check. Issuing a receipt for a closed job is the normal case, and
 * this writes nothing the lock protects.
 */
create or replace function record_ticket_document(
  p_ticket_id text,
  p_doc_type text,
  p_doc_no text,
  p_buyer_name text,
  p_buyer_tax_id text,
  p_buyer_address text,
  p_amount numeric
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into ticket_documents (
    ticket_id, doc_type, doc_no, buyer_name, buyer_tax_id, buyer_address, amount, issued_by
  ) values (
    p_ticket_id,
    p_doc_type,
    coalesce(p_doc_no, ''),
    coalesce(p_buyer_name, ''),
    coalesce(p_buyer_tax_id, ''),
    coalesce(p_buyer_address, ''),
    coalesce(p_amount, 0),
    auth.uid()
  )
  on conflict (ticket_id, doc_type) do update set
    doc_no        = excluded.doc_no,
    buyer_name    = excluded.buyer_name,
    buyer_tax_id  = excluded.buyer_tax_id,
    buyer_address = excluded.buyer_address,
    amount        = excluded.amount;
end;
$$;

revoke all on function record_ticket_document(text, text, text, text, text, text, numeric) from public, anon;
grant execute on function record_ticket_document(text, text, text, text, text, text, numeric) to authenticated;

-- เมนู "รายได้". Delta insert so a live matrix keeps whatever the shop re-toggled.
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','nav','revenue',true),
  ('exec','nav','revenue',true),
  ('sales','nav','revenue',false),
  ('tech','nav','revenue',false)
on conflict (role_id, permission_type, permission_key) do nothing;

-- And into the reset, or "รีเซ็ตค่าเริ่มต้น" would delete the key and the module
-- would vanish for everyone. Only the four `nav`/`revenue` lines differ from
-- migration 0017's copy of this function.
create or replace function reset_permissions_to_defaults()
returns void
language plpgsql
security invoker
set search_path = pos
as $$
begin
  insert into roles (id, name, icon) values
    ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
    ('exec', 'ผู้บริหาร', 'fa-crown'),
    ('sales', 'พนักงานขาย', 'fa-user-tie'),
    ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench')
  on conflict (id) do update set name = excluded.name, icon = excluded.icon;

  update app_users
     set role_id = 'admin'
   where role_id not in ('admin', 'exec', 'sales', 'tech');

  delete from roles where id not in ('admin', 'exec', 'sales', 'tech');

  delete from role_permissions where role_id in ('admin', 'exec', 'sales', 'tech');

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','customers',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','revenue',true), ('admin','nav','permissions',true),
    ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','customers',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','revenue',true), ('exec','nav','permissions',false),
    ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','customers',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','revenue',false), ('sales','nav','permissions',false),
    ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','customers',false), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','revenue',false), ('tech','nav','permissions',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
    ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
    ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
    ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed)
    select r.id, 'module_capability', c.key, true
    from roles r, (values
      ('list.createNew'),('list.printSheet'),('list.delete'),('list.restore'),
      ('customers.edit'),('wholesale.createNew'),('wholesale.priceApproval'),
      ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
      ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
      ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
    ) as c(key)
    where r.id in ('admin','exec');

  -- Admin-only keys: maintaining the option lists, and reopening a closed ticket.
  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('admin','module_capability','options.manage',true),
    ('exec','module_capability','options.manage',false),
    ('sales','module_capability','options.manage',false),
    ('tech','module_capability','options.manage',false),
    ('admin','module_capability','list.unlock',true),
    ('exec','module_capability','list.unlock',false),
    ('sales','module_capability','list.unlock',false),
    ('tech','module_capability','list.unlock',false);

  insert into role_permissions (role_id, permission_type, permission_key, allowed) values
    ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','list.delete',true), ('sales','module_capability','list.restore',false),
    ('sales','module_capability','customers.edit',true), ('sales','module_capability','wholesale.createNew',true),
    ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
    ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
    ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
    ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
    ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','list.delete',false), ('tech','module_capability','list.restore',false),
    ('tech','module_capability','customers.edit',false), ('tech','module_capability','wholesale.createNew',false),
    ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
    ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
    ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',true), ('tech','module_capability','commission.addRule',false),
    ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
end;
$$;

revoke all on function reset_permissions_to_defaults() from public;
revoke all on function reset_permissions_to_defaults() from anon;
grant execute on function reset_permissions_to_defaults() to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0024', 'revenue_report') on conflict (version) do nothing;
