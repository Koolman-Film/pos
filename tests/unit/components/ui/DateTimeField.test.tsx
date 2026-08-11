import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTimeField } from '@/components/ui/DateTimeField';

const dateInput = (container: HTMLElement) =>
  container.querySelector('input[type="date"]') as HTMLInputElement;

describe('DateTimeField', () => {
  it('renders the local date and time of the supplied value', () => {
    render(<DateTimeField value={new Date(2026, 6, 23, 13, 0)} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('2026-07-23')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('13:00');
  });

  it('changing the date part preserves the time of day', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateTimeField value={new Date(2026, 6, 23, 13, 0)} onChange={onChange} />,
    );

    fireEvent.change(dateInput(container), { target: { value: '2026-08-01' } });

    const next = onChange.mock.calls.at(-1)![0] as Date;
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(13);
    expect(next.getMinutes()).toBe(0);
  });

  it('changing the time part preserves the date', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimeField value={new Date(2026, 6, 23, 13, 0)} onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox'), '16:00');

    const next = onChange.mock.calls.at(-1)![0] as Date;
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(6);
    expect(next.getDate()).toBe(23);
    expect(next.getHours()).toBe(16);
    expect(next.getMinutes()).toBe(0);
  });

  it('keeps the local calendar day for an early-morning time (no UTC drift)', () => {
    render(<DateTimeField value={new Date(2026, 6, 23, 2, 0)} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('2026-07-23')).toBeInTheDocument();
  });

  it('offers only the fixed 09:00–18:00 slots, in order, with no way to add one', () => {
    render(<DateTimeField value={new Date(2026, 6, 23, 13, 0)} onChange={vi.fn()} />);

    const times = Array.from(screen.getByRole('combobox').querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);

    expect(times).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
    ]);
    expect(screen.queryByText('+ เพิ่มตัวเลือกใหม่...')).not.toBeInTheDocument();
  });

  it('still shows a saved time from outside the window, in its sorted position', () => {
    render(<DateTimeField value={new Date(2026, 6, 23, 8, 0)} onChange={vi.fn()} />);

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('08:00');
    const times = Array.from(select.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(times[0]).toBe('08:00');
    expect(times).toHaveLength(11);
  });
});
