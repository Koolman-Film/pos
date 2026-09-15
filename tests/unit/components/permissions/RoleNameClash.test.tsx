import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PermissionsModule } from '@/components/permissions/PermissionsModule';

/**
 * บทบาทชื่อซ้ำ.
 *
 * Only the role whose id is `admin` holds every permission. A custom role named
 * "แอดมิน/หลังบ้าน" used to look identical to it in the user dropdown, so two
 * people shown with the same role could not do the same things — a GM could not
 * ปลดล็อกใบงาน. The real one is marked and the look-alike is called out.
 */

const roles = [
  { id: 'admin', name: 'แอดมิน/หลังบ้าน', icon: 'fa-gear' },
  { id: 'role_1757000000000', name: 'แอดมิน/หลังบ้าน', icon: 'fa-user' },
  { id: 'sales', name: 'พนักงานขาย', icon: 'fa-user-tie' },
];

describe('PermissionsModule — บทบาทชื่อซ้ำ', () => {
  it('tells the real admin role apart from a role with the same name in the dropdown', () => {
    render(<PermissionsModule roles={roles} />);
    const dropdown = screen.getByLabelText('บทบาทของผู้ใช้ใหม่');
    const labels = Array.from(dropdown.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('แอดมิน/หลังบ้าน (สิทธิ์เต็ม)');
    expect(labels).toContain('แอดมิน/หลังบ้าน (บทบาทเพิ่มเอง — สิทธิ์ไม่เท่าแอดมิน)');
    expect(labels).toContain('พนักงานขาย');
  });

  it('flags the look-alike in the roles list, and only it', () => {
    render(<PermissionsModule roles={roles} />);
    expect(screen.getAllByText('ชื่อซ้ำ — ไม่ใช่บทบาทแอดมิน')).toHaveLength(1);
  });

  it('says nothing when every role name is different', () => {
    render(<PermissionsModule roles={[roles[0], roles[2]]} />);
    expect(screen.queryByText('ชื่อซ้ำ — ไม่ใช่บทบาทแอดมิน')).not.toBeInTheDocument();
  });
});
