-- supabase/migrations/0015_ticket_item_interested.sql
--
-- Persist สินค้าที่สนใจ (the cheer-up baseline) on a ticket item.
--
-- The field has been in the form since the port — you pick the product the
-- customer originally came in for, its price fills in, and the item shows the
-- difference against what was actually sold. None of it survived a save:
-- `ticket_items` had no column for it and `serializeTicket` did not send it, so
-- reopening the ticket showed an empty picker and the cheer-up figure with it.
-- The trial run reported exactly that ("ข้อมูลหายไป").
--
-- Same shape as the `booked`/`booked_price` pair next to it, including the
-- not-null defaults, so an item that never had one reads as "not specified"
-- rather than NULL.

set search_path = pos, public, extensions;

alter table ticket_items
  add column interested text not null default '',
  add column interested_price numeric not null default 0;

comment on column ticket_items.interested is
  'สินค้าที่ลูกค้าสนใจตอนแรก — the baseline the cheer-up difference is measured from. Empty when not specified.';

-- `save_ticket_children` replaces a ticket''s items wholesale, so the two new
-- columns have to be written there or every save would silently reset them to
-- their defaults. Rest of the body is unchanged from migration 0011.
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

  insert into ticket_payments (ticket_id, type, method, amount, paid_at)
  select
    p_ticket_id,
    coalesce(pay->>'type', ''),
    coalesce(pay->>'method', ''),
    coalesce((pay->>'amount')::numeric, 0),
    coalesce((pay->>'paidAt')::date, current_date)
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;
