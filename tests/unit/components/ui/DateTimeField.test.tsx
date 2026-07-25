import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTimeField } from '@/components/ui/DateTimeField';

const timeSlots = ['09:00', '13:00', '16:30'];

const dateInput = (container: HTMLElement) =>
  container.querySelector('input[type="date"]') as HTMLInputElement;

describe('DateTimeField', () => {
  it('renders the local date and time of the supplied value', () => {
    render(
      <DateTimeField
        value={new Date(2026, 6, 23, 13, 0)}
        onChange={vi.fn()}
        timeSlots={timeSlots}
        setTimeSlots={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('2026-07-23')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('13:00');
  });

  it('changing the date part preserves the time of day', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateTimeField
        value={new Date(2026, 6, 23, 13, 0)}
        onChange={onChange}
        timeSlots={timeSlots}
        setTimeSlots={vi.fn()}
      />,
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
    render(
      <DateTimeField
        value={new Date(2026, 6, 23, 13, 0)}
        onChange={onChange}
        timeSlots={timeSlots}
        setTimeSlots={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '16:30');

    const next = onChange.mock.calls.at(-1)![0] as Date;
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(6);
    expect(next.getDate()).toBe(23);
    expect(next.getHours()).toBe(16);
    expect(next.getMinutes()).toBe(30);
  });

  it('keeps the local calendar day for an early-morning time (no UTC drift)', () => {
    render(
      <DateTimeField
        value={new Date(2026, 6, 23, 2, 0)}
        onChange={vi.fn()}
        timeSlots={timeSlots}
        setTimeSlots={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('2026-07-23')).toBeInTheDocument();
  });

  it('adding a new time slot forwards it to setTimeSlots and selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setTimeSlots = vi.fn();
    render(
      <DateTimeField
        value={new Date(2026, 6, 23, 13, 0)}
        onChange={onChange}
        timeSlots={timeSlots}
        setTimeSlots={setTimeSlots}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '__add__');
    await user.type(screen.getByPlaceholderText('พิมพ์ตัวเลือกใหม่...'), '18:00{Enter}');

    expect(setTimeSlots).toHaveBeenCalledWith(['09:00', '13:00', '16:30', '18:00']);
    const next = onChange.mock.calls.at(-1)![0] as Date;
    expect(next.getHours()).toBe(18);
    expect(next.getDate()).toBe(23);
  });
});
