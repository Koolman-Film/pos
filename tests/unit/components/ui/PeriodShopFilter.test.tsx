import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';

const shops: Shop[] = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FN ลำพูน' },
];

function setup(overrides: Partial<React.ComponentProps<typeof PeriodShopFilter>> = {}) {
  const props = {
    shopFilter: 'all',
    setShopFilter: vi.fn(),
    period: 'today',
    setPeriod: vi.fn(),
    periodValue: '2026-07',
    setPeriodValue: vi.fn(),
    rangeStart: '2026-07-01',
    setRangeStart: vi.fn(),
    rangeEnd: '2026-07-23',
    setRangeEnd: vi.fn(),
    shopOptions: shops,
    ...overrides,
  };
  const utils = render(<PeriodShopFilter {...props} />);
  return { ...utils, props };
}

const inputOfType = (container: HTMLElement, type: string) =>
  container.querySelectorAll(`input[type="${type}"]`);

describe('PeriodShopFilter', () => {
  // Buttons, not a dropdown: every branch is on screen and one tap away, which
  // is the whole point of the change — switching between two branches used to
  // be three actions and you could not see what else was there.
  it('offers an "all shops" button with the shop count when allowAllShops is true', () => {
    setup();
    expect(screen.getByRole('button', { name: 'ทุกร้าน (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FN ลำพูน' })).toBeInTheDocument();
  });

  it('marks the chosen branch as pressed, so it reads as chosen without colour alone', () => {
    setup({ shopFilter: 'lp' });
    expect(screen.getByRole('button', { name: 'FN ลำพูน' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'ทุกร้าน (2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('omits the "all shops" button when allowAllShops is false', () => {
    setup({ allowAllShops: false, shopFilter: 'cm' });
    expect(screen.queryByRole('button', { name: /ทุกร้าน/ })).not.toBeInTheDocument();
  });

  it('clicking a branch calls setShopFilter with its id', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'FN ลำพูน' }));
    expect(props.setShopFilter).toHaveBeenCalledWith('lp');
  });

  it('clicking a period tab calls setPeriod with that key', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'ช่วงเวลา' }));
    expect(props.setPeriod).toHaveBeenCalledWith('range');
  });

  it('period="month" shows a month input and no date inputs', () => {
    const { container } = setup({ period: 'month' });
    expect(inputOfType(container, 'month')).toHaveLength(1);
    expect(inputOfType(container, 'date')).toHaveLength(0);
  });

  it('period="range" shows two date inputs and no month input', () => {
    const { container } = setup({ period: 'range' });
    expect(inputOfType(container, 'date')).toHaveLength(2);
    expect(inputOfType(container, 'month')).toHaveLength(0);
  });

  it('period="year" shows a Buddhist-era year select and no date/month inputs', () => {
    const { container } = setup({ period: 'year', periodValue: '2568' });
    expect(screen.getByRole('option', { name: '2568' })).toBeInTheDocument();
    expect(inputOfType(container, 'date')).toHaveLength(0);
    expect(inputOfType(container, 'month')).toHaveLength(0);
  });

  it('editing the range inputs calls the matching setters', async () => {
    const user = userEvent.setup();
    const { container, props } = setup({ period: 'range' });
    const [start, end] = Array.from(inputOfType(container, 'date')) as HTMLInputElement[];

    await user.clear(start);
    await user.type(start, '2026-06-01');
    expect(props.setRangeStart).toHaveBeenCalled();

    await user.clear(end);
    await user.type(end, '2026-06-30');
    expect(props.setRangeEnd).toHaveBeenCalled();
  });
});
