import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceScheduleList } from '@/components/tickets/detail/ServiceScheduleList';

/**
 * นัดเข้า Service แต่ละครั้ง — ร่างทุก 6 เดือน จนกว่าพนักงานโทรยืนยันกับลูกค้า.
 *
 * On screen it is one visit at a time (ร้านขอ 23 ก.ย. 2569): what has happened,
 * what the customer has already agreed to, and the single visit due next.
 */

function renderList(
  props: { saved?: unknown; recorded?: number[]; start?: string; count?: number } = {},
) {
  const onChange = vi.fn();
  render(
    <ServiceScheduleList
      start={props.start ?? '2026-09-29'}
      count={props.count ?? 3}
      saved={props.saved}
      recordedVisitNos={props.recorded ?? []}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('ServiceScheduleList', () => {
  it('drafts the visit due next, and says how many are left to come', () => {
    renderList();
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 1')).toHaveValue('2026-09-29');
    expect(screen.queryByLabelText('วันนัด Service ครั้งที่ 2')).toBeNull();
    expect(screen.queryByLabelText('วันนัด Service ครั้งที่ 3')).toBeNull();
    expect(screen.getAllByText('ร่าง')).toHaveLength(1);
    // The package as a whole is still readable without the rows.
    expect(screen.getByText(/นัดเข้า Service 3 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/เหลืออีก 2 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/ครบทั้ง 3 ครั้งราวเดือน กันยายน 2570/)).toBeInTheDocument();
  });

  it('waits for a start date with one row, not with the whole package', () => {
    // What the counter opens on a new ใบงาน: a Service ten-pack used to draw ten
    // rows of mm/dd/yyyy, none of which could be filled in yet.
    renderList({ start: '', count: 10 });
    expect(screen.getAllByLabelText(/วันนัด Service ครั้งที่/)).toHaveLength(1);
    expect(screen.getByText(/ใส่วันที่เริ่มเข้า Service ก่อน/)).toBeInTheDocument();
    expect(screen.getByText(/เหลืออีก 9 ครั้ง/)).toBeInTheDocument();
  });

  it('draws the next date only once the visit before it has been recorded', () => {
    renderList({ recorded: [1] });
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 2')).toHaveValue('2027-03-29');
    expect(screen.queryByLabelText('วันนัด Service ครั้งที่ 3')).toBeNull();
    expect(screen.getByText(/เหลืออีก 1 ครั้ง/)).toBeInTheDocument();
  });

  it('says nothing about visits to come when the last one is on screen', () => {
    renderList({ recorded: [1, 2] });
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 3')).toBeInTheDocument();
    expect(screen.queryByText(/เหลืออีก/)).toBeNull();
  });

  it('keeps the day the customer agreed once it is typed in', () => {
    const { onChange } = renderList();
    fireEvent.change(screen.getByLabelText('วันนัด Service ครั้งที่ 1'), {
      target: { value: '2026-10-05' },
    });
    expect(onChange).toHaveBeenCalledWith([
      { no: 1, date: '2026-10-05', confirmed: true },
      { no: 2, date: '2027-03-29', confirmed: false },
      { no: 3, date: '2027-09-29', confirmed: false },
    ]);
  });

  it('confirms a draft as it is when the customer agrees to it', async () => {
    const { onChange } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'ลูกค้ายืนยันวันนัดครั้งที่ 1' }));
    expect(onChange.mock.calls[0][0][0]).toEqual({ no: 1, date: '2026-09-29', confirmed: true });
  });

  it('keeps a date the customer agreed on screen, even though it is not next', async () => {
    const { onChange } = renderList({ saved: [{ no: 2, date: '2027-04-03', confirmed: true }] });
    expect(screen.getByText('ยืนยันแล้ว')).toBeInTheDocument();
    expect(screen.getByLabelText('วันนัด Service ครั้งที่ 2')).toHaveValue('2027-04-03');
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
