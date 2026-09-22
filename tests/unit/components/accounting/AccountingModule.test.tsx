import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccountingModule } from '@/components/accounting/AccountingModule';

const expenses = [
  {
    id: 1,
    shop: 'cm',
    desc: 'ค่าเช่าร้านเดือนกรกฎาคม',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 35000,
    status: 'จ่ายแล้ว',
  },
];
const pettyCash = [{ id: 1, shop: 'cm', type: 'เติมเงิน', amount: 10000 }];

describe('AccountingModule', () => {
  it('hides the topup-cash button when canDo("accounting.topupCash") is false', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => false} />);
    expect(screen.queryByText('เติมเงินสดย่อย')).not.toBeInTheDocument();
  });

  it('renders an expense row with its amount formatted via lib/domain/format.ts fmt()', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => true} />);
    // The formatted amount '35,000.00' appears both in the "จ่ายแล้ว" summary
    // card and in the expense row, so scope the assertion to the expense list
    // (the plan snippet's bare getByText would match both). The intent — the row
    // amount is rendered through fmt() — is what we verify.
    const list = screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;
    expect(within(list).getByText('35,000.00')).toBeInTheDocument();
    expect(within(list).getByText('ค่าเช่าร้านเดือนกรกฎาคม')).toBeInTheDocument();
  });
});

const SHOPS = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

/** Paid + pending, in two shops, so filters and totals have something to bite on. */
const mixedExpenses = [
  {
    id: 1,
    shop: 'cm',
    desc: 'ค่าเช่าร้าน',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 35000,
    status: 'จ่ายแล้ว',
  },
  {
    id: 2,
    shop: 'cm',
    desc: 'ค่าไฟฟ้า',
    category: 'ค่าน้ำ-ไฟ',
    source: 'บัญชีธนาคารสาขา',
    amount: 12400,
    status: 'รอจ่าย',
    due: '25 ก.ค. 2569',
  },
  {
    id: 3,
    shop: 'cm',
    desc: 'ค่ากาแฟ',
    category: 'การตลาด',
    source: 'เงินสดย่อย',
    amount: 150,
    status: 'จ่ายแล้ว',
  },
  {
    id: 4,
    shop: 'lp',
    desc: 'ค่าเช่าลำพูน',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 20000,
    status: 'จ่ายแล้ว',
  },
];

const renderAccounting = (over: Record<string, unknown> = {}) =>
  render(
    <AccountingModule
      expenses={mixedExpenses}
      pettyCash={pettyCash}
      accessibleShops={SHOPS}
      expenseCategories={['ค่าเช่า', 'ค่าน้ำ-ไฟ', 'การตลาด']}
      paymentSources={['เงินสดย่อย', 'บัญชีธนาคารสาขา']}
      canDo={() => true}
      {...over}
    />,
  );

describe('AccountingModule capability gates', () => {
  it('shows both write buttons for a fully-capable user', () => {
    renderAccounting();
    expect(screen.getByText('เพิ่มรายการ')).toBeInTheDocument();
    // 'เติมเงินสดย่อย' is also the balance-card label, so target the button.
    expect(screen.getByRole('button', { name: /เติมเงินสดย่อย/ })).toBeInTheDocument();
  });

  it('hides the add-expense button on its own capability', () => {
    renderAccounting({ canDo: undefined, canAddExpense: false, canTopupCash: true });
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เติมเงินสดย่อย/ })).toBeInTheDocument();
  });

  it('prefers the explicit boolean props a Server Component passes over canDo', () => {
    // The page cannot hand over a closure, so it pre-evaluates the booleans; when
    // both are present the booleans must win.
    renderAccounting({ canDo: () => true, canAddExpense: false });
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
  });

  it('denies by default when given neither form', () => {
    render(<AccountingModule expenses={mixedExpenses} pettyCash={pettyCash} />);
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เติมเงินสดย่อย/ })).not.toBeInTheDocument();
  });

  it('gates the Excel export independently', () => {
    const { rerender } = renderAccounting({ canDo: undefined, canExport: true });
    expect(screen.getByText(/Excel/)).toBeInTheDocument();

    rerender(
      <AccountingModule
        expenses={mixedExpenses}
        pettyCash={pettyCash}
        accessibleShops={SHOPS}
        canExport={false}
      />,
    );
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument();
  });
});

