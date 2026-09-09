'use client';

import { useState } from 'react';

import { fmt, shortShopName } from '@/lib/domain/format';

import type { BranchComparison as Data, BranchRow } from './branchTotals';

/**
 * เปรียบเทียบรายสาขา — the card that answers "which branch is ahead".
 *
 * Shown only while the dashboard is on ทุกร้าน: with one branch selected there
 * is nothing to compare it against, and a one-row table pretending otherwise is
 * worse than no table.
 *
 * A plain table. It first carried a tinted bar behind every figure to show the
 * ranking; across seven columns that is seven overlapping washes of colour on
 * one screen, and the shop said it read as harder rather than easier. The
 * ranking is carried by the row ORDER and by the stated rank number, which is
 * what people were reading anyway. Colour is now reserved for the one thing it
 * has to say: a negative figure.
 */

/** Which column the table is ranked by. */
type SortKey =
  | 'revenue'
  | 'expenses'
  | 'profit'
  | 'jobs'
  | 'receivable'
  | 'payable'
  | 'netDue'
  | 'heldForFinnix';

const COLUMNS: { key: SortKey; label: string; hint: string; money: boolean }[] = [
  { key: 'revenue', label: 'ยอดขาย', hint: 'งานที่ส่งมอบ + ประกันที่ขายในช่วงนี้', money: true },
  {
    key: 'expenses',
    label: 'ค่าใช้จ่าย',
    hint: 'ที่จ่ายแล้วในช่วงนี้ ไม่รวมจ่ายแทน Finnix',
    money: true,
  },
  {
    key: 'profit',
    label: 'คงเหลือ',
    hint: 'ยอดขาย − ค่าใช้จ่าย (ยังไม่หักต้นทุนสินค้า)',
    money: true,
  },
  { key: 'jobs', label: 'งาน', hint: 'จำนวนใบงานที่รับเข้าในช่วงนี้', money: false },
  {
    key: 'receivable',
    label: 'ค้างรับ',
    hint: 'ยอดค้างรับ ณ ตอนนี้ ไม่ผูกกับช่วงเวลา',
    money: true,
  },
  {
    key: 'payable',
    label: 'ค้างจ่าย',
    hint: 'บิลที่รับไว้แล้วยังไม่ได้จ่าย ณ ตอนนี้ ไม่ผูกกับช่วงเวลา',
    money: true,
  },
  {
    key: 'netDue',
    label: 'ค้างสุทธิ',
    hint: 'ค้างรับ − ค้างจ่าย · บวกคือมีเงินจะเข้ามากกว่าที่ต้องจ่าย',
    money: true,
  },
  {
    key: 'heldForFinnix',
    label: 'รอคืน Finnix',
    hint: 'รับเงินแทนร้านอื่น ไม่นับเป็นยอดขายของสาขา',
    money: true,
  },
];

export function BranchComparison({ data, caption }: { data: Data; caption?: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const rows = [...data.rows].sort((a, b) => b[sortKey] - a[sortKey]);

  const cell = (r: BranchRow, key: SortKey, money: boolean) => {
    const value = r[key];
    return (
      <td
        key={key}
        style={{
          padding: '10px 12px',
          textAlign: 'right',
          fontWeight: sortKey === key ? 700 : 500,
          color: value < 0 ? '#B23A48' : 'var(--ink)',
          whiteSpace: 'nowrap',
        }}
      >
        {money ? fmt(value) : value}
      </td>
    );
  };

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="font-semibold flex items-center gap-2">
          <i className="fa-solid fa-chart-column" style={{ color: 'var(--primary)' }}></i>
          เปรียบเทียบรายสาขา
        </p>
        {caption && (
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            {caption}
          </p>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
        กดหัวคอลัมน์เพื่อจัดอันดับใหม่
      </p>

      {/* Wide on purpose: six columns of Thai baht do not fit a phone, so the
          table scrolls inside its own box rather than the whole page sliding. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid var(--line-strong)' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '0 12px 8px',
                  color: 'var(--ink-soft)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                สาขา
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} style={{ padding: '0 12px 8px' }}>
                  <button
                    onClick={() => setSortKey(c.key)}
                    title={c.hint}
                    aria-label={`จัดอันดับตาม ${c.label} — ${c.hint}`}
                    className="text-xs font-semibold"
                    style={{
                      width: '100%',
                      textAlign: 'right',
                      color: sortKey === c.key ? 'var(--primary)' : 'var(--ink-soft)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label}
                    {sortKey === c.key && <i className="fa-solid fa-caret-down ml-1"></i>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.shop} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  {/* The rank is the point of the card, so it is stated rather
                      than left to be inferred from the row order. */}
                  <span
                    className="text-xs mr-2"
                    style={{ color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium">{shortShopName(r.name)}</span>
                </td>
                {COLUMNS.map((c) => cell(r, c.key, c.money))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="text-sm"
                  style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--ink-faint)' }}
                >
                  ไม่มีสาขาให้เปรียบเทียบ
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '1.5px solid var(--line-strong)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  รวมทุกสาขา
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: '10px 12px',
                      textAlign: 'right',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      color: data.total[c.key] < 0 ? '#B23A48' : 'var(--ink)',
                    }}
                  >
                    {c.money ? fmt(data.total[c.key]) : data.total[c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
