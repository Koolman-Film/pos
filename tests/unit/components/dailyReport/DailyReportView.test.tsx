import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}));

/*
  `html-to-image` วาดผ่าน <foreignObject> ของ SVG ซึ่ง jsdom แปลงเป็นรูปไม่ได้
  สิ่งที่เทสต์ได้จึงเป็นสัญญารอบ ๆ มัน: วาดจากกรอบไหน ตัดอะไรออก ตั้งชื่อไฟล์ว่า
  อะไร และกดพิมพ์แล้วใบพิมพ์เป็นรูปนั้นจริงไหม — ส่วนหน้าตาของรูป ตรวจบนเบราว์เซอร์จริง
*/
type CaptureOptions = { backgroundColor?: string; filter?: (node: Node) => boolean };
const capture = vi.hoisted(() => ({
  toPng: vi.fn<(node: HTMLElement, options?: CaptureOptions) => Promise<string>>(
    async () => 'data:image/png;base64,AAAA',
  ),
}));
vi.mock('html-to-image', () => ({ toPng: capture.toPng }));

import type { DailyReport } from '@/components/dailyReport/buildDailyReport';
import { DailyReportView } from '@/components/dailyReport/DailyReportView';

/**
 * รายงานการเงินรายวัน — the screen. The arithmetic is pinned in
 * buildDailyReport.test.ts; this pins that every section shows it, and that
 * the day and branch are URLs.
 */

const REPORT: DailyReport = {
  day: '2026-09-22',
  sales: {
    channels: [
      {
        channel: 'ปลีก',
        total: 11500,
        count: 3,
        categories: [
          { name: 'ฟิล์มกรองแสง', amount: 7500, count: 2 },
          { name: 'เครื่องเสียง', amount: 4000, count: 1 },
        ],
      },
      {
        channel: 'ขายส่ง',
        total: 8000,
        count: 1,
        categories: [{ name: 'ลำโพง', amount: 8000, count: 1 }],
      },
    ],
    total: 19500,
    previousTotal: 10000,
    held: 700,
    documents: 4,
    outstanding: { count: 5, amount: 42300 },
  },
  inflow: {
    rows: [
      { key: 'a1', shop: 'cm', accountId: 1, name: 'เงินสดหน้าร้าน', amount: 7500, count: 2 },
      { key: 'lcm:โอน TTB', shop: 'cm', accountId: null, name: 'โอน TTB', amount: 700, count: 1 },
    ],
    total: 8200,
  },
  outflow: {
    rows: [{ key: 'a3', shop: 'cm', accountId: 3, name: 'เงินสดย่อย', amount: 350, count: 1 }],
    total: 350,
  },
  balances: [
    {
      shop: 'cm',
      name: 'Finnix Film เชียงใหม่',
      total: 7650,
      accounts: [
        {
          accountId: 3,
          shop: 'cm',
          name: 'เงินสดย่อย',
          kind: 'petty',
          opening: 200,
          inflow: 0,
          outflow: 350,
          transfer: 0,
          closing: -150,
        },
      ],
    },
  ],
  hasUnmatched: true,
};

const SHOPS = [
  { id: 'cm', name: 'Finnix Film เชียงใหม่' },
  { id: 'north', name: 'Central Audio' },
];

function renderView() {
  return render(
    <DailyReportView
      report={REPORT}
      today="2026-09-23"
      shopFilter="all"
      shops={SHOPS}
      scopeName="ทุกสาขา"
      showShopColumn={false}
    />,
  );
}