describe('AccountingModule totals', () => {
  it('separates the paid total from the pending total', () => {
    renderAccounting();
    // Shop filter defaults to the first accessible shop (cm), so lp is excluded:
    // paid = 35,000 + 150; pending = 12,400. Both figures also appear on
    // individual rows, so scope to the three summary cards at the top.
    const summary = screen.getByText('เงินสดย่อยคงเหลือ').closest('.grid') as HTMLElement;
    expect(within(summary).getByText('35,150.00')).toBeInTheDocument();
    expect(within(summary).getByText('12,400.00')).toBeInTheDocument();
  });

  it('shows the petty-cash balance as topups minus cash-funded paid expenses', () => {
    // 10,000 topped up, 150 paid from เงินสดย่อย → 9,850.
    renderAccounting();
    expect(screen.getByText('9,850.00')).toBeInTheDocument();
  });

  it('lists both the paid and the pending row', () => {
    // The due date itself is only surfaced on the dashboard's เจ้าหนี้ card in the
    // prototype (:807), not in this list, so do not assert it here.
    renderAccounting();
    const list = screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;
    expect(within(list).getByText('ค่าเช่าร้าน')).toBeInTheDocument();
    expect(within(list).getByText('ค่าไฟฟ้า')).toBeInTheDocument();
  });

  it('survives having no expenses and no petty cash', () => {
    render(<AccountingModule expenses={[]} pettyCash={[]} accessibleShops={SHOPS} />);
    expect(screen.getByText('บัญชี / ค่าใช้จ่าย')).toBeInTheDocument();
  });
});

