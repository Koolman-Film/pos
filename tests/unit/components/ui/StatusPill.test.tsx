import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/ui/StatusPill';

describe('StatusPill', () => {
  it('renders the label with a flat colorMap applied as inline styles', () => {
    render(<StatusPill label="จ่ายแล้ว" colorMap={{ bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' }} />);
    const el = screen.getByText('จ่ายแล้ว');
    expect(el).toHaveStyle({ background: '#E6EFDC', color: '#4C7A3E' });
  });

  it('looks the label up in a keyed colorMap (the prototype call-site shape)', () => {
    render(
      <StatusPill
        label="รอจ่าย"
        colorMap={{
          'จ่ายแล้ว': { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' },
          'รอจ่าย': { bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
        }}
      />,
    );
    const el = screen.getByText('รอจ่าย');
    expect(el).toHaveStyle({ background: '#FBF1DA', color: '#8A5A12' });
  });

  it('falls back to the neutral grey palette for an unmapped label', () => {
    render(
      <StatusPill label="ไม่รู้จัก" colorMap={{ 'จ่ายแล้ว': { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' } }} />,
    );
    expect(screen.getByText('ไม่รู้จัก')).toHaveStyle({ background: '#F1EDE7', color: '#6B5F55' });
  });
});
