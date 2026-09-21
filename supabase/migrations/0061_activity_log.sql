/*
  ประวัติการใช้งานทั้งระบบ (ร้านขอ 19 ก.ย. 2569)

  "ฉันอยากเห็น history ของกิจกรรมในระบบทั้งหมด เนื่องจากมีบางคนแก้ไขงานทับงาน
  ที่ถูกต้องแล้ว" — จนถึงไฟล์นี้ ระบบตอบไม่ได้เลยว่าใครแก้อะไร เมื่อไหร่ ค่าเดิม
  คืออะไร การแก้ทับหายไปเงียบ ๆ

  ตกลงกับร้านไว้: ทั้งระบบรวดเดียว · เก็บก่อน-หลังรายฟิลด์ · แอดมินเห็นคนเดียว

  เขียนจาก trigger ไม่ใช่จากหน้าจอ
  --------------------------------
  ทุกการเขียนผ่านฐานข้อมูล ไม่ว่าจะมาจาก server action, ฟังก์ชัน security
  definer หรือคนที่แก้ตรงจาก SQL Editor จึงหนีการบันทึกไม่ได้ ถ้าบันทึกจากหน้าจอ
  เส้นทางไหนที่ลืมใส่ก็คือรู

  สองแบบ
  ------
  1. แถวทั่วไป (ใบงาน, PO, ค่าใช้จ่าย, สต๊อก, ประกัน, เงิน, ลูกค้า, ผู้ใช้,
     สิทธิ์, ค่าตั้งต้น) — trigger ต่อแถว เก็บเฉพาะฟิลด์ที่เปลี่ยน
     {"ฟิลด์": [ค่าเดิม, ค่าใหม่]} แก้แล้วไม่มีอะไรเปลี่ยน (เช่นกดบันทึกซ้ำ) ไม่บันทึก

  2. ชุดรายการที่ถูก "ลบแล้วเขียนใหม่ทั้งชุด" ทุกครั้งที่กดบันทึก — รายการสินค้า
     และการรับเงินในใบงาน, รายการ/คืนของ/ส่วนลด/รับเงินใน PO, จุดตรวจและการเคลม
     ในการเซอร์วิส, ตัวเลือกในรายการตั้งค่า, สาขาที่ผู้ใช้เข้าถึงได้
     ถ้าดักทีละแถว การกดบันทึกครั้งเดียวจะได้หลายสิบบรรทัด "ลบ...สร้าง..." ที่อ่าน
     ไม่รู้เรื่อง และบันทึกทุกครั้งแม้ไม่มีอะไรเปลี่ยน จึงใช้ constraint trigger
     แบบ deferred ซึ่งทำงานตอน commit: สร้างภาพของทั้งชุด ณ ตอนนั้น เทียบกับภาพ
     ล่าสุดที่เก็บไว้ ถ้าต่างจึงบันทึกหนึ่งบรรทัดต่อเอกสาร พร้อมชุดก่อน-หลัง
     แถวที่ถูกแตะในธุรกรรมเดียวกันหลายแถว หลังบรรทัดแรกภาพจะตรงกันแล้ว จึงไม่ซ้ำ

  สิ่งที่ไม่ได้ดัก
  ----------------
  ticket_status_history, stock_movements, stock_movement_batches — เป็นบันทึก
  ประวัติอยู่แล้วในตัว และ alert_acknowledgements ซึ่งเป็นแค่การกดรับทราบ
  stock.qty และ stock_batches.qty_remaining ที่เปลี่ยนอย่างเดียวก็ไม่บันทึก —
  ทุกครั้งที่บันทึกใบงานสต๊อกขยับอัตโนมัติ และสมุดสต๊อก (stock_movements) เก็บไว้
  ครบพร้อมที่มาแล้ว

  ข้อจำกัด
  --------
  ประวัติเริ่มนับตั้งแต่รันไฟล์นี้ การแก้ก่อนหน้านี้ไม่มีข้อมูลให้ย้อน
  ภาพล่าสุดของทุกชุดรายการถูกเก็บไว้ตอนรันไฟล์ เพื่อให้การแก้ครั้งแรกหลังจากนี้
  มี "ค่าเดิม" ให้เทียบ

  สิทธิ์
  ------
  อ่านได้เฉพาะ role_id = 'admin' ไม่มีใครเขียน แก้ หรือลบได้ผ่าน API — ตารางนี้
  เป็นหลักฐาน ถ้าแก้ได้ก็ไม่เป็นหลักฐาน
*/

