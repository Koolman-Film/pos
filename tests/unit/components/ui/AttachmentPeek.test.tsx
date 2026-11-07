import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AttachmentLinks } from '@/components/ui/AttachmentLinks';
import { resetSignedUrlCache } from '@/lib/storage/signedUrls';

/**
 * ชี้เมาส์ที่ชื่อไฟล์แนบแล้วเห็นไฟล์นั้นเลย (ร้านขอ 7 พ.ย. 2569).
 *
 * คำถามที่คนถามกับสลิปคือ "ใช่ใบนี้ไหม" ซึ่งตอบได้ด้วยการเห็นภาพครึ่งวินาที
 * แต่เดิมราคาของคำตอบคือสี่จังหวะ — กด รอ ปิด กลับมาที่เดิม
 */

const SLIP = 'cm/3f2504e0-4f89-41d3-9a0c-0305e82c3301-slip.jpg';
const DOC = 'cm/3f2504e0-4f89-41d3-9a0c-0305e82c3302-ใบกำกับ.pdf';

beforeEach(() => {
  // แคชอยู่ที่ระดับโมดูล — เคสก่อนหน้าจะทำให้เคสถัดไปไม่ยิงขอลิงก์เลย
  resetSignedUrlCache();
});

describe('AttachmentPeek', () => {
  it('ชี้เมาส์แล้วเห็นสลิป โดยไม่ต้องกด', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    await user.hover(screen.getByTitle('ดู slip.jpg'));

    const card = await screen.findByRole('tooltip', { name: 'ตัวอย่าง slip.jpg' });
    const img = await screen.findByAltText('ตัวอย่าง slip.jpg');
    expect(card).toContainElement(img);
    expect(img).toHaveAttribute('src', 'https://signed.example/slip.jpg');
    // หน้าต่างเต็มจอต้องไม่เปิดเอง — การชี้ไม่ใช่การกด
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('เอาเมาส์ออกแล้วการ์ดปิดเอง', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    const chip = screen.getByTitle('ดู slip.jpg');
    await user.hover(chip);
    await screen.findByRole('tooltip');
    await user.unhover(chip);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('แตะบนมือถือไม่เปิดการ์ด — การแตะเปิดหน้าต่างเต็มจออยู่แล้ว', async () => {
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    fireEvent.pointerEnter(screen.getByTitle('ดู slip.jpg'), { pointerType: 'touch' });

    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(urlAction).not.toHaveBeenCalled();
  });

  it('กดแล้วยังเปิดเต็มจอได้เหมือนเดิม และการ์ดไม่ค้างอยู่ข้างหลัง', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    const chip = screen.getByTitle('ดู slip.jpg');
    await user.hover(chip);
    await screen.findByRole('tooltip');
    await user.click(chip);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('ชี้แล้วกด เซ็นลิงก์ครั้งเดียว ไม่ใช่สองครั้ง', async () => {
    // ลิงก์อายุหนึ่งนาที เส้นแรกยังใช้ได้ตอนนิ้วกดลงไป การขอรอบสองคือการรอเปล่า
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    const chip = screen.getByTitle('ดู slip.jpg');
    await user.hover(chip);
    await screen.findByRole('tooltip');
    await user.click(chip);
    await screen.findByRole('dialog');

    expect(urlAction).toHaveBeenCalledTimes(1);
  });

  it('แท็บมาถึงชิปก็เห็นเท่ากับคนที่ใช้เมาส์', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    await user.tab();

    expect(await screen.findByRole('tooltip', { name: 'ตัวอย่าง slip.jpg' })).toBeInTheDocument();
  });

  it('ไฟล์ PDF ชี้ดูได้ด้วย ไม่ใช่แค่รูป', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ url: 'https://signed.example/doc.pdf' }));

    render(<AttachmentLinks paths={[DOC]} urlAction={urlAction} />);
    await user.hover(screen.getByTitle('ดู ใบกำกับ.pdf'));

    const card = await screen.findByRole('tooltip', { name: 'ตัวอย่าง ใบกำกับ.pdf' });
    const object = card.querySelector('object');
    expect(object).toHaveAttribute('type', 'application/pdf');
    expect(object?.getAttribute('data')).toContain('https://signed.example/doc.pdf');
  });

  it('เซ็นลิงก์ไม่ผ่าน การ์ดบอกให้ลองกดเปิดเต็มจอ ไม่ใช่กรอบว่าง', async () => {
    const user = userEvent.setup();
    const urlAction = vi.fn(async () => ({ error: 'ไม่มีสิทธิ์ในโมดูลขายส่ง' }));

    render(<AttachmentLinks paths={[SLIP]} urlAction={urlAction} />);
    await user.hover(screen.getByTitle('ดู slip.jpg'));

    expect(await screen.findByText('เปิดดูตรงนี้ไม่ได้ กดเพื่อลองเปิดเต็มจอ')).toBeInTheDocument();
  });

  it('ไม่มีสิทธิ์เปิดไฟล์ ก็ไม่มีการ์ดให้ชี้', async () => {
    const user = userEvent.setup();

    render(<AttachmentLinks paths={[SLIP]} />);
    await user.hover(screen.getByTitle('slip.jpg'));

    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
