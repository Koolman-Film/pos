'use client';

import { useState } from 'react';

import { SavedToast } from '@/components/ui/SavedToast';
import { fmt, fmtThaiDayString, shortShopName } from '@/lib/domain/format';
import { dateInputValue } from '@/lib/domain/now';
import type { MoneyAccount, MoneyOverview } from '@/components/dashboard/moneyFlow';

import {
  closeMoneyAccount,
  saveMoneyAccount,
  saveMoneyReconciliation,
  saveMoneyTransfer,
  type SaveAccountInput,
} from '@/app/(app)/money/actions';

/**
 * การจัดการเงิน/บัญชี — the register behind the dashboard's money card.
 *
 * Three jobs on one screen, in the order the bookkeeper does them:
 *   1. แหล่งเงิน — what accounts exist, and the opening balance each starts from.
 *   2. โอน/ฝากเงิน — moving money between them, which is neither income nor cost.
 *   3. กระทบยอด — what was counted, against what the system says.
 *
 * The balances shown are computed by the same function as the dashboard card, so
 * the two screens cannot drift apart.
 */

export type TransferRow = {
  id: number;
  shop: string;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: number;
  movedAt: string;
  note: string;
};

export type ReconciliationRow = {
  id: number;
  accountId: number;
  countedAt: string;
  countedBalance: number;
  systemBalance: number;
  note: string;
};

const KINDS: { key: string; label: string }[] = [
  { key: 'bank', label: 'บัญชีธนาคาร' },
  { key: 'cash', label: 'เงินสด' },
  { key: 'petty', label: 'เงินสดย่อย' },
  { key: 'credit', label: 'บัตรเครดิต' },
];

const blankAccount = (shop: string): SaveAccountInput => ({
  shop,
  name: '',
  kind: 'bank',
  accountNo: '',
  openingBalance: 0,
  openedAt: dateInputValue(new Date()),
  matchNames: [],
});

