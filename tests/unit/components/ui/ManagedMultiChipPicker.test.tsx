import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedMultiChipPicker } from '@/components/ui/ManagedMultiChipPicker';

const options = ['ช่างเอก', 'ช่างบอย', 'ช่างซี'];

describe('ManagedMultiChipPicker', () => {
  it('selecting an unselected option adds it to the values passed to onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ManagedMultiChipPicker
        values={['ช่างเอก']}
        onChange={onChange}
        options={options}
        setOptions={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ช่างซี' }));
    expect(onChange).toHaveBeenCalledWith(['ช่างเอก', 'ช่างซี']);
  });

  it('clicking an already-selected option removes it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ManagedMultiChipPicker
        values={['ช่างเอก', 'ช่างบอย']}
        onChange={onChange}
        options={options}
        setOptions={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ช่างเอก' }));
    expect(onChange).toHaveBeenCalledWith(['ช่างบอย']);
  });

  it('highlights every selected chip', () => {
    render(
      <ManagedMultiChipPicker
        values={['ช่างเอก', 'ช่างซี']}
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'ช่างเอก' })).toHaveStyle({
      background: 'var(--primary)',
    });
    expect(screen.getByRole('button', { name: 'ช่างซี' })).toHaveStyle({
      background: 'var(--primary)',
    });
    expect(screen.getByRole('button', { name: 'ช่างบอย' })).toHaveStyle({
      background: 'var(--paper)',
    });
  });

  it('typing a new value and confirming appends it via setOptions', async () => {
    const user = userEvent.setup();
    const setOptions = vi.fn();
    render(
      <ManagedMultiChipPicker
        values={[]}
        onChange={vi.fn()}
        options={options}
        setOptions={setOptions}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'เพิ่มตัวเลือกใหม่' }));
    await user.type(screen.getByPlaceholderText('ตัวเลือกใหม่'), '  ช่างดี  {Enter}');

    expect(setOptions).toHaveBeenCalledWith([...options, 'ช่างดี']);
  });

  it('manage mode deletes an option and drops it from the selected values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <ManagedMultiChipPicker
        values={['ช่างเอก', 'ช่างบอย']}
        onChange={onChange}
        options={options}
        setOptions={setOptions}
      />,
    );

    expect(screen.queryByRole('button', { name: 'ลบ ช่างบอย' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'จัดการตัวเลือก' }));
    await user.click(screen.getByRole('button', { name: 'ลบ ช่างบอย' }));

    expect(setOptions).toHaveBeenCalledWith(['ช่างเอก', 'ช่างซี']);
    expect(onChange).toHaveBeenCalledWith(['ช่างเอก']);
  });
});
