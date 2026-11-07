import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemsSection } from '@/components/tickets/detail/ItemsSection';
import type { StockRow, Ticket, TicketItem } from '@/components/tickets/types';

/**
 * วันของรายการที่ซื้อเพิ่มทีหลัง (migration 0089, ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ใบงานหนึ่งใบมีวันรับกับวันส่งคู่เดียว ซึ่งถูกตอนที่รถเข้ามาทำทุกอย่างรอบเดียว
 * แต่ของจริงมีกรณีที่ลูกค้ากลับมาซื้อเพิ่ม แล้วรายการนั้นถูกเพิ่มลงในใบงานใบเดิม
 *
 * สิ่งที่ปักไว้ที่นี่: ช่องวันที่ต้องพับอยู่จนกว่าจะใช้ เพราะงานส่วนใหญ่ทำรอบ
 * เดียวจบ และช่องที่ไม่ได้ใช้บนทุกบล็อกสินค้า คือช่องที่คนต้องอ่านผ่านทุกครั้ง
 */
const stock: StockRow[] = [
  {
    id: 1,
    name: 'ลำโพงคู่ JBL Stage',
    shortName: 'JBL',
    category: 'เครื่องเสียง',
    shop: 'cm',
    qty: 6,
    cost: 0,
    sellPrice: 5000,
  },
];

const item = (over: Partial<TicketItem> = {}): TicketItem =>
  ({
    category: 'เครื่องเสียง',
    booked: '',
    bookedPrice: 0,
    sold: 'ลำโพงคู่ JBL Stage',
    soldPrice: 5000,
    positions: [],
    ...over,
  }) as unknown as TicketItem;

const ticket = (items: TicketItem[]): Ticket =>
  ({
    id: 'JT-CM-00617',
    shop: 'cm',
    items,
    dropOffDateObj: new Date('2025-12-24T15:00:00+07:00'),
    pickupDateObj: new Date('2025-12-27T17:00:00+07:00'),
  }) as unknown as Ticket;

const renderItems = (t: Ticket, updateItemFields = vi.fn()) => {
  render(
    <ItemsSection
      t={t}
      stock={stock}
      productCategories={['เครื่องเสียง']}
      filmPositions={[]}
      setFilmPositions={vi.fn()}
      wrapPositions={[]}
      setWrapPositions={vi.fn()}
      addItem={vi.fn()}
      removeItem={vi.fn()}
      updateItem={vi.fn()}
      updateItemFields={updateItemFields}
      updateFilmPositions={vi.fn()}
      lookupPrice={(_p, fallback) => fallback}
      lookupFilmPrice={(_c, _p, _pos, fallback) => fallback}
      commitPrice={vi.fn()}
    />,
  );
  return { user: userEvent.setup(), updateItemFields };
};

describe('ItemsSection — วันของรายการนี้', () => {
  it('ยังไม่ได้กำหนดเอง ก็พับอยู่ และบอกวันที่กำลังใช้จริง', () => {
    // บรรทัดที่พับอยู่ยังต้องบอกวัน ไม่งั้นต้องกดเปิดเพื่อรู้ว่ามันใช้วันอะไร
    renderItems(ticket([item()]));
    const line = screen.getByText(/ใช้วันของใบงาน/);
    expect(line).toHaveTextContent('24 ธ.ค. 2568');
    expect(line).toHaveTextContent('27 ธ.ค. 2568');
    expect(screen.queryByLabelText('วันที่ส่งงานรายการที่ 1')).not.toBeInTheDocument();
  });

  it('กดแล้วเปิดช่องให้กรอก', async () => {
    const { user } = renderItems(ticket([item()]));
    await user.click(screen.getByRole('button', { name: 'กำหนดวันของรายการนี้เอง' }));
    expect(screen.getByLabelText('วันที่รับงานรายการที่ 1')).toBeInTheDocument();
    expect(screen.getByLabelText('วันที่ส่งงานรายการที่ 1')).toBeInTheDocument();
  });

  it('รายการที่กำหนดวันไว้แล้ว เปิดช่องให้เห็นเลย ไม่ต้องกด', () => {
    // วันที่ถูกตั้งไว้แล้วแต่ถูกพับซ่อน คือข้อมูลที่ไม่มีใครรู้ว่ามีอยู่
    renderItems(ticket([item({ receivedAt: '2026-01-05', deliveredAt: '2026-01-06' })]));
    expect(screen.getByLabelText('วันที่รับงานรายการที่ 1')).toHaveValue('2026-01-05');
  });

  it('กรอกข้างเดียว บอกว่าอีกข้างใช้วันอะไร', async () => {
    renderItems(ticket([item({ deliveredAt: '2026-01-06' })]));
    expect(screen.getByText(/ช่องที่เว้นไว้ใช้วันของใบงาน/)).toHaveTextContent('24 ธ.ค. 2568');
  });

  it('“กลับไปใช้วันของใบงาน” ล้างค่าจริง ไม่ใช่แค่พับหน้าจอ', async () => {
    /*
      ปุ่มที่แค่ซ่อนช่อง จะทิ้งวันที่กรอกไว้อยู่ในฐานข้อมูลโดยที่ไม่มีใครเห็น
      มันอีก แล้วใบงานขายก็จะแยกวันด้วยค่าที่คนคิดว่าลบไปแล้ว
    */
    const { user, updateItemFields } = renderItems(
      ticket([item({ receivedAt: '2026-01-05', deliveredAt: '2026-01-06' })]),
    );
    await user.click(screen.getByRole('button', { name: 'กลับไปใช้วันของใบงาน' }));
    expect(updateItemFields).toHaveBeenCalledWith(0, { receivedAt: '', deliveredAt: '' });
  });

  it('ส่งงานก่อนรับงาน บอกตรงนั้น ไม่ใช่ปล่อยไปเจอตอนกดบันทึก', () => {
    // ฐานข้อมูลปฏิเสธอยู่แล้ว (0089) การรู้ตอนกรอกถูกกว่ารู้ตอนบันทึกไม่ผ่าน
    renderItems(ticket([item({ receivedAt: '2026-01-06', deliveredAt: '2026-01-05' })]));
    expect(screen.getByRole('alert')).toHaveTextContent('วันที่ส่งงานอยู่ก่อนวันที่รับงาน');
  });
});
