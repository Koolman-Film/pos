import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProductPicker, productDisplay } from '@/components/ui/ProductPicker';

const OPTIONS = [
  { id: 1, name: '(ตรฟ.) ฟิล์มกรองแสง 3M Ceramate 40%', shortName: '(ตรฟ.) ฟิล์ม 3M CRM 35' },
  { id: 2, name: '(ตรฟ.) ฟิล์มกรองแสง 3M ULTRACLEAR IRIS 60%', shortName: '(ตรฟ.) ฟิล์ม 3M IR 15' },
  { id: 3, name: 'ฟิล์มกันรอย XPEL Ultimate Plus' },
];

describe('productDisplay', () => {
  it('puts the short name first, and falls back to the name alone', () => {
    expect(productDisplay(OPTIONS[0])).toBe(
      '(ตรฟ.) ฟิล์ม 3M CRM 35 · (ตรฟ.) ฟิล์มกรองแสง 3M Ceramate 40%',
    );
    expect(productDisplay(OPTIONS[2])).toBe('ฟิล์มกันรอย XPEL Ultimate Plus');
  });
});

describe('ProductPicker', () => {
  it('shows the selected product short-name-first', () => {
    render(<ProductPicker value={OPTIONS[0].name} onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('combobox')).toHaveValue(productDisplay(OPTIONS[0]));
  });

  it('filters by short name and reports the full product name on select', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProductPicker value="" onChange={onChange} options={OPTIONS} />);

    await user.type(screen.getByRole('combobox'), 'IR 15');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);

    await user.click(options[0]);
    expect(onChange).toHaveBeenCalledWith(OPTIONS[1].name);
  });

  it('filters by a fragment of the full name too', async () => {
    const user = userEvent.setup();
    render(<ProductPicker value="" onChange={vi.fn()} options={OPTIONS} />);

    await user.type(screen.getByRole('combobox'), 'XPEL');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('XPEL Ultimate Plus');
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ProductPicker value="" onChange={vi.fn()} options={OPTIONS} />);

    await user.type(screen.getByRole('combobox'), 'ไม่มีสินค้านี้');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/ไม่พบสินค้าที่ตรงกับ/)).toBeInTheDocument();
  });

  it('offers a clear row when the field is optional', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ProductPicker
        value={OPTIONS[0].name}
        onChange={onChange}
        options={OPTIONS}
        emptyLabel="ไม่ระบุ"
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'ไม่ระบุ' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('keeps showing a stored product that is no longer in the option list', () => {
    render(<ProductPicker value="สินค้าที่เลิกขายแล้ว" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('combobox')).toHaveValue('สินค้าที่เลิกขายแล้ว');
  });
});
