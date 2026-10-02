import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { DEFAULT_WS_STATUS, type WsOrder } from '@/components/wholesale/types';
import { WholesaleList } from '@/components/wholesale/WholesaleList';
import { previousMonthValue } from '@/lib/domain/now';

/**
 * สิ่งที่หน้ารายการขายส่งยังบอกไม่ได้ (ร้านแจ้ง 2 ต.ค. 2569 — "ดูจะไม่สมบูรณ์").
 *
 * 0077 ทำให้ PO ส่งได้หลายรอบ แต่ทำไว้แค่ในหน้า PO — ในรายการ ใบที่ส่งไปแล้ว
 * 80 จาก 200 หน้าตาเหมือนใบที่ยังไม่ได้ส่งเลยทุกประการ และไม่มีทางกรองออกมาดู
 * ว่าวันนี้ต้องส่งอะไรบ้าง
 *
 * และเมื่อช่วงเวลาที่เลือกไม่มี PO เลย หน้าจบลงเฉย ๆ ตรงแถวชิปสถานะ ซึ่งอ่าน
 * ได้อย่างเดียวว่าโมดูลพัง ทั้งที่ของอยู่ครบในเดือนก่อน
 */

const thisMonth = new Date().toISOString();

const po = (over: Partial<WsOrder> & { id: string }) =>
  ({
    shop: 'cm',
    status: 'รอจัดส่ง',
    customerId: 1,
    salesBy: 'โหน่ง',
    items: [
      { name: 'ฟิล์ม 3M', qty: 200, listPrice: 1200, requestedPrice: 1200, reason: '', uid: 'u1' },
    ],
    returns: [],
    adjustments: [],
    payments: [],
    deliveries: [],
    createdAt: thisMonth,
    ...over,
  }) as unknown as WsOrder;

const round = (qty: number) => ({
  uid: 'd1',
  date: '2026-09-10',
  note: 'นิ่มซี่เส็ง',
  attachments: [],
  items: [{ itemUid: 'u1', name: 'ฟิล์ม 3M', qty }],
});

const SHOPS = [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }];

function renderList(orders: WsOrder[]) {
  render(
    <WholesaleList
      orders={orders}
      customers={[{ id: 1, name: 'ร้านออโต้สไตล์', phone: '', address: '' }]}
      caps={{}}
      wsStatuses={DEFAULT_WS_STATUS}
      accessibleShops={SHOPS}
    />,
  );
  return userEvent.setup();
}

describe('WholesaleList — ความคืบหน้าการส่งของ', () => {
  it('ส่งไปแล้วบางส่วน บอกที่แถวว่าส่งไปเท่าไหร่', () => {
    renderList([po({ id: 'WS-CM-0001', deliveries: [round(80)] })]);
    expect(screen.getByText(/ส่งแล้ว 80\/200/)).toBeInTheDocument();
  });

  it('ยังไม่ได้ส่งเลย หรือส่งครบแล้ว ไม่ต้องมีตัวเลขนี้มากวน', () => {
    // สถานะบอกครบอยู่แล้วทั้งสองกรณี
    renderList([
      po({ id: 'WS-CM-0001' }),
      po({ id: 'WS-CM-0002', status: 'จัดส่งแล้ว', deliveries: [round(200)] }),
    ]);
    // ระวังไปชนคำว่า "จัดส่งแล้ว" ที่เป็นชื่อสถานะ
    expect(screen.queryByText(/ส่งแล้ว \d+\/\d+/)).toBeNull();
  });

  it('กรอง "ยังค้างส่ง" ได้ ซึ่งห้าสถานะเดิมตอบไม่ได้', async () => {
    const user = renderList([
      po({ id: 'WS-CM-0001', deliveries: [round(80)] }),
      po({ id: 'WS-CM-0002', status: 'จัดส่งแล้ว', deliveries: [round(200)] }),
    ]);
    await user.click(screen.getByRole('button', { name: /ยังค้างส่ง 1/ }));
    expect(screen.getAllByText(/WS-CM-0001/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/WS-CM-0002/)).toBeNull();
  });

  it('ไม่มีของค้างส่งเลย ก็ไม่มีชิปให้กด', () => {
    // ชิปที่กดแล้วได้ศูนย์ ไม่ได้ช่วยใคร
    renderList([po({ id: 'WS-CM-0002', status: 'จัดส่งแล้ว', deliveries: [round(200)] })]);
    expect(screen.queryByRole('button', { name: /ยังค้างส่ง/ })).toBeNull();
  });

  it('PO ที่ปิดงานแล้ว ไม่นับว่าค้างส่ง แม้จำนวนจะไม่ครบ', () => {
    // ปิดไปแล้วคือจบแล้ว ส่วนที่เหลือไม่ได้เป็นงานที่ต้องตามอีก
    renderList([po({ id: 'WS-CM-0003', status: 'ปิดงานแล้ว', deliveries: [round(80)] })]);
    expect(screen.queryByRole('button', { name: /ยังค้างส่ง/ })).toBeNull();
  });
});

describe('WholesaleList — ไม่มีอะไรให้แสดง', () => {
  it('ยังไม่เคยมี PO เลย ชวนให้เปิดใบแรก', () => {
    renderList([]);
    expect(screen.getByText('ยังไม่มี PO ขายส่ง')).toBeInTheDocument();
  });

  it('มี PO แต่ช่วงที่เลือกไม่มี บอกว่ากำลังดูช่วงไหนอยู่', () => {
    // หน้าที่จบลงเฉย ๆ อ่านได้อย่างเดียวว่าระบบพัง
    renderList([po({ id: 'WS-CM-0001', createdAt: '2020-01-05T00:00:00Z' })]);
    expect(screen.getByText('ไม่มี PO ที่ตรงกับที่กรองอยู่')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ดูเดือนก่อนหน้า/ })).toBeInTheDocument();
  });

  it('กดดูเดือนก่อนหน้าแล้วเจอของ', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1, 15);
    const user = renderList([po({ id: 'WS-CM-0001', createdAt: lastMonth.toISOString() })]);
    await user.click(screen.getByRole('button', { name: /ดูเดือนก่อนหน้า/ }));
    expect(screen.queryByText('ไม่มี PO ที่ตรงกับที่กรองอยู่')).toBeNull();
    expect(screen.getAllByText(/WS-CM-0001/).length).toBeGreaterThan(0);
  });

  it('ว่างเพราะกรองสถานะไว้ ล้างได้จากตรงนั้นเลย', async () => {
    const user = renderList([po({ id: 'WS-CM-0001' })]);
    await user.click(screen.getByRole('button', { name: /^ปิดงานแล้ว 0$/ }));
    await user.click(screen.getByRole('button', { name: /ล้างตัวกรองสถานะ/ }));
    expect(screen.getAllByText(/WS-CM-0001/).length).toBeGreaterThan(0);
  });
});

describe('previousMonthValue', () => {
  it('ข้ามปีได้', () => {
    expect(previousMonthValue('2026-01')).toBe('2025-12');
    expect(previousMonthValue('2026-10')).toBe('2026-09');
  });

  it('ค่าที่อ่านไม่ออก คืนค่าเดิม ไม่ใช่เดือน NaN', () => {
    expect(previousMonthValue('')).toBe('');
    expect(previousMonthValue('ไม่ใช่เดือน')).toBe('ไม่ใช่เดือน');
  });
});
