import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(app)/money/actions', () => ({
  bindMoneyLabel: vi.fn(),
  closeMoneyAccount: vi.fn(),
  importPettyCashTopup: vi.fn(),
  reorderMoneyAccounts: vi.fn(),
  saveMoneyAccount: vi.fn(),
  saveMoneyReconciliation: vi.fn(),
  saveMoneyTransfer: vi.fn(),
  skipPettyCashTopup: vi.fn(),
}));

import { MoneyModule } from '@/components/money/MoneyModule';
import { buildMoneySources, type MoneyAccount } from '@/components/dashboard/moneyFlow';

/**
 * เช็คที่รับมาแล้วแต่ยังขึ้นเงินไม่ได้ ต้องเห็นบนหน้าการจัดการเงิน/บัญชี
 * (ร้านแจ้ง 6 พ.ย. 2569).
 *
 * ร้านเปิดกล่อง "เพิ่มแหล่งเงิน" เพื่อจะสร้างประเภท "เช็ค" เอง เพราะหน้านี้ไม่
 * พูดถึงเช็คเลย ทั้งที่ร้านขายส่งถือเช็คลงวันที่ล่วงหน้าอยู่เป็นปกติ — กระดาษ
 * กองหนึ่งที่เป็นสิทธิ์ในเงิน แต่ยังไม่ใช่ยอดคงเหลือของบัญชีไหน
 *
 * สิ่งที่ต้องไม่เกิดคือการนับมันเป็นเงินที่ใช้ได้ ยอดคงเหลือจึงต้องไม่ขยับ
 */
const SHOPS = [{ id: 'north', name: 'Finnix North' }];

const ACCOUNTS: MoneyAccount[] = [
  {
    id: 1,
    shop: 'north',
    name: 'บัญชีธนาคารสาขา',
    kind: 'bank',
    accountNo: '',
    openingBalance: 5000,
    openedAt: '2026-01-01',
    matchNames: [],
    owner: 'สาขา',
    sortOrder: 0,
  },
];

const CHEQUES = [
  {
    shop: 'north',
    orderId: 'WS-NT-0001',
    customerName: 'ร้านออโต้สไตล์',
    amount: 23000,
    method: 'บัญชีธนาคารสาขา',
    chequeNo: '0071284',
    chequeBank: 'กสิกรไทย',
    due: '2020-10-02',
  },
  {
    shop: 'north',
    orderId: 'WS-NT-0002',
    customerName: 'ร้านดีคาร์แคร์',
    amount: 21750,
    method: 'บัญชีธนาคารสาขา',
    chequeNo: '0038119',
    chequeBank: 'กรุงเทพ',
    due: '2099-09-05',
  },
];

const renderMoney = (pendingCheques = CHEQUES) =>
  render(
    <MoneyModule
      shops={SHOPS}
      accounts={ACCOUNTS}
      overview={buildMoneySources(SHOPS, ACCOUNTS, [], [])}
      transfers={[]}
      reconciliations={[]}
      pendingCheques={pendingCheques}
    />,
  );

const chequeCard = () =>
  screen.getByText('เช็คและเงินที่รอเรียกเก็บ').closest('.card') as HTMLElement;