set search_path = pos, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ตาราง
-- ---------------------------------------------------------------------------

create table if not exists activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- ธุรกรรมเดียวกัน = การกดบันทึกครั้งเดียว หน้าจอใช้จัดกลุ่ม
  tx bigint not null default txid_current(),
  actor uuid,
  -- ชื่อ ณ ตอนนั้น: ผู้ใช้ที่เปลี่ยนชื่อหรือถูกลบภายหลัง ประวัติต้องยังอ่านได้
  actor_name text not null default '',
  shop_id text,
  entity text not null,
  record_id text not null default '',
  -- เลขเอกสารที่คนใช้ค้น (JT-…, WS-…, POS-…) — การเซอร์วิสและประกันใช้เลข
  -- ใบงาน เพื่อให้ขึ้นอยู่ในประวัติของใบงานนั้นด้วย
  doc_ref text not null default '',
  action text not null check (action in ('สร้าง', 'แก้ไข', 'ลบ')),
  changes jsonb not null default '{}'::jsonb
);

comment on table activity_log is
  'ประวัติการใช้งานทั้งระบบ เขียนจาก trigger เท่านั้น อ่านได้เฉพาะแอดมิน (0061).';
comment on column activity_log.changes is
  'แก้ไข: {"ฟิลด์": [ค่าเดิม, ค่าใหม่]} เฉพาะที่เปลี่ยน · สร้าง/ลบ: ทั้งแถว · ชุดรายการ: {"ส่วน": [ชุดเดิม, ชุดใหม่]}';

create index if not exists activity_log_at_idx on activity_log (at desc);
create index if not exists activity_log_doc_idx on activity_log (doc_ref, at desc);
create index if not exists activity_log_actor_idx on activity_log (actor, at desc);
create index if not exists activity_log_shop_idx on activity_log (shop_id, at desc);

alter table activity_log enable row level security;

drop policy if exists activity_log_admin_read on activity_log;
create policy activity_log_admin_read on activity_log
  for select to authenticated
  using (current_user_role() = 'admin');

revoke insert, update, delete, truncate on activity_log from authenticated, anon;
grant select on activity_log to authenticated;

-- ภาพล่าสุดของแต่ละชุดรายการ ใช้เทียบเท่านั้น ไม่มีใครอ่านผ่าน API
create table if not exists activity_snapshots (
  kind text not null,
  key text not null,
  snapshot jsonb not null,
  primary key (kind, key)
);

alter table activity_snapshots enable row level security;
revoke all on activity_snapshots from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. ใครทำ
-- ---------------------------------------------------------------------------

create or replace function activity_actor_name(p_uid uuid) returns text
language sql stable security definer
set search_path = pos
as $$
  select case
    when p_uid is null then 'ระบบ'
    else coalesce((select name from app_users where id = p_uid), '')
  end;
$$;

revoke all on function activity_actor_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. แถวทั่วไป
-- ---------------------------------------------------------------------------

-- tg_argv = คอลัมน์ที่ไม่ต้องนับว่าเป็นการแก้ (นอกจาก updated_at ที่ข้ามเสมอ)
create or replace function log_row_activity() returns trigger
language plpgsql security definer
set search_path = pos
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['updated_at'] || coalesce(tg_argv::text[], '{}'::text[]);
  v_key text;
  v_action text;
  v_doc text;
  v_shop text;
  v_uid uuid := auth.uid();
