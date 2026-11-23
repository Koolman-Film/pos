import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
}));

import { WhatsNewBar } from '@/components/notices/WhatsNewBar';
import { WhatsNewView } from '@/components/notices/WhatsNewView';
import type { Release } from '@/lib/notices/releaseNotes';

/**
 * "มีอะไรใหม่" บนหน้าจอ (docs/DESIGN-whats-new.md).
 *
 * ของสองชิ้นนี้มีหน้าที่ต่างกันชัดเจน: แถบคือคนเคาะประตูบอกว่ามีของใหม่ ส่วน
 * หน้าคือที่ที่ของนั้นอยู่ถาวร แถบหายได้ หน้าต้องไม่หาย
 */
const releases: Release[] = [
  {
    no: 2,
    date: '2026-11-23',
    title: 'สรุปการปรับปรุง',
    notes: [
      {
        id: 'stock-filters',
        title: 'ประวัติสต็อก กรองได้แล้ว',
        what: 'กรองตามสาขา สินค้า ชนิดสินค้า และช่วงเวลา',
        why: 'คำถามว่าของหายไปไหน เคยตอบด้วยการเลื่อนหาเอา',
        kind: 'new',
        href: '/stock',
      },
      {
        id: 'branch-filter',
        title: 'ตัวกรองสาขาของอีกแท็บ ไม่กรองตารางนี้แล้ว',
        what: 'ประวัติสต็อกมีตัวกรองสาขาของตัวเอง',
        why: 'ตารางเคยถูกกรองด้วยปุ่มที่อยู่คนละแท็บ',
        todo: 'ถ้าเคยพึ่งพาพฤติกรรมเดิม ต้องเลือกสาขาในแท็บนี้แทน',
        kind: 'changed',
      },
    ],
  },
];

beforeEach(() => refresh.mockClear());

describe('หน้า มีอะไรใหม่', () => {
  it('บอกครบทั้งอะไรเปลี่ยนและทำไม', () => {
    render(<WhatsNewView releases={releases} unread={0} markSeenAction={vi.fn()} />);
    expect(screen.getByText('ประวัติสต็อก กรองได้แล้ว')).toBeInTheDocument();
    expect(screen.getByText(/กรองตามสาขา สินค้า/)).toBeInTheDocument();
    expect(screen.getByText(/เคยตอบด้วยการเลื่อนหาเอา/)).toBeInTheDocument();
  });

  it('เรื่องที่ไม่ต้องลงมือ พูดออกมาตรง ๆ ว่าไม่ต้องทำอะไร', () => {
    /*
      คนที่อ่านข่าวแล้วไม่รู้ว่าต้องลงมือหรือเปล่า จะค้างอยู่กับคำถามนั้นทั้งวัน
      ประโยคสั้น ๆ ประโยคเดียวปิดคำถามนั้นได้
    */
    render(<WhatsNewView releases={releases} unread={0} markSeenAction={vi.fn()} />);
    expect(screen.getByText('ไม่ต้องทำอะไร ใช้ได้เลย')).toBeInTheDocument();
    expect(screen.getByText(/ต้องเลือกสาขาในแท็บนี้แทน/)).toBeInTheDocument();
  });

  it('ป้ายบอกว่าเรื่องนี้ดังแค่ไหน', () => {
    render(<WhatsNewView releases={releases} unread={0} markSeenAction={vi.fn()} />);
    expect(screen.getByText('ของใหม่')).toBeInTheDocument();
    expect(screen.getByText('ความหมายเปลี่ยน')).toBeInTheDocument();
  });

  it('เปิดหน้า = อ่านแล้ว ไม่ต้องมีปุ่มให้กดยืนยัน', async () => {
    // ปุ่มยืนยันคือสิ่งที่คนกดโดยไม่อ่านอยู่ดี มันจึงวัดได้แค่ว่ามีคนกดปุ่ม
    const mark = vi.fn().mockResolvedValue({ ok: true });
    render(<WhatsNewView releases={releases} unread={2} markSeenAction={mark} />);
    await waitFor(() => expect(mark).toHaveBeenCalledTimes(1));
  });

  it('อ่านครบแล้ว ไม่ต้องเขียนซ้ำทุกครั้งที่เปิด', async () => {
    const mark = vi.fn().mockResolvedValue({ ok: true });
    render(<WhatsNewView releases={releases} unread={0} markSeenAction={mark} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mark).not.toHaveBeenCalled();
  });

  it('ไม่มีข่าวของคนนี้ ก็บอกไปตรง ๆ ไม่ใช่หน้าว่าง', () => {
    render(<WhatsNewView releases={[]} unread={0} markSeenAction={vi.fn()} />);
    expect(screen.getByText(/ยังไม่มีข่าวการเปลี่ยนแปลงที่เกี่ยวกับงานของคุณ/)).toBeInTheDocument();
  });
});

describe('แถบแจ้งหลังอัปเดต', () => {
  it('บอกจำนวนเรื่องของคนนั้น และพาไปอ่านต่อได้', () => {
    render(<WhatsNewBar count={3} dismissAction={vi.fn()} />);
    expect(screen.getByText(/มี 3 เรื่องที่เกี่ยวกับงานของคุณ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ดูว่าอะไรเปลี่ยน' })).toHaveAttribute(
      'href',
      '/whats-new',
    );
  });

  it('ลิงก์ไปอ่าน ไม่ถอดตัวเองออกจากหน้าจอกลางคัน', () => {
    /*
      เจอตอนลองของจริง: ตอนแรกลิงก์นี้ซ่อนแถบตอนถูกกด ซึ่งถอดตัวลิงก์ออกจาก
      DOM กลางคัน แล้วการพาไปหน้าใหม่ก็ถูกยกเลิกไปด้วย — กดแล้วไม่ไปไหน
    */
    render(<WhatsNewBar count={1} dismissAction={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'ดูว่าอะไรเปลี่ยน' });
    link.click();
    expect(screen.getByRole('link', { name: 'ดูว่าอะไรเปลี่ยน' })).toBe(link);
  });

  it('กดไว้ก่อน แถบหายทันที ไม่รอเซิร์ฟเวอร์', async () => {
    // คนที่เพิ่งกด ไม่ควรต้องรอ round-trip เพื่อให้แถบหายจากหน้าจอตัวเอง
    let resolve: (v: { ok: boolean }) => void = () => {};
    const dismiss = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<WhatsNewBar count={2} dismissAction={dismiss} />);

    await user.click(screen.getByRole('button', { name: 'ไว้ก่อน' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(dismiss).toHaveBeenCalled();
    resolve({ ok: true });
  });

  it('ไม่มีเรื่องเลย ก็ไม่ต้องมีแถบ', () => {
    render(<WhatsNewBar count={0} dismissAction={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