describe('การจัดการเงิน/บัญชี — เช็คที่ยังขึ้นเงินไม่ได้', () => {
  it('แสดงเช็คที่ถืออยู่ พร้อมวันที่ที่ขึ้นเงินได้', () => {
    renderMoney();
    const card = chequeCard();
    const rows = within(card).getByRole('table');
    expect(within(rows).getByText(/0071284/)).toBeInTheDocument();
    expect(within(rows).getByText(/2 ต.ค. 2563/)).toBeInTheDocument();
    expect(within(rows).getByText('23,000.00')).toBeInTheDocument();
    expect(within(rows).getByText('21,750.00')).toBeInTheDocument();
  });

  it('บอกว่าใบไหนเลยกำหนดแล้ว แยกจากใบที่ยังไม่ถึงวันที่', () => {
    // ใบที่เลยกำหนดแล้วยังไม่ยืนยัน คือเงินที่ไม่มีใครเอาไปเข้าบัญชี หรือเช็ค
    // ที่เด้งโดยไม่มีใครบันทึก — ทั้งสองทางต้องมีคนตาม
    renderMoney();
    const card = chequeCard();
    // ใบเก่าเลยกำหนด 23,000 · ใบลงวันที่ปี 2099 ยังไม่ถึง 21,750
    expect(within(card).getByText(/ถึงกำหนดแล้วยังไม่ยืนยัน/)).toHaveTextContent('23,000.00');
    expect(within(card).getByText(/ยังไม่ถึงวันที่หน้าเช็ค/)).toHaveTextContent('21,750.00');
    // ติดป้าย "เลยกำหนด" เฉพาะใบที่เลยจริง ใบปี 2099 ต้องไม่ติด
    expect(within(card).getAllByText(/เลยกำหนด/)).toHaveLength(1);
  });

  it('ยอดคงเหลือของบัญชีต้องไม่ขยับเพราะเช็คที่ยังไม่ขึ้นเงิน', () => {
    /*
      ข้อที่สำคัญที่สุดในไฟล์นี้. ถ้าเช็คถูกนับเป็นเงิน ร้านจะเห็นยอดที่เอาไป
      ใช้ไม่ได้ ซึ่งแย่กว่าการไม่เห็นเช็คเลย — 44,750 ที่ขึ้นเงินไม่ได้ จะทำให้
      บัญชี 5,000 อ่านได้เป็น 49,750
    */
    renderMoney();
    const table = screen.getByText('รวมทั้งสาขา').closest('table') as HTMLElement;
    expect(within(table).getAllByText('5,000.00').length).toBeGreaterThan(0);
    expect(within(table).queryByText(/49,750/)).not.toBeInTheDocument();
    expect(within(table).queryByText(/44,750/)).not.toBeInTheDocument();
  });

  it('พูดออกมาตรง ๆ ว่าไม่ได้รวมอยู่ในยอดข้างบน', () => {
    renderMoney();
    expect(within(chequeCard()).getByText(/ไม่ได้รวมอยู่ในยอดคงเหลือข้างบน/)).toBeInTheDocument();
  });

  it('บอกว่าเงินจะเข้าบัญชีไหน เมื่อขึ้นเงินได้', () => {
    // คนอ่านต้องตอบได้ว่าเงินก้อนนี้จะไปโผล่ที่ไหน ไม่ใช่แค่ว่ามีอยู่
    renderMoney();
    expect(within(chequeCard()).getAllByText('บัญชีธนาคารสาขา').length).toBeGreaterThan(0);
  });

  it('ไม่มีเช็คค้าง ก็ไม่ต้องมีหัวข้อนี้', () => {
    renderMoney([]);
    expect(screen.queryByText('เช็คและเงินที่รอเรียกเก็บ')).not.toBeInTheDocument();
  });
});

describe('เพิ่มแหล่งเงิน — ทำไมไม่มีประเภทเช็ค', () => {
  it('ไม่มีประเภทเช็คให้สร้าง และบอกว่าเช็คไปอยู่ไหนแทน', async () => {
    /*
      ถ้าเช็คกลายเป็นบัญชีหนึ่งได้ เงินที่ขึ้นเช็คแล้วจะไปกองอยู่ในบัญชีนั้นแทน
      ที่จะเข้าธนาคารจริง และไม่มีอะไรย้ายมันออกมา — กล่องนี้จึงต้องบอกว่าเช็ค
      ไปอยู่ตรงไหนแทน ไม่ใช่แค่ไม่มีให้เลือก
    */
    const user = userEvent.setup();
    renderMoney();
    await user.click(screen.getByRole('button', { name: /เพิ่มแหล่งเงิน/ }));

    const kinds = within(screen.getByLabelText('ประเภทแหล่งเงิน'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(kinds.some((k) => k.includes('เช็ค'))).toBe(false);
    expect(screen.getByText(/ไม่มีประเภท/)).toHaveTextContent(/เช็คและเงินที่รอเรียกเก็บ/);
  });
});
