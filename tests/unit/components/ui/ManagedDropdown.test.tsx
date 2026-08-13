import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { OptionManageProvider } from '@/components/ui/optionManage';

const options = ['เงินสด', 'โอน'];

describe('ManagedDropdown', () => {
  it('calls onChange when an existing option is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ManagedDropdown
        value=""
        onChange={onChange}
        options={options}
        setOptions={vi.fn()}
        placeholder="เลือกช่องทาง..."
      />,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'โอน');
    expect(onChange).toHaveBeenCalledWith('โอน');
  });

  it('renders the placeholder as the disabled empty option', () => {
    render(
      <ManagedDropdown
        value=""
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
        placeholder="เลือกช่องทาง..."
      />,
    );
    expect(screen.getByRole('option', { name: 'เลือกช่องทาง...' })).toBeDisabled();
  });

  it('adding a new value appends it via setOptions and selects it via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedDropdown value="" onChange={onChange} options={options} setOptions={setOptions} />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '__add__');
    const input = screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...');
    await user.type(input, '  บัตรเครดิต  ');
    await user.click(screen.getByRole('button', { name: 'เพิ่ม' }));

    expect(setOptions).toHaveBeenCalledWith(['เงินสด', 'โอน', 'บัตรเครดิต']);
    expect(onChange).toHaveBeenCalledWith('บัตรเครดิต');
  });

  it('Enter confirms the new value and Escape cancels without adding', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    const { rerender } = render(
      <ManagedDropdown value="" onChange={onChange} options={options} setOptions={setOptions} />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '__add__');
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), 'พร้อมเพย์{Enter}');
    expect(setOptions).toHaveBeenCalledWith(['เงินสด', 'โอน', 'พร้อมเพย์']);

    setOptions.mockClear();
    rerender(
      <ManagedDropdown value="" onChange={onChange} options={options} setOptions={setOptions} />,
    );
    await user.selectOptions(screen.getByRole('combobox'), '__add__');
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), 'เช็ค{Escape}');
    expect(setOptions).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('removing the current option drops it from options and clears the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedDropdown value="โอน" onChange={onChange} options={options} setOptions={setOptions} />,
    );

    await user.click(screen.getByRole('button', { name: 'ลบตัวเลือกนี้ออกจากระบบ' }));
    expect(setOptions).toHaveBeenCalledWith(['เงินสด']);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hides the remove button when nothing is selected', () => {
    render(<ManagedDropdown value="" onChange={vi.fn()} options={options} setOptions={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'ลบตัวเลือกนี้ออกจากระบบ' }),
    ).not.toBeInTheDocument();
  });
});

describe('ManagedDropdown — options.manage gate', () => {
  const renderWith = (canManage: boolean) =>
    render(
      <OptionManageProvider canManage={canManage}>
        <ManagedDropdown
          value="เงินสด"
          onChange={vi.fn()}
          options={options}
          setOptions={vi.fn()}
          placeholder="เลือกช่องทาง..."
        />
      </OptionManageProvider>,
    );

  it('offers add and delete to a caller who may manage the list', () => {
    renderWith(true);
    expect(screen.getByText('+ เพิ่มตัวเลือกใหม่...')).toBeInTheDocument();
    expect(screen.getByLabelText('ลบตัวเลือกนี้ออกจากระบบ')).toBeInTheDocument();
  });

  it('hides both from everyone else, while still allowing selection', () => {
    renderWith(false);
    expect(screen.queryByText('+ เพิ่มตัวเลือกใหม่...')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ลบตัวเลือกนี้ออกจากระบบ')).not.toBeInTheDocument();
    // The list itself is untouched — picking an existing value is not gated.
    expect(screen.getByRole('option', { name: 'เงินสด' })).toBeInTheDocument();
  });
});

/**
 * A `<select>` whose `value` matches no `<option>` does not show blank — the
 * browser shows the FIRST option. So a product whose ชนิดสินค้า was "จอ", a
 * category nobody had added to the managed list, opened for editing reading
 * "ฟิล์มกรองแสง". Saving from that screen wrote the wrong category.
 */
describe('ManagedDropdown — a value outside the list', () => {
  it('keeps the saved value selectable and selected', () => {
    render(
      <ManagedDropdown
        value="จอ"
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
        placeholder="เลือกช่องทาง..."
      />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('จอ');
    expect(screen.getByRole('option', { name: 'จอ' })).toBeInTheDocument();
    // The managed entries are still all there.
    for (const o of options) expect(screen.getByRole('option', { name: o })).toBeInTheDocument();
  });

  it('does not duplicate a value that is already in the list', () => {
    render(
      <ManagedDropdown
        value="เงินสด"
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
        placeholder="เลือกช่องทาง..."
      />,
    );
    expect(screen.getAllByRole('option', { name: 'เงินสด' })).toHaveLength(1);
  });
});
