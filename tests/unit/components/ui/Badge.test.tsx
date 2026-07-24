import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, getStatus, type StatusConfig } from '@/components/ui/Badge';

const statuses: StatusConfig[] = [
  { key: 'จองแล้ว', short: 'จองแล้ว', bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' },
  { key: 'ค้างชำระ', short: 'ค้างชำระ', bg: '#FBEAEC', text: '#B23A48', dot: '#C24B57' },
];

describe('Badge', () => {
  it('renders the short label and color for a known status', () => {
    render(<Badge status="ค้างชำระ" statuses={statuses} />);
    const el = screen.getByText('ค้างชำระ');
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ background: '#FBEAEC', color: '#B23A48' });
  });

  it('falls back to the first status config for an unknown status key', () => {
    render(<Badge status="ไม่มีจริง" statuses={statuses} />);
    expect(screen.getByText('จองแล้ว')).toBeInTheDocument();
  });
});

describe('getStatus', () => {
  it('returns the matching config', () => {
    expect(getStatus(statuses, 'ค้างชำระ')).toBe(statuses[1]);
  });

  it('falls back to the first entry when the key is unknown', () => {
    expect(getStatus(statuses, 'ไม่มีจริง')).toBe(statuses[0]);
  });

  it('falls back to a neutral grey config when the list is empty', () => {
    expect(getStatus([], 'อะไรก็ได้')).toEqual({
      key: 'อะไรก็ได้',
      short: 'อะไรก็ได้',
      bg: '#F1EDE7',
      text: '#6B5F55',
      dot: '#B5AAA1',
    });
  });
});
