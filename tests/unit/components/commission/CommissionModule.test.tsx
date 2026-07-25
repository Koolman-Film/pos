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
