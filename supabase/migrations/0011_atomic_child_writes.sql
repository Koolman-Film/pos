-- supabase/migrations/0011_atomic_child_writes.sql
--
-- Makes saving a job ticket's or a wholesale PO's child rows ATOMIC.
--
-- THE BUG THIS FIXES. Both save paths replaced their children with a
-- delete-then-insert issued as separate HTTP requests from the server action:
--
--     await supabase.from('ticket_items').delete().eq('ticket_id', id);   -- gone
--     await supabase.from('ticket_payments').delete().eq('ticket_id', id);-- gone
--     for (const it of items) { await supabase.from('ticket_items').insert(...) }
--
-- Every one of those is its own transaction. If an insert failed part-way — a
-- constraint, a dropped connection, a timeout — the delete had already committed,
-- so the ticket was left holding SOME or NONE of its items, with the previous
-- values unrecoverable. The user saw an error and their line items were gone. The
-- same shape existed on the wholesale side across four child tables.
--
-- supabase-js cannot span statements in one transaction, so the fix is to move the
-- whole replacement into the database, where a function body IS a single
-- transaction: either every child row lands or the delete rolls back with it.
--
-- SECURITY. Both functions are `security invoker`, so they execute as the caller
-- and every RLS policy from migration 0007 applies exactly as it did to the
-- individual client calls. This changes atomicity, not authorisation — a caller
-- who could not previously write another shop's ticket still cannot.
--
-- The payloads are jsonb because the shapes are already JSON on the way in, and
-- passing arrays of composite types through PostgREST is considerably more
-- awkward for no benefit.

-- ---------------------------------------------------------------------------
-- Job ticket: items (each with its positions) + payments
-- ---------------------------------------------------------------------------
create or replace function save_ticket_children(
  p_ticket_id text,
  p_items jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
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
      discount_type, discount_value, actual_qty
    ) values (
      p_ticket_id,
      coalesce(v_item->>'category', ''),
      coalesce(v_item->>'booked', ''),
      coalesce((v_item->>'bookedPrice')::numeric, 0),
      coalesce(v_item->>'sold', ''),
      coalesce((v_item->>'soldPrice')::numeric, 0),
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

-- ---------------------------------------------------------------------------
-- Wholesale PO: items + returns + adjustments + payments
-- ---------------------------------------------------------------------------
create or replace function save_order_children(
  p_order_id text,
  p_items jsonb,
  p_returns jsonb,
  p_adjustments jsonb,
  p_payments jsonb,
  p_saved_on date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from order_items where order_id = p_order_id;
  delete from order_returns where order_id = p_order_id;
  delete from order_adjustments where order_id = p_order_id;
  delete from order_payments where order_id = p_order_id;

  insert into order_items (order_id, name, qty, list_price, requested_price, reason)
  select
    p_order_id,
    coalesce(it->>'name', ''),
    coalesce((it->>'qty')::numeric, 0),
    coalesce((it->>'listPrice')::numeric, 0),
    coalesce((it->>'requestedPrice')::numeric, 0),
    coalesce(it->>'reason', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into order_returns (order_id, item_name, qty, reason)
  select
    p_order_id,
    coalesce(r->>'item', ''),
    coalesce((r->>'qty')::numeric, 0),
    coalesce(r->>'reason', '')
  from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) as r;

  -- `adjusted_at` and `paid_at` are NOT NULL dates, and the prototype only kept a
  -- free-text Thai display string ("วันนี้"), so the save date is used — the same
  -- divergence the TypeScript version documented.
  insert into order_adjustments (order_id, amount, reason, adjusted_at)
  select
    p_order_id,
    coalesce((a->>'amount')::numeric, 0),
    coalesce(a->>'reason', ''),
    p_saved_on
  from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) as a;

  insert into order_payments (order_id, amount, method, paid_at)
  select
    p_order_id,
    coalesce((pay->>'amount')::numeric, 0),
    coalesce(pay->>'method', ''),
    p_saved_on
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as pay;
end;
$$;

revoke all on function save_ticket_children(text, jsonb, jsonb) from public, anon;
grant execute on function save_ticket_children(text, jsonb, jsonb) to authenticated;

revoke all on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function save_order_children(text, jsonb, jsonb, jsonb, jsonb, date) to authenticated;
