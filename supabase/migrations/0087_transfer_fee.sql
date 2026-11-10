-- supabase/migrations/0087_transfer_fee.sql
--
-- ค่าธรรมเนียมการโอน — บันทึกพร้อมการโอน ไม่ต้องไปเปิดหน้าค่าใช้จ่ายอีกรอบ
--
-- เงินที่ย้ายจากเครื่องรูดบัตรเข้าบัญชีธนาคาร โดนหักค่าธรรมเนียมระหว่างทางเสมอ
-- ซึ่งเป็นค่าใช้จ่ายของร้าน วิธีที่ร้านทำอยู่คือบันทึกการโอนเต็มจำนวนก่อน แล้ว
-- ไปเปิดหน้าค่าใช้จ่ายบันทึกค่าธรรมเนียมอีกรายการ (ร้านแจ้ง 6 พ.ย. 2569)
--
-- สองขั้นตอนที่ต้องจำว่าคู่กัน แปลว่าวันไหนลืมขั้นที่สอง ยอดบัญชีจะเกินจริงอยู่
-- เท่าค่าธรรมเนียม และไม่มีอะไรบนหน้าจอบอกว่าขาดอะไรไป
--
-- หลังรันไฟล์นี้ ช่องค่าธรรมเนียมอยู่ในฟอร์มโอนเงิน และระบบสร้างรายการค่าใช้จ่าย
-- ให้เองในทรานแซกชันเดียวกัน ลบการโอนทิ้งเมื่อไหร่ ค่าใช้จ่ายของมันหายตามไปด้วย
--
-- วิธีคิดเลข: การโอนยังเป็นยอดเต็มทั้งสองด้าน ส่วนค่าธรรมเนียมเป็นค่าใช้จ่ายที่
-- หักจากบัญชีปลายทาง (เลือกเป็นต้นทางได้) เครื่องรูด 10,000 เข้าธนาคาร ค่า
-- ธรรมเนียม 30 จึงเป็น เครื่องรูด −10,000 · ธนาคาร +10,000 −30 = +9,970
--
-- ทำไมไม่โอนยอดสุทธิไปเลย: ยอดคงเหลือทุกใบคำนวณจาก `buildMoneySources` ตัวเดียว
-- ซึ่งรู้จักแค่ "การโอน" กับ "ค่าใช้จ่าย" การโอนสุทธิจะทำให้ 30 บาทนั้นหายไป
-- จากระบบโดยไม่เป็นค่าใช้จ่ายของใคร แล้วต้องสอนตัวคำนวณให้รู้จักค่าธรรมเนียม
-- เป็นเรื่องที่สาม — วิธีนี้ไม่ต้องแตะตัวคำนวณเลยสักบรรทัด
--
-- ของเดิมไม่ขยับ: การโอนทุกใบที่บันทึกไปแล้วมีค่าธรรมเนียมเป็น 0

set search_path = pos, public, extensions;

alter table money_transfers
  add column if not exists fee numeric(12, 2) not null default 0,
  add column if not exists fee_category text not null default '',
  -- บัญชีที่ค่าธรรมเนียมถูกหัก — ปกติคือปลายทาง แต่บาง acquirer หักจากต้นทาง
  add column if not exists fee_account_id bigint references money_accounts(id) on delete set null,
  -- รายการค่าใช้จ่ายที่ระบบสร้างให้ เก็บไว้เพื่อให้ลบตามกันได้
  add column if not exists fee_expense_id bigint references expenses(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'money_transfers_fee_not_negative'
  ) then
    alter table money_transfers
      add constraint money_transfers_fee_not_negative check (fee >= 0);
  end if;
end$$;

/*
  ค่าธรรมเนียมกินการโอนทั้งก้อนไม่ได้.

  ถ้ายอมให้ fee >= amount แปลว่ามีคนกรอกสลับช่อง — การโอนที่ค่าธรรมเนียมเท่ากับ
  หรือมากกว่าเงินที่โอน ไม่ใช่เหตุการณ์ที่เกิดขึ้นจริง และมันจะทำให้บัญชี
  ปลายทางติดลบเงียบ ๆ
*/
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'money_transfers_fee_below_amount'
  ) then
    alter table money_transfers
      add constraint money_transfers_fee_below_amount check (fee = 0 or fee < amount);
  end if;
end$$;

comment on column money_transfers.fee is
  'ค่าธรรมเนียมการโอน — บันทึกเป็นค่าใช้จ่ายให้เองผ่าน fee_expense_id (0087)';
comment on column money_transfers.fee_account_id is
  'บัญชีที่ค่าธรรมเนียมถูกหัก ว่าง = บัญชีปลายทาง (0087)';
comment on column money_transfers.fee_expense_id is
  'รายการใน expenses ที่ระบบสร้างให้คู่กับการโอนใบนี้ ลบการโอนแล้วลบตาม (0087)';