describe('DailyReportView', () => {
  beforeEach(() => nav.push.mockReset());

  it('shows the four headline figures', () => {
    renderView();
    // เงินรับเข้า explains itself: ยอดขาย plus the money held for another shop.
    const inflowTile = screen.getAllByText('เงินรับเข้า')[0].closest('.card') as HTMLElement;
    expect(within(inflowTile).getByText('เงินรอคืน Finnix')).toBeInTheDocument();
    expect(within(inflowTile).getByText('700.00')).toBeInTheDocument();
    expect(screen.getAllByText('19,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText('▲ 95% จากเมื่อวาน · 4 งาน')).toBeInTheDocument();
    expect(screen.getAllByText('+7,850.00').length).toBeGreaterThan(0);
  });

  it('splits sales into ขายปลีก and ขายส่ง, then by ชนิดสินค้า', () => {
    renderView();
    const sales = screen
      .getByRole('heading', { name: /① ยอดขาย/ })
      .closest('.card')! as HTMLElement;
    expect(within(sales).getByText('ขายปลีก')).toBeInTheDocument();
    expect(within(sales).getByText('ขายส่ง')).toBeInTheDocument();
    expect(within(sales).getByText('ฟิล์มกรองแสง')).toBeInTheDocument();
    expect(within(sales).queryByText(/เงินรอคืน Finnix/)).toBeNull();
  });

  it('shows how many jobs each line is, and the jobs still owed money', () => {
    renderView();
    const sales = screen.getByRole('heading', { name: /① ยอดขาย/ }).closest('.card') as HTMLElement;
    const film = within(sales).getByText('ฟิล์มกรองแสง').closest('tr') as HTMLElement;
    expect(within(film).getByText('2')).toBeInTheDocument();
    const due = within(sales).getByText('งานขายค้างชำระ').closest('tr') as HTMLElement;
    expect(within(due).getByText('5')).toBeInTheDocument();
    expect(within(due).getByText('42,300.00')).toBeInTheDocument();
  });

  it('flags a label no account claims, and a negative balance', () => {
    renderView();
    expect(screen.getByText(/ยังไม่ได้ผูกกับบัญชีใด/)).toBeInTheDocument();
    expect(screen.getByText('-150.00 ⚠')).toBeInTheDocument();
  });

  it('moves between days and branches by URL', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-21&shop=all');
    await userEvent.click(screen.getByRole('button', { name: 'วันถัดไป' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-23&shop=all');
    await userEvent.click(screen.getByRole('button', { name: 'Central Audio' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-22&shop=north');
  });
});

/**
 * บันทึกเป็นรูป / พิมพ์ — ภาพเดียวกัน (ร้านขอ 2 ต.ค. 2569).
 *
 * ร้านบอกว่า PDF ตารางเปล่าของเดิมดูยากกว่าหน้าจอ ทางที่ตรงที่สุดคือให้สิ่งที่
 * ออกไปเป็นหน้าจอ ไม่ใช่การจัดหน้าใหม่ให้คล้ายหน้าจอ
 */
describe('DailyReportView — บันทึกเป็นรูป และพิมพ์', () => {
  beforeEach(() => {
    capture.toPng.mockClear();
    capture.toPng.mockResolvedValue('data:image/png;base64,AAAA');
  });

  it('ตั้งชื่อไฟล์ด้วยวันที่นำหน้า แล้วตามด้วยขอบเขตที่ดูอยู่', async () => {
    // เรียงตัวเองได้ในโฟลเดอร์ เพราะคนเปิดหาคือหา "ของวันไหน"
    const user = userEvent.setup();
    const clicks: { download: string; href: string }[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    };
    try {
      renderView();
      await user.click(screen.getByRole('button', { name: /บันทึกเป็นรูป/ }));
      expect(clicks[0].download).toBe('2026-09-22-ทุกสาขา.png');
      expect(clicks[0].href).toContain('data:image/png');
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });

  it('ไม่เอาปุ่มและตัวเลือกวัน/สาขาติดไปในรูป', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /บันทึกเป็นรูป/ }));

    const filter = capture.toPng.mock.calls[0][1]!.filter!;
    const hidden = document.querySelector('[data-capture-hide]')!;
    expect(filter(hidden)).toBe(false);
    // ส่วนที่เป็นเนื้อรายงานยังผ่านตามปกติ
    expect(filter(screen.getByRole('heading', { name: /① ยอดขาย/ }))).toBe(true);
  });

  it('พื้นหลังขาวเสมอ ไม่ใช่สีของธีมที่เปิดอยู่', async () => {
    // คนที่เปิดโหมดมืดก็ยังส่งรูปให้คนอื่นอ่าน และพื้นดำที่พิมพ์ลงกระดาษคือหมึกเต็มหน้า
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /บันทึกเป็นรูป/ }));
    expect(capture.toPng.mock.calls[0][1]).toMatchObject({ backgroundColor: '#ffffff' });
  });

  it('กดพิมพ์ แล้วใบที่พิมพ์คือรูปนั้น ไม่ใช่ตารางอีกชุด', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      renderView();
      await user.click(screen.getByRole('button', { name: /พิมพ์ \/ PDF/ }));
      // รอให้รูปเข้า DOM ก่อนเปิดหน้าต่างพิมพ์ — ตัวจริงรอสองเฟรม ไม่งั้นหน้าต่าง
      // พิมพ์เปิดมาบนใบเปล่า
      await vi.waitFor(() => expect(print).toHaveBeenCalled());
      expect(capture.toPng).toHaveBeenCalled();
    } finally {
      print.mockRestore();
    }
  });

  it('แคปไม่สำเร็จ บอกออกมา ไม่ใช่เงียบ', async () => {
    capture.toPng.mockRejectedValueOnce(new Error('วาดรูปไม่สำเร็จ'));
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /บันทึกเป็นรูป/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('วาดรูปไม่สำเร็จ');
  });
});