describe('AccountingModule attachments', () => {
  it('previews a stored receipt in place, through a signed URL rather than a download', async () => {
    const user = userEvent.setup();
    const attachmentUrlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <AccountingModule
        expenses={[
          {
            id: 1,
            shop: 'cm',
            desc: 'ค่าเช่าร้าน',
            category: 'ค่าเช่า',
            source: 'บัญชีธนาคารสาขา',
            amount: 35000,
            status: 'จ่ายแล้ว',
            attachments: [{ id: 7, fileName: 'สลิปโอน.jpg', path: 'cm/abc-slip.jpg' }],
          },
        ]}
        pettyCash={[]}
        accessibleShops={SHOPS}
        attachmentUrlAction={attachmentUrlAction}
      />,
    );

    const chip = screen.getByTitle('เปิด สลิปโอน.jpg');
    expect(chip).toBeInTheDocument();

    await user.click(chip);

    expect(attachmentUrlAction).toHaveBeenCalledWith('cm/abc-slip.jpg');

    // The receipt opens INSIDE the page — no new tab, no file on disk.
    const dialog = await screen.findByRole('dialog', { name: /สลิปโอน\.jpg/ });
    expect(within(dialog).getByAltText('สลิปโอน.jpg')).toHaveAttribute(
      'src',
      'https://signed.example/slip.jpg',
    );
    expect(open).not.toHaveBeenCalled();

    // …but the escape hatch is there for anyone who does want the file.
    expect(within(dialog).getByText('เปิดแท็บใหม่')).toHaveAttribute(
      'href',
      'https://signed.example/slip.jpg',
    );

    await user.click(within(dialog).getByLabelText('ปิดหน้าต่างดูไฟล์แนบ'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open.mockRestore();
  });

  it('renders no attachment chips for an expense without any', () => {
    render(<AccountingModule expenses={mixedExpenses} pettyCash={[]} accessibleShops={SHOPS} />);
    expect(screen.queryByTitle(/^เปิด /)).not.toBeInTheDocument();
  });
});

/**
 * เงินรอรับคืน Finnix (migration 0032).
 *
 * The branch pays a bill that belongs to another Finnix shop. The cash left the
 * drawer — so the row stays in the list and in the petty-cash balance — but it
 * is not this branch's cost, and counting it as one understates the profit by
 * exactly the amount the shop is waiting to get back.
 */
describe('AccountingModule — เงินรอรับคืน Finnix', () => {
  const mixed = [
    { ...expenses[0], id: 1, amount: 35000, dateObj: new Date() },
    {
      id: 2,
      shop: 'cm',
      desc: 'ค่าฟิล์มงานร้านต้นทาง',
      category: 'ค่าวัสดุสิ้นเปลือง',
      source: 'บัญชีธนาคารสาขา',
      amount: 12000,
      status: 'จ่ายแล้ว',
      paidForFinnix: true,
      dateObj: new Date(),
    },
  ];

  it('keeps money paid for Finnix out of จ่ายแล้ว and reports it on its own', () => {
    render(<AccountingModule expenses={mixed} pettyCash={pettyCash} />);

    const paidCard = screen
      .getAllByText('จ่ายแล้ว')
      .find((el) => el.tagName === 'P')!
      .closest('div')!;
    expect(within(paidCard).getByText('35,000.00')).toBeInTheDocument();

    const heldCard = screen.getByText('เงินรอรับคืน Finnix').closest('div')!;
    expect(within(heldCard).getByText('12,000.00')).toBeInTheDocument();
    expect(within(heldCard).getByText(/1 รายการ/)).toBeInTheDocument();
  });

  it('lists each reimbursable row in its own report', async () => {
    render(<AccountingModule expenses={mixed} pettyCash={pettyCash} />);
    // The panel is folded to start (ร้านขอ 19 ก.ย. 2569) — the rows are for the
    // day somebody settles up, not for every visit to the page.
    await userEvent.setup().click(screen.getByRole('button', { name: /เงินรอรับคืน Finnix/ }));
    const report = screen
      .getByText(/เงินรอรับคืน Finnix \(1 รายการ\)/)
      .closest('.card') as HTMLElement;
    expect(within(report).getByText('ค่าฟิล์มงานร้านต้นทาง')).toBeInTheDocument();
    expect(within(report).queryByText('ค่าเช่าร้านเดือนกรกฎาคม')).not.toBeInTheDocument();
  });

  it('says nothing at all when the period holds none', () => {
    render(
      <AccountingModule
        expenses={[{ ...expenses[0], dateObj: new Date() }]}
        pettyCash={pettyCash}
      />,
    );
    expect(screen.queryByText(/เงินรอรับคืน Finnix \(/)).not.toBeInTheDocument();
    // The card stays, so the shop can see the figure is zero.
    expect(screen.getByText('เงินรอรับคืน Finnix')).toBeInTheDocument();
    expect(screen.getByText('ไม่มีในช่วงนี้')).toBeInTheDocument();
  });
});

/**
 * แก้ไขรายการค่าใช้จ่ายที่บันทึกไปแล้ว.
 *
 * The edit row used to expose only some of the fields, so a row entered against
 * the wrong branch, or one that should have been marked จ่ายแทน, could only be
 * fixed by deleting it and typing it again — which loses its document number and
 * its receipts.
 */
describe('AccountingModule — แก้ไขได้ทุกหัวข้อ', () => {
  const row = {
    id: 9,
    docNo: 'POS-CM-6908001',
    shop: 'cm',
    desc: 'ค่าฟิล์มงานร้านต้นทาง',
    category: 'ค่าวัสดุสิ้นเปลือง',
    source: 'บัญชีธนาคารสาขา',
    amount: 12000,
    status: 'จ่ายแล้ว',
    // Today, not a fixed date. The module defaults to รายเดือน on the current
    // month, so a hard-coded August date put the row outside the window the
    // moment September began, and these two tests started failing at midnight
    // on something neither of them is about.
    dateObj: new Date(),
    paidForFinnix: false,
  };
  const SHOPS = [
    { id: 'cm', name: 'FINNIX CM' },
    { id: 'lpg', name: 'FINNIX ลำปาง' },
  ];

  async function openEdit() {
    const user = userEvent.setup();
    const updateExpenseAction = vi.fn(async () => {});
    render(
      <AccountingModule
        expenses={[row]}
        pettyCash={[]}
        accessibleShops={SHOPS}
        updateExpenseAction={updateExpenseAction}
        canAddExpense
      />,
    );
    await user.click(screen.getByLabelText(/แก้ไขรายการ/));
    return { user, updateExpenseAction };
  }

  it('moves a row to another branch and marks it จ่ายแทน', async () => {
    const { user, updateExpenseAction } = await openEdit();

    await user.selectOptions(screen.getByLabelText('แก้ไขสาขาของรายการค่าใช้จ่าย'), 'lpg');
    await user.click(screen.getByRole('button', { name: 'จ่ายแทน Finnix' }));
    await user.click(screen.getByRole('button', { name: /บันทึก/ }));

    expect(updateExpenseAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, shop: 'lpg', paidForFinnix: true }),
    );
  });

  it('edits กำหนดจ่าย once the row is moved back to รอจ่าย', async () => {
    // The pending date had no field at all before, and the paid date used to be
    // left behind on a row that was no longer paid.
    const { user, updateExpenseAction } = await openEdit();

    await user.selectOptions(screen.getByLabelText('แก้ไขสถานะการจ่าย'), 'รอจ่าย');
    const due = screen.getByLabelText('กำหนดจ่าย');
    await user.clear(due);
    await user.type(due, '2026-09-15');
    await user.click(screen.getByRole('button', { name: /บันทึก/ }));

    expect(updateExpenseAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'รอจ่าย', paidAt: null, dueAt: '2026-09-15' }),
    );
  });
});

