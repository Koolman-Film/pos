import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';

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
