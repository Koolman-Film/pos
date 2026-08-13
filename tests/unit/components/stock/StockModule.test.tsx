import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
      <StockModule stock={atMin} canDo={() => true} canSeeStockPrices={false} />,
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
      />,
    );
    // The pill renders the status label; a keyed map (not a flat object) is what
    // colours it — a flat object would grey it out but still show the text.
    expect(screen.getByText('รออนุมัติ')).toBeInTheDocument();
  });
});

// --- The capability gate. This module 500'd the whole /stock route once because a
// --- Server Component handed it `canDo` as a closure, so both shapes are pinned.

const CAP_KEYS = [
  'stock.addProduct',
  'stock.adjustStock',
  'stock.withdraw',
  'stock.editDelete',
  'stock.export',
] as const;

const allCaps = (value: boolean) =>
  Object.fromEntries(CAP_KEYS.map((k) => [k, value])) as Record<string, boolean>;

describe('StockModule capability gate', () => {
  it('accepts a serialisable caps map, which is what a Server Component must pass', () => {
    render(<StockModule stock={stock} caps={allCaps(true)} canSeeStockPrices={false} />);
    expect(screen.getByRole('button', { name: /เพิ่มสินค้า/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ปรับสต็อก/ })).toBeInTheDocument();
  });

  it('hides every gated control when the caps map denies them', () => {
    render(<StockModule stock={stock} caps={allCaps(false)} canSeeStockPrices={false} />);
    expect(screen.queryByRole('button', { name: /เพิ่มสินค้า/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ปรับสต็อก/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เบิกใช้ภายใน/ })).not.toBeInTheDocument();
  });

  it('denies everything when neither canDo nor caps is supplied', () => {
    // Fail closed: a wiring mistake must hide controls, never expose them.
    render(<StockModule stock={stock} canSeeStockPrices={false} />);
    expect(screen.queryByRole('button', { name: /เพิ่มสินค้า/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เบิกใช้ภายใน/ })).not.toBeInTheDocument();
  });

  it('gates edit and delete per row independently of the other capabilities', () => {
    const { rerender } = render(
      <StockModule
        stock={stock}
        caps={{ ...allCaps(false), 'stock.editDelete': true }}
        accessibleShops={[{ id: 'cm', name: 'เชียงใหม่' }]}
        canSeeStockPrices={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'แก้ไขสินค้า SKU-FLM-3M60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลบสินค้า SKU-FLM-3M60' })).toBeInTheDocument();

    rerender(
      <StockModule
        stock={stock}
        caps={allCaps(false)}
        accessibleShops={[{ id: 'cm', name: 'เชียงใหม่' }]}
        canSeeStockPrices={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'แก้ไขสินค้า SKU-FLM-3M60' }),
    ).not.toBeInTheDocument();
  });

  it('gates the Excel export separately from the rest', () => {
    const { rerender } = render(
      <StockModule
        stock={stock}
        caps={{ ...allCaps(false), 'stock.export': true }}
        canSeeStockPrices={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Excel/ })).toBeInTheDocument();

    rerender(<StockModule stock={stock} caps={allCaps(false)} canSeeStockPrices={false} />);
    expect(screen.queryByRole('button', { name: /Excel/ })).not.toBeInTheDocument();
  });
});

describe('StockModule totals and grouping', () => {
  const twoShops: StockItem[] = [
    { ...stock[0], id: 1, sku: 'A', shop: 'cm', qty: 10, cost: 100, sellPrice: 200 },
    {
      ...stock[0],
      id: 2,
      sku: 'B',
      shop: 'lp',
      qty: 5,
      cost: 100,
      sellPrice: 200,
      category: 'เครื่องเสียง',
    },
  ];

  it('counts every row the user can access, across shops', () => {
    render(
      <StockModule
        stock={twoShops}
        caps={allCaps(true)}
        accessibleShops={[
          { id: 'cm', name: 'เชียงใหม่' },
          { id: 'lp', name: 'ลำพูน' },
        ]}
        canSeeStockPrices={false}
      />,
    );
    const card = screen.getByText('รายการทั้งหมด').closest('div');
    expect(card?.textContent).toContain('2');
  });

  it('groups rows under their product category heading', () => {
    render(
      <StockModule
        stock={twoShops}
        caps={allCaps(true)}
        accessibleShops={[
          { id: 'cm', name: 'เชียงใหม่' },
          { id: 'lp', name: 'ลำพูน' },
        ]}
        canSeeStockPrices={false}
      />,
    );
    // The bare category name also appears in the filter <select>, so match the
    // "name (count)" group-heading form specifically.
    expect(screen.getByText('ฟิล์มกรองแสง (1)')).toBeInTheDocument();
    expect(screen.getByText('เครื่องเสียง (1)')).toBeInTheDocument();
  });

  it('renders an empty module without crashing when there is no stock at all', () => {
    render(<StockModule stock={[]} caps={allCaps(true)} canSeeStockPrices={false} />);
    expect(screen.getByText('สต็อกสินค้า')).toBeInTheDocument();
  });
});

/**
 * "ชนิดสินค้าเป็น จอ แต่ในรายละเอียดไม่มี" from the trial run. Two separate
 * defects met here: the หมวดหมู่ picker offered only the managed list, and its
 * `setOptions` was a bare setState that never reached the database — so a
 * category added in this module was gone on the next load, and a category that
 * arrived by bulk import was never in the list to begin with.
 */
describe('StockModule — ชนิดสินค้า that is not in the managed list', () => {
  const offList: StockItem[] = [
    { ...stock[0], id: 9, sku: 'SCREEN-009', name: 'จอแอนดรอยด์ AF8', category: 'จอ' },
  ];
  const categories = ['ฟิล์มกรองแสง', 'ฟิล์มกันรอย'];

  it('offers a category that products use but the list has not got', async () => {
    const user = userEvent.setup();
    render(
      <StockModule
        stock={offList}
        canDo={() => true}
        canSeeStockPrices={false}
        productCategories={categories}
      />,
    );
    await user.click(screen.getByLabelText('แก้ไขสินค้า SCREEN-009'));

    // The edit form's picker, not the page's category FILTER — that one also
    // lists จอ, but its options carry an "all" entry and its value is 'all'.
    const select = screen.getAllByRole('combobox').find((s) => {
      const opts = Array.from((s as HTMLSelectElement).options).map((o) => o.value);
      return opts.includes('จอ') && !opts.includes('all');
    })!;
    // Selected, not merely present: an unmatched value shows the FIRST option.
    expect((select as HTMLSelectElement).value).toBe('จอ');
  });

  it('persists a new category instead of only holding it in state', async () => {
    const user = userEvent.setup();
    const updateOptionList = vi.fn(async () => ({ ok: true }));
    render(
      <StockModule
        stock={offList}
        canDo={() => true}
        canSeeStockPrices={false}
        productCategories={categories}
        actions={{ updateOptionList }}
      />,
    );
    await user.click(screen.getByLabelText('แก้ไขสินค้า SCREEN-009'));

    const select = screen
      .getAllByRole('combobox')
      .find((s) =>
        Array.from((s as HTMLSelectElement).options).some((o) => o.value === '__add__'),
      )!;
    await user.selectOptions(select, '__add__');
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), 'กล้องติดรถยนต์');
    await user.click(screen.getByRole('button', { name: 'เพิ่ม' }));

    expect(updateOptionList).toHaveBeenCalledWith(
      'product_categories',
      // The write also reconciles the list with what stock already uses, which
      // is how "จอ" stops being orphaned.
      expect.arrayContaining([...categories, 'จอ', 'กล้องติดรถยนต์']),
    );
  });
});