/**
 * รายการรับ-จ่ายเงินสดย่อย.
 *
 * The panel used to list only what was spent, which is half a cash book: the
 * balance above it moves on top-ups too, so with only the spends on screen there
 * was no way to see why the two did not agree.
 */
describe('AccountingModule — รายการรับ-จ่ายเงินสดย่อย', () => {
  const today = new Date();
  const rows = [
    {
      ...expenses[0],
      id: 3,
      desc: 'เติมแก๊ส',
      category: 'ค่าวัสดุสิ้นเปลือง',
      source: 'เงินสดย่อย',
      amount: 520,
      status: 'จ่ายแล้ว',
      dateObj: today,
    },
  ];
  const topups = [
    { id: 1, shop: 'cm', type: 'เติมเงิน', amount: 5000, dateObj: today, note: 'เติมต้นเดือน' },
  ];

  async function openPanel() {
    const user = userEvent.setup();
    render(<AccountingModule expenses={rows} pettyCash={topups} accessibleShops={SHOPS_CM} />);
    await user.click(screen.getByText('เงินสดย่อยคงเหลือ'));
    return user;
  }
  const SHOPS_CM = [{ id: 'cm', name: 'FINNIX CM' }];

  it('shows the top-up as money in and the expense as money out', async () => {
    await openPanel();
    const panel = screen
      .getByText(/รายการที่รับ-จ่ายจากเงินสดย่อย/)
      .closest('.card') as HTMLElement;
    expect(within(panel).getByText('เติมต้นเดือน')).toBeInTheDocument();
    expect(within(panel).getByText('เติมแก๊ส')).toBeInTheDocument();
    expect(within(panel).getByText(/\+5,000\.00/)).toBeInTheDocument();
    expect(within(panel).getByText(/−520\.00/)).toBeInTheDocument();
  });

  it('totals the NET movement, not the spending', async () => {
    // 5,000 in − 520 out. Summing them as one pile would say 5,520, which is
    // neither what was spent nor what the balance moved by.
    await openPanel();
    const panel = screen
      .getByText(/รายการที่รับ-จ่ายจากเงินสดย่อย/)
      .closest('.card') as HTMLElement;
    expect(within(panel).getByText('เคลื่อนไหวสุทธิ')).toBeInTheDocument();
    expect(within(panel).getByText(/\+4,480\.00/)).toBeInTheDocument();
    expect(within(panel).getByText(/เติมเข้า 5,000\.00/)).toBeInTheDocument();
  });
});

/**
 * กลุ่มค่าใช้จ่าย และ แหล่งเงินที่จ่าย คนละสี (ร้านขอ 19 ก.ย. 2569).
 *
 * The two answer different questions — what the money went ON, and which pot it
 * came OUT OF — and sat in one grey line a middot apart, so telling them apart
 * meant reading both every time.
 */
describe('AccountingModule — สีของกลุ่มค่าใช้จ่าย และแหล่งเงิน', () => {
  const listOf = () => screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;

  it('gives each of the two its own colour', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => true} />);
    const list = listOf();
    expect(within(list).getByText('ค่าเช่า')).toHaveStyle({ color: 'var(--expense-group)' });
    expect(within(list).getByText('บัญชีธนาคารสาขา')).toHaveStyle({
      color: 'var(--money-source)',
    });
  });

  it('leaves the document number and the date as they were', () => {
    // Only the two that were being confused are tinted; colouring the whole
    // line would just be a different kind of unreadable.
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => true} />);
    const line = within(listOf()).getByText('ค่าเช่า').parentElement as HTMLElement;
    expect(line).toHaveStyle({ color: 'var(--ink-soft)' });
  });
});

/**
 * กรองตามกลุ่มค่าใช้จ่าย พิมพ์ค้นหาได้ (ร้านขอ 19 ก.ย. 2569).
 *
 * "หากมีกลุ่มค่าใช้จ่ายเยอะกว่านี้จะทำให้เสียเวลาในการเลือก" — the shop already
 * runs past twenty groups. The forms got the typed picker earlier; this is the
 * same list in the filter row, so it answers to typing too.
 */