begin
  v_row := coalesce(v_new, v_old);

  -- การเคลมที่ผูกกับการเซอร์วิส (0059) ถูกลบแล้วเขียนใหม่ทุกครั้งที่บันทึกการ
  -- เซอร์วิส จึงบันทึกเป็นส่วนหนึ่งของชุดการเซอร์วิสแทน (ข้อ 4)
  if tg_table_name = 'insurance_claims' and v_row->>'service_visit_id' is not null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key = any(v_ignore);
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes
          || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    -- กดบันทึกโดยไม่ได้เปลี่ยนอะไร ไม่ใช่กิจกรรม
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    v_action := 'แก้ไข';
  elsif tg_op = 'INSERT' then
    v_changes := v_new;
    v_action := 'สร้าง';
  else
    v_changes := v_old;
    v_action := 'ลบ';
  end if;

  v_doc := case tg_table_name
    when 'tickets' then v_row->>'id'
    when 'orders' then v_row->>'id'
    when 'expenses' then coalesce(nullif(v_row->>'doc_no', ''), v_row->>'id')
    when 'insurance_policies' then v_row->>'ticket_id'
    when 'service_visits' then v_row->>'ticket_id'
    when 'ticket_documents' then v_row->>'ticket_id'
    when 'insurance_claims' then
      (select ticket_id from insurance_policies where id = (v_row->>'policy_id')::bigint)
    when 'expense_attachments' then
      (select coalesce(nullif(doc_no, ''), id::text) from expenses
        where id = (v_row->>'expense_id')::bigint)
    when 'stock' then v_row->>'name'
    when 'app_users' then v_row->>'name'
    else coalesce(v_row->>'id', v_row->>'key', '')
  end;

  v_shop := coalesce(
    v_row->>'shop_id',
    case when v_row ? 'ticket_id' then
      (select shop_id from tickets where id = v_row->>'ticket_id') end,
    case when v_row ? 'order_id' then
      (select shop_id from orders where id = v_row->>'order_id') end,
    case when tg_table_name = 'insurance_claims' then
      (select t.shop_id from insurance_policies p join tickets t on t.id = p.ticket_id
        where p.id = (v_row->>'policy_id')::bigint) end,
    case when tg_table_name = 'expense_attachments' then
      (select shop_id from expenses where id = (v_row->>'expense_id')::bigint) end
  );

  insert into activity_log (actor, actor_name, shop_id, entity, record_id, doc_ref, action, changes)
  values (
    v_uid,
    activity_actor_name(v_uid),
    v_shop,
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'key', v_row->>'user_id', ''),
    coalesce(v_doc, ''),
    v_action,
    v_changes
  );
  return null;
end;
$$;

revoke all on function log_row_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ชุดรายการที่ลบแล้วเขียนใหม่ทั้งชุด
-- ---------------------------------------------------------------------------

-- ภาพของทั้งชุด ณ ตอนนี้ เลือกเฉพาะฟิลด์ที่คนอ่านแล้วเข้าใจ (ไม่เอา id ซึ่งเปลี่ยน
-- ทุกครั้งที่บันทึก) เรียงตาม id ซึ่งก็คือลำดับที่หน้าจอส่งมา
create or replace function activity_collection(p_kind text, p_key text) returns jsonb
language plpgsql stable security definer
set search_path = pos
as $$
begin
  if p_kind = 'ticket' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category', i.category,
          'booked', i.booked,
          'booked_price', i.booked_price,
          'sold', i.sold,
          'sold_price', i.sold_price,
          'interested', i.interested,
          'interested_price', i.interested_price,
          'discount_type', i.discount_type,
          'discount_value', i.discount_value,
          'actual_qty', i.actual_qty,
          'positions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', p."position", 'product', p.product, 'price', p.price
            ) order by p.id)
            from ticket_item_positions p where p.ticket_item_id = i.id
          ), '[]'::jsonb)
        ) order by i.id)
        from ticket_items i where i.ticket_id = p_key
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid,
          'type', type,
          'method', method,
          'amount', amount,
          'paid_at', paid_at,
          'slips', coalesce(array_length(attachments, 1), 0)
        ) order by id)
        from ticket_payments where ticket_id = p_key
      ), '[]'::jsonb)
    );
  elsif p_kind = 'order' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', name, 'qty', qty, 'list_price', list_price,
          'requested_price', requested_price, 'reason', reason
        ) order by id)
        from order_items where order_id = p_key
      ), '[]'::jsonb),
      'returns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'item_name', item_name, 'qty', qty, 'reason', reason,
          'returned_at', returned_at, 'received_at', received_at
        ) order by id)
        from order_returns where order_id = p_key
      ), '[]'::jsonb),
      'adjustments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'amount', amount, 'reason', reason,
          'adjusted_at', adjusted_at, 'status', status
        ) order by id)
        from order_adjustments where order_id = p_key
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid', uid, 'amount', amount, 'method', method, 'paid_at', paid_at,
          'status', status, 'cheque_no', cheque_no, 'cheque_bank', cheque_bank,
          'cheque_date', cheque_date, 'cleared_at', cleared_at, 'bounced_at', bounced_at
        ) order by id)
        from order_payments where order_id = p_key
      ), '[]'::jsonb)
    );
  elsif p_kind = 'service_visit' then
    return jsonb_build_object(
      'points', coalesce((
        select jsonb_agg(jsonb_build_object(
          'seq', seq, 'position', "position", 'detail', detail, 'note', note
        ) order by seq, id)
        from service_visit_points where visit_id = p_key::bigint
      ), '[]'::jsonb),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'policy_id', policy_id, 'big_used', big_used, 'small_used', small_used,
          'detail', detail, 'technician', technician
        ) order by id)
        from insurance_claims where service_visit_id = p_key::bigint
      ), '[]'::jsonb)
    );
  elsif p_kind = 'option_list' then
    return jsonb_build_object(
      'values', coalesce((
        select jsonb_agg(value order by sort_order, id)
        from option_lists
        where list_key = split_part(p_key, '|', 1)
          and coalesce(shop_id, '') = split_part(p_key, '|', 2)
      ), '[]'::jsonb)
    );
  elsif p_kind = 'user_shops' then
    return jsonb_build_object(
      'shops', coalesce((
        select jsonb_agg(shop_id order by shop_id)
        from user_shop_access where user_id::text = p_key
      ), '[]'::jsonb)
    );
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function activity_collection(text, text) from public, anon, authenticated;

