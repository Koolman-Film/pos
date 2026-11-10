import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { DEFAULT_WS_STATUS, type WsOrder } from '@/components/wholesale/types';
import { WholesaleList } from '@/components/wholesale/WholesaleList';

/**
 * รายงานสรุปการขาย บนหน้าขายส่ง (ร้านขอ 6 พ.ย. 2569).
 *
 * สิ่งที่ปักไว้ที่นี่คือเรื่องที่สำคัญกว่าตัวเลข: รายงานเป็นมุมมองของชุดข้อมูล
 * เดียวกับรายการ ใช้ตัวกรองชุดเดียวกัน ถ้าแยกเป็นหน้าของตัวเองเมื่อไหร่ มันจะมี
 * ตัวกรองชุดที่สองที่ตั้งไม่ตรงกันได้ แล้วตัวเลขสองหน้าก็จะไม่ตรงกันโดยไม่มีใครผิด
 */
const thisYear = new Date().toISOString();

const po = (id: string, shop: string, over: Partial<Record<string, unknown>> = {}): WsOrder =>
  ({
    id,
    shop,
    status: 'ค้างชำระ',
    customerId: 1,
    salesBy: 'โหน่ง',
    items: [{ name: 'ฟิล์ม 3M', qty: 10, listPrice: 1000, requestedPrice: 1000, reason: '' }],
    returns: [],
    adjustments: [],
    payments: [],
    createdAt: thisYear,
    ...over,
  }) as unknown as WsOrder;

const SHOPS = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'north', name: 'Finnix North' },
];

const CUSTOMERS = [
  { id: 1, name: 'ร้านออโต้สไตล์', phone: '', address: '' },
  { id: 2, name: 'ร้านดีคาร์แคร์', phone: '', address: '' },
];

function renderList(orders: WsOrder[]) {
  render(
    <WholesaleList
      orders={orders}
      customers={CUSTOMERS}
      caps={{ 'wholesale.export': true }}
      wsStatuses={DEFAULT_WS_STATUS}
      accessibleShops={SHOPS}
    />,
  );
  return userEvent.setup();
}

/** ตัวรายงานบนจอ — .print-area ซ้อนเนื้อหาเดียวกันไว้สำหรับพิมพ์ */
const onScreen = () => screen.getByRole('region', { name: 'รายงานสรุปการขาย' });

/** ตัวเลขใต้ป้ายหนึ่งในแถบสรุป — ยอดสองช่องเท่ากันได้ จึงต้องถามเป็นช่อง ๆ */
const figure = (label: string) => {
  // แถบสรุปคือการ์ดใบแรกในรายงาน — คำว่า "ชำระแล้ว" เป็นหัวคอลัมน์ในตารางด้วย
  const summary = onScreen().querySelector('.card') as HTMLElement;
  return within(summary).getByText(label).parentElement?.textContent ?? '';
};

const openReport = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'รายงานสรุป' }));
};

describe('WholesaleList — รายงานสรุปการขาย', () => {
  const ORDERS = [
    po('WS-CM-0001', 'cm', {
      customerId: 1,
      salesBy: 'โหน่ง',
      payments: [{ amount: 4000, method: 'เงินสด', status: 'รับเงินแล้ว' }],
    }),
    po('WS-NT-0002', 'north', { customerId: 2, salesBy: 'เคน' }),
  ];

  it('ตั้งต้นที่รายการ แล้วสลับมาเป็นรายงานได้', async () => {
    const user = renderList(ORDERS);
    expect(screen.queryByText('ยอดขายรวม')).not.toBeInTheDocument();
    await openReport(user);
    // ถามเฉพาะตัวบนจอ — .print-area มีคำเดียวกันอยู่ในแถวยอดรวมของกระดาษ
    expect(within(onScreen()).getByText('ยอดขายรวม')).toBeInTheDocument();
  });

  it('สรุปยอดขาย ชำระแล้ว และค้างชำระ ไว้บนสุด', async () => {
    // คนเปิดรายงานนี้ถามคำถามเดียวก่อนเสมอ — ค้างอยู่เท่าไหร่
    const user = renderList(ORDERS);
    await openReport(user);
    expect(figure('ยอดขายรวม')).toContain('20,000.00');
    expect(figure('ชำระแล้ว')).toContain('4,000.00');
    expect(figure('ค้างชำระ')).toContain('16,000.00');
  });

  it('สลับการจัดกลุ่มระหว่างลูกค้ากับพนักงานขายได้', async () => {
    const user = renderList(ORDERS);
    await openReport(user);
    expect(within(onScreen()).getByText('ร้านออโต้สไตล์')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('จัดกลุ่มรายงานตาม'), 'sales');
    expect(within(onScreen()).getByText('โหน่ง')).toBeInTheDocument();
    expect(within(onScreen()).getByText('เคน')).toBeInTheDocument();
  });

  it('ใช้ตัวกรองชุดเดียวกับรายการ — กรองสาขาแล้วรายงานตามไปด้วย', async () => {
    /*
      ข้อที่สำคัญที่สุดในไฟล์นี้. ถ้ารายงานไม่ฟังตัวกรอง มันจะกลายเป็นตัวเลขชุด
      ที่สองที่ไม่ตรงกับอะไรบนหน้าจอเลย
    */
    const user = renderList(ORDERS);
    await user.click(
      within(screen.getByRole('group', { name: 'เลือกสาขา' })).getByRole('button', {
        name: 'Finnix North',
      }),
    );
    await openReport(user);
    // เหลือแต่ใบของ north: 10,000 และยังไม่จ่ายเลย
    expect(figure('ยอดขายรวม')).toContain('10,000.00');
    expect(figure('ชำระแล้ว')).toContain('0.00');
    expect(within(onScreen()).queryByText('ร้านออโต้สไตล์')).not.toBeInTheDocument();
  });

  it('เตือนยอดที่เลยกำหนดชำระแล้ว แยกจากยอดค้างทั้งหมด', async () => {
    const user = renderList([po('WS-CM-0003', 'cm', { dueAt: '2020-01-31' })]);
    await openReport(user);
    expect(within(onScreen()).getByText(/เลยกำหนดชำระแล้ว/)).toHaveTextContent('10,000.00');
  });

  it('ไม่เตือนเมื่อไม่มีใบไหนเลยกำหนด', async () => {
    const user = renderList([po('WS-CM-0004', 'cm', { dueAt: '' })]);
    await openReport(user);
    expect(within(onScreen()).queryByText(/เลยกำหนดชำระแล้ว/)).not.toBeInTheDocument();
  });
});

