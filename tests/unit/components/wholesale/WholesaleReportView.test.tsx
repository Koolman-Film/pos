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
    expect(screen.getByText('ยอดขายรวม')).toBeInTheDocument();
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
