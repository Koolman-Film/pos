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
          {
            name: 'ฟิล์มกรองแสง',
            amount: 7500,
            count: 2,
            items: [
              { label: 'JT-CM-00101', amount: 5000, href: '/tickets/JT-CM-00101' },
              { label: 'JT-CM-00102', amount: 2500, href: '/tickets/JT-CM-00102' },
            ],
          },
          {
            name: 'เครื่องเสียง',
            amount: 4000,
            count: 1,
            items: [{ label: 'JT-CM-00103', amount: 4000, href: '/tickets/JT-CM-00103' }],
          },
        ],
        items: [
          { label: 'JT-CM-00101', amount: 5000, href: '/tickets/JT-CM-00101' },
          { label: 'JT-CM-00103', amount: 4000, href: '/tickets/JT-CM-00103' },
          { label: 'JT-CM-00102', amount: 2500, href: '/tickets/JT-CM-00102' },
        ],
      },
      {
        channel: 'ขายส่ง',
        total: 8000,
        count: 1,
        categories: [
          {
            name: 'ลำโพง',
            amount: 8000,
            count: 1,
            items: [{ label: 'WS-CM-0007', amount: 8000, href: '/wholesale/WS-CM-0007' }],
          },
        ],
        items: [{ label: 'WS-CM-0007', amount: 8000, href: '/wholesale/WS-CM-0007' }],
      },
    ],
    items: [
      { label: 'WS-CM-0007', amount: 8000, href: '/wholesale/WS-CM-0007' },
      { label: 'JT-CM-00101', amount: 5000, href: '/tickets/JT-CM-00101' },
      { label: 'JT-CM-00103', amount: 4000, href: '/tickets/JT-CM-00103' },
      { label: 'JT-CM-00102', amount: 2500, href: '/tickets/JT-CM-00102' },
    ],
    total: 19500,
    previousTotal: 10000,
    held: 700,
    documents: 4,
    outstanding: {
      count: 5,
      amount: 42300,
      items: [
        { label: 'JT-CM-00099', note: 'รอส่งมอบ', amount: 42300, href: '/tickets/JT-CM-00099' },
      ],
    },
  },
  inflow: {
    rows: [
      {
        key: 'a1',
        shop: 'cm',
        accountId: 1,
        name: 'เงินสดหน้าร้าน',
        amount: 7500,
        count: 2,
        items: [
          {
            label: 'JT-CM-00101',
            note: 'คุณ เอ · เงินสด',
            amount: 5000,
            href: '/tickets/JT-CM-00101',
          },
          {
            label: 'JT-CM-00102',
            note: 'คุณ บี · เงินสด',
            amount: 2500,
            href: '/tickets/JT-CM-00102',
          },
        ],
      },
      {
        key: 'lcm:โอน TTB',
        shop: 'cm',
        accountId: null,
        name: 'โอน TTB',
        amount: 700,
        count: 1,
        items: [{ label: 'โอน TTB', amount: 700 }],
      },
    ],
    total: 8200,
  },
  outflow: {
    rows: [
      {
        key: 'a3',
        shop: 'cm',
        accountId: 3,
        name: 'เงินสดย่อย',
        amount: 350,
        count: 1,
        items: [
          { label: 'POS-0012', note: 'ค่ากาแฟ · ของใช้สำนักงาน', amount: 350, href: '/accounting' },
        ],
      },
    ],
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
    // จำนวนงานเป็นปุ่มของตัวเองแล้ว (กดดูที่มาได้) ข้อความจึงถูกแยกเป็นสองชิ้น
    expect(screen.getByText(/▲ 95% จากเมื่อวาน/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' })).toHaveTextContent('4 งาน');
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

/**
 * ชี้เมาส์หรือกดค้างที่ตัวเลข "จำนวน" แล้วเห็นที่มา (ร้านขอ 2 ต.ค. 2569).
 *
 * "1 งาน" ตอบได้แค่ว่ามีกี่อัน และคำถามถัดไปคือ "อันไหน" เสมอ — เดิมต้องออกจาก
 * รายงานไปเปิดอีกโมดูลแล้วไล่หาเอง ซึ่งแปลว่าเลิกอ่านรายงานกลางคัน
 */
describe('DailyReportView — ที่มาของจำนวน', () => {
  it('ชี้เมาส์ที่จำนวนงาน แล้วเห็นใบงานที่จ่ายเงินเข้ามา', async () => {
    const user = userEvent.setup();
    renderView();
    await user.hover(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' }));
    const panel = await screen.findByRole('dialog', { name: 'ใบงาน / PO ที่จ่ายเงินเข้ามาวันนี้' });
    expect(within(panel).getByText('WS-CM-0007')).toBeInTheDocument();
    expect(within(panel).getByText('JT-CM-00101')).toBeInTheDocument();
    // รวมท้ายกล่อง เพื่อให้เทียบกับตัวเลขบนการ์ดได้ทันทีว่าครบไหม
    expect(within(panel).getByText('19,500.00')).toBeInTheDocument();
  });

  it('เปิดเอกสารต้นทางได้จากในป๊อปอัพ', async () => {
    const user = userEvent.setup();
    renderView();
    await user.hover(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByRole('link', { name: 'WS-CM-0007' })).toHaveAttribute(
      'href',
      '/wholesale/WS-CM-0007',
    );
  });

  it('จำนวนรายการของแต่ละแหล่งเงิน บอกว่าเงินก้อนไหนบ้าง', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'ดูที่มาของ2 รายการของ เงินสดหน้าร้าน' }));
    const panel = await screen.findByRole('dialog', { name: 'เงินสดหน้าร้าน' });
    expect(within(panel).getByText('คุณ เอ · เงินสด')).toBeInTheDocument();
  });

  it('งานค้างชำระ บอกสถานะ ณ วันนั้นของแต่ละงาน', async () => {
    // ไม่ใช่สถานะวันนี้ — รายงานของเมื่อวานต้องอ่านเหมือนเมื่อวาน
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'ดูที่มาของ5 งานขายค้างชำระ' }));
    const panel = await screen.findByRole('dialog', { name: 'งานขายค้างชำระ ณ สิ้นวัน' });
    expect(within(panel).getByText('รอส่งมอบ')).toBeInTheDocument();
  });

  it('คลิกคือการปักหมุด กล่องอยู่ต่อแม้เมาส์ออกไปแล้ว', async () => {
    // คนที่จะกดลิงก์ข้างในต้องเลื่อนเมาส์ออกจากตัวเลขก่อนเสมอ
    const user = userEvent.setup();
    renderView();
    const btn = screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' });
    await user.click(btn);
    await user.unhover(btn);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
  });

  it('ชี้เมาส์เฉย ๆ แล้วเอาเมาส์ออก กล่องปิดเอง', async () => {
    const user = userEvent.setup();
    renderView();
    const btn = screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' });
    await user.hover(btn);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    await user.unhover(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('กด Escape แล้วปิด แม้ปักหมุดไว้', async () => {
    const user = userEvent.setup();
    renderView();
    const btn = screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' });
    await user.click(btn);
    await user.keyboard('{Escape}');
    await user.unhover(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ป๊อปอัพไม่ติดไปในรูปที่แคป', async () => {
    // รูปของรายงานต้องเป็นรายงาน ไม่ใช่รายงานที่มีกล่องลอยบังอยู่
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' }));
    expect(screen.getByRole('dialog').closest('[data-capture-hide]')).not.toBeNull();
  });
});

/**
 * กล่องต้องอยู่ในจอ (ร้านเจอ 2 ต.ค. 2569).
 *
 * ตั้งต้นให้กล่องชิดขวาของตัวเลขเพราะตัวเลขส่วนใหญ่อยู่ชิดขวาของตาราง แต่ตัวเลข
 * บนการ์ดสรุปอยู่ชิดซ้ายของหน้า กล่องเลยกางทะลุไปทับแถบเมนูจนอ่านชื่อใบงานไม่ได้
 * เหลือแต่ตัวเลขเงิน — ข้อมูลอยู่ครบมาตลอด แต่คนอ่านมองไม่เห็น
 */
describe('DailyReportView — กล่องที่มาต้องไม่ล้นจอ', () => {
  const rect = (left: number, right: number) =>
    ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 }) as DOMRect;

  it('ล้นขอบซ้าย ถูกเลื่อนกลับเข้ามา', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect(-120, 120));
    try {
      renderView();
      await user.click(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' }));
      const panel = await screen.findByRole('dialog');
      // -120 + 128 = 8 — ขอบซ้ายพอดีกับระยะขอบที่เผื่อไว้
      expect(panel.style.transform).toBe('translateX(128px)');
    } finally {
      spy.mockRestore();
    }
  });

  it('อยู่ในจออยู่แล้ว ไม่ต้องเลื่อน', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect(200, 440));
    try {
      renderView();
      await user.click(screen.getByRole('button', { name: 'ดูที่มาของ4 งาน' }));
      const panel = await screen.findByRole('dialog');
      expect(panel.style.transform).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});
