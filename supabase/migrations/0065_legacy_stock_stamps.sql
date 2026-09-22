/*
  ของเก่าที่ 0054 ตกหล่น — PO ที่ตัดสต๊อกไปแล้ว และการรับคืนที่ไม่มี uid

  1. 0054 marked a PO as already deducted by its status, naming the closing step
     ปิดงานแล้ว. Production renamed that step เสร็จสิ้น, so its closed POs were
     left unmarked, and the new rule would take their goods off the shelf a
     second time if one were ever moved back to จัดส่งแล้ว. The old rule also
     deducted on every save whatever the status, so a PO still waiting on a
     price or on delivery can already be out of stock.

     What decides it here is what happened, not what the step is called: a PO
     with a wholesale movement against it has had its stock taken. A PO past
     the two pre-delivery steps is marked too, as 0054 meant to, in case every
     line was unmatched and nothing moved.

  2. Returns written before 0054 have uid ''. save_order_children carries the
     received stamps across a save by uid, so the first save of such a PO wiped
     them, and confirm_order_return refuses an empty uid — the return would sit
     unconfirmed for good. Each gets a uid of its own, like 0060's 'p'||id.
     A return with no uid was written by the old app, whose rule put the goods
     back when it was saved, so it is stamped as handled as well. That also
     covers one the old app saved between 0054 and this file.

  Safe to re-run: every update only touches rows still unmarked.
*/
set search_path = pos, public, extensions;

update orders o
set stock_deducted_at = now()
where o.stock_deducted_at is null
  and (
    o.status not in ('รออนุมัติราคา', 'รอจัดส่ง')
    or exists (
      select 1
        from stock_movements m
       where m.document_id = o.id
         and m.kind = 'ขายส่ง'
    )
  );

update order_returns
set uid = 'r' || id,
    received_at = coalesce(received_at, returned_at),
    stock_returned_at = coalesce(stock_returned_at, now())
where uid = '';
