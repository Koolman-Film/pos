'use client';

import Link from 'next/link';

import { fmt, fmtThaiDayString } from '@/lib/domain/format';

import type { SalesReport, SalesReportGroup, SalesReportGroupBy } from './salesReport';
import type { Shop } from './types';
import { shopName } from './types';

/**
 * รายงานสรุปการขายของขายส่ง — บนหน้าจอ (ร้านขอ 6 พ.ย. 2569).
 *
 * หน้ารายการตอบทีละใบ รายงานนี้ตอบเป็นราย "ลูกค้า" หรือราย "เซลล์" แล้วจบที่
 * ยอดค้างชำระ ซึ่งเป็นตัวเลขที่ร้านต้องนั่งรวมเองจากหน้ารายการทุกครั้ง
 *
 * ตัวกรองทั้งหมดใช้ของหน้ารายการร่วมกัน — สาขา ช่วงเวลา ลูกค้า สินค้า เซลล์
 * สถานะ รายงานจึงเป็นมุมมองของชุดเดียวกัน ไม่ใช่หน้าที่มีตัวกรองชุดที่สอง
 * ให้ตั้งไม่ตรงกันได้
 */
export function WholesaleReport({
  report,
  groupBy,
  shops,
  caption,
}: {
  report: SalesReport;
  groupBy: SalesReportGroupBy;
  shops: Shop[];
  /** ช่วงเวลาที่กรองอยู่ ตามถ้อยคำเดียวกับหน้ารายการ. */
  caption: string;
}) {
  if (report.groups.length === 0) return null;

  const counterpartHead = groupBy === 'customer' ? 'พนักงานขาย' : 'ลูกค้า';

  return (
    // ตั้งชื่อไว้ให้แยกออกจากสำเนาที่อยู่ใน .print-area ซึ่งซ้อนเนื้อหาเดียวกัน
    <section aria-label="รายงานสรุปการขาย" className="flex flex-col gap-3">
      {/*
        ยอดรวมอยู่บนสุด ก่อนรายละเอียด.

        คนเปิดรายงานนี้ถามคำถามเดียวก่อนเสมอ — ค้างอยู่เท่าไหร่ — แล้วค่อยไล่ดู
        ว่าใครค้าง การวางยอดรวมไว้ท้ายตารางยาว ๆ แปลว่าต้องเลื่อนผ่านคำตอบทุกครั้ง
      */}
      <div className="card p-4">
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          {caption} · {report.orders} ใบ
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Figure label="ยอดขายรวม" value={report.total} />
          <Figure label="ชำระแล้ว" value={report.paid} tone="#3F6B33" />
          <Figure label="แจ้งแล้ว รอยืนยัน" value={report.reported} tone="#8A5A12" />
          <Figure label="ค้างชำระ" value={report.outstanding} tone="#B23A48" strong />
        </div>
        {report.overdueOutstanding > 0 && (
          <p className="text-xs mt-2 font-medium" style={{ color: '#B23A48' }}>
            <i className="fa-solid fa-triangle-exclamation mr-1"></i>
            ในยอดค้างชำระนี้ เลยกำหนดชำระแล้ว {fmt(report.overdueOutstanding)}
          </p>
        )}
      </div>

      {report.groups.map((g) => (
        <GroupCard key={g.key} group={g} shops={shops} counterpartHead={counterpartHead} />
      ))}
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: number;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
        {label}
      </p>
      <p
        className={strong ? 'text-lg font-bold' : 'text-base font-semibold'}
        style={{ color: tone }}
      >
        {fmt(value)}
      </p>
    </div>
  );
}

function GroupCard({
  group,
  shops,
  counterpartHead,
}: {
  group: SalesReportGroup;
  shops: Shop[];
  counterpartHead: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <p className="font-semibold">
          {group.label}
          <span className="text-xs font-normal ml-2" style={{ color: 'var(--ink-faint)' }}>
            {group.orders} ใบ
          </span>
        </p>
        <p className="text-sm">
          <span style={{ color: 'var(--ink-soft)' }}>ค้างชำระ</span>{' '}
          <b style={{ color: group.outstanding > 0.005 ? '#B23A48' : 'var(--ink-soft)' }}>
            {fmt(group.outstanding)}
          </b>
          <span className="text-xs ml-2" style={{ color: 'var(--ink-faint)' }}>
            จากยอดขาย {fmt(group.total)}
          </span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--ink-soft)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>เลขที่ PO</th>
              <th style={{ padding: '6px 8px' }}>เปิดเมื่อ</th>
              <th style={{ padding: '6px 8px' }}>{counterpartHead}</th>
              <th style={{ padding: '6px 8px' }}>สถานะ</th>
              <th style={{ padding: '6px 8px' }}>กำหนดชำระ</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>ยอดสุทธิ</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>ชำระแล้ว</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>ค้างชำระ</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.orderId} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 8px' }}>
                  <Link href={`/wholesale/${r.orderId}`} style={{ color: 'var(--primary)' }}>
                    {r.orderId}
                  </Link>
                  {shops.length > 1 && (
                    <span className="block" style={{ color: 'var(--ink-faint)' }}>
                      {shopName(r.shop, shops)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {r.openedOn ? fmtThaiDayString(r.openedOn) : '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>{r.counterpart}</td>
                <td style={{ padding: '6px 8px' }}>{r.status}</td>
                <td style={{ padding: '6px 8px', color: r.overdue ? '#B23A48' : undefined }}>
                  {r.dueAt ? fmtThaiDayString(r.dueAt) : '—'}
                  {r.overdue && ' · เลยกำหนด'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(r.total)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  {fmt(r.paid)}
                  {/* เช็คที่รับไว้แล้วแต่ยังไม่ยืนยัน — ยังไม่ตัดหนี้ แต่ลูกค้า
                      ที่ยื่นเช็คมาแล้วอยู่คนละสถานะกับคนที่ยังไม่ส่งอะไรมาเลย */}
                  {r.reported > 0.005 && (
                    <span className="block" style={{ color: '#8A5A12' }}>
                      แจ้งแล้ว {fmt(r.reported)}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    padding: '6px 8px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: r.outstanding > 0.005 ? '#B23A48' : undefined,
                  }}
                >
                  {fmt(r.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1.5px solid var(--line-strong)', fontWeight: 700 }}>
              <td colSpan={5} style={{ padding: '6px 8px' }}>
                รวม
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(group.total)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(group.paid)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(group.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
