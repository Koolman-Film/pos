import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AttachmentField } from '@/components/tickets/detail/AttachmentField';

/**
 * The ticket's slips and QC photos are real files now. What this pins down is
 * the part that was broken for the whole trial run: the field must hand its
 * parent STORAGE PATHS, never `File.name` — a filename is what the old code
 * kept, and the save then dropped it on the floor.
 */

const upload = vi.hoisted(() => vi.fn());
const discard = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/attachments')>(
    '@/lib/storage/attachments',
  );
  return { ...actual, uploadAttachments: upload, discardAttachments: discard };
});

beforeEach(() => {
  upload.mockReset();
  discard.mockReset();
});

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('AttachmentField', () => {
  it('uploads the picked file and reports its stored path, not its name', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue([
      { path: 'cm/abc-slip.jpg', fileName: 'สลิป.jpg', mimeType: 'image/jpeg', size: 10 },
    ]);
    const onChange = vi.fn();

    const { container } = render(
      <AttachmentField label="แนบสลิป" paths={[]} onChange={onChange} folder="cm" />,
    );

    await user.upload(container.querySelector('input[type="file"]')!, file('สลิป.jpg'));

    expect(upload).toHaveBeenCalledWith('ticket-attachments', 'cm', [expect.any(File)]);
    expect(onChange).toHaveBeenCalledWith(['cm/abc-slip.jpg']);
  });

  it('shows a stored file by its original name, with the uuid prefix stripped', () => {
    render(
      <AttachmentField
        label="แนบสลิป"
        paths={['cm/3f2504e0-4f89-41d3-9a0c-0305e82c3301-slip.jpg']}
        onChange={vi.fn()}
        folder="cm"
      />,
    );
    expect(screen.getByTitle('ดู slip.jpg')).toBeInTheDocument();
  });

  it('previews through the signed URL the action returns', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(
      <AttachmentField
        label="แนบสลิป"
        paths={['cm/3f2504e0-4f89-41d3-9a0c-0305e82c3301-slip.jpg']}
        onChange={vi.fn()}
        folder="cm"
        urlAction={urlAction}
      />,
    );

    await user.click(screen.getByTitle('ดู slip.jpg'));

    expect(urlAction).toHaveBeenCalledWith('cm/3f2504e0-4f89-41d3-9a0c-0305e82c3301-slip.jpg');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('slip.jpg')).toHaveAttribute(
      'src',
      'https://signed.example/slip.jpg',
    );
  });

  it('deletes the object when a file uploaded in this session is taken off again', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue([
      { path: 'cm/abc-slip.jpg', fileName: 'สลิป.jpg', mimeType: 'image/jpeg', size: 10 },
    ]);
    let paths: string[] = [];
    const onChange = vi.fn((next: string[]) => {
      paths = next;
    });

    const { container, rerender } = render(
      <AttachmentField label="แนบสลิป" paths={paths} onChange={onChange} folder="cm" />,
    );
    await user.upload(container.querySelector('input[type="file"]')!, file('สลิป.jpg'));
    rerender(<AttachmentField label="แนบสลิป" paths={paths} onChange={onChange} folder="cm" />);

    // The chip is named from the PATH — that is all a saved ticket carries.
    await user.click(screen.getByLabelText('เอา abc-slip.jpg ออก'));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(discard).toHaveBeenCalledWith('ticket-attachments', ['cm/abc-slip.jpg']);
  });

  it('leaves a file that arrived with the ticket in storage when it is detached', async () => {
    const user = userEvent.setup();
    render(
      <AttachmentField
        label="แนบสลิป"
        paths={['cm/already-saved.jpg']}
        onChange={vi.fn()}
        folder="cm"
      />,
    );

    await user.click(screen.getByLabelText('เอา already-saved.jpg ออก'));

    // The ticket has not been saved yet — deleting the object here would destroy
    // evidence that is still referenced by the stored row.
    expect(discard).not.toHaveBeenCalled();
  });
});
