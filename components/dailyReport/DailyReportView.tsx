'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';

import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import { fmt, fmtThaiDateLong, shortShopName } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

import { nextDay, previousDay, type DailyReport, type SourceRow } from './buildDailyReport';

/**
 * สรุปการเงินประจำวัน — the screen and its printed page.
 *
 * Everything is computed on the server (`buildDailyReport`); this only lays it
 * out and moves between days and branches by changing the URL. The printed copy
 * is the same figures in plain tables, sized to fit one A4 page.
 */

type Shop = { id: string; name: string };

const CHANNEL_LABEL: Record<string, string> = { ปลีก: 'ขายปลีก', ขายส่ง: 'ขายส่ง' };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function DailyReportView({
  report,
  today,
  shopFilter,
  shops,
  scopeName,
  showShopColumn,
}: {
  report: DailyReport;
  today: string;
  shopFilter: string;
  shops: Shop[];
  scopeName: string;
  /** More than one branch on the page — name the branch beside each account. */
  showShopColumn: boolean;
}) {
  const router = useRouter();
  const mounted = useIsMounted();
  const { sales, inflow, outflow, balances } = report;

  const go = (next: { d?: string; shop?: string }) => {
    const q = new URLSearchParams({ d: next.d ?? report.day, shop: next.shop ?? shopFilter });
    router.push(`/daily-report?${q}`);
  };

  const dateLabel = fmtThaiDateLong(new Date(`${report.day}T00:00:00+07:00`));
  const shopName = new Map(shops.map((s) => [s.id, shortShopName(s.name)]));
  const sourceName = (r: SourceRow) =>
    showShopColumn ? `${r.name} · ${shopName.get(r.shop) ?? r.shop}` : r.name;
  const net = inflow.total - outflow.total;
  const change =
    sales.previousTotal > 0
      ? Math.round(((sales.total - sales.previousTotal) / sales.previousTotal) * 100)
      : null;

  const muted = { color: 'var(--ink-soft)' };
  const cell = { padding: '7px 8px' };
  const numCell = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

  return (
    <div className="fade-page">
      {/* ------------------------------------------------------------ header -- */}
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold">สรุปการเงินประจำวัน</h1>
          <p className="text-sm mt-0.5" style={muted}>
            {scopeName} · {dateLabel}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
        >
          <i className="fa-solid fa-file-pdf mr-1.5" style={{ color: '#C0392B' }}></i>พิมพ์ / PDF
        </button>
      </div>

      {/* ----------------------------------------------------------- filter -- */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => go({ d: previousDay(report.day) })}
          aria-label="วันก่อนหน้า"
          className="btn-outline text-sm px-3 py-2 rounded-lg"
        >
          <i className="fa-solid fa-chevron-left"></i>
        </button>
        <div style={{ minWidth: 170 }}>
          <ThaiDateInput
            value={report.day}
            ariaLabel="เลือกวันที่"
            onChange={(v) => v && v <= today && go({ d: v })}
          />
        </div>
        <button
          onClick={() => go({ d: nextDay(report.day) })}
          disabled={report.day >= today}
          aria-label="วันถัดไป"
          className="btn-outline text-sm px-3 py-2 rounded-lg disabled:opacity-40"
        >
          <i className="fa-solid fa-chevron-right"></i>
        </button>
        {report.day !== today && (
          <button
            onClick={() => go({ d: today })}
            className="text-xs px-3 py-2 font-semibold"
            style={{ color: 'var(--primary)' }}
          >
            วันนี้
          </button>
        )}
        {shops.length > 1 && (
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {[{ id: 'all', name: 'ทุกสาขา' }, ...shops].map((s) => (
              <button
                key={s.id}
                onClick={() => go({ shop: s.id })}
                aria-pressed={shopFilter === s.id}
                className="text-xs px-3 py-2 rounded-xl font-semibold"
                style={{
                  background: shopFilter === s.id ? 'var(--primary)' : 'transparent',
                  color: shopFilter === s.id ? '#fff' : 'var(--ink-soft)',
                  border: '1.5px solid var(--line)',
                }}
              >
                {s.id === 'all' ? s.name : shortShopName(s.name)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- tiles -- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile
          label="ยอดขายที่เก็บเงินได้"
          value={sales.total}
          note={
            change === null
              ? `${sales.documents} ใบงาน/PO`
              : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% จากเมื่อวาน`
          }
          noteColor={change === null ? undefined : change >= 0 ? '#2f7a4f' : '#b23a48'}
        />
        <Tile
          label="เงินรับเข้า"
          value={inflow.total}
          note={`${inflow.rows.reduce((n, r) => n + r.count, 0)} รายการ`}
        />
        <Tile
          label="ค่าใช้จ่าย"
          value={outflow.total}
          note={`${outflow.rows.reduce((n, r) => n + r.count, 0)} รายการ`}
        />
        <Tile
          label="เงินสุทธิวันนี้"
          value={net}
          note="รับเข้า − ค่าใช้จ่าย"
          valueColor={net >= 0 ? '#2f7a4f' : '#b23a48'}
          signed
        />
      </div>

      {report.hasUnmatched && (
        <div className="card p-3 mb-4 text-sm" style={{ borderLeft: '4px solid #B8860B' }}>
          <i className="fa-solid fa-triangle-exclamation mr-1.5" style={{ color: '#B8860B' }}></i>
          มีเงินที่บันทึกด้วยชื่อแหล่งเงินที่ยังไม่ได้ผูกกับบัญชีใด (ทำเครื่องหมาย ⚠) —{' '}
          <Link href="/money" style={{ color: 'var(--primary)' }}>
            ไปผูกที่การจัดการเงิน/บัญชี
          </Link>
        </div>
      )}

      {/* ---------------------------------------------------------------- ① -- */}
      <div className="card p-5 mb-4">
        <h2 className="font-bold mb-3">① ยอดขาย (ที่เก็บเงินได้) แยกตามชนิดสินค้า</h2>
        {sales.channels.length === 0 ? (
          <p className="text-sm" style={muted}>
            ไม่มีการรับชำระเงินในวันนี้
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ ...muted, borderBottom: '1px solid var(--line)' }}>
                <th style={{ ...cell, textAlign: 'left' }}>ชนิดสินค้า</th>
                <th style={numCell}>ยอดเงิน</th>
                <th style={{ ...cell, width: '35%' }} className="hidden sm:table-cell">
                  สัดส่วน
                </th>
              </tr>
            </thead>
            {sales.channels.map((c) => (
              <tbody key={c.channel}>
                <tr style={{ background: 'var(--paper)' }}>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    {CHANNEL_LABEL[c.channel] ?? c.channel}
                  </td>
                  <td style={{ ...numCell, fontWeight: 700 }}>{fmt(c.total)}</td>
                  <td style={cell} className="hidden sm:table-cell text-xs">
                    <span style={muted}>{pct(c.total, sales.total)}% ของยอดขาย</span>
                  </td>
                </tr>
                {c.categories.map((cat) => (
                  <tr key={cat.name} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ ...cell, paddingLeft: 22 }}>{cat.name}</td>
                    <td style={numCell}>{fmt(cat.amount)}</td>
                    <td style={cell} className="hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--revenue)',
                            width: `${Math.max(2, pct(cat.amount, sales.total))}%`,
                          }}
                        />
                        <span className="text-xs" style={muted}>
                          {pct(cat.amount, sales.total)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                <td style={{ ...cell, fontWeight: 700 }}>รวมยอดขาย</td>
                <td style={{ ...numCell, fontWeight: 700 }}>{fmt(sales.total)}</td>
                <td className="hidden sm:table-cell"></td>
              </tr>
            </tfoot>
          </table>
        )}
        {sales.held > 0 && (
          <p className="text-xs mt-3" style={muted}>
            เงินรอคืน Finnix {fmt(sales.held)} บาท — รับเงินไว้แทนสาขาอื่น จึงไม่นับเป็นยอดขาย
            แต่รวมอยู่ในเงินรับเข้า ②
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------- ② ③ -- */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <SourceCard
          title="② เงินรับเข้า แยกแหล่งเงิน"
          rows={inflow.rows}
          total={inflow.total}
          nameOf={sourceName}
          empty="ไม่มีเงินรับเข้า"
        />
        <SourceCard
          title="③ ค่าใช้จ่าย แยกแหล่งเงิน"
          rows={outflow.rows}
          total={outflow.total}
          nameOf={sourceName}
          empty="ไม่มีค่าใช้จ่าย"
        />
      </div>

      {/* ---------------------------------------------------------------- ④ -- */}
      <div className="card p-5">
        <h2 className="font-bold">④ ยอดคงเหลือแต่ละแหล่งเงิน ณ สิ้นวัน</h2>
        <p className="text-xs mb-3" style={muted}>
          ยกมา + รับเข้า − จ่ายออก ± โอนระหว่างแหล่งเงิน = คงเหลือ
        </p>
        {balances.length === 0 ? (
          <p className="text-sm" style={muted}>
            ยังไม่ได้ตั้งแหล่งเงิน
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ ...muted, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ ...cell, textAlign: 'left' }}>แหล่งเงิน</th>
                  <th style={numCell}>ยกมา</th>
                  <th style={numCell}>+ รับ</th>
                  <th style={numCell}>− จ่าย</th>
                  <th style={numCell}>± โอน</th>
                  <th style={numCell}>คงเหลือ</th>
                </tr>
              </thead>
              {balances.map((b) => (
                <tbody key={b.shop}>
                  {showShopColumn && (
                    <tr style={{ background: 'var(--paper)' }}>
                      <td colSpan={5} style={{ ...cell, fontWeight: 700 }}>
                        {b.name}
                      </td>
                      <td style={{ ...numCell, fontWeight: 700 }}>{fmt(b.total)}</td>
                    </tr>
                  )}
                  {b.accounts.map((a) => (
                    <tr key={a.accountId} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={cell}>
                        <Link href={`/money/${a.accountId}`} style={{ color: 'var(--ink)' }}>
                          {a.name}
                        </Link>
                      </td>
                      <td style={numCell}>{fmt(a.opening)}</td>
                      <td style={numCell}>{a.inflow ? fmt(a.inflow) : '-'}</td>
                      <td style={numCell}>{a.outflow ? fmt(a.outflow) : '-'}</td>
                      <td style={numCell}>
                        {a.transfer ? `${a.transfer > 0 ? '+' : ''}${fmt(a.transfer)}` : '-'}
                      </td>
                      <td
                        style={{
                          ...numCell,
                          fontWeight: 700,
                          color: a.closing < 0 ? '#b23a48' : undefined,
                        }}
                      >
                        {fmt(a.closing)}
                        {a.closing < 0 ? ' ⚠' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td colSpan={5} style={{ ...cell, fontWeight: 700 }}>
                    รวมเงินทุกแหล่ง
                  </td>
                  <td style={{ ...numCell, fontWeight: 700 }}>
                    {fmt(balances.reduce((n, b) => n + b.total, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ print -- */}
      {mounted &&
        createPortal(
          <div className="print-area">
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>
              สรุปการเงินประจำวัน
            </h2>
            <p style={{ fontSize: 12, margin: '0 0 10px' }}>
              {scopeName} · {dateLabel}
            </p>
            <table className="compact-table" style={{ marginBottom: 10 }}>
              <tbody>
                <tr>
                  <th>ยอดขายที่เก็บเงินได้</th>
                  <th>เงินรับเข้า</th>
                  <th>ค่าใช้จ่าย</th>
                  <th>เงินสุทธิ (รับ − จ่าย)</th>
                </tr>
                <tr>
                  <td>{fmt(sales.total)}</td>
                  <td>{fmt(inflow.total)}</td>
                  <td>{fmt(outflow.total)}</td>
                  <td>{fmt(net)}</td>
                </tr>
              </tbody>
            </table>

            <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>
              ① ยอดขาย (ที่เก็บเงินได้) แยกตามชนิดสินค้า
            </p>
            <table className="compact-table" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>ชนิดสินค้า</th>
                  <th>ยอดเงิน</th>
                  <th>สัดส่วน</th>
                </tr>
              </thead>
              <tbody>
                {sales.channels.flatMap((c) => [
                  <tr key={c.channel}>
                    <td style={{ fontWeight: 700 }}>{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(c.total)}</td>
                    <td>{pct(c.total, sales.total)}%</td>
                  </tr>,
                  ...c.categories.map((cat) => (
                    <tr key={`${c.channel}-${cat.name}`}>
                      <td style={{ paddingLeft: 14 }}>{cat.name}</td>
                      <td>{fmt(cat.amount)}</td>
                      <td>{pct(cat.amount, sales.total)}%</td>
                    </tr>
                  )),
                ])}
                <tr>
                  <td style={{ fontWeight: 700 }}>รวมยอดขาย</td>
                  <td style={{ fontWeight: 700 }}>{fmt(sales.total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            {sales.held > 0 && (
              <p style={{ fontSize: 10, margin: '-6px 0 10px' }}>
                เงินรอคืน Finnix {fmt(sales.held)} บาท (ไม่นับเป็นยอดขาย รวมอยู่ในเงินรับเข้า)
              </p>
            )}

            <table className="compact-table" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>② เงินรับเข้า แยกแหล่งเงิน</th>
                  <th>ยอดเงิน</th>
                  <th>③ ค่าใช้จ่าย แยกแหล่งเงิน</th>
                  <th>ยอดเงิน</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(inflow.rows.length, outflow.rows.length) }).map(
                  (_, i) => (
                    <tr key={i}>
                      <td>{inflow.rows[i] ? sourceName(inflow.rows[i]) : ''}</td>
                      <td>{inflow.rows[i] ? fmt(inflow.rows[i].amount) : ''}</td>
                      <td>{outflow.rows[i] ? sourceName(outflow.rows[i]) : ''}</td>
                      <td>{outflow.rows[i] ? fmt(outflow.rows[i].amount) : ''}</td>
                    </tr>
                  ),
                )}
                <tr>
                  <td style={{ fontWeight: 700 }}>รวม</td>
                  <td style={{ fontWeight: 700 }}>{fmt(inflow.total)}</td>
                  <td style={{ fontWeight: 700 }}>รวม</td>
                  <td style={{ fontWeight: 700 }}>{fmt(outflow.total)}</td>
                </tr>
              </tbody>
            </table>

            <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>
              ④ ยอดคงเหลือแต่ละแหล่งเงิน ณ สิ้นวัน
            </p>
            <table className="compact-table">
              <thead>
                <tr>
                  <th>แหล่งเงิน</th>
                  <th>ยกมา</th>
                  <th>+ รับ</th>
                  <th>− จ่าย</th>
                  <th>± โอน</th>
                  <th>คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {balances.flatMap((b) =>
                  b.accounts.map((a) => (
                    <tr key={a.accountId}>
                      <td>
                        {a.name}
                        {showShopColumn ? ` · ${shortShopName(b.name)}` : ''}
                      </td>
                      <td>{fmt(a.opening)}</td>
                      <td>{fmt(a.inflow)}</td>
                      <td>{fmt(a.outflow)}</td>
                      <td>{fmt(a.transfer)}</td>
                      <td>{fmt(a.closing)}</td>
                    </tr>
                  )),
                )}
                <tr>
                  <td colSpan={5} style={{ fontWeight: 700 }}>
                    รวมเงินทุกแหล่ง
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {fmt(balances.reduce((n, b) => n + b.total, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  noteColor,
  valueColor,
  signed,
}: {
  label: string;
  value: number;
  note: string;
  noteColor?: string;
  valueColor?: string;
  signed?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
        {label}
      </p>
      <p className="text-xl font-bold mt-1" style={{ color: valueColor }}>
        {signed && value > 0 ? '+' : ''}
        {fmt(value)}
      </p>
      <p className="text-xs mt-0.5" style={{ color: noteColor ?? 'var(--ink-soft)' }}>
        {note}
      </p>
    </div>
  );
}

function SourceCard({
  title,
  rows,
  total,
  nameOf,
  empty,
}: {
  title: string;
  rows: SourceRow[];
  total: number;
  nameOf: (r: SourceRow) => string;
  empty: string;
}) {
  const cell = { padding: '7px 8px' };
  const numCell = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  return (
    <div className="card p-5">
      <h2 className="font-bold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {empty}
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={cell}>
                  {nameOf(r)}
                  {r.accountId === null && (
                    <span title="ชื่อนี้ยังไม่ได้ผูกกับแหล่งเงินใด" style={{ color: '#B8860B' }}>
                      {' '}
                      ⚠
                    </span>
                  )}
                  <span className="text-xs ml-1.5" style={{ color: 'var(--ink-soft)' }}>
                    {r.count} รายการ
                  </span>
                </td>
                <td style={numCell}>{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
              <td style={{ ...cell, fontWeight: 700 }}>รวม</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
