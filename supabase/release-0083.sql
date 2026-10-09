-- supabase/release-0083.sql
--
-- หลักฐานการรับเงินค่าประกัน
--
-- รันต่อจาก release-0082.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists และ create or replace function
--
-- หลังรันไฟล์นี้ กล่อง "การรับเงินค่าประกัน" ในใบงานมีที่แนบสลิปเหมือนการรับเงิน
-- ปกติ ไฟล์เก็บใน bucket ticket-attachments ที่เดียวกับสลิปของใบงาน
--
-- ทำไมถึงขาดไป: การรับเงินค่าประกันเพิ่งแยกออกมาเป็นการรับเงินของตัวเองใน 0071
-- เพราะลูกค้ามักกลับมาซื้อประกันหลังใบงานปิดและล็อกไปแล้ว แต่ตอนนั้นไม่ได้ติด
-- ช่องแนบไฟล์ไปด้วย มันจึงเป็นเงินก้อนเดียวในระบบที่ไม่มีหลักฐานผูกอยู่
--
-- ของเดิมไม่ขยับ: กรมธรรม์ทุกฉบับที่บันทึกไปแล้วได้ลิสต์ไฟล์ว่าง

set search_path = pos, public, extensions;

alter table insurance_policies
  add column if not exists paid_attachments text[] not null default '{}';

comment on column insurance_policies.paid_attachments is
  'หลักฐานการรับเงินค่าประกัน — storage path ใน ticket-attachments (0083)';

/*
  `save_insurance_policy` รับฟิลด์ใหม่เพิ่มหนึ่งช่อง.

  ตัวเดิมของ 0071 ทั้งดุ้น เปลี่ยนแค่เพิ่ม paid_attachments — `create or replace`
  เขียนทับทั้งตัว ไม่ใช่แก้บางบรรทัด อะไรที่ไม่เขียนกลับมาคือของที่หายไป

  `coalesce(..., '{}')` ไม่ใช่ปล่อยให้เป็น null: client รุ่นเก่าที่ยังไม่ส่งฟิลด์นี้
  มาต้องไม่ล้างไฟล์ที่แนบไว้แล้วทิ้ง — แต่ก็ต้องไม่เขียน null ลงคอลัมน์ not null
*/
create or replace function save_insurance_policy(
  p_id bigint,
  p_ticket_id text,
  p_policy jsonb,
  p_claims jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_id bigint;
  v_attachments text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(p_policy->'paidAttachments')),
    '{}'::text[]
  );
begin
  if p_id is null then
    insert into insurance_policies (
      ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms,
      sold_at, starts_at, ends_at, notes, created_by,
      paid_amount, paid_at, paid_method, paid_attachments
    ) values (
      p_ticket_id,
      coalesce(p_policy->>'plate', ''),
      coalesce(p_policy->>'planName', ''),
      coalesce((p_policy->>'price')::numeric, 0),
      coalesce((p_policy->>'bigPieces')::int, 0),
      coalesce((p_policy->>'smallPieces')::int, 0),
      coalesce(p_policy->>'terms', ''),
      coalesce((p_policy->>'soldAt')::date, current_date),
      (p_policy->>'startsAt')::date,
      (p_policy->>'endsAt')::date,
      coalesce(p_policy->>'notes', ''),
      auth.uid(),
      greatest(coalesce((p_policy->>'paidAmount')::numeric, 0), 0),
      (p_policy->>'paidAt')::date,
      coalesce(p_policy->>'paidMethod', ''),
      v_attachments
    )
    returning id into v_id;
  else
    update insurance_policies set
      plate        = coalesce(p_policy->>'plate', ''),
      plan_name    = coalesce(p_policy->>'planName', ''),
      price        = coalesce((p_policy->>'price')::numeric, 0),
      big_pieces   = coalesce((p_policy->>'bigPieces')::int, 0),
      small_pieces = coalesce((p_policy->>'smallPieces')::int, 0),
      terms        = coalesce(p_policy->>'terms', ''),
      sold_at      = coalesce((p_policy->>'soldAt')::date, current_date),
      starts_at    = (p_policy->>'startsAt')::date,
      ends_at      = (p_policy->>'endsAt')::date,
      notes        = coalesce(p_policy->>'notes', ''),
      paid_amount  = greatest(coalesce((p_policy->>'paidAmount')::numeric, 0), 0),
      paid_at      = (p_policy->>'paidAt')::date,
      paid_method  = coalesce(p_policy->>'paidMethod', ''),
      -- ไม่ส่งคีย์นี้มาเลย = ไม่ได้ตั้งใจแก้ไฟล์แนบ ของเดิมจึงอยู่ต่อ
      paid_attachments = case
        when p_policy ? 'paidAttachments' then v_attachments
        else paid_attachments
      end
    where id = p_id and ticket_id = p_ticket_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ไม่พบกรมธรรม์ที่ต้องการแก้ไข' using errcode = 'P0002';
    end if;
  end if;

  -- การเคลมไม่ได้เขียนที่นี่ (0059): a claim is made at the service visit it
  -- happened on, and replacing the list here would delete those every time a
  -- policy was edited. `p_claims` stays in the signature for older callers.
  return v_id;
end;
$$;

revoke all on function save_insurance_policy(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function save_insurance_policy(bigint, text, jsonb, jsonb) to authenticated;

select 'release-0083 done' as status;

insert into supabase_migrations.schema_migrations(version, name) values ('0083', 'insurance_payment_attachments') on conflict (version) do nothing;
