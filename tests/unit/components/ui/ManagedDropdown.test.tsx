import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { OptionManageProvider } from '@/components/ui/optionManage';

/**
 * พิมพ์ค้นหาได้ (ร้านขอ 18 ก.ย. 2569). The lists behind จองผ่าน, ยี่ห้อรถ and
 * หมวดค่าใช้จ่าย are too long to scroll accurately, so the control is a typed
 * picker. What it stores is unchanged: the value IS the label.
 */

const options = ['เงินสด', 'โอน', 'บัตรเครดิต'];

const box = (name = 'เลือกช่องทาง...') => screen.getByRole('combobox', { name });

function renderDropdown(props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const setOptions = vi.fn();
  render(
    <OptionManageProvider canManage>
      <ManagedDropdown
        value=""
        onChange={onChange}
        options={options}
        setOptions={setOptions}
        placeholder="เลือกช่องทาง..."
        {...props}
      />
    </OptionManageProvider>,
  );
  return { onChange, setOptions, user: userEvent.setup() };
}

describe('ManagedDropdown', () => {
  it('picks an option from the list', async () => {
    const { onChange, user } = renderDropdown();
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'โอน' }));
    expect(onChange).toHaveBeenCalledWith('โอน');
  });

  it('narrows the list as the words are typed', async () => {
    const { onChange, user } = renderDropdown();
    await user.type(box(), 'บัตร');
    expect(screen.getByRole('option', { name: 'บัตรเครดิต' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'เงินสด' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('บัตรเครดิต');
  });

  it('says so when nothing matches', async () => {
    const { user } = renderDropdown();
    await user.type(box(), 'ไม่มีอันนี้');
    expect(screen.getByText('ไม่พบตัวเลือกที่ค้นหา')).toBeInTheDocument();
  });

  it('shows the placeholder while nothing is chosen', () => {
    renderDropdown();
    expect(screen.getByPlaceholderText('เลือกช่องทาง...')).toBeInTheDocument();
  });

  it('adding a new value appends it via setOptions and selects it via onChange', async () => {
    const { onChange, setOptions, user } = renderDropdown();

    await user.click(box());
    await user.click(screen.getByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' }));
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), '  พร้อมเพย์  ');
    await user.click(screen.getByRole('button', { name: 'เพิ่ม' }));

    expect(setOptions).toHaveBeenCalledWith([...options, 'พร้อมเพย์']);
    expect(onChange).toHaveBeenCalledWith('พร้อมเพย์');
  });

  it('Enter confirms the new value and Escape cancels without adding', async () => {
    const { setOptions, user } = renderDropdown();

    await user.click(box());
    await user.click(screen.getByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' }));
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), 'พร้อมเพย์{Enter}');
    expect(setOptions).toHaveBeenCalledWith([...options, 'พร้อมเพย์']);

    setOptions.mockClear();
    await user.click(box());
    await user.click(screen.getByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' }));
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), 'เช็ค{Escape}');
    expect(setOptions).not.toHaveBeenCalled();
    expect(box()).toBeInTheDocument();
  });

  it('removing the current option drops it from options and clears the value', async () => {
    const { onChange, setOptions, user } = renderDropdown({ value: 'โอน' });

    await user.click(screen.getByRole('button', { name: 'ลบตัวเลือกนี้ออกจากระบบ' }));
    expect(setOptions).toHaveBeenCalledWith(['เงินสด', 'บัตรเครดิต']);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hides the remove button when nothing is selected', () => {
    renderDropdown();
    expect(
      screen.queryByRole('button', { name: 'ลบตัวเลือกนี้ออกจากระบบ' }),
    ).not.toBeInTheDocument();
  });
});

describe('ManagedDropdown — options.manage gate', () => {
  it('offers nothing to add where nobody said who may manage the list', async () => {
    // No provider: the default is deny, so a picker somebody forgot to wrap
    // cannot be used to extend a shop-wide list.
    render(
      <ManagedDropdown
        value=""
        onChange={vi.fn()}
        options={options}
        setOptions={vi.fn()}
        placeholder="เลือกช่องทาง..."
      />,
    );
    await userEvent.setup().click(box());
    expect(screen.queryByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' })).toBeNull();
  });

  const renderWith = (canManage: boolean) => {
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
    return userEvent.setup();
  };

  it('offers add and delete to a caller who may manage the list', async () => {
    const user = renderWith(true);
    await user.click(box());
    expect(screen.getByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' })).toBeInTheDocument();
    expect(screen.getByLabelText('ลบตัวเลือกนี้ออกจากระบบ')).toBeInTheDocument();
  });

  it('hides both from everyone else, while still allowing selection', async () => {
    const user = renderWith(false);
    await user.click(box());
    expect(
      screen.queryByRole('option', { name: '+ เพิ่มตัวเลือกใหม่...' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ลบตัวเลือกนี้ออกจากระบบ')).not.toBeInTheDocument();
    // The list itself is untouched — picking an existing value is not gated.
    expect(screen.getByRole('option', { name: 'เงินสด' })).toBeInTheDocument();
  });
});

/**
 * A saved value that is no longer in the managed list still belongs in it: a
 * product whose ชนิดสินค้า was "จอ", a category nobody had added, used to open
 * reading the first entry instead — and saving from that screen wrote it.
 */
describe('ManagedDropdown — a value outside the list', () => {
  it('keeps the saved value shown and selectable', async () => {
    const { user } = renderDropdown({ value: 'จอ' });
    expect(box()).toHaveValue('จอ');
    await user.click(box());
    expect(screen.getByRole('option', { name: 'จอ' })).toBeInTheDocument();
    for (const o of options) expect(screen.getByRole('option', { name: o })).toBeInTheDocument();
  });

  it('does not duplicate a value that is already in the list', async () => {
    const { user } = renderDropdown({ value: 'เงินสด' });
    await user.click(box());
    expect(screen.getAllByRole('option', { name: 'เงินสด' })).toHaveLength(1);
  });
});