describe('AccountingModule — กรองตามกลุ่มค่าใช้จ่าย', () => {
  const filter = () => screen.getByRole('combobox', { name: 'กรองตามกลุ่มค่าใช้จ่าย' });

  it('narrows the list to what was typed', async () => {
    const user = userEvent.setup();
    renderAccounting();
    await user.click(filter());
    await user.type(filter(), 'ตลาด');
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('การตลาด')).toBeInTheDocument();
    expect(within(list).queryByText('ค่าเช่า')).not.toBeInTheDocument();
  });

  it('filters the expenses to the group chosen', async () => {
    const user = userEvent.setup();
    renderAccounting();
    await user.click(filter());
    await user.type(filter(), 'ตลาด');
    await user.click(within(screen.getByRole('listbox')).getByText('การตลาด'));

    const list = screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;
    expect(within(list).getByText('ค่ากาแฟ')).toBeInTheDocument();
    expect(within(list).queryByText('ค่าเช่าร้าน')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, instead of showing an empty box', async () => {
    const user = userEvent.setup();
    renderAccounting();
    await user.click(filter());
    await user.type(filter(), 'ไม่มีกลุ่มนี้');
    expect(screen.getByText('ไม่พบกลุ่มค่าใช้จ่ายที่ค้นหา')).toBeInTheDocument();
  });
});

/**
 * เงินรอรับคืน Finnix ยุบไว้ (ร้านขอ 19 ก.ย. 2569).
 *
 * "ใช้พื้นที่หน้าจอเยอะเกิน" — the table listed every bill the branch fronted
 * for another Finnix shop and sat open above รายการค่าใช้จ่าย, so the list the
 * page exists for was a screen and a half down. How many and how much is what
 * gets read daily; the rows are for the day somebody settles up.
 */
describe('AccountingModule — เงินรอรับคืน Finnix', () => {
  const finnixExpenses = [
    {
      id: 9,
      shop: 'cm',
      desc: 'ค่าส่งฟิล์มกันรอย',
      docNo: 'POS-CM-6909081',
      category: 'ขนส่ง/ไปรษณีย์',
      source: 'เงินสดย่อย',
      amount: 120,
      status: 'จ่ายแล้ว',
      paidForFinnix: true,
    },
  ];
  const panel = () => screen.getByRole('button', { name: /เงินรอรับคืน Finnix/ });
  const card = () => panel().closest('.card') as HTMLElement;

  it('keeps the headline but folds the rows away', () => {
    renderAccounting({ expenses: finnixExpenses });
    expect(panel()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toHaveTextContent('(1 รายการ)');
    expect(panel()).toHaveTextContent('120.00');
    expect(within(card()).queryByText('POS-CM-6909081')).not.toBeInTheDocument();
  });

  it('opens the rows when the heading is pressed', async () => {
    const user = userEvent.setup();
    renderAccounting({ expenses: finnixExpenses });
    await user.click(panel());
    expect(panel()).toHaveAttribute('aria-expanded', 'true');
    expect(within(card()).getByText('POS-CM-6909081')).toBeInTheDocument();
  });
});

/**
 * จ่ายจาก = แหล่งเงินของสาขา (migration 0064, ร้านขอ 22 ก.ย. 2569) — the account
 * picked is the balance the expense comes off.
 */
describe('AccountingModule — จ่ายจากแหล่งเงิน', () => {
  const ACCOUNTS = [
    { id: 1, shop: 'cm', name: 'เงินสดย่อย', kind: 'petty' },
    { id: 2, shop: 'cm', name: 'กสิกร ออมทรัพย์', kind: 'bank' },
    { id: 3, shop: 'cm', name: 'บัตรเครดิตบริษัท', kind: 'credit' },
    { id: 4, shop: 'lp', name: 'SCB ลำพูน', kind: 'bank' },
  ];

  async function openAdd(addExpenseAction = vi.fn(async () => {})) {
    const user = userEvent.setup();
    renderAccounting({ moneyAccounts: ACCOUNTS, addExpenseAction });
    await user.click(screen.getByRole('button', { name: /เพิ่มรายการ/ }));
    // The list opens on the first branch the caller has — เชียงใหม่ here.
    return { user, addExpenseAction };
  }

  it('offers every account of the branch — petty cash and the company card included', async () => {
    await openAdd();
    const options = within(screen.getByLabelText('จ่ายจาก'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'เลือกแหล่งเงินที่จ่าย...',
      'เงินสดย่อย',
      'กสิกร ออมทรัพย์',
      'บัตรเครดิตบริษัท',
    ]);
  });

  it('will not save money already paid out without saying where it came from', async () => {
    const { user, addExpenseAction } = await openAdd();
    await user.type(screen.getByLabelText('รายละเอียดรายการที่ 1'), 'ค่าน้ำมัน');
    await user.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));
    expect(addExpenseAction).not.toHaveBeenCalled();
    expect(screen.getByText(/เลือก "จ่ายจาก"/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('จ่ายจาก'), 'เงินสดย่อย');
    await user.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));
    expect(addExpenseAction).toHaveBeenCalledWith(
      expect.objectContaining({ shop: 'cm', source: 'เงินสดย่อย' }),
    );
  });
});