/*
  บันทึกการโอน พร้อมค่าธรรมเนียมของมัน ในทรานแซกชันเดียว.

  สองแถวนี้ต้องเกิดพร้อมกันหรือไม่เกิดเลย การเขียนแยกจากฝั่ง action แปลว่ามี
  ช่วงที่การโอนมีอยู่แต่ค่าใช้จ่ายยังไม่มี และถ้าคำสั่งที่สองพลาด จะไม่มีอะไร
  ย้อนคำสั่งแรกให้ — ซึ่งคือปัญหาเดียวกับที่ร้านทำด้วยมืออยู่ตอนนี้ แค่เร็วขึ้น

  `security invoker` ตามทั้งระบบ: RLS ของทั้ง money_transfers และ expenses
  ยังเป็นด่านจริง ไม่ได้ถูกข้ามเพราะเรียกผ่านฟังก์ชัน
*/
create or replace function save_money_transfer(
  p_shop text,
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount numeric,
  p_moved_at date,
  p_note text,
  p_fee numeric default 0,
  p_fee_category text default '',
  p_fee_account_id bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_fee numeric := greatest(coalesce(p_fee, 0), 0);
  v_fee_account bigint := coalesce(p_fee_account_id, p_to_account_id, p_from_account_id);
  v_fee_source text := '';
  v_expense_id bigint;
  v_transfer_id bigint;
  v_from_name text;
  v_to_name text;
begin
  if v_fee > 0 then
    if v_fee_account is null then
      raise exception 'ค่าธรรมเนียมต้องระบุว่าหักจากบัญชีไหน' using errcode = '23514';
    end if;

    -- ชื่อบัญชี ไม่ใช่ id: `expenses.source` เก็บป้ายชื่อแหล่งเงิน และยอดคงเหลือ
    -- จับคู่กลับด้วยชื่อ (0064) — เก็บ id ลงไปจะกลายเป็นค่าใช้จ่ายที่ไม่เข้าบัญชีไหน
    select name into v_fee_source from money_accounts where id = v_fee_account;
    if v_fee_source is null then
      raise exception 'ไม่พบบัญชีที่จะหักค่าธรรมเนียม' using errcode = 'P0002';
    end if;

    select name into v_from_name from money_accounts where id = p_from_account_id;
    select name into v_to_name from money_accounts where id = p_to_account_id;

    insert into expenses (shop_id, description, category, source, amount, status, paid_at)
    values (
      p_shop,
      -- อธิบายตัวเองได้ในหน้าค่าใช้จ่าย โดยไม่ต้องย้อนกลับมาดูว่ามาจากการโอนใบไหน
      'ค่าธรรมเนียมโอนเงิน ' || coalesce(v_from_name, 'นอกระบบ') || ' → ' ||
        coalesce(v_to_name, 'นอกระบบ'),
      coalesce(nullif(btrim(p_fee_category), ''), 'ค่าธรรมเนียม/ภาษี'),
      v_fee_source,
      v_fee,
      'จ่ายแล้ว',
      p_moved_at
    )
    returning id into v_expense_id;
  end if;

  insert into money_transfers (
    shop_id, from_account_id, to_account_id, amount, moved_at, note, created_by,
    fee, fee_category, fee_account_id, fee_expense_id
  ) values (
    p_shop, p_from_account_id, p_to_account_id, p_amount, p_moved_at,
    coalesce(btrim(p_note), ''), auth.uid(),
    v_fee,
    case when v_fee > 0 then coalesce(nullif(btrim(p_fee_category), ''), 'ค่าธรรมเนียม/ภาษี') else '' end,
    case when v_fee > 0 then v_fee_account else null end,
    v_expense_id
  )
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

revoke all on function save_money_transfer(text, bigint, bigint, numeric, date, text, numeric, text, bigint) from public, anon;
grant execute on function save_money_transfer(text, bigint, bigint, numeric, date, text, numeric, text, bigint) to authenticated;

/*
  ลบการโอน แล้วค่าใช้จ่ายของมันหายตามไปด้วย.

  ค่าธรรมเนียมที่ค้างอยู่หลังการโอนถูกลบ คือค่าใช้จ่ายที่ไม่มีเหตุการณ์รองรับ
  และไม่มีใครรู้ว่ามันมาจากไหน — แย่กว่าการลืมบันทึกตั้งแต่แรก เพราะมันดูถูกต้อง
*/
create or replace function delete_money_transfer(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_expense_id bigint;
begin
  select fee_expense_id into v_expense_id from money_transfers where id = p_id;
  delete from money_transfers where id = p_id;
  if v_expense_id is not null then
    delete from expenses where id = v_expense_id;
  end if;
end;
$$;

revoke all on function delete_money_transfer(bigint) from public, anon;
grant execute on function delete_money_transfer(bigint) to authenticated;