-- ชุดไหน คีย์อะไร: เลือกจากคอลัมน์ของแถวที่ถูกแตะ
create or replace function activity_collection_key(p_kind text, p_row jsonb) returns text
language sql immutable
as $$
  select case p_kind
    when 'ticket' then p_row->>'ticket_id'
    when 'order' then p_row->>'order_id'
    when 'service_visit' then coalesce(p_row->>'visit_id', p_row->>'service_visit_id')
    when 'option_list' then (p_row->>'list_key') || '|' || coalesce(p_row->>'shop_id', '')
    when 'user_shops' then p_row->>'user_id'
  end;
$$;

create or replace function log_collection_activity() returns trigger
language plpgsql security definer
set search_path = pos
as $$
declare
  v_kind text := tg_argv[0];
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_key text;
  v_exists boolean := false;
  v_shop text;
  v_doc text;
  v_now jsonb;
  v_before jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_part text;
  v_uid uuid := auth.uid();
begin
  v_key := activity_collection_key(v_kind, v_row);
  -- การเคลมแบบเดิมที่ไม่ได้ผูกกับการเซอร์วิส ไม่มีชุดให้เข้า (ข้อ 3 ดูแลแล้ว)
  if v_key is null then
    return null;
  end if;

  if v_kind = 'ticket' then
    select true, shop_id, id into v_exists, v_shop, v_doc from tickets where id = v_key;
  elsif v_kind = 'order' then
    select true, shop_id, id into v_exists, v_shop, v_doc from orders where id = v_key;
  elsif v_kind = 'service_visit' then
    select true, t.shop_id, sv.ticket_id into v_exists, v_shop, v_doc
      from service_visits sv join tickets t on t.id = sv.ticket_id
     where sv.id = v_key::bigint;
  elsif v_kind = 'option_list' then
    v_exists := true;
    v_shop := nullif(split_part(v_key, '|', 2), '');
    v_doc := split_part(v_key, '|', 1);
  elsif v_kind = 'user_shops' then
    select true, name into v_exists, v_doc from app_users where id = v_key::uuid;
  end if;

  -- เอกสารถูกลบไปทั้งใบ: บรรทัดของตัวเอกสารเองบันทึกการลบไว้แล้ว ชุดรายการที่
  -- หายตามไปด้วยไม่ใช่การแก้อีกเรื่องหนึ่ง
  if not coalesce(v_exists, false) then
    delete from activity_snapshots where kind = v_kind and key = v_key;
    return null;
  end if;

  v_now := activity_collection(v_kind, v_key);
  select snapshot into v_before from activity_snapshots where kind = v_kind and key = v_key;

  -- ไม่มีอะไรเปลี่ยน หรือแถวอื่นในธุรกรรมเดียวกันบันทึกไปแล้ว
  if v_before is not distinct from v_now then
    return null;
  end if;

  for v_part in select jsonb_object_keys(v_now) loop
    if (v_before -> v_part) is distinct from (v_now -> v_part) then
      v_changes := v_changes
        || jsonb_build_object(v_part, jsonb_build_array(v_before -> v_part, v_now -> v_part));
    end if;
  end loop;

  insert into activity_log (actor, actor_name, shop_id, entity, record_id, doc_ref, action, changes)
  values (
    v_uid,
    activity_actor_name(v_uid),
    v_shop,
    v_kind || '_lines',
    v_key,
    coalesce(v_doc, ''),
    case when v_before is null then 'สร้าง' else 'แก้ไข' end,
    v_changes
  );

  insert into activity_snapshots (kind, key, snapshot) values (v_kind, v_key, v_now)
  on conflict (kind, key) do update set snapshot = excluded.snapshot;

  return null;
