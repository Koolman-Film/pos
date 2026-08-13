import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemsSection } from '@/components/tickets/detail/ItemsSection';
import type { StockRow, Ticket } from '@/components/tickets/types';

/**
 * The product pickers must offer every product in the category, not only the
 * ones the ticket's own branch stocks.
 *
 * The original rule filtered to `s.shop === t.shop` and fell back to the full
 * list only when the branch stocked nothing at all in that category — so a
 * product another branch carries was simply missing from the dropdown, which is
 * how the trial run hit "สินค้าบางชนิดไม่แสดงให้เลือก".
 */

const stock: StockRow[] = [
  {
    id: 1,
    name: 'ฟิล์ม 3M CRM 60%',
    shortName: '3M60',
    category: 'ฟิล์มกรองแสง',
    shop: 'cm',
    qty: 15,
    cost: 0,
    sellPrice: 1700,
  },
  {
    id: 2,
    name: 'ฟิล์ม FINNIX CT 40%',
    shortName: 'FNCT40',
    category: 'ฟิล์มกรองแสง',
    shop: 'lp',
    qty: 18,
    cost: 0,
    sellPrice: 1300,
  },
  {
    id: 3,
    name: 'ลำโพงคู่ JBL Stage',
    shortName: 'JBL',
    category: 'เครื่องเสียง',
    shop: 'cm',
    qty: 6,
    cost: 0,
    sellPrice: 5000,
  },
];

/** A ticket at เชียงใหม่ carrying one เครื่องเสียง line (no positions). */
const ticket = {
  id: 'JT-CM-00001',
  shop: 'cm',
  items: [
    {
      category: 'เครื่องเสียง',
      booked: '',
      bookedPrice: 0,
      sold: '',
      soldPrice: 0,
      positions: [],
    },
  ],
} as unknown as Ticket;

/** Film is picked per position, so the item needs one for a picker to exist. */
const filmTicket = {
  ...ticket,
  items: [
    {
      category: 'ฟิล์มกรองแสง',
      booked: '',
      bookedPrice: 0,
      sold: '',
      soldPrice: 0,
      positions: [{ position: 'บานหน้า', product: '', price: 0 }],
    },
  ],
} as unknown as Ticket;

function renderItems(t: Ticket) {
  return render(
    <ItemsSection
      t={t}
      stock={stock}
      productCategories={['ฟิล์มกรองแสง', 'เครื่องเสียง']}
      filmPositions={['บานหน้า']}
      setFilmPositions={vi.fn()}
      wrapPositions={['เต็มคัน']}
      setWrapPositions={vi.fn()}
      serviceItems={[]}
      setServiceItems={vi.fn()}
      addItem={vi.fn()}
      removeItem={vi.fn()}
      updateItem={vi.fn()}
      updateItemFields={vi.fn()}
      updateFilmPositions={vi.fn()}
      lookupPrice={(_p, fallback) => fallback}
      lookupFilmPrice={(_c, _p, _pos, fallback) => fallback}
      commitPrice={vi.fn()}
    />,
  );
}

describe('ItemsSection product options', () => {
  it("lists the branch's own stock with its remaining count", async () => {
    const user = userEvent.setup();
    renderItems(ticket);

    await user.click(screen.getByRole('combobox', { name: 'สินค้าที่ขายจริง' }));

    const option = screen.getByRole('option', { name: /JBL/ });
    expect(option).toHaveTextContent('ลำโพงคู่ JBL Stage');
    expect(option).toHaveTextContent('คงเหลือ 6');
  });

  it('still offers a product only another branch stocks, marked as such', async () => {
    const user = userEvent.setup();
    renderItems(filmTicket);

    await user.click(screen.getByRole('combobox', { name: 'สินค้าประจำตำแหน่ง บานหน้า' }));

    // เชียงใหม่ stocks 3M60; FNCT40 exists only at ลำพูน and must still be pickable.
    const own = screen.getByRole('option', { name: /3M60/ });
    expect(own).toHaveTextContent('คงเหลือ 15');

    const other = screen.getByRole('option', { name: /FNCT40/ });
    expect(other).toHaveTextContent('ไม่มีในสาขานี้');
  });

  it('keeps the branch stock at the top of the list', async () => {
    const user = userEvent.setup();
    renderItems(filmTicket);

    await user.click(screen.getByRole('combobox', { name: 'สินค้าประจำตำแหน่ง บานหน้า' }));

    // The category <select> contributes options too, so scope to the picker's
    // own listbox.
    const labels = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels[0]).toContain('3M60');
    expect(labels[1]).toContain('FNCT40');
  });
});

/**
 * Same defect the stock module had. A `<select>` whose value matches no option
 * renders the FIRST one, so an older ticket carrying a ชนิดสินค้า that has since
 * left the managed list read as whatever happens to sit at the top — while the
 * per-category notes, the technician block and the printed sheets all still
 * keyed off the real value.
 */
describe('ItemsSection — a ชนิดสินค้า outside the managed list', () => {
  const withCategory = (category: string) =>
    ({
      ...ticket,
      items: [{ category, booked: '', bookedPrice: 0, sold: '', soldPrice: 0, positions: [] }],
    }) as unknown as Ticket;

  it('keeps the item’s own category selected and selectable', () => {
    // `renderItems` supplies productCategories = [ฟิล์มกรองแสง, เครื่องเสียง].
    renderItems(withCategory('จอ'));

    const select = screen.getByLabelText('ชนิดสินค้า') as HTMLSelectElement;
    expect(select.value).toBe('จอ');
    expect(screen.getByRole('option', { name: 'จอ' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ฟิล์มกรองแสง' })).toBeInTheDocument();
  });

  it('does not duplicate a category that is in the list', () => {
    renderItems(withCategory('ฟิล์มกรองแสง'));
    expect(screen.getAllByRole('option', { name: 'ฟิล์มกรองแสง' })).toHaveLength(1);
  });
});
