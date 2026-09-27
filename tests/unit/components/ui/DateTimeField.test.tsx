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

/*
  Read and written on the SHOP's clock, not the process's.

  The day and time used to come from the Date's local getters, i.e. whatever
  zone the code ran in. The page renders twice — on Vercel (UTC) and in the
  browser (Bangkok) — so a delivery at 00:30 Bangkok read the 28th in the server
  HTML and the 29th in the browser: React threw a hydration error on the ticket
  page and discarded the server's render. The e2e run catches that directly
  (UTC server, Bangkok browser); these pin the conversion itself.
*/
describe('DateTimeField — shop clock', () => {
  // 00:30 on 29 Sep in Bangkok — still 28 Sep in UTC.
  const justAfterMidnight = new Date('2026-09-28T17:30:00Z');

  it('shows the Bangkok day and time', () => {
    render(<DateTimeField value={justAfterMidnight} onChange={() => {}} label="วันที่ส่งงาน" />);
    expect(screen.getByLabelText('วันที่ส่งงาน — วันที่')).toHaveValue('2026-09-29');
    expect(screen.getByText('29 ก.ย. 2569')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('00:30');
  });

  it('writes a changed day back as that day in Bangkok, keeping the time', () => {
    const onChange = vi.fn();
    render(<DateTimeField value={justAfterMidnight} onChange={onChange} label="วันที่ส่งงาน" />);
    fireEvent.change(screen.getByLabelText('วันที่ส่งงาน — วันที่'), {
      target: { value: '2026-10-01' },
    });
    expect((onChange.mock.calls[0][0] as Date).toISOString()).toBe('2026-09-30T17:30:00.000Z');
  });
});
