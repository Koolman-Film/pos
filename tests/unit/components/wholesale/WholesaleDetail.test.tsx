import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// WholesaleList navigates with useRouter(); jsdom has no app-router context.
// Test-environment concern only.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';
import { WholesaleList } from '@/components/wholesale/WholesaleList';
import type { WsOrder } from '@/components/wholesale/types';
import { todayValue } from '@/lib/domain/now';

// The Step-3 order: a single line, no discount (requestedPrice with no
// listPrice), no returns/adjustments/payments — priced at 10 * 1000 = 10,000.
const order = {
  id: 'WS-CM-0091',
  status: 'รออนุมัติราคา',
  items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, requestedPrice: 1000 }],
  returns: [],
  adjustments: [],
  payments: [],
} as unknown as WsOrder;

// A line whose offered price is below list price → a discount that needs
// approval; drives the `wholesale.priceApproval` gate.
const discountedOrder = {
  id: 'WS-CM-0092',
  status: 'รออนุมัติราคา',
  items: [
    { name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, listPrice: 1200, requestedPrice: 1000, reason: '' },
  ],
  returns: [],
  adjustments: [],
  payments: [],
} as unknown as WsOrder;

describe('WholesaleDetail', () => {
  it('hides the approve-price control when canDo("wholesale.priceApproval") is false', () => {
    render(<WholesaleDetail order={order} canDo={() => false} />);
    expect(screen.queryByText('อนุมัติราคานี้')).not.toBeInTheDocument();
  });

  it('shows the computed order total using orderTotal, not a re-derived number', () => {
    render(<WholesaleDetail order={order} canDo={() => true} />);
    // 10 * 1000, formatted by lib/domain/orders.ts + lib/domain/format.ts. The
    // faithful port shows this figure in both the "ยอดสุทธิ" and "คงเหลือ" rows,
    // so assert on the set rather than a single node.
    expect(screen.getAllByText(/10,000\.00/).length).toBeGreaterThan(0);
  });

  it('reveals the approve-price control only when the capability is granted', () => {
    const { rerender } = render(<WholesaleDetail order={discountedOrder} canDo={() => true} />);
    expect(screen.getByText('อนุมัติราคานี้')).toBeInTheDocument();

    rerender(<WholesaleDetail order={discountedOrder} canDo={() => false} />);
    // Gated off: the approve button is gone and the "waiting for management"
    // notice takes its place.
    expect(screen.queryByText('อนุมัติราคานี้')).not.toBeInTheDocument();
    expect(screen.getByText(/มีส่วนลดรออนุมัติจากผู้บริหาร/)).toBeInTheDocument();
  });

  it('denies every capability when neither canDo nor caps is supplied', () => {
    render(<WholesaleDetail order={discountedOrder} />);
    expect(screen.queryByText('อนุมัติราคานี้')).not.toBeInTheDocument();
  });
});

