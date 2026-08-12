-- supabase/migrations/0018_ticket_attachments.sql
--
-- Real files for the two attachment points on a ticket: the transfer slip on a
-- payment row, and the QC photos taken before installation.
--
-- Both were the same defect the expense receipts had (migration 0014): the form
-- accepted files and kept only their NAMES in React state. The slip was worse —
-- `ticket_payments` had no column at all, so it did not even survive the save;
-- `qcPhotos` at least persisted, as a list of names pointing at nothing.
--
-- These are the shop's evidence that money arrived and that a car had a scratch
-- before it was touched, so they belong in storage, not in a string.
--
-- Own bucket rather than reusing `expense-attachments`: a ticket is readable by
-- anyone with the `list` nav (a technician included), an expense receipt only by
-- the accounting roles. One bucket would have to satisfy the looser of the two.

set search_path = pos, public, extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,  -- 10 MB, same as the receipts: a phone photo, not a scan archive
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

-- The slip lives with its payment row, which `save_ticket_children` replaces
-- wholesale — an array on the row keeps it attached to the payment it belongs to
-- without a second table to keep in step.
alter table ticket_payments
  add column attachments text[] not null default '{}';

comment on column ticket_payments.attachments is
  'Storage paths in the `ticket-attachments` bucket — the transfer slips for this payment.';

create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = pos
as $$
declare
  v_item jsonb;
  v_item_id bigint;
begin
  if exists (select 1 from tickets where id = p_ticket_id and locked)
     and not current_user_can('list.unlock') then
    raise exception 'ใบงานนี้ปิดงานแล้วและถูกล็อก แก้ไขไม่ได้ (ต้องให้แอดมินปลดล็อกก่อน)'
      using errcode = '42501';
  end if;

  -- Positions cascade from ticket_items, so deleting the items clears them too.
  delete from ticket_items where ticket_id = p_ticket_id;
  delete from ticket_payments where ticket_id = p_ticket_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into ticket_items (
      ticket_id, category, booked, booked_price, sold, sold_price,
      interested, interested_price, discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
      coalesce(v_item->>'interested', ''),
      coalesce((v_item->>'interestedPrice')::numeric, 0),
      -- Both nullable: absent or JSON null must stay NULL, not become 0/''.
      v_item->>'discountType',
      (v_item->>'discountValue')::numeric,
      coalesce(v_item->'actualQty', '{}'::jsonb)
    )
    returning id into v_item_id;

    insert into ticket_item_positions (ticket_item_id, "position", product, price)
    select
      v_item_id,
      coalesce(pos->>'position', ''),
      coalesce(pos->>'product', ''),
      coalesce((pos->>'price')::numeric, 0)
    from jsonb_array_elements(coalesce(v_item->'positions', '[]'::jsonb)) as pos;
  end loop;

  insert into ticket_payments (ticket_id, type, method, amount, paid_at, attachments)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date),
    -- `jsonb_array_elements_text` over an absent key yields no rows, which
    -- aggregates to NULL — coalesce keeps the NOT NULL default shape.
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(pay->'attachments', '[]'::jsonb))),
      '{}'
    )
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

-- Storage policies: the ticket module's own nav is the gate, so a technician who
-- can open the ticket can also see the QC photos on it and add more.
create policy ticket_attachments_object_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

create policy ticket_attachments_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));

create policy ticket_attachments_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and pos.current_user_has_nav('list'));
