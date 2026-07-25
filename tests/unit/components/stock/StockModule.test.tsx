import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StockModule, type StockItem } from '@/components/stock/StockModule';

const stock: StockItem[] = [
  {
    id: 1,
    sku: 'SKU-FLM-3M60',
    name: 'ฟิล์ม 3M CRM 60%',
    category: 'ฟิล์มกรองแสง',
    shop: 'cm',
    qty: 15,
    min: 10,
    cost: 850,
    sellPrice: 1700,
  },
];

describe('StockModule', () => {
  it('hides cost/sellPrice when seeStockPrices is false', () => {
    render(<StockModule stock={stock} canDo={() => true} canSeeStockPrices={false} />);
    expect(screen.queryByText('850.00')).not.toBeInTheDocument();
  });

  it('shows cost/sellPrice when seeStockPrices is true', () => {
    render(<StockModule stock={stock} canDo={() => true} canSeeStockPrices={true} />);
    expect(screen.getByText(/850\.00/)).toBeInTheDocument();
  });

  it('hides the total-stock-value card when prices are not visible', () => {
    render(<StockModule stock={stock} canDo={() => true} canSeeStockPrices={false} />);
    expect(screen.queryByText('มูลค่าสต็อกรวม')).not.toBeInTheDocument();
  });

  it('uses a strict qty < min for low stock, matching the prototype (C11)', () => {
    // qty === min is NOT low (boundary excluded); qty < min IS low. The
    // prototype is the source of truth over the plan's "<=" wording.
    const atMin: StockItem[] = [{ ...stock[0], qty: 10, min: 10 }];
    const { rerender } = render(
      <StockModule stock={atMin} canDo={() => true} canSeeStockPrices={false} />
    );
    let card = screen.getByText('ใกล้หมด').closest('div');
    expect(card?.textContent).toContain('0'); // at min → not low

    const belowMin: StockItem[] = [{ ...stock[0], qty: 9, min: 10 }];
    rerender(<StockModule stock={belowMin} canDo={() => true} canSeeStockPrices={false} />);
    card = screen.getByText('ใกล้หมด').closest('div');
    expect(card?.textContent).toContain('1'); // below min → low
  });

  it('renders the withdrawal status pill with its Thai label (C1 keyed colour map)', () => {
    render(
      <StockModule
        stock={stock}
        withdrawals={[
          {
            id: 5,
            item: 'ฟิล์ม 3M CRM 60%',
            shop: 'cm',
            qty: 2,
            type: 'สินค้าตัวอย่าง',
            by: 'คุณเอ',
            date: '1 ก.ค. 2569',
            status: 'รออนุมัติ',
          },
        ]}
        accessibleShops={[{ id: 'cm', name: 'เชียงใหม่' }]}
        canDo={() => true}
        canSeeStockPrices={false}
      />
    );
    // The pill renders the status label; a keyed map (not a flat object) is what
    // colours it — a flat object would grey it out but still show the text.
    expect(screen.getByText('รออนุมัติ')).toBeInTheDocument();
  });
});
