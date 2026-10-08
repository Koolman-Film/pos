import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MemoSection } from '@/components/tickets/detail/MemoSection';
import type { TicketMemo } from '@/components/tickets/types';

const ME = '00000000-0000-4000-8000-00000000000a';
const SOMEONE_ELSE = '00000000-0000-4000-8000-00000000000b';

const MEMOS: TicketMemo[] = [
  {
    id: 1,
    body: 'ลูกค้าขอเลื่อนเป็นบ่าย',
    authorId: SOMEONE_ELSE,
    authorName: 'สมชาย',
    createdAt: '2026-10-05T03:15:00Z',
  },
  {
    id: 2,
    body: 'รับทราบ\nแจ้งช่างแล้ว',
    authorId: ME,
    authorName: 'ไผริน',
    createdAt: '2026-10-05T04:00:00Z',
  },
];

function setup(over: Partial<Parameters<typeof MemoSection>[0]> = {}) {
  const onAdd = vi.fn(async () => ({ ok: true }));
  const onDelete = vi.fn(async () => ({ ok: true }));
  const onDone = vi.fn();
  render(
    <MemoSection
      memos={MEMOS}
      ticketId="JT-CM-00001"
      currentUserId={ME}
      canDeleteAny={false}
      onAdd={onAdd}
      onDelete={onDelete}
      onDone={onDone}
      {...over}
    />,
  );
  return { onAdd, onDelete, onDone };
}