describe('WholesaleDetail totals', () => {
  const build = (over: Partial<WsOrder>) => ({ ...order, ...over }) as unknown as WsOrder;

  it('subtracts a return priced at the matching item price', () => {
    // 10 x 1000 = 10,000, less 2 returned at 1000 = 8,000.
    render(
      <WholesaleDetail
        order={build({
          returns: [{ item: 'ฟิล์ม 3M CRM (ม้วน)', qty: 2, reason: '' }],
        } as Partial<WsOrder>)}
        canDo={() => true}
      />,
    );
    expect(screen.getAllByText(/8,000\.00/).length).toBeGreaterThan(0);
  });

  it('ignores a return naming a product that is not on the order', () => {
    render(
      <WholesaleDetail
        order={build({ returns: [{ item: 'ไม่เคยขาย', qty: 5, reason: '' }] } as Partial<WsOrder>)}
        canDo={() => true}
      />,
    );
    expect(screen.getAllByText(/10,000\.00/).length).toBeGreaterThan(0);
  });

  it('applies adjustments to the total', () => {
    render(
      <WholesaleDetail
        order={build({
          adjustments: [{ amount: 500, reason: 'ค่าส่ง', date: '' }],
        } as Partial<WsOrder>)}
        canDo={() => true}
      />,
    );
    expect(screen.getAllByText(/9,500\.00/).length).toBeGreaterThan(0);
  });

  it('shows the outstanding balance after a part payment', () => {
    render(
      <WholesaleDetail
        order={build({
          payments: [{ amount: 4000, method: 'เงินสด', date: '', attachments: [] }],
        } as Partial<WsOrder>)}
        canDo={() => true}
      />,
    );
    // 10,000 billed, 4,000 paid → 6,000 outstanding.
    expect(screen.getAllByText(/6,000\.00/).length).toBeGreaterThan(0);
  });

  it('renders an order with no lines at all', () => {
    // The order id only appears inside the print portal, which is not mounted
    // here, so assert on the section that is always present.
    render(<WholesaleDetail order={build({ items: [] } as Partial<WsOrder>)} canDo={() => true} />);
    expect(screen.getAllByText(/รายการสินค้า/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0);
  });
});

describe('WholesaleDetail capability gates', () => {
  it('accepts a serialisable caps map from a Server Component', () => {
    render(<WholesaleDetail order={discountedOrder} caps={{ 'wholesale.priceApproval': true }} />);
    expect(screen.getByText('อนุมัติราคานี้')).toBeInTheDocument();
  });

  it('gates bad-debt separately from price approval', () => {
    render(
      <WholesaleDetail
        order={order}
        caps={{ 'wholesale.priceApproval': true, 'wholesale.badDebt': false }}
      />,
    );
    expect(screen.queryByText(/ตัดหนี้สูญ/)).not.toBeInTheDocument();
  });
});

/**
 * เปิด PO ให้สาขาอื่นได้ (ตามสิทธิ์ที่มี).
 *
 * The branch was printed as plain text, so a new PO always belonged to whichever
 * of the caller's shops sorted first — head office could read and edit another
 * branch's PO but could not raise one for it.
 */
describe('WholesaleDetail — เลือกสาขาตอนเปิด PO ใหม่', () => {
  const SHOPS = [
    { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
    { id: 'lpg', name: 'FINNIX FILM ลำปาง' },
  ];
  const blank = { ...order, id: '', shop: 'cm' } as unknown as WsOrder;

  it('offers the branches the caller may act for', () => {
    render(<WholesaleDetail order={blank} isNew shops={SHOPS} canDo={() => true} />);
    const picker = screen.getByLabelText('สาขาที่เปิด PO');
    expect(picker).toHaveValue('cm');
    expect(within(picker).getByRole('option', { name: SHOPS[1].name })).toBeInTheDocument();
  });

  it('keeps it fixed on a PO that already exists', () => {
    // Its number, its stock and the customer's paperwork all name the branch.
    render(
      <WholesaleDetail
        order={{ ...order, shop: 'lpg' } as unknown as WsOrder}
        shops={SHOPS}
        canDo={() => true}
      />,
    );
    expect(screen.queryByLabelText('สาขาที่เปิด PO')).not.toBeInTheDocument();
    expect(screen.getByText(SHOPS[1].name)).toBeInTheDocument();
  });

  it('says nothing when the caller has one branch', () => {
    render(<WholesaleDetail order={blank} isNew shops={[SHOPS[0]]} canDo={() => true} />);
    expect(screen.queryByLabelText('สาขาที่เปิด PO')).not.toBeInTheDocument();
  });
});

/**
 * ตัดสต็อกไม่สำเร็จตอนบันทึก PO.
 *
 * Saving a PO deducts what was sold. When that fails — the product was renamed,
 * or the branch has no such product registered — the save still succeeds, which
 * is right: losing the sale over a stock lookup would be the worse failure. What
 * was wrong is that the failure was swallowed whole, so goods left the shelf and
 * the count never moved, and nobody knew until a stocktake months later.
 */
describe('WholesaleList — เตือนเมื่อตัดสต็อกไม่สำเร็จ', () => {
  const listProps = {
    orders: [],
    customers: [],
    wsStatuses: {},
    accessibleShops: [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }],
  };

  it('shows what could not be deducted', () => {
    render(
      <WholesaleList
        {...listProps}
        canDo={() => true}
        stockWarning="บันทึก PO แล้ว แต่ตัดสต็อกไม่สำเร็จ: ฟิล์ม 3M CRM 60%"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ฟิล์ม 3M CRM 60%');
  });

  it('says nothing when everything deducted', () => {
    render(<WholesaleList {...listProps} canDo={() => true} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/**
 * สต็อกของสาขาที่เลือก และการลบ PO.
 *
 * Two defects found in the first real week of the wholesale module: a PO could
 * not be deleted at all, and a new PO moved to another branch was offered no
 * products, because the stock it was handed was pinned to whichever branch the
 * draft happened to open on.
 */
describe('WholesaleDetail — สาขา และ ถังขยะ', () => {
  const shops = [
    { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
    { id: 'north', name: 'Finnix North' },
  ];
  const stock = [
    { id: 1, name: 'ฟิล์ม CT 40%', shortName: 'CT40', shop: 'cm', qty: 5, sellPrice: 900 },
    { id: 2, name: 'ฟิล์มกันรอย', shortName: 'PPF', shop: 'north', qty: 20, sellPrice: 1500 },
  ];
  const draft = { ...order, id: 'WS-NEW-1234', shop: 'cm', items: [] } as unknown as WsOrder;

  it('offers the chosen branch’s stock, not only the branch the draft opened on', async () => {
    const user = userEvent.setup();
    render(<WholesaleDetail order={draft} isNew shops={shops} stock={stock} canDo={() => true} />);

    await user.click(screen.getByText(/เพิ่มรายการสินค้า|เพิ่มสินค้า/));
    // The picker is type-to-search: the list opens on focus, and what it offers
    // is the shelf of the branch the PO is currently on.
    await user.click(screen.getByLabelText('สินค้าในรายการ'));
    expect(screen.getByText(/ฟิล์ม CT 40%/)).toBeInTheDocument();
    expect(screen.queryByText(/ฟิล์มกันรอย/)).not.toBeInTheDocument();

    // Switch to the wholesale-only branch: its shelf is what the PO now sells.
    await user.selectOptions(screen.getByLabelText('สาขาที่เปิด PO'), 'north');
    await user.click(screen.getByLabelText('สินค้าในรายการ'));
    expect(screen.getByText(/ฟิล์มกันรอย/)).toBeInTheDocument();
  });

  it('ค้นหาสินค้าด้วยการพิมพ์ ทั้งชื่อเต็มและชื่อย่อ', async () => {
    // A branch carrying 135+ products whose names share long prefixes cannot be
    // scrolled through, and staff know the short name rather than the full one.
    const user = userEvent.setup();
    render(<WholesaleDetail order={draft} isNew shops={shops} stock={stock} canDo={() => true} />);

    await user.click(screen.getByText(/เพิ่มรายการสินค้า|เพิ่มสินค้า/));
    await user.type(screen.getByLabelText('สินค้าในรายการ'), 'CT40');
    expect(screen.getByText(/ฟิล์ม CT 40%/)).toBeInTheDocument();

    await user.click(screen.getByText(/ฟิล์ม CT 40%/));
    // Choosing a product still fills the price from that branch's stock.
    expect(screen.getByLabelText('สินค้าในรายการ')).toHaveValue('CT40 · ฟิล์ม CT 40%');
    // ราคามาตรฐาน and ราคาที่เสนอ both come from that shelf, so both read 900.
    expect(screen.getAllByDisplayValue('900')).toHaveLength(2);
  });

  it('drops a product the new branch does not carry rather than selling from an empty shelf', async () => {
    const user = userEvent.setup();
    const withItem = {
      ...draft,
      items: [{ name: 'ฟิล์ม CT 40%', qty: 2, listPrice: 900, requestedPrice: 900, reason: '' }],
    } as unknown as WsOrder;
    render(
      <WholesaleDetail order={withItem} isNew shops={shops} stock={stock} canDo={() => true} />,
    );

    await user.selectOptions(screen.getByLabelText('สาขาที่เปิด PO'), 'north');
    // Kept as a line (the quantity is still wanted) but no longer claiming to
    // sell a product that branch has never stocked.
    expect(screen.getByLabelText('สินค้าในรายการ')).toHaveValue('');
  });

  it('offers ลบ PO only on a saved PO, and only with the capability', () => {
    const onDeleteOrder = vi.fn(async () => ({ ok: true }));
    const { rerender } = render(
      <WholesaleDetail order={order} canDo={() => true} onDeleteOrder={onDeleteOrder} />,
    );
    expect(screen.getByText('ลบ PO นี้')).toBeInTheDocument();

    // A draft has nothing to delete — ยกเลิก already throws it away.
    rerender(
      <WholesaleDetail order={order} isNew canDo={() => true} onDeleteOrder={onDeleteOrder} />,
    );
    expect(screen.queryByText('ลบ PO นี้')).not.toBeInTheDocument();

    rerender(<WholesaleDetail order={order} canDo={() => false} onDeleteOrder={onDeleteOrder} />);
    expect(screen.queryByText('ลบ PO นี้')).not.toBeInTheDocument();
  });

  it('warns that money was already received before deleting', async () => {
    const user = userEvent.setup();
    const paidOrder = {
      ...order,
      payments: [{ amount: 4000, method: 'เงินสด', date: '', attachments: [] }],
    } as unknown as WsOrder;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDeleteOrder = vi.fn(async () => ({ ok: true }));

    render(<WholesaleDetail order={paidOrder} canDo={() => true} onDeleteOrder={onDeleteOrder} />);
    await user.click(screen.getByText('ลบ PO นี้'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('4,000.00'));
    // Declined at the prompt → nothing is deleted.
    expect(onDeleteOrder).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('surfaces a refused delete instead of pretending it worked', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDeleteOrder = vi.fn(async () => ({ ok: false, error: 'ไม่มีสิทธิ์ลบ PO' }));

    render(<WholesaleDetail order={order} canDo={() => true} onDeleteOrder={onDeleteOrder} />);
    await user.click(screen.getByText('ลบ PO นี้'));

    expect(await screen.findByText('ไม่มีสิทธิ์ลบ PO')).toBeInTheDocument();
    confirm.mockRestore();
  });
});

/**
 * เอกสารขายส่ง สี่ใบ และวันที่ที่มากับสองใบในนั้น.
 *
 * ขายส่งไม่ออกใบกำกับภาษี — ใบแจ้งหนี้ ใบส่งของ ใบรับคืนสินค้า ใบเสร็จรับเงิน
 * เท่านั้น. Two of them are also the accounting events: a ใบส่งของ IS the
 * delivery, which is when a wholesale sale is earned (the shop delivers first
 * and is paid weeks later), and a ใบรับคืนสินค้า IS the return.
 */
describe('WholesaleDetail — เอกสารขายส่ง', () => {
  const saved = {
    ...order,
    items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, listPrice: 1000, requestedPrice: 1000 }],
    returns: [],
    payments: [],
  } as unknown as WsOrder;

  it('offers exactly the four wholesale documents, and no ใบกำกับภาษี', () => {
    render(<WholesaleDetail order={saved} canDo={() => true} />);
    for (const label of ['ใบแจ้งหนี้', 'ใบส่งของ', 'ใบรับคืนสินค้า', 'ใบเสร็จรับเงิน']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByText(/ใบกำกับภาษี/)).not.toBeInTheDocument();
  });

  it('will not issue ใบรับคืนสินค้า until something has been returned', () => {
    render(<WholesaleDetail order={saved} canDo={() => true} />);
    expect(screen.getByRole('button', { name: /ใบรับคืนสินค้า/ })).toBeDisabled();
    expect(screen.getByText(/ต้องบันทึกการคืนสินค้าก่อน/)).toBeInTheDocument();
  });

  it('records the delivery date when ใบส่งของ is issued', async () => {
    const user = userEvent.setup();
    const onRecordDelivery = vi.fn(async () => ({ ok: true }));
    render(
      <WholesaleDetail order={saved} canDo={() => true} onRecordDelivery={onRecordDelivery} />,
    );
    await user.click(screen.getByRole('button', { name: /ใบส่งของ/ }));
    expect(onRecordDelivery).toHaveBeenCalledWith(
      saved.id,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('does NOT re-date a delivery that already happened', async () => {
    // A second ใบส่งของ is a reprint. Re-dating the sale because somebody printed
    // it again would move revenue between months with nobody deciding to.
    const user = userEvent.setup();
    const onRecordDelivery = vi.fn(async () => ({ ok: true }));
    render(
      <WholesaleDetail
        order={{ ...saved, deliveredAt: '2026-08-20' } as unknown as WsOrder}
        canDo={() => true}
        onRecordDelivery={onRecordDelivery}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ใบส่งของ/ }));
    expect(onRecordDelivery).not.toHaveBeenCalled();
    expect(screen.getByText(/ส่งของแล้วเมื่อ 20 ส\.ค\. 2569/)).toBeInTheDocument();
  });
});

/**
 * หัวเอกสารของสาขาที่ขายผ่านพนักงานขาย.
 *
 * Finnix North sells through โหน่ง and เคน, and a wholesale buyer rings the
 * person who sold to them — not a branch switchboard. So those documents carry
 * the shop name and THAT rep's phone, and nothing else: an address block buries
 * the one number the customer wants.
 */
describe('WholesaleDetail — หัวเอกสาร และใบส่งของ', () => {
  const NORTH = [
    { id: 1, shop: 'north', name: 'โหน่ง', phone: '081-111-2222' },
    { id: 2, shop: 'north', name: 'เคน', phone: '082-333-4444' },
  ];
  const shopInfo = {
    north: {
      companyName: 'บริษัท ฟินนิกซ์ นอร์ท จำกัด',
      address: '99 ถนนทดสอบ เชียงใหม่',
      phone: '053-000-000',
      paymentChannels: [],
    },
  };
  const northOrder = {
    ...order,
    shop: 'north',
    salesBy: 'โหน่ง',
    createdAt: '2026-09-01T02:00:00Z',
    items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, listPrice: 1000, requestedPrice: 1000 }],
    returns: [],
    payments: [],
  } as unknown as WsOrder;

  const printed = () => document.querySelector('.print-area')!;

  it('heads the document with the rep’s phone, not the branch address', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <WholesaleDetail
        order={northOrder}
        canDo={() => true}
        salesPeople={NORTH}
        shopInfo={shopInfo}
        shops={[{ id: 'north', name: 'Finnix North' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ใบแจ้งหนี้/ }));

    const sheet = printed();
    expect(sheet.textContent).toContain('โหน่ง โทร 081-111-2222');
    expect(sheet.textContent).not.toContain('99 ถนนทดสอบ');
    expect(sheet.textContent).not.toContain('053-000-000');
  });

  it('signs the issuer’s line for them, and leaves the customer’s blank', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<WholesaleDetail order={northOrder} canDo={() => true} salesPeople={NORTH} />);
    await user.click(screen.getByRole('button', { name: /ใบส่งของ/ }));

    const sheet = printed();
    expect(sheet.textContent).toContain('ลงชื่อ โหน่ง ผู้ส่งของ');
    expect(sheet.textContent).toContain('ผู้รับของ');
    expect(sheet.textContent).toMatch(/ลงชื่อ\.+ ผู้รับของ/);
  });

  it('puts the invoice reference and the PO date on the ใบส่งของ', async () => {
    // The two dates on a wholesale sale are days apart, and this is the only
    // document where the customer can see both.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<WholesaleDetail order={northOrder} canDo={() => true} salesPeople={NORTH} />);
    await user.click(screen.getByRole('button', { name: /ใบส่งของ/ }));

    const sheet = printed();
    expect(sheet.textContent).toContain('อ้างอิง INV-CM-0091');
    expect(sheet.textContent).toContain('เปิด PO 1 ก.ย. 2569');
    // Same form as the invoice: the amounts are on it.
    expect(sheet.textContent).toContain('ยอดรวมสุทธิ');
  });

  it('ไม่พิมพ์ที่อยู่บนเอกสารขายส่ง ไม่ว่าใบไหน', async () => {
    // เอกสารขายส่งระบุแค่ชื่อร้านกับชื่อพนักงานขาย. A wholesale buyer rings the
    // person who sold to them; the address buries that line, and for a
    // wholesale-only branch it is not a place anyone visits.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <WholesaleDetail
        order={northOrder}
        canDo={() => true}
        salesPeople={NORTH}
        shopInfo={shopInfo}
        shops={[{ id: 'north', name: 'Finnix North' }]}
      />,
    );

    for (const doc of [/ใบแจ้งหนี้/, /ใบส่งของ/]) {
      await user.click(screen.getByRole('button', { name: doc }));
      expect(printed().textContent).not.toContain('99 ถนนทดสอบ');
    }
  });

  it('พิมพ์ชื่อพนักงานขาย แม้ยังไม่ได้บันทึกเบอร์โทรไว้', async () => {
    // The production case this was found in: the reps were named on the POs but
    // had no rows in `sales_people`, so the letterhead — which looked the phone
    // up first — printed no seller at all. The PO says who sold it; that is the
    // fact the document has to carry.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <WholesaleDetail
        order={northOrder}
        canDo={() => true}
        salesPeople={[]}
        shopInfo={shopInfo}
        shops={[{ id: 'north', name: 'Finnix North' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ใบแจ้งหนี้/ }));

    const sheet = printed();
    expect(sheet.textContent).toContain('โหน่ง');
    expect(sheet.textContent).toContain('ลงชื่อ โหน่ง');
    expect(sheet.textContent).not.toContain('99 ถนนทดสอบ');
  });
});

/**
 * ตัวกรองและสรุปรายพนักงานขาย.
 *
 * Finnix North sells through โหน่ง and เคน, and the shop needs to see each
 * person's own POs, sales and outstanding balance without exporting to Excel
 * first. Branches that do not record a seller must be unaffected.
 */
describe('WholesaleList — พนักงานขาย', () => {
  // Dated today so the default period (this month) keeps them on screen.
  const today = todayValue();
  const po = (id: string, salesBy: string, qty: number, paid = 0) =>
    ({
      id,
      shop: 'north',
      customerId: 1,
      status: 'ค้างชำระ',
      createdAt: today,
      salesBy,
      items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty, requestedPrice: 1000 }],
      returns: [],
      adjustments: [],
      payments: paid ? [{ amount: paid, method: 'เงินสด', date: today }] : [],
    }) as unknown as WsOrder;

  const listProps = {
    customers: [{ id: 1, name: 'ร้านทดสอบ', phone: '', address: '' }],
    wsStatuses: {},
    accessibleShops: [{ id: 'north', name: 'Finnix North' }],
    canDo: () => true,
  };

  const orders = [
    po('WS-N-0001', 'โหน่ง', 10, 4000),
    po('WS-N-0002', 'เคน', 3),
    po('WS-N-0003', '', 1),
  ];

  it('สรุปยอดขายและค้างรับรายคน', () => {
    render(<WholesaleList {...listProps} orders={orders} />);
    const summary = screen.getByText('สรุปรายพนักงานขาย').closest('div') as HTMLElement;

    // โหน่ง: one PO of 10,000 with 4,000 paid → 6,000 still owed.
    expect(within(summary).getByText('โหน่ง')).toBeInTheDocument();
    expect(within(summary).getByText(/6,000\.00/)).toBeInTheDocument();
    // เคน: 3,000 and nothing paid.
    expect(within(summary).getByText('เคน')).toBeInTheDocument();
    // The unassigned PO belongs to nobody and gets no line of its own.
    expect(within(summary).queryByText('ไม่ระบุ')).not.toBeInTheDocument();
  });

  it('กรองรายการตามพนักงานขาย และนับ "ไม่ระบุ" แยก', async () => {
    const user = userEvent.setup();
    render(<WholesaleList {...listProps} orders={orders} />);

    await user.selectOptions(screen.getByLabelText('กรองตามพนักงานขาย'), 'เคน');
    // The id shows on the row and again in the print sheet, which the same
    // filter feeds — assert on presence, not on a single node.
    expect(screen.getAllByText(/WS-N-0002/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/WS-N-0001/)).toHaveLength(0);

    // ไม่ระบุ is a choice of its own — "which of mine have no seller".
    await user.selectOptions(screen.getByLabelText('กรองตามพนักงานขาย'), 'unassigned');
    expect(screen.getAllByText(/WS-N-0003/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/WS-N-0002/)).toHaveLength(0);
  });

  it('สรุปนับเฉพาะรายการที่แสดงอยู่ ไม่ใช่ทั้งหมด', async () => {
    const user = userEvent.setup();
    render(<WholesaleList {...listProps} orders={orders} />);

    await user.selectOptions(screen.getByLabelText('กรองตามพนักงานขาย'), 'เคน');
    const summary = screen.getByText('สรุปรายพนักงานขาย').closest('div') as HTMLElement;
    // The summary sits above the rows and has to agree with them.
    expect(within(summary).queryByText('โหน่ง')).not.toBeInTheDocument();
    expect(within(summary).getByText('เคน')).toBeInTheDocument();
  });

  it('ไม่แสดงตัวกรองในสาขาที่ไม่ได้บันทึกพนักงานขาย', () => {
    const anon = [
      { ...orders[0], salesBy: '' },
      { ...orders[1], salesBy: '' },
    ].map((o) => o as unknown as WsOrder);
    render(<WholesaleList {...listProps} orders={anon} />);
    // Every PO unassigned means there is nobody to filter BY; the "ไม่ระบุ"
    // choice alone would filter to the whole list.
    expect(screen.queryByText('สรุปรายพนักงานขาย')).not.toBeInTheDocument();
  });
});

/**
 * เช็คลงวันที่ล่วงหน้า และการยืนยันเงินเข้า (migration 0048).
 *
 * The shop is paid mostly by post-dated cheque, so a payment row now spans
 * three days: taken in, dated on its face, and actually cleared. Only the last
 * one is money, and only `wholesale.confirmPayment` may declare it.
 */
describe('WholesaleDetail — การรับเงินแบบเช็ค', () => {
  const chequePayment = {
    amount: 20000,
    method: 'เช็คธนาคารกสิกร',
    date: '2026-09-01',
    uid: 'p-cheque-1',
    status: 'แจ้งแล้ว',
    chequeNo: '0012345',
    chequeBank: 'KBANK',
    chequeDate: '2026-10-15',
    attachments: [],
  };
  const chequeOrder = {
    ...order,
    id: 'WS-N-0101',
    shop: 'north',
    payments: [chequePayment],
  } as unknown as WsOrder;

  it('ยอดที่แจ้งแล้วไม่ถูกนับเป็นชำระแล้ว', () => {
    render(<WholesaleDetail order={chequeOrder} canDo={() => true} />);
    // 10,000 owed and a 20,000 cheque in the drawer: still 10,000 outstanding.
    expect(screen.getByText('แจ้งแล้ว รอยืนยัน')).toBeInTheDocument();
    expect(screen.queryByText('ชำระครบแล้ว')).not.toBeInTheDocument();
  });

  it('ให้กรอกเลขที่เช็ค ธนาคาร และวันที่หน้าเช็ค เมื่อวิธีชำระเป็นเช็ค', () => {
    render(<WholesaleDetail order={chequeOrder} canDo={() => true} />);
    expect(screen.getByLabelText('เลขที่เช็ค')).toHaveValue('0012345');
    expect(screen.getByLabelText('ธนาคารของเช็ค')).toHaveValue('KBANK');
    expect(screen.getByLabelText('วันที่หน้าเช็ค')).toHaveValue('2026-10-15');
  });

  it('ซ่อนปุ่มยืนยันเงินเข้าเมื่อไม่มีสิทธิ์', () => {
    render(
      <WholesaleDetail
        order={chequeOrder}
        caps={{ 'wholesale.confirmPayment': false }}
        onConfirmPayment={async () => ({ ok: true })}
      />,
    );
    expect(screen.queryByText('ยืนยันเงินเข้า')).not.toBeInTheDocument();
  });

  it('ยืนยันเงินเข้าแล้วยอดที่รอยืนยันหายไป', async () => {
    const user = userEvent.setup();
    const onConfirmPayment = vi.fn(async () => ({ ok: true }));
    render(
      <WholesaleDetail
        order={chequeOrder}
        caps={{ 'wholesale.confirmPayment': true }}
        onConfirmPayment={onConfirmPayment}
      />,
    );

    await user.click(screen.getByText('ยืนยันเงินเข้า'));
    await user.clear(screen.getByLabelText('วันที่เงินเข้าจริง'));
    await user.type(screen.getByLabelText('วันที่เงินเข้าจริง'), '2026-10-16');
    await user.click(screen.getByText('ยืนยันว่าเงินเข้าแล้ว'));

    // The date the money landed is the confirmer's to type: a cheque banked on
    // Friday and credited on Monday belongs to Monday.
    expect(onConfirmPayment).toHaveBeenCalledWith('WS-N-0101', 'p-cheque-1', '2026-10-16');
    expect(screen.queryByText('แจ้งแล้ว รอยืนยัน')).not.toBeInTheDocument();
  });

  it('ไม่ให้ยืนยันรายการที่ยังไม่ได้บันทึก', async () => {
    const user = userEvent.setup();
    render(
      <WholesaleDetail
        order={{ ...chequeOrder, payments: [] } as unknown as WsOrder}
        caps={{ 'wholesale.confirmPayment': true }}
        onConfirmPayment={async () => ({ ok: true })}
      />,
    );
    await user.click(screen.getByText(/เพิ่มรายการรับเงิน/));
    // The server cannot confirm a row it has never seen, and the error it would
    // return is not something the user could act on.
    expect(screen.getByText(/บันทึก PO ก่อน/)).toBeInTheDocument();
    expect(screen.queryByText('ยืนยันเงินเข้า')).not.toBeInTheDocument();
  });

  it('ใบเสร็จออกได้ตั้งแต่รับเช็ค และพิมพ์รายละเอียดเช็คไว้บนใบ', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<WholesaleDetail order={chequeOrder} canDo={() => true} />);

    await user.click(screen.getByRole('button', { name: /ใบเสร็จรับเงิน/ }));
    const sheet = document.querySelector('.print-area') as HTMLElement;
    expect(sheet.textContent).toContain('0012345');
    expect(sheet.textContent).toContain('KBANK');
    // Says on its own face that the money has not arrived — a receipt reading
    // only "รับเงินแล้ว 20,000" against a cheque dated next month is read by
    // each side as meaning something different.
    expect(sheet.textContent).toContain('ยังไม่ได้ขึ้นเงิน');
    expect(sheet.textContent).toContain('หนี้จะถูกตัดเมื่อเช็คขึ้นเงิน');
  });
});

