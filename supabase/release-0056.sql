-- supabase/release-0056.sql
--
-- เติมเงินสดย่อยจากหน้าค่าใช้จ่าย ต้องเข้ายอดเงินด้วย
--
-- รันต่อจาก release-0055.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / create index if not exists /
-- create or replace function. การผูกของเดิมดูเฉพาะแถวที่ยังไม่ผูก และเฉพาะการโอน
-- ที่ยังไม่มีใครผูก รอบสองจึงไม่เปลี่ยนอะไร
--
-- ตั้งแต่ 0043 ยอดเงินคิดจากการโอน แต่ปุ่ม "เติมเงินสดย่อย" ในหน้าค่าใช้จ่ายยังบันทึก
-- ลง petty_cash อย่างเดียว ทุกครั้งที่กดหลังขึ้นระบบ ยอดเงินสดย่อยจึงไม่เพิ่ม และ
-- แหล่งเงินต้นทางก็ไม่ลด
--
-- หลังรันไฟล์นี้:
--   * ปุ่มนี้บันทึกเป็นการโอนด้วย และถามว่าเงินมาจากไหน
--   * รายการเก่าที่ตรงกับการโอนที่มีอยู่แน่นอน (สาขา วัน จำนวน ตรงกัน) ถูกผูกให้
--   * ที่เหลือ **ไม่ถูกคัดลอกให้อัตโนมัติ** — ขึ้นเป็นรายการที่หน้าการจัดการเงิน/บัญชี
--     ให้เลือกนำเข้า หรือกด "โอนไว้เองแล้ว" ทีละรายการ เพราะบางก้อนอาจคีย์เป็นการ
--     โอนไว้เองแล้ว คัดลอกทั้งหมดจะนับเงินซ้ำ

set search_path = pos, public, extensions;

alter table petty_cash
  -- การโอนที่เป็นคู่ของรายการเติมเงินนี้ ในยอดเงิน
  add column if not exists money_transfer_id bigint
    references money_transfers(id) on delete set null,
  -- "บันทึกโอนไว้เองแล้ว" — decided, but not by importing it
  add column if not exists transfer_skipped_at timestamptz,
  add column if not exists transfer_skipped_by uuid
    references app_users(id) on delete set null;

comment on column petty_cash.money_transfer_id is
  'การโอนเข้าบัญชีเงินสดย่อยที่เป็นคู่ของรายการเติมเงินนี้ (0056). null = ยังไม่เข้ายอดเงิน.';
comment on column petty_cash.transfer_skipped_at is
  'ร้านยืนยันว่าบันทึกการโอนก้อนนี้ไว้เองแล้ว จึงไม่นำเข้าซ้ำ (0056).';

-- One transfer explains one top-up. Without this, two identical top-ups on the
-- same day could both claim the same transfer and the second would look
-- accounted for when it is not.
create unique index if not exists petty_cash_money_transfer_uidx
  on petty_cash (money_transfer_id)
  where money_transfer_id is not null;

/*
  ผูกของเดิมที่ตรงกันแน่นอน.

  A loop rather than one UPDATE … FROM: two identical top-ups on one day must
  take two different transfers, and a set-based update would hand both the same
  one. Oldest top-up takes the oldest matching transfer.

  Safe to re-run: it only ever looks at rows that are still unlinked, and only
  at transfers no row has claimed.
*/
do $$
declare
  r record;
  v_transfer bigint;
begin
  for r in
    select p.id, p.shop_id, p.amount, p.entry_at
    from petty_cash p
    where p.type = 'เติมเงิน'
      and p.amount > 0
      and p.money_transfer_id is null
      and p.transfer_skipped_at is null
    order by p.id
  loop
    select t.id into v_transfer
    from money_transfers t
    join money_accounts a on a.id = t.to_account_id and a.kind = 'petty'
    where t.shop_id = r.shop_id
      and t.moved_at = r.entry_at
      and t.amount = r.amount
      and not exists (select 1 from petty_cash x where x.money_transfer_id = t.id)
    order by t.id
    limit 1;

    if v_transfer is not null then
      update petty_cash set money_transfer_id = v_transfer where id = r.id;
    end if;
  end loop;
end $$;

/*
  เติมเงินสดย่อย.

  security definer because it writes two tables in one go, which means RLS does
  not stand guard — so every check RLS and the Server Action used to make is
  made here, explicitly: the capability, the branch, the amount, and that both
  ends of the transfer are accounts of that branch.

  `p_from_account` null means นอกระบบ — the money came from somewhere the
  register does not track (a director's own pocket). That is a real answer and
  the form makes the person choose it, rather than null standing for "nobody
  said".
*/
create or replace function topup_petty_cash(
  p_shop text,
  p_from_account bigint,
  p_amount numeric,
  p_note text default '',
  p_on date default null
)
returns bigint
language plpgsql
security definer
set search_path = pos
as $$
declare
  v_petty bigint;
  v_transfer bigint;
  v_id bigint;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_on date;
  v_note text;
