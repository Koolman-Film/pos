'use client';

import Link from 'next/link';

import { fmt, fmtQty, fmtThaiDayString } from '@/lib/domain/format';

import { paymentStatusText } from './salesReport';
import type {
  SalesReport,
  SalesReportGroup,
  SalesReportGroupBy,
  SalesReportRow,
} from './salesReport';
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
 *
 * ตารางแบ่งเป็นสามหัวข้อตามที่ร้านขอ 7 พ.ย. 2569 — การสั่งซื้อ · การชำระเงิน ·
 * จำนวนเงินคงค้างชำระ เพราะสามเรื่องนี้ถูกอ่านคนละเวลาและคนละคน: คนดูว่าขาย
 * อะไรไป คนดูว่าเก็บเงินได้หรือยัง และคนที่ต้องโทรไปทวง การเรียงเป็นคอลัมน์
 * ยาวแถวเดียวบังคับให้ทั้งสามคนอ่านทุกช่องเพื่อหาช่องของตัวเอง
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Figure label="ยอดขายรวม" value={report.total} />
          <Figure label="ชำระแล้ว" value={report.paid} tone="#3F6B33" />
          <Figure label="รอยืนยันเงินเข้า" value={report.reported} tone="#8A5A12" />
          <Figure label="ค้างชำระ" value={report.outstanding} tone="#B23A48" strong />
          {/*
            ค้างสุทธิ = ค้างชำระ − ที่รอยืนยัน.

            สองยอดนี้สั่งงานคนละอย่าง ยอดที่รอยืนยันต้องไปตามคนในร้านให้กดยืนยัน
            ส่วนยอดสุทธิคือเงินที่ยังไม่มีใครส่งอะไรมาเลย นั่นคือยอดที่ต้องโทรหา
            ลูกค้าจริง ๆ
          */}
          <Figure label="ค้างสุทธิ (หักที่รอยืนยัน)" value={report.netOutstanding} tone="#B23A48" />
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

/** หัวข้อสามเรื่องที่ตารางแบ่งไว้ — ใช้ร่วมกับสำเนาที่พิมพ์ลงกระดาษ. */
const SECTION_TINT = {
  order: 'rgba(100, 116, 139, 0.10)',
  payment: 'rgba(63, 107, 51, 0.10)',
  balance: 'rgba(178, 58, 72, 0.10)',
};

