import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ExtrasSection } from '@/components/tickets/detail/ExtrasSection';
import type { Ticket } from '@/components/tickets/types';
import { OptionManageProvider } from '@/components/ui/optionManage';

/**
 * บริการเสริม — "+ เพิ่มตัวเลือกใหม่" is for แอดมิน only.
 *
 * The list is shared by every branch, and the button sat under every ticket for
 * everyone, so staff added one-off entries nobody needed. The server already
 * refused them (`updateOptionListAction` checks `options.manage`); now the
 * button is not offered either.
 */

const ticket = { id: 'JT-CM-00001', shop: 'cm', items: [], extras: {} } as unknown as Ticket;

function renderAs(canManage: boolean) {
  render(
    <OptionManageProvider canManage={canManage}>
      <ExtrasSection
        t={ticket}
        extraOptions={['รถสไลด์', 'นอกสถานที่']}
        setExtraOptions={vi.fn()}
        slideTypes={[]}
        stock={[]}
        toggleExtra={vi.fn()}
        updateExtraDetail={vi.fn()}
        setSlideType={vi.fn()}
        updateSlideLeg={vi.fn()}
        shareLink={vi.fn()}
      />
    </OptionManageProvider>,
  );
  // The extras list sits behind "ข้อมูลเพิ่มเติม"; open it when it is folded.
  const toggle = screen.queryByRole('button', { name: /ข้อมูลเพิ่มเติม/ });
  if (toggle && !screen.queryByText('รถสไลด์')) toggle.click();
}

describe('ExtrasSection — เพิ่มตัวเลือกใหม่', () => {
  it('offers the button to someone who manages option lists', async () => {
    renderAs(true);
    expect(await screen.findByRole('button', { name: /เพิ่มตัวเลือกใหม่/ })).toBeInTheDocument();
  });

  it('hides it from everyone else, while the options stay selectable', async () => {
    renderAs(false);
    expect(await screen.findByText('รถสไลด์')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เพิ่มตัวเลือกใหม่/ })).not.toBeInTheDocument();
  });
});
