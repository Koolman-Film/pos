'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';

import type { AccountLedger, LedgerCount, LedgerEntry } from '@/components/dashboard/moneyFlow';
import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import { downloadBase64 } from '@/lib/browser/download';
import { fmt, fmtThaiDayString, fmtThaiMonthYear } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

import { ledgerEntryDetail, ledgerEntryTitle } from './ledgerText';

/**
 * สมุดบัญชีแหล่งเงิน — the screen.
 *
 * Laid out as a bank statement on purpose: ยอดยกมา, then every movement in date
 * order with the balance after it, then ยอดยกไป. That is the document the
 * bookkeeper holds it up against, and matching the shape is what makes the check
 * a matter of reading down two columns.
 *
 * Everything shown is computed on the server; this component only lays it out,
 * moves between periods by changing the URL, and hands a count or an export back
 * to a Server Action that recomputes rather than trusting what is on the page.
 */

export type LedgerAccountView = {
  id: number;
  name: string;
  kind: string;
  accountNo: string;
  openedAt: string;
  shopName: string;
};

type Result = { ok: boolean; error?: string };
export type LedgerExportResult =
  { ok: true; fileName: string; base64: string } | { ok: false; error: string };

const PERIODS = [
  ['today', 'วันนี้'],
  ['month', 'รายเดือน'],
  ['year', 'รายปี'],
  ['range', 'ช่วงเวลา'],
] as const;

const UP = '#3F6B33';
const DOWN = '#B23A48';

function iconFor(e: LedgerEntry): string {
  if (e.kind === 'transfer-in' || e.kind === 'transfer-out') return 'fa-right-left';
  if (e.kind === 'expense') return 'fa-receipt';
  if (e.ref?.kind === 'order') return 'fa-truck-fast';
  if (e.ref?.kind === 'ticket') return 'fa-car';
  return 'fa-arrow-down';
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return fmtThaiMonthYear(new Date(y, m - 1, 1));
};

/** Entries and count pins in one date-ordered list; a count sits after its day's money. */
function interleave(entries: LedgerEntry[], counts: LedgerCount[]) {
  const rows: ({ type: 'entry'; e: LedgerEntry } | { type: 'count'; c: LedgerCount })[] = [];
  let j = 0;
  for (const e of entries) {
    while (j < counts.length && counts[j].on < e.on) rows.push({ type: 'count', c: counts[j++] });
    rows.push({ type: 'entry', e });
  }
  while (j < counts.length) rows.push({ type: 'count', c: counts[j++] });
  return rows;
}

