import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PrintJobSheet } from '@/components/tickets/PrintJobSheet';
import type { Ticket } from '@/components/tickets/types';

/**
 * ใบงานขาย แยกเป็นคนละใบตามวันส่งของ (migration 0089, ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ลูกค้ากลับมาซื้อเพิ่มทีหลัง แล้วรายการนั้นถูกเพิ่มลงในใบงานใบเดิม — ของสอง
 * ชิ้นในใบเดียวกันจึงส่งมอบกันคนละวัน
 *
 * รอบแรกผมแยกเป็น "หัวข้อ" ในใบเดียว ซึ่งตอบผิดคำถาม ร้านตีกลับมาว่ายังไม่ได้
 * แยก และถูกแล้ว: ใบงานขายคือกระดาษที่ยื่นให้ลูกค้าตอนรับของ ลูกค้าที่มารับ
 * วันที่ 7 ต้องได้ใบของวันที่ 7 ไม่ใช่ใบที่พาดหัวว่าวันที่ 2 แล้วมีของที่เขา
 * รับไปแล้วติดมาด้วย
 *
 * ข้อที่สำคัญที่สุดในไฟล์นี้ยังเป็นข้อสุดท้าย: ใบที่ส่งรอบเดียวต้องหน้าตา
 * เหมือนเดิมทุกประการ ไม่งั้นงานส่วนใหญ่ของร้านจะได้เอกสารที่เปลี่ยนไปโดย
 * ไม่มีใครขอ
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

/** แต่ละใบคือ `.print-page` ของตัวเอง — ใบพิมพ์ถูก portal ไปไว้ที่ body. */
const sheets = () => Array.from(document.body.querySelectorAll<HTMLElement>('.print-page'));

