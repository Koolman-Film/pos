import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CommissionModule } from '@/components/commission/CommissionModule';

const rules = [
  {
    id: 1,
    category: 'ค่าคอมพนักงาน',
    name: 'ค่าคอมขายรวม 3%',
    type: 'percent_of_sale',
    value: 3,
    shop: 'cm',
    team: ['กมล'],
    active: true,
  },
];

describe('CommissionModule', () => {
  it('hides the add-rule button when canDo("commission.addRule") is false', () => {
    render(<CommissionModule rules={rules} canDo={() => false} />);
    expect(screen.queryByText('เพิ่มกฎใหม่')).not.toBeInTheDocument();
  });
  it("renders an existing rule's name and team members", () => {
    render(<CommissionModule rules={rules} canDo={() => true} />);
    expect(screen.getByText('ค่าคอมขายรวม 3%')).toBeInTheDocument();
    expect(screen.getByText('กมล')).toBeInTheDocument();
  });
});

describe('CommissionModule rule formatting', () => {
  const rule = (over: Partial<(typeof rules)[number]>) => [{ ...rules[0], ...over }];

  it('describes a percentage rule as a share of sales', () => {
    render(
      <CommissionModule rules={rule({ type: 'percent_of_sale', value: 3 })} canDo={() => true} />,
    );
    expect(screen.getByText(/3% ของยอดขาย/)).toBeInTheDocument();
  });

  it('describes a fixed rule as baht per job, formatted through fmt()', () => {
    render(
      <CommissionModule rules={rule({ type: 'fixed_per_job', value: 1500 })} canDo={() => true} />,
    );
    expect(screen.getByText(/1,500\.00 บาท\/งาน/)).toBeInTheDocument();
  });

  it('states how many people the rule is split between', () => {
    render(<CommissionModule rules={rule({ team: ['กมล', 'สมชาย', 'บอย'] })} canDo={() => true} />);
    expect(screen.getByText(/หาร 3 คนเท่าๆ กัน/)).toBeInTheDocument();
  });

  it('handles a rule with nobody assigned without dividing by a phantom team', () => {
    render(<CommissionModule rules={rule({ team: [] })} canDo={() => true} />);
    expect(screen.getByText(/หาร 0 คนเท่าๆ กัน/)).toBeInTheDocument();
  });

  it('shows the active/paused state as a pill', () => {
    const { rerender } = render(
      <CommissionModule rules={rule({ active: true })} canDo={() => true} />,
    );
    expect(screen.getByText('ใช้งานอยู่')).toBeInTheDocument();

    rerender(<CommissionModule rules={rule({ active: false })} canDo={() => true} />);
    expect(screen.getByText('ปิดใช้งาน')).toBeInTheDocument();
  });

  it('renders every team member as its own chip', () => {
    render(<CommissionModule rules={rule({ team: ['กมล', 'สมชาย'] })} canDo={() => true} />);
    expect(screen.getByText('กมล')).toBeInTheDocument();
    expect(screen.getByText('สมชาย')).toBeInTheDocument();
  });

  it('renders with no rules at all', () => {
    render(<CommissionModule rules={[]} canDo={() => true} />);
    expect(screen.getByText(/ค่าคอมมิชชั่น/)).toBeInTheDocument();
  });

  it('denies the add-rule button by default when no capability source is given', () => {
    render(<CommissionModule rules={rules} />);
    expect(screen.queryByText('เพิ่มกฎใหม่')).not.toBeInTheDocument();
  });
});
