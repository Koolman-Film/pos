import Link from 'next/link';

import { DEFAULT_WS_STATUS } from '@/components/wholesale/types';
import { fmt } from '@/lib/domain/format';

import type { WholesaleOverviewData } from './buildWholesaleOverview';

/**
 * ขายส่ง — the dashboard card for the part of the business that runs on POs.
 *
 * Laid out in the order a wholesale day is worked: how much has been sold, what
 * is owed and what is late, which POs are sitting in which step, who sold what,
 * and the latest POs. Every number links to the list of exactly those POs.
 */

const neutral = { bg: 'var(--paper)', text: 'var(--ink-soft)', dot: 'var(--ink-faint)' };
const toneOf = (status: string) => DEFAULT_WS_STATUS[status] ?? neutral;

function Tile({
  label,
  amount,
  count,
  href,
  tone,
}: {
  label: string;
  amount: number;
  count?: number;
  href?: string;
  tone?: 'danger' | 'warning';
}) {
  const color = tone === 'danger' ? '#B23A48' : tone === 'warning' ? '#8A5A12' : 'var(--ink)';
  const body = (
    <>
      <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
        {label}
      </p>
      <p className="text-lg font-bold mt-0.5" style={{ color }}>
        {fmt(amount)}
      </p>
      {count !== undefined && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
          {count} PO
        </p>
      )}
    </>
  );
  const box = 'rounded-xl px-3.5 py-3 block';
  const style = { background: 'var(--paper)' };
  return href ? (
    <Link href={href} className={box} style={style}>
      {body}
    </Link>
  ) : (
    <div className={box} style={style}>
      {body}
    </div>
  );
}

export function WholesaleOverview({ data }: { data: WholesaleOverviewData }) {
  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="icon-tile" style={{ background: '#E6EFE3' }}>
            <i className="fa-solid fa-truck-fast" style={{ color: '#3F6B33' }}></i>
          </div>
          <div>
            <p className="text-sm font-semibold">ขายส่ง</p>
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              PO ที่ยังไม่ปิด {data.openCount} ใบ
            </p>
          </div>
        </div>
        <Link href="/wholesale" className="btn-primary text-xs px-3 py-1.5 rounded-lg font-medium">
          ดูทั้งหมด
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <Tile label="ขายส่งรับเงินแล้ว (ช่วงที่เลือก)" amount={data.sales} />
        <Tile label="ค้างรับ (ส่งของแล้ว)" amount={data.owing.amount} count={data.owing.count} />
        <Tile
          label="เลยกำหนดชำระ"
          amount={data.overdue.amount}
          count={data.overdue.count}
          href="/wholesale?flag=overdue"
          tone={data.overdue.count > 0 ? 'danger' : undefined}
        />
        <Tile
          label="ใกล้ถึงกำหนดชำระ"
          amount={data.dueSoon.amount}
          count={data.dueSoon.count}
          href="/wholesale?flag=dueSoon"
          tone={data.dueSoon.count > 0 ? 'warning' : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {data.statusCounts.map((s) => {
          const tone = toneOf(s.status);
          return (
            <Link
              key={s.status}
              href={`/wholesale?status=${encodeURIComponent(s.status)}`}
              className="text-xs px-3 py-1.5 rounded-full font-semibold flex items-center gap-1.5"
              style={{ background: tone.bg, color: tone.text }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }}></span>
              {s.status} {s.count}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-soft)' }}>
            สรุปรายเซลล์
          </p>
          {data.byRep.length === 0 ? (
            <p className="text-xs py-3" style={{ color: 'var(--ink-faint)' }}>
              PO ในสาขานี้ยังไม่ได้ระบุพนักงานขาย
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>
                    <th className="text-xs font-semibold text-left py-1.5">เซลล์</th>
                    <th className="text-xs font-semibold text-right py-1.5">PO ยังไม่ปิด</th>
                    <th className="text-xs font-semibold text-right py-1.5">รับเงินแล้ว</th>
                    <th className="text-xs font-semibold text-right py-1.5">ค้างรับ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byRep.map((r) => (
                    <tr key={r.name} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="py-2">
                        <Link
                          href={`/wholesale?sale=${encodeURIComponent(r.name)}`}
                          style={{ color: 'var(--primary)' }}
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="py-2 text-right">{r.openCount}</td>
                      <td className="py-2 text-right">{fmt(r.sales)}</td>
                      <td className="py-2 text-right">{fmt(r.owing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-soft)' }}>
            PO ล่าสุด
          </p>
          <div className="flex flex-col">
            {data.recent.map((o, i) => {
              const tone = toneOf(o.status);
              return (
                <Link
                  key={o.id}
                  href={`/wholesale/${encodeURIComponent(o.id)}`}
                  className="flex items-center justify-between gap-3 py-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                >
                  <span className="min-w-0">
                    <span className="text-sm font-semibold block truncate">{o.customer}</span>
                    <span className="text-xs block truncate" style={{ color: 'var(--ink-faint)' }}>
                      {o.id}
                      {o.salesBy ? ` · ${o.salesBy}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="text-sm font-bold"
                      aria-label={`ยอด ${o.id} ${fmt(o.total)} บาท`}
                    >
                      {fmt(o.total)}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: tone.bg, color: tone.text }}
                    >
                      {o.status}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
