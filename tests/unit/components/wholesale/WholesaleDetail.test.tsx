import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';
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
