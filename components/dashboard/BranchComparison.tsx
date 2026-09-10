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
  | 'retail'
  | 'wholesale'
  | 'expenses'
  | 'profit'
  | 'jobs'
  | 'receivable'
  | 'payable'
  | 'netDue'
  | 'heldForFinnix';

/**
 * หมวดของคอลัมน์.
 *
 * Eleven columns of Thai baht read as one undifferentiated wall, and they are
 * not one kind of number: three are takings in the period, three are how the
 * period went, four are what is owed RIGHT NOW regardless of the period. A
 * reader comparing branches has to know which question a column answers before
 * the figure means anything — ค้างรับ 40,900 beside ยอดขาย 53,300 invites
 * subtracting one from the other, and they do not even cover the same days.
 *
 * Marked with a caption and a rule rather than a fill: the shop asked for the
 * colour-graded comparison to come out ("มองแล้วยาก"), and grouping is
 * structure, not emphasis.
 */
const GROUPS = {
  sales: { label: 'ยอดขายในช่วงนี้' },
  result: { label: 'ผลประกอบการในช่วงนี้' },
  due: { label: 'ยอดค้าง ณ ตอนนี้' },
  other: { label: 'อื่นๆ' },
} as const;

type GroupKey = keyof typeof GROUPS;

/**
 * `channelOnly` columns appear only where some branch actually sells that way.
 *
 * Most branches sell retail only, and for them a ขายส่ง column of zeros would
 * be two more columns to scroll past on a phone saying nothing. Where a
 * wholesale desk does exist — Finnix North, Central Audio — the split is the
 * first thing management asks about, because the two halves behave nothing
 * alike: one is paid at the counter, the other on credit weeks later.
 */
const COLUMNS: {
  key: SortKey;
  label: string;
  hint: string;
  money: boolean;
  group: GroupKey;
  channelOnly?: boolean;
}[] = [
  {
    key: 'revenue',
    label: 'ยอดขาย',
    hint: 'ขายปลีก + ขายส่ง ในช่วงนี้',
    money: true,
    group: 'sales',
  },
  {
    key: 'retail',
    label: 'ปลีก',
    hint: 'งานที่ส่งมอบ + ประกันที่ขายในช่วงนี้ (Book งาน)',
    money: true,
    group: 'sales',
    channelOnly: true,
  },
  {
    key: 'wholesale',
    label: 'ส่ง',
    hint: 'ขายส่งที่ส่งของแล้วในช่วงนี้ หักคืนสินค้าและปรับราคาตามวันที่ของมันเอง',
    money: true,
    group: 'sales',
    channelOnly: true,
  },
  {
    key: 'expenses',
    label: 'ค่าใช้จ่าย',
    hint: 'ที่จ่ายแล้วในช่วงนี้ ไม่รวมจ่ายแทน Finnix',
    money: true,
    group: 'result',
  },
  {
    key: 'profit',
    label: 'คงเหลือ',
    hint: 'ยอดขาย − ค่าใช้จ่าย (ยังไม่หักต้นทุนสินค้า)',
    money: true,
    group: 'result',
  },
  {
    key: 'jobs',
    label: 'งาน',
    hint: 'จำนวนใบงานที่รับเข้าในช่วงนี้',
    money: false,
    group: 'result',
  },
  {
    key: 'receivable',
    label: 'ค้างรับ',
    hint: 'ยอดค้างรับ ณ ตอนนี้ ไม่ผูกกับช่วงเวลา',
    money: true,
    group: 'due',
  },
  {
    key: 'payable',
    label: 'ค้างจ่าย',
    hint: 'บิลที่รับไว้แล้วยังไม่ได้จ่าย ณ ตอนนี้ ไม่ผูกกับช่วงเวลา',
    money: true,
    group: 'due',
  },
  {
    key: 'netDue',
    label: 'ค้างสุทธิ',
    hint: 'ค้างรับ − ค้างจ่าย · บวกคือมีเงินจะเข้ามากกว่าที่ต้องจ่าย',
    money: true,
    group: 'due',
  },
  {
    // Its own group rather than sitting with ยอดค้าง: this one IS scoped to
    // the period, and the ค้าง columns deliberately are not.
    key: 'heldForFinnix',
    label: 'รอคืน Finnix',
    hint: 'รับเงินแทนร้านอื่นในช่วงนี้ ไม่นับเป็นยอดขายของสาขา',
    money: true,
    group: 'other',
  },
];

export function BranchComparison({ data, caption }: { data: Data; caption?: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const rows = [...data.rows].sort((a, b) => b[sortKey] - a[sortKey]);
  const hasWholesale = data.rows.some((r) => r.wholesale !== 0);
  const columns = COLUMNS.filter((c) => !c.channelOnly || hasWholesale);

  /*
    Spans computed from the columns actually on screen, not from GROUPS: the
    ปลีก/ส่ง pair drops out for a shop with no wholesale desk, and a header
    that still spanned three would sit crooked over two.
  */
  const headerGroups: { key: GroupKey; span: number }[] = [];
  for (const c of columns) {
    const last = headerGroups.at(-1);
    if (last && last.key === c.group) last.span += 1;
    else headerGroups.push({ key: c.group, span: 1 });
  }
  /** A rule down the left edge of every column that opens a group. */
  const startsGroup = (i: number) => i > 0 && columns[i - 1].group !== columns[i].group;
  const groupRule = (i: number) => (startsGroup(i) ? '1px solid var(--line-strong)' : undefined);

  const cell = (r: BranchRow, key: SortKey, money: boolean, i: number) => {
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
          borderLeft: groupRule(i),
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
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            // Two more columns need two more columns of room; squeezing them
            // into the same width is how baht figures start wrapping.
            minWidth: hasWholesale ? 800 : 640,
          }}
        >
          <thead>
            {/* หมวด — which question each block of columns answers. The rule
                under it runs only over the columns it covers, so the eye reads
                the caption and the block as one thing. */}
            <tr>
              <th style={{ padding: '0 12px 4px' }}></th>
              {headerGroups.map((g, gi) => (
                <th
                  key={g.key}
                  colSpan={g.span}
                  className="text-xs font-semibold"
                  style={{
                    padding: '0 12px 4px',
                    textAlign: 'right',
                    color: 'var(--ink-faint)',
                    whiteSpace: 'nowrap',
                    borderLeft: gi > 0 ? '1px solid var(--line-strong)' : undefined,
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  {GROUPS[g.key].label}
                </th>
              ))}
            </tr>
            <tr style={{ borderBottom: '1.5px solid var(--line-strong)' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 12px 8px',
                  color: 'var(--ink-soft)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                สาขา
              </th>
              {columns.map((c, i) => (
                <th key={c.key} style={{ padding: '6px 12px 8px', borderLeft: groupRule(i) }}>
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
                {columns.map((c, i) => cell(r, c.key, c.money, i))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
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
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    style={{
                      padding: '10px 12px',
                      textAlign: 'right',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      color: data.total[c.key] < 0 ? '#B23A48' : 'var(--ink)',
                      borderLeft: groupRule(i),
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