/**
 * ลบรายการสินค้า และลบรายการคืน.
 *
 * Neither row could be removed at all: a line typed by mistake stayed on the PO
 * and on every document it printed. The adjustment rows had a bin from the
 * start, so this is filling a gap rather than adding a feature.
 */
describe('WholesaleDetail — ลบรายการ', () => {
  const twoLines = {
    ...order,
    id: 'WS-CM-0101',
    items: [
      { name: 'ฟิล์ม A', qty: 2, listPrice: 1000, requestedPrice: 1000, reason: '' },
      { name: 'ฟิล์ม B', qty: 3, listPrice: 500, requestedPrice: 500, reason: '' },
    ],
    returns: [{ item: 'ฟิล์ม A', qty: 1, reason: 'ของชำรุด', date: '2026-09-10' }],
  } as unknown as WsOrder;

  it('ลบรายการสินค้าออกได้ และยอดรวมลดตาม', async () => {
    const user = userEvent.setup();
    render(<WholesaleDetail order={twoLines} canDo={() => true} />);

    // 2*1,000 + 3*500 = 3,500, less the 1,000 return = 2,500.
    expect(screen.getAllByText(/2,500.00/).length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('ลบรายการสินค้าที่ 1'));
    // ฟิล์ม A is gone, so its return prices at nothing: 1,500 left.
    expect(screen.getAllByText(/1,500.00/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('ลบรายการสินค้าที่ 2')).not.toBeInTheDocument();
  });

  it('ลบรายการคืนสินค้าออกได้', async () => {
    const user = userEvent.setup();
    render(<WholesaleDetail order={twoLines} canDo={() => true} />);

    await user.click(screen.getByLabelText('ลบรายการคืนสินค้าที่ 1'));
    // The return no longer reduces the total: back to the full 3,500.
    expect(screen.getAllByText(/3,500.00/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('ลบรายการคืนสินค้าที่ 1')).not.toBeInTheDocument();
  });
});

/**
 * กำหนดชำระเงิน (migration 0049).
 *
 * ขายส่งส่งของก่อนแล้วเก็บเงินทีหลัง so every PO carries a credit term, and the
 * system recorded it nowhere — the invoice went out saying what was owed and
 * nothing about when, which left the shop chasing on memory.
 */
describe('WholesaleDetail — กำหนดชำระเงิน', () => {
  const dueOrder = {
    ...order,
    id: 'WS-CM-0120',
    dueAt: '2026-10-31',
    deliveredAt: '2026-09-30',
  } as unknown as WsOrder;
  const printed = () => document.querySelector('.print-area')!;

  it('พิมพ์ลงในใบแจ้งหนี้และใบส่งของ', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<WholesaleDetail order={dueOrder} canDo={() => true} />);

    for (const doc of [/ใบแจ้งหนี้/, /ใบส่งของ/]) {
      await user.click(screen.getByRole('button', { name: doc }));
      expect(printed().textContent).toContain('กำหนดชำระเงิน 31 ต.ค. 2569');
    }
  });

  it('ไม่พิมพ์บนใบเสร็จ เพราะจ่ายไปแล้ว', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <WholesaleDetail
        order={
          {
            ...dueOrder,
            payments: [{ amount: 10000, method: 'เงินสด', date: '2026-10-02', attachments: [] }],
          } as unknown as WsOrder
        }
        canDo={() => true}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ใบเสร็จรับเงิน/ }));
    expect(printed().textContent).not.toContain('กำหนดชำระเงิน');
  });

  it('ไม่มีวันที่ตกลงกันไว้ ก็ไม่พิมพ์อะไรเลย', async () => {
    // Inventing one from the delivery date would put a demand on the customer's
    // paperwork that nobody agreed to.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <WholesaleDetail
        order={{ ...dueOrder, dueAt: '' } as unknown as WsOrder}
        canDo={() => true}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ใบแจ้งหนี้/ }));
    expect(printed().textContent).not.toContain('กำหนดชำระเงิน');
  });
});

