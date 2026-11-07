import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PrintJobSheet } from '@/components/tickets/PrintJobSheet';
import type { Ticket } from '@/components/tickets/types';

/**
 * ใบงานขาย แยกตามวันส่งของ (migration 0089, ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ลูกค้ากลับมาซื้อเพิ่มทีหลัง แล้วรายการนั้นถูกเพิ่มลงในใบงานใบเดิม เอกสารที่
 * ออกมาจึงบอกวันเดียว ทั้งที่ของสองชิ้นนั้นส่งมอบกันคนละวัน
 *
 * ข้อที่สำคัญที่สุดในไฟล์นี้คือข้อสุดท้าย: ใบที่ทำรอบเดียวต้องหน้าตาเหมือนเดิม
 * ทุกประการ ไม่งั้นงานส่วนใหญ่ของร้านจะได้เอกสารที่เปลี่ยนไปโดยไม่มีใครขอ
 */
const ticket = (items: Ticket['items']): Ticket =>
  ({
    id: 'JT-CM-00617',
    shop: 'cm',
    customer: 'K.กิวลอย',
    phone: '0949452896',
    plate: '',
    carType: 'รถตู้',
    brand: 'Toyota',
    model: 'Alphard',
    color: '',
    serviceType: '',
    status: 'จองแล้ว',
    bookingChannel: 'Walk-in',
    techByCategory: {},
    dropOffDateObj: new Date('2025-12-24T15:00:00+07:00'),
    pickupDateObj: new Date('2025-12-27T17:00:00+07:00'),
    extras: {},
    items,
    payments: [],
    notes: '',
  }) as unknown as Ticket;

const item = (over: Partial<Ticket['items'][number]> = {}) =>
  ({
    category: 'ฟิล์มกันรอย',
    booked: '',
    bookedPrice: 0,
    sold: 'TPU กันรอยเกรดพรีเมียม',
    soldPrice: 1000,
    positions: [],
    ...over,
  }) as Ticket['items'][number];

const renderSale = (t: Ticket) =>
  render(
    <PrintJobSheet
      t={t}
      printMode="sale"
      currentUserName="แอดมินระบบ"
      shopName={() => 'FINNIX FILM เชียงใหม่'}
      shopInfo={{}}
      stock={[]}
      extraOptions={[]}
      total={1350}
      paid={0}
      docType="ใบเสร็จรับเงิน"
      buyerName=""
      buyerTaxId=""
      buyerAddress=""
      showCompanyInfo={false}
      showDisclaimer={false}
    />,
  );

describe('ใบงานขาย — แยกตามวันส่งของ', () => {
  const later = item({
    category: 'บริการ',
    sold: 'ล้างรถ',
    soldPrice: 350,
    receivedAt: '2026-01-05',
    deliveredAt: '2026-01-06',
  });

  it('ของที่ส่งคนละวัน ขึ้นหัวกลุ่มบอกวันของมันเอง', () => {
    renderSale(ticket([item(), later]));
    expect(screen.getByText(/ส่งงาน 27 ธ.ค. 2568/)).toBeInTheDocument();
    expect(screen.getByText(/ส่งงาน 6 ม.ค. 2569/)).toBeInTheDocument();
  });

  it('หัวกลุ่มบอกวันรับงานของรอบนั้น ไม่ใช่วันของใบงานเสมอไป', () => {
    // รอบที่สองรถเข้ามาใหม่วันที่ 5 ม.ค. — ไม่ใช่ 24 ธ.ค. ที่เป็นของงานแรก
    renderSale(ticket([item(), later]));
    expect(screen.getByText(/ส่งงาน 6 ม.ค. 2569/)).toHaveTextContent('รับงาน 5 ม.ค. 2569');
  });

  it('หัวกลุ่มบอกยอดของวันนั้น — แยกวันแล้วไม่บอกยอด ก็ต้องบวกเองอยู่ดี', () => {
    renderSale(ticket([item(), later]));
    expect(screen.getByText(/ส่งงาน 6 ม.ค. 2569/).parentElement).toHaveTextContent('350.00');
  });

  it('รายการยังขึ้นครบทุกชิ้น ไม่ได้หายไปกับการแบ่งกลุ่ม', () => {
    renderSale(ticket([item(), later]));
    expect(screen.getByText('TPU กันรอยเกรดพรีเมียม')).toBeInTheDocument();
    expect(screen.getByText('ล้างรถ')).toBeInTheDocument();
  });

  it('งานที่ทำรอบเดียว ไม่มีหัวกลุ่มมาเพิ่ม — เอกสารหน้าตาเหมือนเดิม', () => {
    /*
      งานส่วนใหญ่ของร้านเป็นแบบนี้ หัวข้อที่บอกสิ่งที่หัวเอกสารบอกไปแล้ว คือ
      บรรทัดที่คนต้องอ่านผ่านทุกใบเพื่อไม่ได้อะไรเลย
    */
    renderSale(ticket([item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง' })]));
    expect(screen.queryByText(/^ส่งงาน /)).not.toBeInTheDocument();
  });
});