/**
 * สามหัวข้อในตาราง (ร้านขอ 7 พ.ย. 2569).
 *
 * การสั่งซื้อ · การชำระเงิน · จำนวนเงินคงค้างชำระ — สามเรื่องนี้ถูกอ่านคนละเวลา
 * และคนละคน คนดูว่าขายอะไรไป คนดูว่าเก็บเงินได้หรือยัง และคนที่ต้องโทรไปทวง
 */
describe('รายงานสรุปการขาย — สามหัวข้อ', () => {
  const WITH_PAYMENTS = [
    po('WS-CM-0010', 'cm', {
      customerId: 1,
      deliveredAt: '2026-09-12',
      items: [
        { name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 4, listPrice: 2500, requestedPrice: 2500, reason: '' },
      ],
      payments: [
        { amount: 4000, method: 'เงินสด', status: 'รับเงินแล้ว', date: '2026-09-20' },
        {
          amount: 3000,
          method: 'กรุงเทพ',
          status: 'แจ้งแล้ว',
          date: '2026-09-25',
          isCheque: true,
          chequeBank: 'BBL',
          chequeNo: '0038119',
        },
      ],
    }),
  ];

  const table = () => within(onScreen()).getByRole('table');

  it('หัวข้อทั้งสามอยู่เหนือกลุ่มคอลัมน์ของมัน', async () => {
    const user = renderList(WITH_PAYMENTS);
    await openReport(user);
    const head = within(table()).getByText('1. การสั่งซื้อ');
    expect(head).toHaveAttribute('colspan', '4');
    expect(within(table()).getByText('2. การชำระเงิน')).toHaveAttribute('colspan', '4');
    expect(within(table()).getByText('3. จำนวนเงินคงค้างชำระ')).toHaveAttribute('colspan', '2');
  });

  it('การสั่งซื้อ บอกวันที่ส่งของและสินค้า ไม่ใช่แค่ยอดเงิน', async () => {
    // "ขายอะไรไป" เป็นคำถามที่รายงานเดิมตอบไม่ได้เลย ทั้งที่ชื่อว่ารายงานการขาย
    const user = renderList(WITH_PAYMENTS);
    await openReport(user);
    expect(within(table()).getByText('ฟิล์ม 3M CRM (ม้วน) × 4')).toBeInTheDocument();
    expect(within(table()).getAllByText('12 ก.ย. 2569').length).toBeGreaterThan(0);
  });

  it('การชำระเงิน แยกเป็นครั้ง ๆ พร้อมวันที่ วิธี และสถานะ', async () => {
    const user = renderList(WITH_PAYMENTS);
    await openReport(user);
    // ถามในตัวตาราง ไม่ใช่แถวรวม ซึ่งมีคำว่า "ชำระแล้ว" เป็นป้ายกำกับยอดด้วย
    const body = table().querySelector('tbody') as HTMLElement;
    expect(within(body).getByText('ชำระแล้ว')).toBeInTheDocument();
    expect(within(body).getByText('รอยืนยันเงินเข้า')).toBeInTheDocument();
    // เช็คต้องอ่านว่าเป็นเช็ค ไม่ใช่ชื่อบัญชีที่จะเอาไปขึ้น ซึ่งอ่านแล้วเหมือนเงินเข้าแล้ว
    expect(within(table()).getByText(/เช็ค BBL เลขที่ 0038119/)).toBeInTheDocument();
  });

  it('เงินที่จ่ายมาแล้วแต่รอยืนยัน ไม่หายไปในยอดค้าง', async () => {
    /*
      ลูกค้าที่ยื่นเช็คเต็มจำนวนมาแล้ว อยู่คนละสถานะกับลูกค้าที่ยังไม่ส่งอะไรมาเลย
      แต่ทั้งคู่เคยโผล่เป็นยอดค้างก้อนเดียวกัน แล้วก็โดนตามเหมือนกัน
    */
    const user = renderList(WITH_PAYMENTS);
    await openReport(user);
    // 10,000 − 4,000 ที่รับแล้ว = 6,000 ค้าง ในนั้นเป็นเช็ครอยืนยัน 3,000
    expect(figure('ค้างชำระ')).toContain('6,000.00');
    expect(figure('รอยืนยันเงินเข้า')).toContain('3,000.00');
    // เหลือที่ยังไม่มีใครส่งอะไรมาเลย 3,000 — ยอดที่ต้องโทรหาลูกค้าจริง ๆ
    expect(figure('ค้างสุทธิ (หักที่รอยืนยัน)')).toContain('3,000.00');
  });

  it('ใบที่ยังไม่จ่ายเลย บอกตรง ๆ ไม่ใช่ปล่อยช่องว่าง', async () => {
    const user = renderList([po('WS-CM-0011', 'cm')]);
    await openReport(user);
    expect(within(table()).getByText('ยังไม่มีการชำระเงิน')).toBeInTheDocument();
  });

  it('กรองตามสถานะได้ตอนดูรายงาน ไม่ใช่เฉพาะตอนดูรายการ', async () => {
    /*
      ตัวกรองสถานะมีอยู่แล้วและรายงานก็ฟังมันอยู่แล้ว แต่มันเป็นแถวชิปที่ขึ้น
      เฉพาะมุมมองรายการ พอสลับมาดูรายงานจึงไม่มีทางเลือกว่าจะดูเฉพาะใบที่ค้าง
      ชำระ ทั้งที่นั่นคือคำถามหลักที่คนเปิดรายงานนี้ถาม (ร้านขอ 7 พ.ย. 2569)
    */
    const user = renderList([
      ...WITH_PAYMENTS,
      po('WS-CM-0012', 'cm', { customerId: 2, status: 'ปิดงานแล้ว' }),
    ]);
    await openReport(user);
    expect(figure('ยอดขายรวม')).toContain('20,000.00');

    await user.selectOptions(screen.getByLabelText('กรองตามสถานะ'), 'ค้างชำระ');
    // เหลือแต่ใบที่ค้างชำระ — 10,000 ของอีกใบหายไปจากทุกยอด
    expect(figure('ยอดขายรวม')).toContain('10,000.00');
    expect(within(onScreen()).queryByText('ร้านดีคาร์แคร์')).not.toBeInTheDocument();
  });

  it('สถานะที่เลือกไว้ ติดไปกับมุมมองรายการด้วย — ตัวกรองชุดเดียวกัน', async () => {
    // ถ้าเป็นสถานะคนละชุด สลับมุมมองแล้วตัวเลขจะเปลี่ยนโดยไม่มีใครสั่ง
    const user = renderList([
      ...WITH_PAYMENTS,
      po('WS-CM-0012', 'cm', { customerId: 2, status: 'ปิดงานแล้ว' }),
    ]);
    await openReport(user);
    await user.selectOptions(screen.getByLabelText('กรองตามสถานะ'), 'ปิดงานแล้ว');
    await user.click(screen.getByRole('button', { name: 'รายการ' }));
    expect(screen.getByRole('button', { name: /^ปิดงานแล้ว/ })).toHaveClass('pill-active');
  });

  it('แถวรวมของกลุ่ม มีคำกำกับว่าตัวเลขคือยอดอะไร', async () => {
    // ตัวเลขเปล่า ๆ ใต้ตารางยาว บังคับให้นับคอลัมน์ขึ้นไปหาหัวตาราง
    const user = renderList(WITH_PAYMENTS);
    await openReport(user);
    const foot = table().querySelector('tfoot') as HTMLElement;
    expect(within(foot).getByText(/รวม 1 ใบ/)).toBeInTheDocument();
    expect(within(foot).getByText('ชำระแล้ว')).toBeInTheDocument();
  });
});
