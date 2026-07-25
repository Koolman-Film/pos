import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedChipPicker } from '@/components/ui/ManagedChipPicker';

const options = ['เก๋งเล็ก', 'เก๋งใหญ่', 'กระบะ'];

describe('ManagedChipPicker', () => {
  it('selecting an existing option calls onChange with that value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ManagedChipPicker value="" onChange={onChange} options={options} setOptions={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'กระบะ' }));
    expect(onChange).toHaveBeenCalledWith('กระบะ');
  });

  it('highlights the selected chip with the primary colour', () => {
    render(
      <ManagedChipPicker
        value="เก๋งใหญ่"
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'เก๋งใหญ่' })).toHaveStyle({
      background: 'var(--primary)',
    });
    expect(screen.getByRole('button', { name: 'กระบะ' })).toHaveStyle({
      background: 'var(--paper)',
    });
  });

  it('typing a new value and confirming calls setOptions with it appended and onChange with it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedChipPicker value="" onChange={onChange} options={options} setOptions={setOptions} />,
    );

    await user.click(screen.getByRole('button', { name: 'เพิ่มตัวเลือกใหม่' }));
    await user.type(screen.getByPlaceholderText('ตัวเลือกใหม่'), '  รถตู้  ');
    await user.click(screen.getByRole('button', { name: 'ยืนยันเพิ่มตัวเลือก' }));

    expect(setOptions).toHaveBeenCalledWith([...options, 'รถตู้']);
    expect(onChange).toHaveBeenCalledWith('รถตู้');
  });

  it('does not add a duplicate option but still selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedChipPicker value="" onChange={onChange} options={options} setOptions={setOptions} />,
    );

    await user.click(screen.getByRole('button', { name: 'เพิ่มตัวเลือกใหม่' }));
    await user.type(screen.getByPlaceholderText('ตัวเลือกใหม่'), 'กระบะ{Enter}');

    expect(setOptions).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('กระบะ');
  });

  it('manage mode reveals per-chip delete buttons that remove the option and clear a matching value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedChipPicker
        value="กระบะ"
        onChange={onChange}
        options={options}
        setOptions={setOptions}
      />,
    );

    expect(screen.queryByRole('button', { name: 'ลบ กระบะ' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'จัดการตัวเลือก' }));
    await user.click(screen.getByRole('button', { name: 'ลบ กระบะ' }));

    expect(setOptions).toHaveBeenCalledWith(['เก๋งเล็ก', 'เก๋งใหญ่']);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
