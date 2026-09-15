import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceScheduleList } from '@/components/tickets/detail/ServiceScheduleList';

/**
 * นัดเข้า Service แต่ละครั้ง — ร่างทุก 6 เดือน จนกว่าพนักงานโทรยืนยันกับลูกค้า.
 */

function renderList(props: { saved?: unknown; recorded?: number[] } = {}) {
  const onChange = vi.fn();
  render(
    <ServiceScheduleList
      start="2026-09-29"
      count={3}
      saved={props.saved}
      recordedVisitNos={props.recorded ?? []}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('ServiceScheduleList', () => {
  it('drafts one date per visit sold, every 6 months', () => {
    renderList();
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 1')).toHaveValue('2026-09-29');
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 2')).toHaveValue('2027-03-29');
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 3')).toHaveValue('2027-09-29');
    expect(screen.getAllByText('ร่าง')).toHaveLength(3);
  });

  it('keeps the day the customer agreed once it is typed in', () => {
    const { onChange } = renderList();
    fireEvent.change(screen.getByLabelText('วันนัด Service ครั้งที่ 2'), {
      target: { value: '2027-04-03' },
    });
    expect(onChange).toHaveBeenCalledWith([
      { no: 1, date: '2026-09-29', confirmed: false },
      { no: 2, date: '2027-04-03', confirmed: true },
      { no: 3, date: '2027-09-29', confirmed: false },
    ]);
  });

  it('confirms a draft as it is when the customer agrees to it', async () => {
    const { onChange } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'ลูกค้ายืนยันวันนัดครั้งที่ 3' }));
    expect(onChange.mock.calls[0][0][2]).toEqual({ no: 3, date: '2027-09-29', confirmed: true });
  });

  it('shows a confirmed date as such, and can put it back to the draft', async () => {
    const { onChange } = renderList({ saved: [{ no: 2, date: '2027-04-03', confirmed: true }] });
    expect(screen.getByText('ยืนยันแล้ว')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'กลับเป็นร่าง ครั้งที่ 2' }));
    expect(onChange.mock.calls[0][0][1]).toEqual({ no: 2, date: '2027-04-03', confirmed: false });
  });

  it('marks the visits the car has already made', () => {
    renderList({ recorded: [1] });
    expect(screen.getByText('เข้าแล้ว')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'ลูกค้ายืนยันวันนัดครั้งที่ 1' }),
    ).not.toBeInTheDocument();
  });
});