export function LedgerModule({
  account,
  branchAccounts,
  ledger,
  caption,
  period,
  periodValue,
  rangeStart,
  rangeEnd,
  todayKey,
  links,
  reconcileAction,
  exportAction,
  attachmentUrlAction,
}: {
  account: LedgerAccountView;
  /** The branch's accounts in the shop's order — the switcher, and transfer ends. */
  branchAccounts: { id: number; name: string }[];
  ledger: AccountLedger;
  caption: string;
  period: string;
  periodValue: string;
  rangeStart: string;
  rangeEnd: string;
  todayKey: string;
  links: { tickets: boolean; wholesale: boolean; expenseFiles: boolean };
  reconcileAction?: (input: {
    accountId: number;
    countedAt: string;
    countedBalance: number;
    note: string;
  }) => Promise<Result>;
  exportAction?: (input: {
    accountId: number;
    from: string;
    to: string;
  }) => Promise<LedgerExportResult>;
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
}) {
  const router = useRouter();
  const mounted = useIsMounted();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nameOf = (id: number | null | undefined) =>
    id == null ? 'นอกระบบ' : (branchAccounts.find((a) => a.id === id)?.name ?? '—');

  // ---- where a click goes -------------------------------------------------
  const query = (next: { period?: string; v?: string; from?: string; to?: string }) => {
    const p = next.period ?? period;
    const qs = new URLSearchParams({ period: p });
    // Changing the kind of period drops the old value: "2026-09" means nothing
    // to รายปี, and the server fills in the current one.
    const v = next.v ?? (p === period ? periodValue : '');
    if ((p === 'month' || p === 'year') && v) qs.set('v', v);
    if (p === 'range') {
      // Opening ช่วงเวลา starts from the window already on screen.
      const f = next.from ?? (rangeStart || ledger.from);
      const t = next.to ?? (rangeEnd || ledger.to);
      if (f) qs.set('from', f);
      if (t) qs.set('to', t);
    }
    return qs.toString();
  };
  const hrefFor = (accountId: number, next = {}) => `/money/${accountId}?${query(next)}`;
  const go = (next: { period?: string; v?: string; from?: string; to?: string }) =>
    router.push(hrefFor(account.id, next));

  const thisBE = Number(todayKey.slice(0, 4)) + 543;
  const years: number[] = [];
  for (let y = thisBE; y >= 2567; y -= 1) years.push(y);
  const yearBE = Number(periodValue) > 2400 ? Number(periodValue) : Number(periodValue) + 543;

  // ---- reconciliation ------------------------------------------------------
  /*
    ยอด ณ วันที่ — defaults to the last day on screen, not today: the statement
    being checked is usually last month's, and its closing balance is true on
    its closing date. Never later than today.
  */
  const countDay = ledger.to && ledger.to < todayKey ? ledger.to : todayKey;
  const [count, setCount] = useState({ on: countDay, counted: '', note: '' });

  function submitCount() {
    setError(null);
    setNotice(null);
    if (count.counted.trim() === '' || !Number.isFinite(Number(count.counted))) {
      setError('กรอกยอดที่นับได้จริง หรือยอดใน statement ก่อน');
      return;
    }
    if (!reconcileAction) return;
    startTransition(async () => {
      const res = await reconcileAction({
        accountId: account.id,
        countedAt: count.on,
        countedBalance: Number(count.counted),
        note: count.note,
      });
      if (!res.ok) {
        setError(res.error || 'บันทึกการกระทบยอดไม่สำเร็จ');
        return;
      }
      setNotice('บันทึกการกระทบยอดแล้ว');
      setCount({ ...count, counted: '', note: '' });
      router.refresh();
    });
  }

  function exportExcel() {
    if (!exportAction) return;
    setError(null);
    startTransition(async () => {
      const res = await exportAction({ accountId: account.id, from: ledger.from, to: ledger.to });
      if (!res.ok) setError(res.error);
      else downloadBase64(res.base64, res.fileName);
    });
  }

  async function openFile(path: string) {
    if (!attachmentUrlAction) return;
    const res = await attachmentUrlAction(path);
    if (res.url) window.open(res.url, '_blank', 'noopener');
    else setError(res.error || 'เปิดไฟล์ไม่สำเร็จ');
  }

  const latest = ledger.counts.at(-1);
  const rows = interleave(ledger.entries, ledger.counts);
  const yearView = period === 'year';
  /*
    ยอดยกมา is dated the day it is TRUE: the start of the period, or the day the
    account opened when the period starts earlier. "ยอดยกมา 1 ม.ค." on an account
    first recorded in September would describe a balance nobody ever took.
  */
  const carriedInDay =
    ledger.from && ledger.from > account.openedAt ? ledger.from : account.openedAt;

  // ---- one line's reference, on screen --------------------------------------
  function DocRef({ e }: { e: LedgerEntry }) {
    if (!e.ref) return null;
    const href =
      e.ref.kind === 'ticket' && links.tickets
        ? `/tickets/${encodeURIComponent(e.ref.id)}`
        : e.ref.kind === 'order' && links.wholesale
          ? `/wholesale/${encodeURIComponent(e.ref.id)}`
          : null;
    return (
      <>
        {' '}
        {href ? (
          <Link href={href} className="font-mono text-xs" style={{ color: 'var(--primary)' }}>
            {e.ref.docNo}
          </Link>
        ) : (
          <span className="font-mono text-xs">{e.ref.docNo}</span>
        )}
        {links.expenseFiles &&
          attachmentUrlAction &&
          (e.ref.attachments ?? []).map((a) => (
            <button
              key={a.path}
              onClick={() => openFile(a.path)}
              title={a.fileName}
              aria-label={`เปิดไฟล์แนบ ${a.fileName}`}
              className="text-xs ml-1.5"
              style={{ color: 'var(--ink-soft)' }}
            >
              <i className="fa-solid fa-paperclip"></i>
            </button>
          ))}
      </>
    );
  }

  const cell = { padding: '9px 10px', verticalAlign: 'top' as const };
  const num = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

  return (
    <div className="fade-page">
      <Link href="/money" className="text-sm" style={{ color: 'var(--ink-soft)' }}>
        <i className="fa-solid fa-arrow-left mr-1.5"></i>การจัดการเงิน/บัญชี
      </Link>

      <div className="flex items-end justify-between flex-wrap gap-3 mt-2 mb-4">
        <div>
          <h1 className="text-xl font-bold">สมุดบัญชี · {account.name}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            {account.shopName}
            {account.accountNo ? ` · ${account.accountNo}` : ''} · {caption}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            aria-label="เปลี่ยนแหล่งเงิน"
            value={account.id}
            onChange={(e) => router.push(hrefFor(Number(e.target.value)))}
            className="field text-sm px-3 py-2"
          >
            {branchAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            onClick={exportExcel}
            disabled={isPending || !exportAction}
            className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
          >
            <i className="fa-solid fa-file-excel mr-1.5" style={{ color: '#1D6F42' }}></i>Excel
          </button>
          <button
            onClick={() => window.print()}
            className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
          >
            <i className="fa-solid fa-file-pdf mr-1.5" style={{ color: '#C0392B' }}></i>PDF
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- period -- */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <div
          className="flex rounded-xl overflow-hidden"
          style={{ border: '1.5px solid var(--line)' }}
        >
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => go({ period: key })}
              aria-pressed={period === key}
              className="text-xs px-3 py-2 font-semibold"
              style={{
                background: period === key ? 'var(--primary)' : 'transparent',
                color: period === key ? '#fff' : 'var(--ink-soft)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {period === 'month' && (
          <input
            type="month"
            value={periodValue}
            aria-label="เลือกเดือน"
            onChange={(e) => e.target.value && go({ v: e.target.value })}
            className="field text-sm px-3 py-2"
          />
        )}
        {period === 'year' && (
          <select
            value={yearBE}
            aria-label="เลือกปี"
            onChange={(e) => go({ v: e.target.value })}
            className="field text-sm px-3 py-2"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
        {period === 'range' && (
          <div className="flex items-start gap-2">
            <ThaiDateInput
              value={rangeStart || ledger.from}
              onChange={(v) => go({ from: v })}
              ariaLabel="ตั้งแต่วันที่"
              className="field text-sm px-3 py-2"
            />
            <i
              className="fa-solid fa-arrow-right text-xs mt-3"
              style={{ color: 'var(--ink-faint)' }}
            ></i>
            <ThaiDateInput
              value={rangeEnd || ledger.to}
              onChange={(v) => go({ to: v })}
              ariaLabel="ถึงวันที่"
              className="field text-sm px-3 py-2"
            />
          </div>
        )}
      </div>

      {error && (
        <p
          className="text-sm mb-3 px-3 py-2 rounded-lg"
          style={{ background: '#FBEAEC', color: DOWN }}
          role="alert"
        >
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          {error}
        </p>
      )}
      {notice && (
        <p
          className="text-sm mb-3 px-3 py-2 rounded-lg"
          style={{ background: '#EAF3DE', color: UP }}
        >
          <i className="fa-solid fa-circle-check mr-1.5"></i>
          {notice}
        </p>
      )}

      {ledger.beforeOpening ? (
        <div className="card p-5 mb-4 text-sm" style={{ color: 'var(--ink-soft)' }}>
          บัญชีนี้เริ่มนับในระบบตั้งแต่ {fmtThaiDayString(account.openedAt)} —
          เงินก่อนหน้านั้นรวมอยู่ในยอดตั้งต้นแล้ว ช่วงที่เลือกจึงไม่มีรายการให้แสดง
        </div>
      ) : (
        <>
          {/* -------------------------------------------------------- cards -- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ยอดยกมา{carriedInDay ? ` ${fmtThaiDayString(carriedInDay)}` : ''}
              </p>
              <p className="text-xl font-bold mt-1">{fmt(ledger.carriedIn)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                เงินเพิ่ม
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: UP }}>
                +{fmt(ledger.increase)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                เงินลด
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: DOWN }}>
                −{fmt(ledger.decrease)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ยอดยกไป{ledger.to ? ` ${fmtThaiDayString(ledger.to)}` : ''}
              </p>
              <p className="text-xl font-bold mt-1">{fmt(ledger.carriedOut)}</p>
            </div>
          </div>

          {latest && (
            <p
              className="text-sm mb-4 px-3 py-2 rounded-lg"
              style={{
                background: latest.counted === latest.systemNow ? '#EAF3DE' : '#FBEAEC',
                color: latest.counted === latest.systemNow ? UP : DOWN,
              }}
            >
              <i className="fa-solid fa-scale-balanced mr-1.5"></i>
              กระทบยอดล่าสุด {fmtThaiDayString(latest.on)} · นับได้ {fmt(latest.counted)} · ระบบ{' '}
              {fmt(latest.systemNow)} ·{' '}
              {latest.counted === latest.systemNow
                ? 'ตรง'
                : `ต่าง ${fmt(latest.counted - latest.systemNow)}`}
            </p>
          )}

          {/* ------------------------------------------------------ the book -- */}
          <div className="card p-5 mb-4">
            {yearView ? (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--ink-soft)' }}>
                  รวมเป็นรายเดือน — กดชื่อเดือนเพื่อดูทุกรายการของเดือนนั้น
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 13,
                      minWidth: 560,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1.5px solid var(--line-strong)',
                          color: 'var(--ink-soft)',
                        }}
                      >
                        <th
                          className="text-xs font-semibold"
                          style={{ ...cell, textAlign: 'left' }}
                        >
                          เดือน
                        </th>
                        <th className="text-xs font-semibold" style={num}>
                          ยอดยกมา
                        </th>
                        <th className="text-xs font-semibold" style={num}>
                          เงินเพิ่ม
                        </th>
                        <th className="text-xs font-semibold" style={num}>
                          เงินลด
                        </th>
                        <th className="text-xs font-semibold" style={num}>
                          สิ้นเดือน
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.months.map((m) => (
                        <tr key={m.month} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={cell}>
                            <button
                              onClick={() => go({ period: 'month', v: m.month })}
                              className="font-medium"
                              style={{ color: 'var(--primary)' }}
                            >
                              {monthLabel(m.month)}
                            </button>
                          </td>
                          <td style={num}>{fmt(m.carriedIn)}</td>
                          <td style={{ ...num, color: UP }}>{fmt(m.increase)}</td>
                          <td style={{ ...num, color: DOWN }}>{fmt(m.decrease)}</td>
                          <td style={{ ...num, fontWeight: 700 }}>{fmt(m.carriedOut)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1.5px solid var(--line-strong)',
                        color: 'var(--ink-soft)',
                      }}
                    >
                      <th className="text-xs font-semibold" style={{ ...cell, textAlign: 'left' }}>
                        วันที่
                      </th>
                      <th className="text-xs font-semibold" style={{ ...cell, textAlign: 'left' }}>
                        รายการ · ที่มาอ้างอิง
                      </th>
                      <th className="text-xs font-semibold" style={num}>
                        เงินเพิ่ม
                      </th>
                      <th className="text-xs font-semibold" style={num}>
                        เงินลด
                      </th>
                      <th className="text-xs font-semibold" style={num}>
                        คงเหลือ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {carriedInDay ? fmtThaiDayString(carriedInDay) : ''}
                      </td>
                      <td style={cell}>ยอดยกมา</td>
                      <td style={num}></td>
                      <td style={num}></td>
                      <td style={num}>{fmt(ledger.carriedIn)}</td>
                    </tr>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          style={{ ...cell, color: 'var(--ink-faint)', textAlign: 'center' }}
                        >
                          ไม่มีเงินเข้าหรือออกจากบัญชีนี้ในช่วงที่เลือก
                        </td>
                      </tr>
                    )}
                    {rows.map((r) =>
                      r.type === 'entry' ? (
                        <tr key={r.e.key} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                            {fmtThaiDayString(r.e.on)}
                          </td>
                          <td style={cell}>
                            <i
                              className={`fa-solid ${iconFor(r.e)} mr-1.5 text-xs`}
                              style={{ color: 'var(--ink-faint)' }}
                            ></i>
                            {r.e.kind === 'transfer-in' || r.e.kind === 'transfer-out' ? (
                              <>
                                {r.e.kind === 'transfer-in' ? 'โอนเข้า จาก ' : 'โอนออก ไป '}
                                {r.e.counterpartId != null ? (
                                  <Link
                                    href={hrefFor(r.e.counterpartId)}
                                    style={{ color: 'var(--primary)' }}
                                  >
                                    {nameOf(r.e.counterpartId)}
                                  </Link>
                                ) : (
                                  'นอกระบบ'
                                )}
                              </>
                            ) : (
                              <>
                                {ledgerEntryTitle(r.e, nameOf)}
                                <DocRef e={r.e} />
                              </>
                            )}
                            {ledgerEntryDetail(r.e) && (
                              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                                {ledgerEntryDetail(r.e)}
                              </p>
                            )}
                          </td>
                          <td style={{ ...num, color: UP }}>
                            {r.e.amount >= 0 ? fmt(r.e.amount) : ''}
                          </td>
                          <td style={{ ...num, color: DOWN }}>
                            {r.e.amount < 0 ? fmt(-r.e.amount) : ''}
                          </td>
                          <td style={num}>{fmt(r.e.balance)}</td>
                        </tr>
                      ) : (
                        <tr
                          key={`count-${r.c.id}`}
                          style={{
                            borderBottom: '1px solid var(--line)',
                            background: 'var(--paper)',
                          }}
                        >
                          <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                            {fmtThaiDayString(r.c.on)}
                          </td>
                          <td style={cell}>
                            <i className="fa-solid fa-scale-balanced mr-1.5 text-xs"></i>
                            กระทบยอด · นับได้ {fmt(r.c.counted)}
                            {r.c.note ? ` · ${r.c.note}` : ''}
                            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                              ไม่เปลี่ยนยอด เป็นหลักฐานว่า ณ วันนั้นนับได้เท่าไหร่
                            </p>
                            {/* History under a count was edited after it was taken:
                                say so, rather than let the old "ตรง" stand. */}
                            {r.c.systemNow !== r.c.systemAtRecord && (
                              <p className="text-xs mt-0.5" style={{ color: DOWN }}>
                                <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                ยอดระบบ ณ วันนั้นเปลี่ยนไปจากตอนบันทึก (ตอนบันทึก{' '}
                                {fmt(r.c.systemAtRecord)}) — มีรายการย้อนหลังถูกเพิ่มหรือแก้ภายหลัง
                              </p>
                            )}
                          </td>
                          <td style={num}></td>
                          <td style={num}></td>
                          <td
                            style={{
                              ...num,
                              fontWeight: 600,
                              color: r.c.counted === r.c.systemNow ? UP : DOWN,
                            }}
                          >
                            {r.c.counted === r.c.systemNow
                              ? 'ตรง'
                              : `ต่าง ${fmt(r.c.counted - r.c.systemNow)}`}
                          </td>
                        </tr>
                      ),
                    )}
                    <tr style={{ borderTop: '1.5px solid var(--line-strong)', fontWeight: 700 }}>
                      <td style={cell}></td>
                      <td style={cell}>รวมช่วงนี้ · ยอดยกไป</td>
                      <td style={num}>{fmt(ledger.increase)}</td>
                      <td style={num}>{fmt(ledger.decrease)}</td>
                      <td style={num}>{fmt(ledger.carriedOut)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ----------------------------------------------------- reconcile -- */}
      {reconcileAction && (
        <div className="card p-5">
          <p className="font-semibold mb-1">
            <i className="fa-solid fa-scale-balanced mr-2" style={{ color: 'var(--primary)' }}></i>
            กระทบยอดบัญชีนี้
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
            ใส่ยอดที่นับได้จริง หรือยอดคงเหลือใน statement พร้อมวันที่ของยอดนั้น ระบบคำนวณยอด ณ
            สิ้นวันนั้นเองแล้วเก็บผลต่างไว้เป็นหลักฐาน
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <ThaiDateInput
              value={count.on}
              onChange={(v) => setCount({ ...count, on: v })}
              ariaLabel="วันที่ของยอดที่นับได้"
            />
            <input
              type="number"
              aria-label="ยอดที่นับได้จริง"
              placeholder="ยอดที่นับได้จริง"
              value={count.counted}
              onChange={(e) => setCount({ ...count, counted: e.target.value })}
              className="field w-full text-sm px-3 py-2"
            />
            <input
              aria-label="หมายเหตุการกระทบยอด"
              placeholder="เช่น statement สิ้นเดือน"
              value={count.note}
              onChange={(e) => setCount({ ...count, note: e.target.value })}
              className="field w-full text-sm px-3 py-2"
            />
          </div>
          <button
            onClick={submitCount}
            disabled={isPending}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold"
          >
            บันทึกการกระทบยอด
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------- print -- */}
      {mounted &&
        createPortal(
          <div className="print-area">
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>
              สมุดบัญชี · {account.name}
            </h2>
            <p style={{ fontSize: 12, margin: '0 0 10px' }}>
              {account.shopName}
              {account.accountNo ? ` · ${account.accountNo}` : ''} · {caption}
            </p>
            {yearView ? (
              <table>
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th>ยอดยกมา</th>
                    <th>เงินเพิ่ม</th>
                    <th>เงินลด</th>
                    <th>สิ้นเดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.months.map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      <td>{fmt(m.carriedIn)}</td>
                      <td>{fmt(m.increase)}</td>
                      <td>{fmt(m.decrease)}</td>
                      <td>{fmt(m.carriedOut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>รายการ</th>
                    <th>อ้างอิง</th>
                    <th>เงินเพิ่ม</th>
                    <th>เงินลด</th>
                    <th>คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{carriedInDay ? fmtThaiDayString(carriedInDay) : ''}</td>
                    <td>ยอดยกมา</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td>{fmt(ledger.carriedIn)}</td>
                  </tr>
                  {ledger.entries.map((e) => (
                    <tr key={e.key}>
                      <td>{fmtThaiDayString(e.on)}</td>
                      <td>
                        {ledgerEntryTitle(e, nameOf)}
                        {ledgerEntryDetail(e) ? ` · ${ledgerEntryDetail(e)}` : ''}
                      </td>
                      <td>{e.ref?.docNo ?? ''}</td>
                      <td>{e.amount >= 0 ? fmt(e.amount) : ''}</td>
                      <td>{e.amount < 0 ? fmt(-e.amount) : ''}</td>
                      <td>{fmt(e.balance)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td></td>
                    <td>ยอดยกไป</td>
                    <td></td>
                    <td>{fmt(ledger.increase)}</td>
                    <td>{fmt(ledger.decrease)}</td>
                    <td>{fmt(ledger.carriedOut)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