begin
  if not current_user_can('accounting.topupCash') then
    raise exception 'forbidden: ไม่มีสิทธิ์เติมเงินสดย่อย';
  end if;
  if p_shop is null or p_shop not in (select current_user_shops()) then
    raise exception 'forbidden: ไม่มีสิทธิ์ในสาขานี้';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'จำนวนเงินต้องมากกว่า 0';
  end if;

  -- วันที่ของร้าน ไม่ใช่ของเซิร์ฟเวอร์. The old action sent a UTC timestamp into
  -- a DATE column, so a top-up before 07:00 was filed under yesterday.
  v_on := coalesce(p_on, v_today);
  if v_on > v_today then
    raise exception 'วันที่เติมเงินต้องไม่เกินวันนี้';
  end if;

  select a.id into v_petty
  from money_accounts a
  where a.shop_id = p_shop and a.kind = 'petty' and a.active
  order by a.sort_order, a.id
  limit 1;
  if v_petty is null then
    raise exception 'สาขานี้ยังไม่มีแหล่งเงินประเภทเงินสดย่อย — เพิ่มที่หน้าการจัดการเงิน/บัญชีก่อน';
  end if;

  if p_from_account is not null then
    if p_from_account = v_petty then
      raise exception 'เงินสดย่อยเติมจากตัวเองไม่ได้';
    end if;
    if not exists (
      select 1 from money_accounts a
      where a.id = p_from_account and a.shop_id = p_shop and a.active
    ) then
      raise exception 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้';
    end if;
  end if;

  v_note := coalesce(nullif(trim(p_note), ''), 'เติมเงินสดย่อย');

  insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note, created_by)
  values (p_shop, p_from_account, v_petty, p_amount, v_on, v_note, auth.uid())
  returning id into v_transfer;

  insert into petty_cash (shop_id, type, amount, note, entry_at, money_transfer_id)
  values (p_shop, 'เติมเงิน', p_amount, v_note, v_on, v_transfer)
  returning id into v_id;

  return v_id;
end;
$$;

/*
  นำการเติมเงินสดย่อยที่ตกหล่นเข้ายอดเงิน.

  Gated by the money register's own nav rather than `accounting.topupCash`:
  deciding what an old entry means for the balances is the bookkeeper's call on
  /money, and that is where the control lives. The transfer is dated the day
  the top-up was, so the balance history lands where it happened.
*/
create or replace function link_petty_cash_topup(
  p_petty_id bigint,
  p_from_account bigint
)
returns bigint
language plpgsql
security definer
set search_path = pos
as $$
declare
  r petty_cash%rowtype;
  v_petty bigint;
  v_transfer bigint;
begin
  if not current_user_has_nav('money') then
    raise exception 'forbidden: ไม่มีสิทธิ์จัดการแหล่งเงิน';
  end if;

  select * into r from petty_cash where id = p_petty_id for update;
  if not found or r.shop_id not in (select current_user_shops()) then
    raise exception 'ไม่พบรายการเติมเงินสดย่อยนี้';
  end if;
  if r.type <> 'เติมเงิน' or r.amount <= 0 then
    raise exception 'รายการนี้ไม่ใช่การเติมเงินสดย่อย';
  end if;
  if r.money_transfer_id is not null or r.transfer_skipped_at is not null then
    raise exception 'รายการนี้จัดการไปแล้ว';
  end if;

  select a.id into v_petty
  from money_accounts a
  where a.shop_id = r.shop_id and a.kind = 'petty' and a.active
  order by a.sort_order, a.id
  limit 1;
  if v_petty is null then
    raise exception 'สาขานี้ยังไม่มีแหล่งเงินประเภทเงินสดย่อย — เพิ่มที่หน้าการจัดการเงิน/บัญชีก่อน';
  end if;

  if p_from_account is not null then
    if p_from_account = v_petty then
      raise exception 'เงินสดย่อยเติมจากตัวเองไม่ได้';
    end if;
    if not exists (
      select 1 from money_accounts a
      where a.id = p_from_account and a.shop_id = r.shop_id and a.active
    ) then
      raise exception 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้';
    end if;
  end if;

  insert into money_transfers (shop_id, from_account_id, to_account_id, amount, moved_at, note, created_by)
  values (
    r.shop_id, p_from_account, v_petty, r.amount, r.entry_at,
    coalesce(nullif(trim(r.note), ''), 'เติมเงินสดย่อย'), auth.uid()
  )
  returning id into v_transfer;

  update petty_cash set money_transfer_id = v_transfer where id = r.id;
  return v_transfer;
end;
$$;

/*
  "บันทึกโอนไว้เองแล้ว".

  Kept as a decision with a name and a time on it rather than a delete: the
  petty-cash entry is still the accounting screen's record of the top-up, and
  whoever looks at it later should be able to see that somebody chose not to
  import it, and who.
*/
create or replace function skip_petty_cash_topup(p_petty_id bigint)
returns void
language plpgsql
security definer
set search_path = pos
as $$
declare
  r petty_cash%rowtype;
begin
  if not current_user_has_nav('money') then
    raise exception 'forbidden: ไม่มีสิทธิ์จัดการแหล่งเงิน';
  end if;

  select * into r from petty_cash where id = p_petty_id for update;
  if not found or r.shop_id not in (select current_user_shops()) then
    raise exception 'ไม่พบรายการเติมเงินสดย่อยนี้';
  end if;
  if r.money_transfer_id is not null or r.transfer_skipped_at is not null then
    raise exception 'รายการนี้จัดการไปแล้ว';
  end if;

  update petty_cash
  set transfer_skipped_at = now(),
      transfer_skipped_by = auth.uid()
  where id = r.id;
end;
$$;

revoke all on function topup_petty_cash(text, bigint, numeric, text, date) from public, anon;
grant execute on function topup_petty_cash(text, bigint, numeric, text, date) to authenticated;
revoke all on function link_petty_cash_topup(bigint, bigint) from public, anon;
grant execute on function link_petty_cash_topup(bigint, bigint) to authenticated;
revoke all on function skip_petty_cash_topup(bigint) from public, anon;
grant execute on function skip_petty_cash_topup(bigint) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('0056', 'petty_cash_transfers') on conflict (version) do nothing;
