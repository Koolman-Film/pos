-- supabase/release-0055.sql
--
-- เปลี่ยนเป็น "จัดส่งแล้ว" ต้องกรอกข้อมูลการจัดส่ง และแนบไฟล์
--
-- รันต่อจาก release-0054.sql
--
-- ปลอดภัยเมื่อรันซ้ำ: add column if not exists / on conflict do nothing /
-- create or replace function. ไม่มีการ backfill ใดๆ จึงไม่มีอะไรให้ล็อกกับเวอร์ชัน
--
-- ขายส่งส่งของก่อน แล้วค่อยเก็บเงินทีหลัง — ช่วงที่ของออกไปแล้วแต่เงินยังไม่เข้า
-- คือช่วงที่เสี่ยงที่สุดของร้าน. When a customer says the goods never arrived, the
-- only thing that settles it is what was written down at the time. Until now the
-- module recorded a DATE and nothing else.
--
-- **ต้องสร้าง policy ของ storage ด้วย.** The three policies below are attempted
-- and downgraded to a warning if this connection does not own `storage.objects`
-- (the Dashboard SQL Editor does not). If you see that warning, create them from
-- Dashboard → Storage → Policies using supabase/storage-policies.sql, or delivery
-- evidence will not upload and the transition will be impossible to complete.
--
-- ของเก่าไม่ถูกแตะ. The rule fires only when the status CHANGES to จัดส่งแล้ว, so
-- every PO already in that status stays exactly as it is.

set search_path = pos, public, extensions;

alter table orders
  -- ข้อมูลการจัดส่ง — ขนส่งเจ้าไหน เลขพัสดุ ใครรับ. Free text on purpose: the
  -- shop uses a different courier per customer and sometimes its own van, and a
  -- fixed set of fields would be wrong for whichever case was not foreseen.
  add column if not exists delivery_note text not null default '',
  -- Storage paths in the `wholesale-attachments` bucket — the signed delivery
  -- note, the courier receipt, the photo of the pallet on the truck.
  add column if not exists delivery_attachments text[] not null default '{}';

comment on column orders.delivery_note is
  'ข้อมูลการจัดส่ง — ขนส่ง/เลขพัสดุ/ผู้รับ. บังคับกรอกตอนเปลี่ยนเป็นจัดส่งแล้ว.';
comment on column orders.delivery_attachments is
  'หลักฐานการจัดส่งใน bucket wholesale-attachments. ต้องมีอย่างน้อยหนึ่งไฟล์.';

-- Own bucket rather than reusing `ticket-attachments`: a ticket's photos are
-- readable by anyone with the `list` nav — a technician included — and a
-- wholesale delivery note is not their business. One bucket would have to
-- satisfy the looser of the two navs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wholesale-attachments',
  'wholesale-attachments',
  false,
  10485760,  -- 10 MB: a phone photo of a signed slip, not a scan archive
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

/*
  Attempted rather than asserted, for the reason spelled out in 0014 and 0018:
  `storage.objects` belongs to `supabase_storage_admin`, so these succeed under
  `supabase db push` (whose connection can act as that owner) but not under a
  plain `postgres` one such as the Dashboard SQL Editor. A hard failure there
  would roll this migration back and strand the release, so a missing privilege
  becomes a warning and `supabase/storage-policies.sql` holds the three for
  creating by hand.
*/
do $$
declare
  ddl text;
begin
  foreach ddl in array array[
    $p$create policy wholesale_attachments_object_read on storage.objects for select to authenticated
      using (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$,
    $p$create policy wholesale_attachments_object_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$,
    $p$create policy wholesale_attachments_object_delete on storage.objects for delete to authenticated
      using (bucket_id = 'wholesale-attachments' and pos.current_user_has_nav('wholesale'))$p$
  ]
  loop
    begin
      execute ddl;
    exception
      when insufficient_privilege then
        raise warning 'SKIPPED a storage.objects policy for wholesale-attachments: not the owner of storage.objects. Create the three from Dashboard -> Storage -> Policies using supabase/storage-policies.sql, or delivery evidence will not upload or open.';
      when duplicate_object then
        null;
    end;
  end loop;
end $$;

/*
  เปลี่ยนเป็นจัดส่งแล้ว ต้องมีหลักฐานติดมาด้วย.

  Everything else in this function is 0052 unchanged — `create or replace` has
  no way to patch one branch, and every guard an earlier migration put here has
  to be written out again rather than assumed. (0051 learned that the hard way
  by silently deleting 0049's uid check; the first draft of THIS file dropped
  0052's service_role bypass the same way. Re-read the old body, do not trust
  the memory of it.)

  The evidence is demanded only on the TRANSITION. A PO already delivered can
  still be edited, re-priced and re-saved without anybody being asked for a
  photograph of something that happened last month.
*/
create or replace function enforce_order_status_capability()
returns trigger
language plpgsql
security definer
set search_path = pos
as $$
begin
  if new.status is distinct from old.status then
    -- แบ็กเอนด์ที่ถือ service_role (seed, สคริปต์ซ่อมข้อมูล, ชุดทดสอบ) ไม่ได้ผ่าน
    -- หน้าจอ จึงไม่มี auth.uid() ให้ตรวจสิทธิ์ และจะโดนปฏิเสธทุกครั้ง คีย์นี้เป็น
    -- ความลับฝั่งเซิร์ฟเวอร์อยู่แล้ว และตัวแอปไม่เคยใช้ service_role แตะสถานะ PO
    -- (ใช้เฉพาะใน permissions/actions.ts) ด่านนี้จึงยังกันคนที่ยิงตรงเข้า API ได้ครบ
    --
    -- มาก่อนด่านหลักฐานด้วย: a seed or a repair script setting up a PO that was
    -- delivered last year has no photograph to offer, and demanding one would
    -- make the fixtures impossible to write rather than making the shop safer.
    if auth.role() = 'service_role' then
      return new;
    end if;

    -- หลักฐานการจัดส่ง ก่อนเรื่องสิทธิ์: this is about the row being complete,
    -- not about who is asking, so it applies to everyone including an admin.
    if new.status = 'จัดส่งแล้ว' and old.status is distinct from 'จัดส่งแล้ว' then
      if new.delivered_at is null then
        raise exception 'ต้องระบุวันที่จัดส่งก่อน จึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(trim(new.delivery_note), '') = '' then
        raise exception 'ต้องกรอกข้อมูลการจัดส่ง (ขนส่ง/เลขพัสดุ/ผู้รับ) ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
      if coalesce(array_length(new.delivery_attachments, 1), 0) = 0 then
        raise exception 'ต้องแนบหลักฐานการจัดส่งอย่างน้อยหนึ่งไฟล์ ก่อนจึงจะเปลี่ยนเป็นจัดส่งแล้วได้';
      end if;
    end if;

    if current_user_can('wholesale.updateStatus') then
      return new;
    end if;
    if new.status in ('รอจัดส่ง', 'รออนุมัติราคา')
       and current_user_can('wholesale.priceApproval') then
      return new;
    end if;
    if new.status = 'ค้างชำระ' and current_user_can('wholesale.badDebt') then
      return new;
    end if;
    if new.status = 'จัดส่งแล้ว'
       and old.delivered_at is null
       and new.delivered_at is not null then
      return new;
    end if;
    raise exception 'forbidden: ไม่มีสิทธิ์เปลี่ยนสถานะ PO';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_capability on orders;
create trigger orders_status_capability
  before update on orders
  for each row
  execute function enforce_order_status_capability();

insert into supabase_migrations.schema_migrations(version, name) values ('0055', 'delivery_evidence') on conflict (version) do nothing;