/**
 * เปิดจากแดชบอร์ดแล้วเห็นเฉพาะรายการที่กดมา.
 *
 * Clicking a counter that says 3 and landing on a list of 40 leaves the reader
 * to find those three by eye — which is the job the counter was supposed to
 * have done for them.
 */
describe('WholesaleList — กรองตามที่กดมาจากแดชบอร์ด', () => {
  const today = todayValue();
  const po = (id: string, status: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      shop: 'cm',
      customerId: 1,
      status,
      createdAt: today,
      items: [{ name: 'ฟิล์ม A', qty: 1, listPrice: 1000, requestedPrice: 1000 }],
      returns: [],
      adjustments: [],
      payments: [],
      ...over,
    }) as unknown as WsOrder;

  const orders = [
    po('WS-CM-0001', 'ค้างชำระ'),
    po('WS-CM-0002', 'ปิดงานแล้ว'),
    // A discount waiting on ผู้บริหาร.
    po('WS-CM-0003', 'รออนุมัติราคา', {
      items: [{ name: 'ฟิล์ม A', qty: 1, listPrice: 1000, requestedPrice: 800 }],
    }),
    // A reduction written after delivery, also waiting.
    po('WS-CM-0004', 'จัดส่งแล้ว', {
      adjustments: [{ amount: 200, reason: 'ต่อรอง', date: today, status: 'รออนุมัติ' }],
    }),
  ];

  const listProps = {
    orders,
    customers: [{ id: 1, name: 'ร้านทดสอบ', phone: '', address: '' }],
    wsStatuses: {},
    accessibleShops: [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }],
    canDo: () => true,
  };

  it('เปิดด้วยสถานะ แสดงเฉพาะสถานะนั้น', () => {
    render(<WholesaleList {...listProps} initialStatus="ค้างชำระ" />);
    expect(screen.getAllByText(/WS-CM-0001/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/WS-CM-0002/)).toHaveLength(0);
  });

  it('เปิดด้วย approval=pending แสดงทั้งส่วนลดและปรับราคาที่รออนุมัติ', () => {
    render(<WholesaleList {...listProps} initialApproval="pending" />);
    // Both kinds reach the same person, so both belong in the same list.
    expect(screen.getAllByText(/WS-CM-0003/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/WS-CM-0004/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/WS-CM-0001/)).toHaveLength(0);
  });

  it('บอกว่ากำลังกรองอยู่ และกดล้างได้', async () => {
    const user = userEvent.setup();
    render(<WholesaleList {...listProps} initialApproval="pending" />);
    const chip = screen.getByText(/กำลังกรอง: รอผู้บริหารอนุมัติ/);
    expect(chip).toBeInTheDocument();

    // A list that silently shows 2 of 4 because of something the previous
    // screen decided is a list the reader cannot trust.
    await user.click(chip);
    expect(screen.getAllByText(/WS-CM-0001/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/กำลังกรอง: รอผู้บริหารอนุมัติ/)).not.toBeInTheDocument();
  });

  it('ไม่ได้กดมาจากแดชบอร์ด ก็แสดงทั้งหมดเหมือนเดิม', () => {
    render(<WholesaleList {...listProps} />);
    for (const id of ['WS-CM-0001', 'WS-CM-0002', 'WS-CM-0003', 'WS-CM-0004']) {
      expect(screen.getAllByText(new RegExp(id)).length).toBeGreaterThan(0);
    }
  });
});