export function MoneyModule({
  shops,
  accounts,
  overview,
  transfers,
  reconciliations,
}: {
  shops: { id: string; name: string }[];
  accounts: MoneyAccount[];
  overview: MoneyOverview;
  transfers: TransferRow[];
  reconciliations: ReconciliationRow[];
}) {
  const [shop, setShop] = useState(shops[0]?.id ?? '');
  const [draft, setDraft] = useState<SaveAccountInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const branch = overview.branches.find((b) => b.shop === shop);
  const shopAccounts = accounts.filter((a) => a.shop === shop);
  const accountName = (id: number | null) =>
    id ? (accounts.find((a) => a.id === id)?.name ?? '—') : 'นอกระบบ';

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error || 'บันทึกไม่สำเร็จ');
        return false;
      }
      setSaved(message);
      return true;
    } finally {
      setBusy(false);
    }
  }

  // ---- โอน/ฝากเงิน -----------------------------------------------------
  const [transfer, setTransfer] = useState({
    fromAccountId: '' as string,
    toAccountId: '' as string,
    amount: '',
    movedAt: dateInputValue(new Date()),
    note: '',
  });

  async function submitTransfer() {
    const ok = await run(
      () =>
        saveMoneyTransfer({
          shop,
          fromAccountId: transfer.fromAccountId ? Number(transfer.fromAccountId) : null,
          toAccountId: transfer.toAccountId ? Number(transfer.toAccountId) : null,
          amount: Number(transfer.amount) || 0,
          movedAt: transfer.movedAt,
          note: transfer.note,
        }),
      'บันทึกการโอนเงินแล้ว',
    );
    if (ok) {
      setTransfer({
        fromAccountId: '',
        toAccountId: '',
        amount: '',
        movedAt: dateInputValue(new Date()),
        note: '',
      });
    }
  }

  // ---- กระทบยอด --------------------------------------------------------
  const [count, setCount] = useState({ accountId: '', counted: '', note: '' });

  async function submitCount() {
    const id = Number(count.accountId);
    const system = branch?.accounts.find((a) => a.id === id)?.balance ?? 0;
    const ok = await run(
      () =>
        saveMoneyReconciliation({
          accountId: id,
          countedAt: dateInputValue(new Date()),
          countedBalance: Number(count.counted) || 0,
          systemBalance: system,
          note: count.note,
        }),
      'บันทึกการกระทบยอดแล้ว',
    );
    if (ok) setCount({ accountId: '', counted: '', note: '' });
  }

  const field = 'field text-sm px-3 py-2 w-full';
  const label = 'text-xs';
  const labelStyle = { color: 'var(--ink-soft)' };

  return (
    <div className="fade-page">
      <div className="mb-4">
        <h1 className="text-xl font-bold">การจัดการเงิน/บัญชี</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
          แหล่งเงินของแต่ละสาขา ยอดตั้งต้น การโอนเงิน และการกระทบยอดกับเงินจริง
        </p>
      </div>

      {shops.length > 1 && (
        <div className="card p-3 mb-4 flex flex-wrap items-center gap-1.5">
          {shops.map((s) => (
            <button
              key={s.id}
              onClick={() => setShop(s.id)}
              aria-pressed={shop === s.id}
              className="text-xs px-3 py-2 rounded-xl font-semibold"
              style={{
                background: shop === s.id ? 'var(--primary)' : 'transparent',
                color: shop === s.id ? '#fff' : 'var(--ink-soft)',
                border: shop === s.id ? '1.5px solid var(--primary)' : '1.5px solid var(--line)',
              }}
            >
              {shortShopName(s.name)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p
          className="text-sm mb-3 px-3 py-2 rounded-lg"
          style={{ background: '#FBEAEC', color: '#B23A48' }}
          role="alert"
        >
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          {error}
        </p>
      )}

      {/* ---------------------------------------------------- แหล่งเงิน -- */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <p className="font-semibold">
            <i className="fa-solid fa-vault mr-2" style={{ color: 'var(--primary)' }}></i>
            แหล่งเงิน
          </p>
          <button
            onClick={() => setDraft(blankAccount(shop))}
            className="btn-outline text-sm px-3 py-1.5 rounded-xl font-medium"
          >
            <i className="fa-solid fa-plus mr-1.5"></i>เพิ่มแหล่งเงิน
          </button>
        </div>

        {branch && branch.accounts.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}
            >
              <thead>
                <tr style={{ borderBottom: '1.5px solid var(--line-strong)' }}>
                  {['แหล่งเงิน', 'ยอดตั้งต้น', 'รับเข้า', 'จ่ายออก', 'โอนสุทธิ', 'คงเหลือ', ''].map(
                    (h, i) => (
                      <th
                        key={h + i}
                        className="text-xs font-semibold"
                        style={{
                          padding: '0 10px 8px',
                          textAlign: i === 0 || i === 6 ? 'left' : 'right',
                          color: 'var(--ink-soft)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {branch.accounts.map((a) => {
                  const source = shopAccounts.find((x) => x.id === a.id);
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                        <span className="font-medium">{a.name}</span>
                        {a.accountNo && (
                          <span className="text-xs ml-1.5" style={{ color: 'var(--ink-faint)' }}>
                            {a.accountNo}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(a.opening)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(a.inflow)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(a.outflow)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        {fmt(a.transferIn - a.transferOut)}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                        {fmt(a.balance)}
                      </td>
                      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() =>
                            source &&
                            setDraft({
                              id: source.id,
                              shop: source.shop,
                              name: source.name,
                              kind: source.kind,
                              accountNo: source.accountNo,
                              openingBalance: source.openingBalance,
                              openedAt: source.openedAt,
                              matchNames: source.matchNames,
                            })
                          }
                          aria-label={`แก้ไข ${a.name}`}
                          className="btn-outline text-xs px-2.5 py-1.5 rounded-lg"
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1.5px solid var(--line-strong)' }}>
                  <td colSpan={5} style={{ padding: '10px', fontWeight: 700 }}>
                    รวมทั้งสาขา
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                    {fmt(branch.total)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
            ยังไม่มีแหล่งเงินในสาขานี้
          </p>
        )}
      </div>

      {/* ---------------------------------------------- โอน / ฝากเงิน -- */}
      <div className="card p-5 mb-4">
        <p className="font-semibold mb-1">
          <i className="fa-solid fa-right-left mr-2" style={{ color: 'var(--primary)' }}></i>
          โอน / ฝากเงิน
        </p>
        {/*
          Says out loud that one end may be blank. Without it somebody repaying a
          director picks the nearest account to satisfy the form, and the register
          then claims money went somewhere it did not.
        */}
        <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
          ฝากเงินสดเข้าธนาคาร เติมเงินสดย่อย หรือเงินที่ออกไปโดยไม่เป็นค่าใช้จ่าย เช่น
          คืนเงินสำรองจ่ายให้กรรมการ — เว้นด้านใดด้านหนึ่งว่างได้ ถ้าเงินมาจากหรือออกไปนอกระบบ
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mb-2">
          <div>
            <label className={label} style={labelStyle}>
              จาก
            </label>
            <select
              aria-label="โอนจากแหล่งเงิน"
              value={transfer.fromAccountId}
              onChange={(e) => setTransfer({ ...transfer, fromAccountId: e.target.value })}
              className={field}
            >
              <option value="">— นอกระบบ —</option>
              {shopAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>
              ไป
            </label>
            <select
              aria-label="โอนไปแหล่งเงิน"
              value={transfer.toAccountId}
              onChange={(e) => setTransfer({ ...transfer, toAccountId: e.target.value })}
              className={field}
            >
              <option value="">— นอกระบบ —</option>
              {shopAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>
              จำนวนเงิน
            </label>
            <input
              type="number"
              aria-label="จำนวนเงินที่โอน"
              value={transfer.amount}
              onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className={label} style={labelStyle}>
              วันที่
            </label>
            <input
              type="date"
              aria-label="วันที่โอนเงิน"
              value={transfer.movedAt}
              onChange={(e) => setTransfer({ ...transfer, movedAt: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className={label} style={labelStyle}>
              หมายเหตุ
            </label>
            <input
              aria-label="หมายเหตุการโอนเงิน"
              value={transfer.note}
              onChange={(e) => setTransfer({ ...transfer, note: e.target.value })}
              placeholder="เช่น ฝากยอดขายประจำวัน"
              className={field}
            />
          </div>
        </div>
        <button
          onClick={submitTransfer}
          disabled={busy}
          className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold"
        >
          บันทึกการโอน
        </button>

        {transfers.filter((t) => t.shop === shop).length > 0 && (
          <div className="mt-4">
            {transfers
              .filter((t) => t.shop === shop)
              .slice(0, 8)
              .map((t) => (
                <div
                  key={t.id}
                  className="flex items-baseline justify-between gap-3 py-2 text-xs"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <span className="min-w-0">
                    <span style={{ color: 'var(--ink-soft)' }}>{fmtThaiDayString(t.movedAt)}</span>{' '}
                    {accountName(t.fromAccountId)} → {accountName(t.toAccountId)}
                    {t.note && (
                      <span style={{ color: 'var(--ink-faint)' }}> &middot; {t.note}</span>
                    )}
                  </span>
                  <span className="font-semibold flex-shrink-0">{fmt(t.amount)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* -------------------------------------------------- กระทบยอด -- */}
      <div className="card p-5">
        <p className="font-semibold mb-1">
          <i className="fa-solid fa-scale-balanced mr-2" style={{ color: 'var(--primary)' }}></i>
          กระทบยอดกับเงินจริง
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
          นับเงินจริงหรือดูยอดจาก statement แล้วบันทึกไว้ ระบบเก็บผลต่างไว้เป็นหลักฐาน
          ไม่ได้แก้ยอดให้เท่ากันเอง — ถ้ายอดตั้งต้นผิด ให้แก้ที่แหล่งเงินด้านบน
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
          <div>
            <label className={label} style={labelStyle}>
              แหล่งเงิน
            </label>
            <select
              aria-label="แหล่งเงินที่กระทบยอด"
              value={count.accountId}
              onChange={(e) => setCount({ ...count, accountId: e.target.value })}
              className={field}
            >
              <option value="">เลือกแหล่งเงิน...</option>
              {shopAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>
              ยอดที่นับได้จริง
            </label>
            <input
              type="number"
              aria-label="ยอดที่นับได้จริง"
              value={count.counted}
              onChange={(e) => setCount({ ...count, counted: e.target.value })}
              className={field}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>
              หมายเหตุ
            </label>
            <input
              aria-label="หมายเหตุการกระทบยอด"
              value={count.note}
              onChange={(e) => setCount({ ...count, note: e.target.value })}
              placeholder="เช่น ตรวจนับสิ้นเดือน"
              className={field}
            />
          </div>
        </div>
        <button
          onClick={submitCount}
          disabled={busy || !count.accountId}
          className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold"
        >
          บันทึกการกระทบยอด
        </button>

        {reconciliations.filter((r) => shopAccounts.some((a) => a.id === r.accountId)).length >
          0 && (
          <div className="mt-4">
            {reconciliations
              .filter((r) => shopAccounts.some((a) => a.id === r.accountId))
              .slice(0, 8)
              .map((r) => {
                const gap = r.countedBalance - r.systemBalance;
                return (
                  <div
                    key={r.id}
                    className="flex items-baseline justify-between gap-3 py-2 text-xs"
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <span className="min-w-0">
                      <span style={{ color: 'var(--ink-soft)' }}>
                        {fmtThaiDayString(r.countedAt)}
                      </span>{' '}
                      {accountName(r.accountId)}
                      {r.note && (
                        <span style={{ color: 'var(--ink-faint)' }}> &middot; {r.note}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0">
                      <span style={{ color: 'var(--ink-soft)' }}>นับได้ </span>
                      {fmt(r.countedBalance)}
                      <span
                        className="ml-2 font-semibold"
                        style={{ color: gap === 0 ? '#3F6B33' : '#B23A48' }}
                      >
                        {gap === 0 ? 'ตรง' : `ต่าง ${fmt(gap)}`}
                      </span>
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {draft && (
        <AccountEditor
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onSave={async () => {
            const ok = await run(() => saveMoneyAccount(draft), 'บันทึกแหล่งเงินแล้ว');
            if (ok) setDraft(null);
          }}
          onClose={async () => {
            if (!draft.id) return;
            if (!window.confirm(`ปิดแหล่งเงิน ${draft.name}? ประวัติเดิมยังอยู่ครบ`)) return;
            const ok = await run(() => closeMoneyAccount(draft.id as number), 'ปิดแหล่งเงินแล้ว');
            if (ok) setDraft(null);
          }}
        />
      )}

      <SavedToast message={saved} onDone={() => setSaved(null)} />
    </div>
  );
}

/** The add/edit sheet. Separate so the page above stays readable. */
function AccountEditor({
  draft,
  setDraft,
  busy,
  onSave,
  onClose,
}: {
  draft: SaveAccountInput;
  setDraft: (d: SaveAccountInput | null) => void;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const field = 'field text-sm px-3 py-2 w-full';
  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.35)', zIndex: 50 }}
    >
      <div className="card p-5 w-full" style={{ maxWidth: 520 }}>
        <p className="font-semibold mb-3">{draft.id ? 'แก้ไขแหล่งเงิน' : 'เพิ่มแหล่งเงิน'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ชื่อแหล่งเงิน
            </label>
            <input
              aria-label="ชื่อแหล่งเงิน"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="เช่น Kbank"
              className={field}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ประเภท
            </label>
            <select
              aria-label="ประเภทแหล่งเงิน"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              className={field}
            >
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              เลขบัญชี
            </label>
            <input
              aria-label="เลขบัญชี"
              value={draft.accountNo}
              onChange={(e) => setDraft({ ...draft, accountNo: e.target.value })}
              placeholder="เช่น 123-4-56789"
              className={field}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ยอดตั้งต้น
            </label>
            <input
              type="number"
              aria-label="ยอดตั้งต้น"
              value={draft.openingBalance}
              onChange={(e) => setDraft({ ...draft, openingBalance: Number(e.target.value) })}
              className={field}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ยอดตั้งต้น ณ วันที่
            </label>
            <input
              type="date"
              aria-label="วันที่ของยอดตั้งต้น"
              value={draft.openedAt}
              onChange={(e) => setDraft({ ...draft, openedAt: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ป้ายกำกับที่หมายถึงบัญชีนี้
            </label>
            <input
              aria-label="ป้ายกำกับที่หมายถึงบัญชีนี้"
              value={draft.matchNames.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, matchNames: e.target.value.split(',').map((x) => x.trim()) })
              }
              placeholder="โอน TTB, บัญชีธนาคารสาขา"
              className={field}
            />
          </div>
        </div>
        {/* The one field whose purpose is not obvious from its name. */}
        <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
          ป้ายกำกับคือชื่อวิธีชำระเงินในใบงาน และชื่อแหล่งจ่ายในค่าใช้จ่าย ที่ให้ถือว่าเป็นบัญชีนี้
          คั่นด้วยจุลภาค — รายการเก่าจะผูกเข้าบัญชีนี้ทันทีโดยไม่ต้องแก้ใบงานย้อนหลัง
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
          รายการที่เกิดก่อน &quot;ยอดตั้งต้น ณ วันที่&quot; จะไม่ถูกนับเพิ่ม
          เพราะยอดตั้งต้นรวมไว้แล้ว
        </p>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setDraft(null)}
            className="btn-outline flex-1 rounded-xl py-2 text-sm font-medium"
          >
            ยกเลิก
          </button>
          {draft.id && (
            <button
              onClick={onClose}
              className="text-sm px-3 rounded-xl font-medium"
              style={{ color: '#B23A48', border: '1px solid #C24B57' }}
            >
              ปิดแหล่งเงิน
            </button>
          )}
          <button
            onClick={onSave}
            disabled={busy}
            className="btn-primary flex-1 rounded-xl py-2 text-sm font-semibold"
          >
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