/**
 * รายงานเงินสดย่อย Excel / PDF (ร้านขอ 22 ก.ย. 2569), and the cash book
 * following the branch's real petty-cash account.
 */
describe('AccountingModule — รายงานเงินสดย่อย', () => {
  const today = new Date();
  const ymd = today.toLocaleDateString('en-CA');
  const cash = [
    { id: 1, shop: 'cm', type: 'เติมเงิน', amount: 10000, dateObj: today, date: ymd, note: '' },
  ];
  const spent = [
    {
      id: 21,
      shop: 'cm',
      desc: 'ค่ากาแฟรับลูกค้า',
      category: 'การตลาด',
      // The petty-cash account, renamed by the branch.
      source: 'กล่องเงินสดย่อยหน้าร้าน',
      amount: 150,
      status: 'จ่ายแล้ว',
      dateObj: today,
      date: ymd,
    },
  ];
  const ACCOUNTS = [{ id: 3, shop: 'cm', name: 'กล่องเงินสดย่อยหน้าร้าน', kind: 'petty' }];

  async function openCashBook(
    exportAction = vi.fn(async () => ({ fileName: 'x.xlsx', base64: '' })),
  ) {
    const user = userEvent.setup();
    renderAccounting({
      expenses: spent,
      pettyCash: cash,
      moneyAccounts: ACCOUNTS,
      canExport: true,
      exportAction,
    });
    await user.click(screen.getByText('เงินสดย่อยคงเหลือ'));
    return { user, exportAction };
  }

  it('counts a spend from the branch’s petty-cash account, whatever it is called', async () => {
    await openCashBook();
    // The expense list shows it too; the cash book's footer is the one that
    // only moves when the spend is counted as petty cash.
    expect(screen.getAllByText('ค่ากาแฟรับลูกค้า').length).toBeGreaterThan(1);
    expect(screen.getByText(/เติมเข้า 10,000.00/)).toHaveTextContent('จ่ายออก 150.00');
  });

  it('exports the cash book to Excel, money in and out in their own columns', async () => {
    const { user, exportAction } = await openCashBook();
    await user.click(screen.getByRole('button', { name: 'ส่งออกเงินสดย่อยเป็น Excel' }));
    const payload = (exportAction.mock.calls as unknown as unknown[][])[0][0] as {
      groups: { sheetName: string; rows: Record<string, unknown>[] }[];
    };
    expect(payload.groups[0].sheetName).toBe('เงินสดย่อย');
    const rows = payload.groups[0].rows;
    expect(rows).toContainEqual(
      expect.objectContaining({ รายการ: 'ค่ากาแฟรับลูกค้า', จ่ายออก: 150 }),
    );
    expect(rows).toContainEqual(expect.objectContaining({ ประเภท: 'เติมเงิน', รับเข้า: 10000 }));
    expect(rows).toContainEqual(
      expect.objectContaining({ รายการ: 'เคลื่อนไหวสุทธิ', รับเข้า: 9850 }),
    );
  });

  it('prints the cash book, not the expense list, for its PDF', async () => {
    let printed = '';
    vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.querySelector('.print-area')?.textContent ?? '';
    });
    const { user } = await openCashBook();
    await user.click(screen.getByRole('button', { name: 'พิมพ์เงินสดย่อยเป็น PDF' }));
    expect(printed).toContain('รายการรับ-จ่ายเงินสดย่อย');
    expect(printed).toContain('เคลื่อนไหวสุทธิ: 9,850.00');
    // …and the page's own print goes back to the expense list afterwards.
    expect(document.querySelector('.print-area')?.textContent).toContain('รายการค่าใช้จ่าย');
  });
});