describe('ใบงานขาย — แยกตามวันส่งของ', () => {
  const later = item({
    category: 'บริการ',
    sold: 'ล้างรถ',
    soldPrice: 350,
    receivedAt: '2026-01-05',
    deliveredAt: '2026-01-06',
  });

  it('ของที่ส่งคนละวัน ได้คนละใบ ไม่ใช่สองหัวข้อในใบเดียว', () => {
    renderSale(ticket([item(), later]));
    expect(sheets()).toHaveLength(2);
    expect(screen.getAllByText('ใบงานขาย')).toHaveLength(2);
    // ใบที่สองต้องขึ้นหน้าใหม่ ไม่ใช่ต่อท้ายใบแรกกลางหน้า
    expect(sheets()[1]).toHaveStyle({ pageBreakBefore: 'always' });
  });

  it('หัวของแต่ละใบบอกวันของใบนั้น ไม่ใช่วันของทั้งใบงาน', () => {
    renderSale(ticket([item(), later]));
    const [first, second] = sheets();
    expect(
      within(first).getByText(/วันที่ส่งงาน \(ของในใบนี้\): 27 ธ.ค. 2568/),
    ).toBeInTheDocument();
    expect(
      within(second).getByText(/วันที่ส่งงาน \(ของในใบนี้\): 6 ม.ค. 2569/),
    ).toBeInTheDocument();
    // รอบที่สองรถเข้ามาใหม่วันที่ 5 ม.ค. — ไม่ใช่ 24 ธ.ค. ที่เป็นของงานแรก
    expect(
      within(second).getByText(/วันที่รับงาน \(ของในใบนี้\): 5 ม.ค. 2569/),
    ).toBeInTheDocument();
  });

  it('วันของทั้งใบงานยังอยู่ตัวเล็ก — การรับประกันนับจากวันที่รถเข้ามาครั้งแรก', () => {
    renderSale(ticket([item(), later]));
    expect(within(sheets()[1]).getByText(/ทั้งใบงาน: รับ 24 ธ.ค. 2568/)).toHaveTextContent(
      'ส่ง 27 ธ.ค. 2568',
    );
  });

  it('แต่ละใบบอกว่าเป็นใบที่เท่าไหร่ของกี่ใบ', () => {
    // ใบเดียวที่หลุดมือไป คือใบที่ไม่มีใครรู้ว่าหาย
    renderSale(ticket([item(), later]));
    expect(within(sheets()[0]).getByText(/ใบที่ 1\/2/)).toBeInTheDocument();
    expect(within(sheets()[1]).getByText(/ใบที่ 2\/2/)).toBeInTheDocument();
  });

  it('ใบหนึ่งมีเฉพาะของที่ส่งวันนั้น ไม่มีของรอบอื่นติดมา', () => {
    renderSale(ticket([item(), later]));
    const [first, second] = sheets();
    expect(within(first).getByText('TPU กันรอยเกรดพรีเมียม')).toBeInTheDocument();
    expect(within(first).queryByText('ล้างรถ')).toBeNull();
    expect(within(second).getByText('ล้างรถ')).toBeInTheDocument();
    expect(within(second).queryByText('TPU กันรอยเกรดพรีเมียม')).toBeNull();
  });

  it('เงินในใบบอกสองชั้น — ยอดของใบนี้ กับฐานะของทั้งใบงาน', () => {
    /*
      เงินผูกกับใบงานทั้งใบ ไม่ได้ผูกกับรายการ การบอกว่า "ชำระแล้วเท่าไหร่ของ
      วันนี้" จึงเป็นการเดา ใบจึงบอกยอดงานของมันเอง แล้วติดป้ายให้ยอดที่เหลือ
      ว่าเป็นของทั้งใบงาน
    */
    renderSale(ticket([item(), later]));
    const second = sheets()[1];
    expect(within(second).getByText(/ยอดงานในใบนี้/)).toHaveTextContent('6 ม.ค. 2569');
    expect(within(second).getByText(/ยอดงานในใบนี้/).parentElement).toHaveTextContent('350.00');
    expect(within(second).getByText('ยอดสุทธิทั้งใบงาน JT-CM-00617')).toBeInTheDocument();
    expect(within(second).getByText('ค้างชำระ (ทั้งใบงาน)')).toBeInTheDocument();
  });

  it('แถบชนิดสินค้า นับเฉพาะของในใบนั้น', () => {
    // "งานนี้มี 2 ชนิดสินค้า" บนใบที่มีชิ้นเดียว คือคำบอกให้ไปตามหาของที่ไม่หาย
    renderSale(ticket([item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง' }), later]));
    const [first, second] = sheets();
    expect(within(first).getByText(/ใบนี้มี 2 ชนิดสินค้า/)).toBeInTheDocument();
    expect(within(second).queryByText(/ชนิดสินค้า/)).toBeNull();
  });

  it('ของที่ส่งคนละวันแต่ชนิดเดียวกัน ก็ไม่มีแถบชนิดสินค้าสักใบ', () => {
    renderSale(ticket([item(), later]));
    expect(screen.queryByText(/ชนิดสินค้า/)).toBeNull();
  });

  it('งานที่ส่งรอบเดียว ได้ใบเดียว หน้าตาเหมือนเดิมทุกประการ', () => {
    /*
      งานส่วนใหญ่ของร้านเป็นแบบนี้ ป้ายกำกับที่บอกสิ่งที่หัวเอกสารบอกไปแล้ว คือ
      บรรทัดที่คนต้องอ่านผ่านทุกใบเพื่อไม่ได้อะไรเลย
    */
    renderSale(ticket([item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง' })]));
    expect(sheets()).toHaveLength(1);
    expect(screen.queryByText(/ใบที่ 1\//)).toBeNull();
    expect(screen.queryByText(/ของในใบนี้/)).toBeNull();
    expect(screen.queryByText(/ยอดงานในใบนี้/)).toBeNull();
    expect(screen.getByText('ยอดสุทธิ')).toBeInTheDocument();
    expect(screen.getByText('งานนี้มี 2 ชนิดสินค้า')).toBeInTheDocument();
    expect(screen.getByText(/วันที่ส่งงาน:/)).toBeInTheDocument();
  });
});
