import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TicketList } from '@/components/tickets/TicketList';
import { fmtThaiDate } from '@/lib/domain/format';

const tickets = [
  {
    id: 'JT-CM-00214',
    shop: 'cm',
    customer: 'คุณ เอ',
    plate: '250 กก',
    status: 'กำลัง QC ก่อนติดตั้ง',
    items: [{ soldPrice: 5100 }],
    payments: [],
  },
];
const statuses = [
  { key: 'กำลัง QC ก่อนติดตั้ง', short: 'รอ QC', bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
];

describe('TicketList', () => {
  it('renders a ticket row with its status badge', () => {
    render(
      <TicketList
        tickets={tickets}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    // customer and plate share a text node in the faithful markup ("คุณ เอ · 250 กก");
    // the customer also appears again inside the body-portaled print table.
    expect(screen.getAllByText(/คุณ เอ/).length).toBeGreaterThan(0);
    expect(screen.getByText('รอ QC')).toBeInTheDocument();
  });

  it('hides the "create new" button when canDo("list.createNew") is false', () => {
    render(
      <TicketList
        tickets={tickets}
        statuses={statuses}
        canDo={() => false}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    expect(screen.queryByText('สร้างใบงานใหม่')).not.toBeInTheDocument();
    expect(screen.queryByText('สร้างใหม่')).not.toBeInTheDocument();
  });

  it('shows the "create new" controls when canDo("list.createNew") is true', () => {
    render(
      <TicketList
        tickets={tickets}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    expect(screen.getByText('สร้างใบงานใหม่')).toBeInTheDocument();
  });
});

describe('TicketList — ยอดรวม และ ยี่ห้อ/รุ่น ในแต่ละแถว', () => {
  const row = {
    ...tickets[0],
    brand: 'Toyota',
    model: 'Camry',
    items: [
      { soldPrice: 5100 },
      { soldPrice: 1000, discountType: 'amount' as const, discountValue: 100 },
    ],
  };

  it("shows the job's net total on the row", () => {
    render(
      <TicketList
        tickets={[row]}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    // 5,100 + (1,000 − 100 discount): the same figure as the ticket and the export.
    expect(screen.getByLabelText('ยอดรวม 6,000.00 บาท')).toBeInTheDocument();
  });

  it('shows the make and model beside the plate', () => {
    render(
      <TicketList
        tickets={[row]}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    expect(screen.getAllByText(/Toyota Camry/).length).toBeGreaterThan(0);
  });

  it('leaves the car out rather than printing an empty separator', () => {
    render(
      <TicketList
        tickets={tickets}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    // The row title, matched whole: no dangling " · " where a car would go.
    expect(screen.getByText('คุณ เอ · 250 กก')).toBeInTheDocument();
  });
});

/**
 * วันที่รับงาน และ วันที่ส่งงาน บนทุกแถว (ร้านขอ 8 ต.ค. 2569).
 *
 * แถวเคยบอกวันเดียว และบอกผิดด้วย: ป้ายเขียนว่า "รับรถ" แต่พิมพ์ `pickupDateObj`
 * ซึ่งคือวันที่ส่งงาน งานที่รับวันจันทร์ส่งวันพุธ จึงขึ้นในลิสต์ว่า "รับรถ วันพุธ"
 */
describe('TicketList — วันที่รับงาน และ วันที่ส่งงาน', () => {
  const dropOff = new Date();
  const pickup = new Date(Date.now() + 2 * 86400000);
  const dated = {
    ...tickets[0],
    dropOffDateObj: dropOff,
    pickupDateObj: pickup,
  };

  const renderRow = () =>
    render(
      <TicketList
        tickets={[dated]}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );

  it('แสดงทั้งสองวัน พร้อมป้ายที่ตรงกับช่องในใบงาน', () => {
    renderRow();
    const line = screen.getByText(
      (_, el) =>
        el?.textContent === `รับงาน ${fmtThaiDate(dropOff)} · ส่งงาน ${fmtThaiDate(pickup)}`,
    );
    expect(line).toBeInTheDocument();
  });

  it('ไม่เรียกวันส่งงานว่า "รับรถ" อีกแล้ว', () => {
    /*
      ตัวเลขที่เคยขึ้นใต้คำว่า "รับรถ" คือวันที่ส่งงานมาตลอด การปล่อยคำนี้ไว้
      แปลว่ายังมีที่หนึ่งในระบบที่พูดไม่ตรงกับใบงาน
    */
    renderRow();
    expect(screen.queryByText(/รับรถ/)).toBeNull();
  });

  it('ยังไม่ได้นัดวันส่ง ขึ้นขีด ไม่ใช่ยืมวันรับมาใช้', () => {
    render(
      <TicketList
        tickets={[{ ...tickets[0], dropOffDateObj: dropOff, pickupDateObj: null }]}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );
    const line = screen.getByText(
      (_, el) => el?.textContent === `รับงาน ${fmtThaiDate(dropOff)} · ส่งงาน -`,
    );
    expect(line).toBeInTheDocument();
  });
});

/**
 * ป้าย "ยังไม่แนบหลักฐาน" บนแถว (ร้านขอ 9 ต.ค. 2569).
 *
 * "ป้องกันการลืม และช่วยให้ตรวจสอบย้อนหลังได้สะดวก" — คำถาม "ใบไหนรับเงินแล้ว
 * แต่ยังไม่มีสลิป" เคยตอบได้ด้วยการเปิดใบงานทีละใบเท่านั้น
 */
describe('TicketList — ยังไม่แนบหลักฐานการรับเงิน', () => {
  const withPayments = (payments: { amount: number; attachments?: string[] }[]) => ({
    ...tickets[0],
    dropOffDateObj: new Date(),
    pickupDateObj: new Date(),
    payments,
  });

  const renderRow = (payments: { amount: number; attachments?: string[] }[]) =>
    render(
      <TicketList
        tickets={[withPayments(payments)]}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'CM' }]}
      />,
    );

  it('รับเงินแล้วไม่มีสลิป ขึ้นป้าย', () => {
    renderRow([{ amount: 5000 }]);
    expect(screen.getByText('ยังไม่แนบหลักฐาน')).toBeInTheDocument();
  });

  it('มีสลิปครบแล้ว ไม่มีป้าย', () => {
    renderRow([{ amount: 5000, attachments: ['cm/slip.jpg'] }]);
    expect(screen.queryByText('ยังไม่แนบหลักฐาน')).toBeNull();
  });

  it('ยังไม่ได้รับเงินเลย ไม่มีป้าย', () => {
    // ป้ายที่ขึ้นตั้งแต่ยังไม่มีอะไรให้ลืม คือป้ายที่อยู่ตลอดเวลาจนไม่มีใครอ่าน
    renderRow([]);
    expect(screen.queryByText('ยังไม่แนบหลักฐาน')).toBeNull();
  });

  it('ขาดหลายแถว บอกจำนวนไปด้วย', () => {
    renderRow([{ amount: 3000 }, { amount: 2000, attachments: ['cm/a.jpg'] }, { amount: 1000 }]);
    expect(screen.getByText(/ยังไม่แนบหลักฐาน/)).toHaveTextContent('2');
  });
});