describe('MemoSection', () => {
  it('แสดงทุกข้อความ และบอกชื่อคนอื่น', () => {
    setup();
    expect(screen.getByText('ลูกค้าขอเลื่อนเป็นบ่าย')).toBeInTheDocument();
    expect(screen.getByText(/แจ้งช่างแล้ว/)).toBeInTheDocument();
    expect(screen.getByText('สมชาย')).toBeInTheDocument();
    /*
      ชื่อของตัวเองไม่ขึ้น — ฟองอยู่ฝั่งขวาแล้ว เหมือนทุกแอปแชท การเขียนชื่อ
      ตัวเองกำกับทุกข้อความคือข้อมูลที่คนอ่านรู้อยู่แล้ว
    */
    expect(screen.queryByText('ไผริน')).toBeNull();
  });

  it('วันที่ขึ้นครั้งเดียวเป็นป้ายคั่น ส่วนแต่ละข้อความเหลือแค่เวลา', () => {
    setup();
    // สองข้อความอยู่วันเดียวกัน จึงมีป้ายคั่นใบเดียว
    expect(screen.getAllByText(/5 ต\.ค\. 2569/)).toHaveLength(1);
    // เวลาเป็น <time> ที่ถือ ISO ไว้ ไม่ใช่แค่ข้อความที่อ่านกลับไม่ได้
    const times = Array.from(document.querySelectorAll('time'));
    expect(times.map((t) => t.getAttribute('dateTime') ?? t.getAttribute('datetime'))).toEqual([
      '2026-10-05T03:15:00Z',
      '2026-10-05T04:00:00Z',
    ]);
    expect(times.map((t) => t.textContent)).toEqual(['10:15', '11:00']);
  });

  it('ข้ามวันแล้วขึ้นป้ายใหม่ และวันนี้เรียกว่า "วันนี้"', () => {
    const today = new Date();
    setup({
      memos: [
        MEMOS[0],
        { ...MEMOS[1], id: 9, createdAt: today.toISOString(), authorId: SOMEONE_ELSE },
      ],
    });
    expect(screen.getByText(/5 ต\.ค\. 2569/)).toBeInTheDocument();
    expect(screen.getByText('วันนี้')).toBeInTheDocument();
  });

  it('คนเดิมพิมพ์ติดกัน ไม่ขึ้นชื่อซ้ำ', () => {
    /* คนพิมพ์สามบรรทัดรวด ไม่ได้แปลว่ามีสามคนพูด */
    setup({
      memos: [
        MEMOS[0],
        {
          ...MEMOS[0],
          id: 3,
          body: 'อีกเรื่องหนึ่ง',
          createdAt: '2026-10-05T03:16:00Z',
        },
      ],
    });
    expect(screen.getAllByText('สมชาย')).toHaveLength(1);
  });

  it('คนเดิมแต่ห่างกันเกินห้านาที ขึ้นชื่อใหม่', () => {
    setup({
      memos: [
        MEMOS[0],
        {
          ...MEMOS[0],
          id: 3,
          body: 'กลับมาอีกที',
          createdAt: '2026-10-05T03:30:00Z',
        },
      ],
    });
    expect(screen.getAllByText('สมชาย')).toHaveLength(2);
  });

  it('ส่งข้อความแล้วล้างช่อง และบอกให้หน้าไปดึงของใหม่มา', async () => {
    const user = userEvent.setup();
    const { onAdd, onDone } = setup();
    const box = screen.getByLabelText('เขียน MEMO');
    await user.type(box, 'สั่งฟิล์มเพิ่ม 2 ม้วน');
    await user.click(screen.getByRole('button', { name: /ส่ง/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ ticketId: 'JT-CM-00001', body: 'สั่งฟิล์มเพิ่ม 2 ม้วน' });
    expect(box).toHaveValue('');
    expect(onDone).toHaveBeenCalled();
  });

  it('ส่งไม่สำเร็จ ข้อความที่พิมพ์ไว้ต้องยังอยู่', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => ({ ok: false, error: 'เน็ตหลุด' }));
    const onDone = vi.fn();
    render(
      <MemoSection
        memos={[]}
        ticketId="JT-CM-00001"
        currentUserId={ME}
        canDeleteAny={false}
        onAdd={onAdd}
        onDelete={vi.fn(async () => ({ ok: true }))}
        onDone={onDone}
      />,
    );
    const box = screen.getByLabelText('เขียน MEMO');
    await user.type(box, 'ของที่กำลังจะหาย');
    await user.click(screen.getByRole('button', { name: /ส่ง/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('เน็ตหลุด');
    // ล้างช่องตอนพลาด = ข้อความหายโดยไม่มีที่ให้กดส่งซ้ำ
    expect(box).toHaveValue('ของที่กำลังจะหาย');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('ช่องว่างส่งไม่ได้', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    const send = screen.getByRole('button', { name: /ส่ง/ });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('เขียน MEMO'), '   ');
    expect(send).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('Ctrl + Enter ส่งได้', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    await user.type(screen.getByLabelText('เขียน MEMO'), 'ด่วน');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  });

  describe('ปุ่มลบ', () => {
    it('ขึ้นเฉพาะข้อความของตัวเอง', () => {
      setup();
      expect(screen.getByRole('button', { name: /ลบข้อความของ ไผริน/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ลบข้อความของ สมชาย/ })).toBeNull();
    });

    it('แอดมินลบของคนอื่นได้', () => {
      setup({ canDeleteAny: true });
      expect(screen.getByRole('button', { name: /ลบข้อความของ สมชาย/ })).toBeInTheDocument();
    });

    it('เทียบด้วย id ไม่ใช่ชื่อ — คนชื่อซ้ำกันต้องลบของอีกคนไม่ได้', () => {
      /*
        พนักงานสองคนชื่อเดียวกันมีจริง และชื่อที่เก็บไว้คือชื่อ ณ ตอนที่เขียน
        ถ้าตัดสินด้วยชื่อ คนที่สองจะเห็นปุ่มลบบนข้อความที่ไม่ใช่ของตัวเอง
      */
      setup({
        memos: [{ ...MEMOS[0], authorName: 'ไผริน' }],
        currentUserId: ME,
      });
      expect(screen.queryByRole('button', { name: /ลบข้อความของ/ })).toBeNull();
    });
  });

  it('ใบงานที่ยังไม่ได้บันทึก ไม่มีช่องให้พิมพ์', () => {
    setup({ memos: [], disabled: true, disabledNote: 'บันทึกใบงานก่อน' });
    expect(screen.queryByLabelText('เขียน MEMO')).toBeNull();
    expect(screen.getByText('บันทึกใบงานก่อน')).toBeInTheDocument();
  });

  /*
    ข้อกำหนดของร้าน: "ข้อความในmemo จะไม่แสดงในเอกสาร จะเห็นเฉพาะในระบบเท่านั้น"

    ฝั่งที่บังคับจริงคือฝั่งพิมพ์ (ดู PrintJobSheet.test.tsx) ส่วนตรงนี้คือป้าย
    ที่บอกคนใช้ว่ามันเป็นอย่างนั้น ซึ่งเป็นคนละเรื่องและพังแยกกันได้
  */
  it('บอกไว้บนหน้าจอว่าไม่ถูกพิมพ์ลงเอกสาร', () => {
    setup();
    expect(screen.getByText('เห็นเฉพาะในระบบ')).toBeInTheDocument();
    expect(screen.getByText(/ไม่ถูกพิมพ์ลงใบงาน ใบเสนอราคา หรือใบเสร็จ/)).toBeInTheDocument();
  });
});