const cell = { padding: '6px 8px', verticalAlign: 'top' as const };
const num = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

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
      {/*
        ชื่อลูกค้า/เซลล์ ต้องเห็นว่าเป็นหัวเรื่อง ไม่ใช่ข้อความบรรทัดหนึ่ง
        (ร้านแจ้ง 7 พ.ย. 2569).

        รายงานยาวหลายหน้าถูกอ่านด้วยการกวาดตาหาชื่อ ไม่ใช่อ่านทีละบรรทัด ชื่อที่
        หนาเท่าข้อความรอบข้างทำให้ต้องอ่านทุกบรรทัดเพื่อหาว่าตารางนี้ของใคร
      */}
      <div
        className="flex items-baseline justify-between gap-3 flex-wrap mb-2 rounded-xl px-3 py-2"
        style={{ background: 'var(--surface-2, rgba(127,127,127,0.08))' }}
      >
        <p className="text-base font-bold">
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
        {/*
          สิบคอลัมน์ต้องการที่ขั้นต่ำ ไม่ใช่บีบให้พอดีจอ.

          ปล่อยให้ยืดหยุ่นเต็มที่ จอแคบจะบีบช่องสินค้าจนชื่อแตกเป็นห้าบรรทัด
          อ่านไม่ออก — เลื่อนตารางซ้ายขวาอ่านง่ายกว่าอ่านคำที่ถูกหั่น
        */}
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            {/*
              แถวหัวข้อใหญ่ สามเรื่อง — colSpan ไม่ใช่การตกแต่ง มันคือสิ่งที่
              บอกว่าสี่ช่องนี้เป็นเรื่องเดียวกัน
            */}
            <tr style={{ textAlign: 'center' }}>
              <th colSpan={4} style={{ ...cell, background: SECTION_TINT.order }}>
                1. การสั่งซื้อ
              </th>
              <th colSpan={4} style={{ ...cell, background: SECTION_TINT.payment }}>
                2. การชำระเงิน
              </th>
              <th colSpan={2} style={{ ...cell, background: SECTION_TINT.balance }}>
                3. จำนวนเงินคงค้างชำระ
              </th>
            </tr>
            <tr style={{ color: 'var(--ink-soft)', textAlign: 'left' }}>
              <th style={cell}>เลขที่ PO</th>
              <th style={cell}>วันที่ส่งของ</th>
              <th style={cell}>สินค้า</th>
              <th style={num}>จำนวนเงิน</th>
              <th style={cell}>วันที่ชำระ</th>
              <th style={cell}>วิธีการชำระ</th>
              <th style={num}>จำนวนที่ชำระ</th>
              <th style={cell}>สถานะ</th>
              <th style={num}>รอยืนยันเงินเข้า</th>
              <th style={num}>คงค้างสุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <OrderRows key={r.orderId} row={r} shops={shops} counterpart={counterpartHead} />
            ))}
          </tbody>
          <tfoot>
            {/*
              แถวรวม ต้องบอกว่าแต่ละตัวเลขคือยอดอะไร.

              ตัวเลขเปล่า ๆ สามตัวใต้ตารางยาว บังคับให้คนนับคอลัมน์ขึ้นไปหาหัว
              ตาราง ซึ่งอาจอยู่คนละหน้ากระดาษแล้ว
            */}
            <tr style={{ borderTop: '1.5px solid var(--line-strong)', fontWeight: 700 }}>
              <td colSpan={3} style={cell}>
                รวม {group.orders} ใบ
              </td>
              <td style={num}>{fmt(group.total)}</td>
              <td colSpan={2} style={{ ...cell, textAlign: 'right' }}>
                ชำระแล้ว
              </td>
              <td style={num}>{fmt(group.paid)}</td>
              <td style={cell}></td>
              <td style={num}>{fmt(group.reported)}</td>
              <td style={num}>{fmt(group.netOutstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * หนึ่ง PO = หนึ่งแถว ต่อการชำระเงินหนึ่งครั้ง.
 *
 * `rowSpan` ทำให้ช่องฝั่งการสั่งซื้อกับฝั่งยอดค้างเขียนครั้งเดียว แล้วการชำระ
 * เงินหลายครั้งเรียงลงมาในแถวของมันเอง — ถ้าเอาทุกงวดยัดในช่องเดียว บรรทัด
 * วันที่กับบรรทัดจำนวนเงินจะเลื่อนไม่ตรงกันทันทีที่ชื่อวิธีชำระยาวต่างกัน
 */
function OrderRows({
  row,
  shops,
  counterpart,
}: {
  row: SalesReportRow;
  shops: Shop[];
  /** ป้ายของอีกมิติหนึ่ง — จัดกลุ่มตามลูกค้าก็เป็น "พนักงานขาย" และกลับกัน. */
  counterpart: string;
}) {
  const pays = row.payments;
  const span = Math.max(1, pays.length);
  const first = pays[0];

  const orderCells = (
    <>
      {/* เลขเอกสารขึ้นบรรทัดใหม่กลางคำ อ่านแล้วเหมือนคนละใบ */}
      <td style={{ ...cell, background: SECTION_TINT.order, whiteSpace: 'nowrap' }} rowSpan={span}>
        <Link href={`/wholesale/${row.orderId}`} style={{ color: 'var(--primary)' }}>
          {row.orderId}
        </Link>
        {shops.length > 1 && (
          <span className="block" style={{ color: 'var(--ink-faint)' }}>
            {shopName(row.shop, shops)}
          </span>
        )}
        {/*
          อีกมิติหนึ่งเกาะมากับเลขที่ PO ไม่ใช่คอลัมน์ของตัวเอง.

          ร้านไม่ได้ขอช่องนี้ไว้ในสามหัวข้อ แต่การทิ้งมันไปเงียบ ๆ แปลว่า
          รายงานที่จัดกลุ่มตามลูกค้า ตอบไม่ได้อีกต่อไปว่าใบไหนเซลล์คนไหนขาย
        */}
        <span className="block" style={{ color: 'var(--ink-faint)' }}>
          {counterpart}: {row.counterpart}
        </span>
      </td>
      <td style={{ ...cell, background: SECTION_TINT.order, whiteSpace: 'nowrap' }} rowSpan={span}>
        {row.deliveredAt ? fmtThaiDayString(row.deliveredAt) : 'ยังไม่ส่ง'}
      </td>
      <td style={{ ...cell, background: SECTION_TINT.order }} rowSpan={span}>
        {row.items.length === 0 ? (
          '—'
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {row.items.map((it, i) => (
              <li key={i}>
                {it.name} × {fmtQty(it.qty)}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td style={{ ...num, background: SECTION_TINT.order }} rowSpan={span}>
        {fmt(row.total)}
      </td>
    </>
  );

  const balanceCells = (
    <>
      <td style={{ ...num, background: SECTION_TINT.balance }} rowSpan={span}>
        {row.reported > 0.005 ? (
          <b style={{ color: '#8A5A12' }}>{fmt(row.reported)}</b>
        ) : (
          <span style={{ color: 'var(--ink-faint)' }}>—</span>
        )}
      </td>
      <td
        style={{
          ...num,
          background: SECTION_TINT.balance,
          fontWeight: 600,
          color: row.netOutstanding > 0.005 ? '#B23A48' : undefined,
        }}
        rowSpan={span}
      >
        {fmt(row.netOutstanding)}
        {/* กำหนดชำระอยู่ตรงนี้ เพราะมันเป็นคุณสมบัติของ "ยอดที่ยังค้าง"
            ไม่ใช่ของการสั่งซื้อ — ใบที่จ่ายครบแล้วไม่มีกำหนดชำระให้เลย */}
        {row.outstanding > 0.005 && row.dueAt && (
          <span
            className="block font-normal"
            style={{ color: row.overdue ? '#B23A48' : 'var(--ink-faint)' }}
          >
            กำหนด {fmtThaiDayString(row.dueAt)}
            {row.overdue && ' · เลยกำหนด'}
          </span>
        )}
      </td>
    </>
  );

  if (pays.length === 0) {
    return (
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        {orderCells}
        <td colSpan={4} style={{ ...cell, color: 'var(--ink-faint)' }}>
          ยังไม่มีการชำระเงิน
        </td>
        {balanceCells}
      </tr>
    );
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        {orderCells}
        <PaymentCells pay={first} />
        {balanceCells}
      </tr>
      {pays.slice(1).map((p, i) => (
        <tr key={i}>
          <PaymentCells pay={p} />
        </tr>
      ))}
    </>
  );
}

function PaymentCells({ pay }: { pay: SalesReportRow['payments'][number] }) {
  const text = paymentStatusText(pay);
  const tone = pay.settled ? '#3F6B33' : text === 'เช็คเด้ง' ? '#B23A48' : '#8A5A12';
  return (
    <>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        {pay.paidAt ? fmtThaiDayString(pay.paidAt) : '—'}
      </td>
      <td style={cell}>{pay.method}</td>
      <td style={num}>{fmt(pay.amount)}</td>
      <td style={{ ...cell, color: tone, whiteSpace: 'nowrap' }}>{text}</td>
    </>
  );
}
