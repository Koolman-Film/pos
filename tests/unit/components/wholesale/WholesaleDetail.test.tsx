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
    const picker = screen.getByLabelText('สินค้าในรายการ');
    expect(within(picker).getByText(/ฟิล์ม CT 40%/)).toBeInTheDocument();
    expect(within(picker).queryByText(/ฟิล์มกันรอย/)).not.toBeInTheDocument();

    // Switch to the wholesale-only branch: its shelf is what the PO now sells.
    await user.selectOptions(screen.getByLabelText('สาขาที่เปิด PO'), 'north');
    expect(
      within(screen.getByLabelText('สินค้าในรายการ')).getByText(/ฟิล์มกันรอย/),
    ).toBeInTheDocument();
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
    expect((screen.getByLabelText('สินค้าในรายการ') as HTMLSelectElement).value).toBe('');
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