end;
$$;

revoke all on function log_collection_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. ติดตั้ง trigger
-- ---------------------------------------------------------------------------

do $$
declare
  v_spec record;
begin
  -- แถวทั่วไป: ชื่อตาราง และคอลัมน์ที่เปลี่ยนเองแล้วไม่นับ
  for v_spec in
    select * from (values
      ('tickets', array[]::text[]),
      ('orders', array[]::text[]),
      ('expenses', array[]::text[]),
      ('expense_attachments', array[]::text[]),
      ('stock', array['qty']),
      ('stock_batches', array['qty_remaining']),
      ('insurance_plans', array[]::text[]),
      ('insurance_policies', array[]::text[]),
      ('insurance_claims', array[]::text[]),
      ('service_visits', array[]::text[]),
      ('ticket_documents', array[]::text[]),
      ('money_accounts', array[]::text[]),
      ('money_transfers', array[]::text[]),
      ('money_reconciliations', array[]::text[]),
      ('petty_cash', array[]::text[]),
      ('withdrawals', array[]::text[]),
      ('retail_customers', array[]::text[]),
      ('wholesale_customers', array[]::text[]),
      ('corporate_buyers', array[]::text[]),
      ('app_users', array[]::text[]),
      ('roles', array[]::text[]),
      ('role_permissions', array[]::text[]),
      ('sales_people', array[]::text[]),
      ('shops', array[]::text[]),
      ('shop_info', array[]::text[]),
      ('statuses', array[]::text[]),
      ('ws_statuses', array[]::text[]),
      ('commission_rules', array[]::text[]),
      ('commission_rule_teams', array[]::text[]),
      ('price_matrix', array[]::text[]),
      ('film_price_matrix', array[]::text[]),
      ('car_models', array[]::text[])
    ) as t(tbl, ignore_cols)
  loop
    execute format('drop trigger if exists activity_log_row on pos.%I', v_spec.tbl);
    execute format(
      'create trigger activity_log_row after insert or update or delete on pos.%I '
      'for each row execute function pos.log_row_activity(%s)',
      v_spec.tbl,
      (select coalesce(string_agg(quote_literal(c), ', '), '') from unnest(v_spec.ignore_cols) c)
    );
  end loop;

  -- ชุดรายการ: ทำงานตอน commit
  for v_spec in
    select * from (values
      ('ticket_items', 'ticket'),
      ('ticket_payments', 'ticket'),
      ('order_items', 'order'),
      ('order_returns', 'order'),
      ('order_adjustments', 'order'),
      ('order_payments', 'order'),
      ('service_visit_points', 'service_visit'),
      ('insurance_claims', 'service_visit'),
      ('option_lists', 'option_list'),
      ('user_shop_access', 'user_shops')
    ) as t(tbl, kind)
  loop
    execute format('drop trigger if exists activity_log_lines on pos.%I', v_spec.tbl);
    execute format(
      'create constraint trigger activity_log_lines after insert or update or delete on pos.%I '
      'deferrable initially deferred for each row execute function pos.log_collection_activity(%L)',
      v_spec.tbl,
      v_spec.kind
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. ภาพตั้งต้นของทุกชุด ให้การแก้ครั้งแรกมีค่าเดิมให้เทียบ
-- ---------------------------------------------------------------------------
-- on conflict do nothing: รันซ้ำแล้วไม่ทับภาพที่ trigger อัปเดตไปแล้ว

insert into activity_snapshots (kind, key, snapshot)
select 'ticket', id, activity_collection('ticket', id) from tickets
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'order', id, activity_collection('order', id) from orders
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'service_visit', id::text, activity_collection('service_visit', id::text) from service_visits
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select distinct on (k) 'option_list', k, activity_collection('option_list', k)
from (select list_key || '|' || coalesce(shop_id, '') as k from option_lists) s
on conflict (kind, key) do nothing;

insert into activity_snapshots (kind, key, snapshot)
select 'user_shops', id::text, activity_collection('user_shops', id::text) from app_users
on conflict (kind, key) do nothing;
