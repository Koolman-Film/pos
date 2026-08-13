'use client';

import { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { fmt, fmtThaiDate, thaiBahtText } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { itemNetPrice } from '@/lib/domain/tickets';

import { WRAP_CATEGORY, WRAP_OPTIONS } from './wrapOptions';

import type { ShopInfo, StockRow, Ticket } from './types';

export type PrintMode = 'job' | 'sale' | 'offsite' | 'doc' | null;

/**
 * The pre-installation inspection sheet (ใบตรวจเช็คสภาพก่อนติดตั้ง), ported
 * verbatim from reference/v0.4/finnix-film.html:2101-2105.
 *
 * This is the sheet a technician walks around the car with before touching it, so
 * a missing row is a check nobody performs and a dispute the shop cannot answer
 * later. An earlier port truncated ระบบไฟฟ้า to 6 of 20 rows and
 * ระบบเครื่องเสียง to 3 of 7; the full lists are restored here, in the
 * prototype's order. Extracted to a named constant so the next diff against a new
 * prototype drop is a one-line comparison instead of a hunt through JSX.
 */
export const QC_CHECKLIST_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'ระบบไฟฟ้า',
    items: [
      'ไฟหน้า',
      'ไฟหรี่',
      'ไฟสูง',
      'สปอตไลท์',
      'ไฟเลี้ยวหน้า',
      'ไฟเลี้ยวข้าง',
      'ไฟฉุกเฉิน',
      'ไฟท้าย',
      'ไฟเบรก',
      'ไฟเลี้ยวถอย',
      'ไฟเลี้ยวหลัง',
      'ระบบกระจกบานข้าง',
      'ระบบกระจกมองข้าง',
      'คอนโทรพวงมาลัย',
      'ไฟหน้าปัด',
      'ไฟปุ่มแอร์',
      'ระบบแอร์',
      'ไฟเพดาน',
      'กล้องหน้า-หลัง',
      'เซนเซอร์หน้า-หลัง',
    ],
  },
  {
    title: 'ระบบเครื่องเสียง',
    items: [
      'เครื่องเล่นวิทยุเดิม',
      'ทวิตเตอร์ซ้าย-ขวา',
      'ลำโพงหน้าซ้าย-ขวา',
      'ลำโพงหลังซ้าย-ขวา',
      'Sub Box',
      'ปรีแอมป์',
      'DSP',
    ],
  },
  { title: 'สภาพภายในรถ', items: ['เพดานรถ', 'คอนโซลรถ', 'เบาะรถ', 'แผงข้าง'] },
  { title: 'สภาพภายนอกรถ', items: ['สภาพรอบคัน', 'กระจกบานหน้า-หลัง', 'กระจกบานข้าง'] },
];

/**
 * The solid bars on the financial document — the title band, the table header
 * and the ยอดรวมสุทธิ bar.
 *
 * The shop's red, the same `--primary` the save button carries in light mode,
 * written as a literal on purpose: a printed sheet must not change colour with
 * the app's theme, and the CSS variable flips to a lighter red in dark mode.
 * `.doc-table th` in app/globals.css carries the same value.
 */
const DOC_ACCENT = '#7A2333';

/**
 * "มัดจำ" reads as a noun on its own; the printed line wants the act of paying
 * it. The other two types are already phrased that way ("ชำระส่วนที่เหลือ"), so
 * only the ones that are not get the verb.
 */
function paymentLabel(type: string): string {
  const label = (type || '').trim();
  if (!label) return 'รับชำระ';
  return label.startsWith('ชำระ') ? label : `ชำระ${label}`;
}

/**
 * The ภายในตัวรถ grid on the ใบเช็ครถ — the interior parts a wrap job touches.
 *
 * Both columns were wrong in the port: "Piano Black" (the trim finish) had been
 * transcribed as "Pino Black", and the left column repeated กาบประตูหน้าซ้าย on
 * all four rows, so the technician had one door trim listed four times and the
 * other three not at all.
 */
const WRAP_INTERIOR_PARTS: [string, string][] = [
  ['หน้าจอ', 'Piano Black'],
  ['กาบประตูหน้าซ้าย', 'ที่เก็บของด้านหลัง'],
  ['กาบประตูหน้าขวา', 'หน้าปัดรถยนต์'],
  ['กาบประตูหลังซ้าย', 'แผงเกียร์'],
  ['กาบประตูหลังขวา', 'ช่องเก็บของกลาง'],
];

const emboss: CSSProperties = {
  display: 'inline-block',
  padding: '2px 9px',
  borderRadius: 5,
  background: '#FFF1BF',
  border: '1px solid #D8A83A',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(0,0,0,.18)',
  fontWeight: 'bold',
};

// The per-position work table on the installation sheet. Cells the technician
// WRITES IN are taller and left blank on purpose — a printed line he has to
// squeeze numbers onto is the complaint this table replaces.
const cellHead: CSSProperties = {
  border: '1px solid #666',
  padding: '3px 6px',
  fontSize: 10,
  fontWeight: 'bold',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
const cellBody: CSSProperties = {
  border: '1px solid #666',
  padding: '5px 6px',
  verticalAlign: 'middle',
};
const cellWrite: CSSProperties = {
  border: '1px solid #666',
  padding: '5px 6px',
  height: 26,
};

/** The "1", "2" ringed numbers that tie a category to the summary strip. */
const stepBadge: CSSProperties = {
  display: 'inline-block',
  width: 16,
  height: 16,
  border: '1.5px solid #333',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 'bold',
  lineHeight: '14px',
  textAlign: 'center',
  flexShrink: 0,
};

/**
 * The physical work-order / sales / offsite / financial-document sheets.
 * Ported from the `.print-area` portals inside TicketDetail
 * (reference/v0.4/finnix-film.html:1962-2465).
 *
 * Rendered through a portal to `document.body` so it becomes a body-level
 * sibling of `.app-shell`; the `@media print` rule in app/globals.css hides the
 * app shell and shows only `.print-area`. Guarded by a `mounted` state because
 * `document.body` only exists client-side.
 *
 * NOTE (judgment call): the prototype's wrap (ฟิล์มกันรอย) QC checklist embeds
 * three multi-hundred-KB base64 car-diagram images inline. Embedding those in a
 * client bundle would bloat it by ~600KB, so the diagram slots render as labeled
 * placeholder boxes here; the functional interior/exterior part-checklist tables
 * are ported verbatim. Flagged for human review — re-add as /public assets.
 */
export function PrintJobSheet({
  t,
  printMode,
  currentUserName,
  shopName,
  shopInfo,
  stock,
  extraOptions,
  total,
  paid,
  docType,
  buyerName,
  buyerTaxId,
  buyerAddress,
  showCompanyInfo,
  showDisclaimer,
}: {
  t: Ticket;
  printMode: PrintMode;
  currentUserName: string;
  shopName: (id: string) => string;
  shopInfo: Record<string, ShopInfo>;
  stock: StockRow[];
  extraOptions: string[];
  total: number;
  paid: number;
  docType: string;
  buyerName: string;
  buyerTaxId: string;
  buyerAddress: string;
  showCompanyInfo: boolean;
  showDisclaimer: boolean;
}) {
  const mounted = useIsMounted();
  if (!mounted || !printMode) return null;

  const categories = [...new Set(t.items.filter((i) => i.sold).map((i) => i.category))];
  const filledExtras = extraOptions.filter((name) => t.extras?.[name]?.checked);
  const info = shopInfo[t.shop] || {};
  const receivedPayments = t.payments.filter((p) => Number(p.amount || 0) > 0);
  /** Net per ชนิดสินค้า, for the sale sheet's multi-category summary strip. */
  const categoryTotals: Record<string, number> = {};
  for (const i of t.items.filter((i) => i.sold)) {
    categoryTotals[i.category] = (categoryTotals[i.category] || 0) + itemNetPrice(mapItem(i));
  }

  function extrasBlock(gap: number) {
    if (filledExtras.length === 0) return null;
    return (
      <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: gap }}>
        {filledExtras.map((name) => {
          const ex = t.extras[name];
          if (name === 'รถสไลด์') {
            const legs =
              (ex.legs as { from?: string; to?: string; date?: string; time?: string }[]) || [];
            return (
              <div key={name} style={{ marginBottom: 6 }}>
                <p style={{ margin: 0 }}>
                  {name}: {(ex.slideType as string) || '-'}
                  {ex.notes ? ' (' + ex.notes + ')' : ''}
                </p>
                {legs.map((leg, li) => (
                  <p key={li} style={{ margin: '2px 0 0 16px', fontSize: 11, color: '#555' }}>
                    {ex.slideType === 'Walk-in'
                      ? `ถึงหน้าร้าน วันที่ ${leg.date || '-'} เวลา ${leg.time || '-'}`
                      : `ขาที่ ${li + 1} จาก ${leg.from || '-'} ถึง ${leg.to || '-'} วันที่ ${leg.date || '-'} เวลา ${leg.time || '-'}`}
                  </p>
                ))}
              </div>
            );
          }
          let detail = '';
          if (name === 'นอกสถานที่') {
            detail = `${(ex.mapLabel as string) || '-'}${ex.mapLink ? ' — ' + ex.mapLink : ''}`;
          } else if (name === 'แก้งาน') {
            detail = (ex.detail as string) || '-';
          } else if (name === 'Service') {
            detail = `จำนวน ${(ex.serviceCount as string) || '-'} ครั้ง วันที่เข้า Service ${(ex.serviceDate as string) || '-'}`;
          } else if (name === 'ประกัน') {
            detail = 'รวมอยู่ในรายการสินค้าด้านบนแล้ว';
          } else {
            detail = 'ระบุแล้ว';
          }
          return (
            <p key={name} style={{ margin: 0 }}>
              {name}: {detail}
            </p>
          );
        })}
      </div>
    );
  }

  /**
   * หมายเหตุ, printed big enough to be read across a workbench.
   *
   * `category` scopes it to one ใบงานติดตั้ง page: that page shows the ticket's
   * general note plus the note written for THAT ชนิดสินค้า. Passing null (the
   * sale and offsite sheets, which cover the whole job) prints the general note
   * and every category note under its own heading.
   */
  function notesBlock(category: string | null) {
    const general = (t.notes || '').trim();
    const perCategory = Object.entries(t.notesByCategory || {})
      .filter(([cat, note]) => (category ? cat === category : true) && note && note.trim())
      .map(([cat, note]) => [cat, note.trim()] as const);
    if (!general && perCategory.length === 0) return null;

    return (
      <div
        style={{
          border: '1.5px solid #333',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: 12, fontWeight: 'bold', color: '#555' }}>หมายเหตุ</p>
        {general && (
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 16,
              fontWeight: 'bold',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {general}
          </p>
        )}
        {perCategory.map(([cat, note]) => (
          <p
            key={cat}
            style={{
              margin: '4px 0 0',
              fontSize: 16,
              fontWeight: 'bold',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {/* The heading is only useful where more than one job's note can
                appear — on its own installation page it is already implied. */}
            {!category && <span style={{ fontSize: 12, color: '#555' }}>{cat}: </span>}
            {note}
          </p>
        ))}
      </div>
    );
  }

  /** Option / รายการแถม — the paper form's tick row, ticked from the ticket. */
  function wrapOptionsBlock() {
    const selected = new Set(t.wrapOptions ?? []);
    return (
      <div
        style={{
          border: '1px solid #666',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 12,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap', paddingTop: 1 }}>
          Option / รายการแถม :
        </span>
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '5px 10px',
          }}
        >
          {WRAP_OPTIONS.map((name) => (
            <span
              key={name}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              {/* Every box prints, ticked or not: the sheet is still the paper
                  form the technician can mark up if something changes on site. */}
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  border: '1.5px solid #333',
                  borderRadius: 2,
                  textAlign: 'center',
                  lineHeight: '12px',
                  fontSize: 12,
                  fontWeight: 'bold',
                  flexShrink: 0,
                }}
              >
                {selected.has(name) ? '✓' : ' '}
              </span>
              <span style={selected.has(name) ? { fontWeight: 'bold' } : undefined}>{name}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  /**
   * Both ends of the job, in the order they happen — shared by all three work
   * sheets so they cannot drift apart again.
   *
   * Only the delivery date used to print, so a sheet never said when the car
   * came in, and "how long have you had my car" is the question the counter
   * fields. The delivery date keeps the emphasis; it is the one the customer is
   * here about.
   */
  function jobDates() {
    return (
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 'bold',
            border: '1.5px solid #666',
            borderRadius: 6,
            padding: '4px 10px',
          }}
        >
          วันที่รับงาน: {fmtThaiDate(t.dropOffDateObj)}
        </span>
        <span
          style={{
            fontSize: 17,
            fontWeight: 'bold',
            border: '2px solid #D8A83A',
            borderRadius: 6,
            padding: '4px 12px',
            background: '#FFF7DD',
          }}
        >
          วันที่ส่งงาน: {fmtThaiDate(t.pickupDateObj)}
        </span>
      </div>
    );
  }

  let content: React.ReactNode = null;

  if (printMode === 'job') {
    content = (
      <div className="print-area">
        {categories.map((cat, catIdx) => (
          <div
            key={cat}
            className="print-page"
            style={catIdx > 0 ? { pageBreakBefore: 'always' } : {}}
          >
            <h1 style={{ margin: '0 0 14px', fontSize: 22, textAlign: 'center' }}>ใบงานติดตั้ง</h1>
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12 }}>เลขที่เอกสาร: {t.id}</p>
              {jobDates()}
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
                บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
              </p>
            </div>
            <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>
              {shopName(t.shop)}
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 28px',
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              <span>
                ชื่อลูกค้า: <b>{t.customer}</b>
              </span>
              <span>
                เบอร์โทร: <b>{t.phone}</b>
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 22px',
                fontSize: 13,
                marginBottom: 10,
              }}
            >
              <span>
                ยี่ห้อรถ: <b>{t.brand}</b>
              </span>
              <span>
                รุ่นรถ: <b>{t.model}</b>
              </span>
              <span>
                สีรถ: <b>{t.color}</b>
              </span>
              <span>
                ทะเบียนรถ/เลขถัง: <b>{t.plate}</b>
              </span>
              <span>
                ประเภทรถ: <b>{t.carType}</b>
              </span>
            </div>
            {categories.length > 1 && (
              <p style={{ margin: '0 0 10px', fontSize: 11, color: '#B23A48', fontWeight: 'bold' }}>
                งานนี้มี {categories.length} ชนิดสินค้า — หน้านี้แสดงเฉพาะ &quot;{cat}&quot; (หน้า{' '}
                {catIdx + 1}/{categories.length})
              </p>
            )}
            <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
            {t.items
              .filter((i) => i.sold && i.category === cat)
              .map((i, idx) => {
                // ONE ROW PER POSITION, not one per product.
                //
                // The sheet used to group the positions by product — "บานหน้า,
                // คู่หน้า, คู่หลัง, บานตาย, บานหลัง  3M60  ขนาด ____ ตัด ____" —
                // which gives the technician a single blank line for five
                // panels he measures and cuts separately. The trial run asked
                // for the numbers per position, so each position gets its own
                // line and its own boxes to write in, with the product repeated
                // only when it changes.
                const isFilm = i.category === 'ฟิล์มกรองแสง' || i.category === 'ฟิล์มกันรอย';
                let rows: { label: string | null; product: string }[];
                if (i.positions && i.positions.length) {
                  rows = i.positions.map((p) => ({ label: p.position, product: p.product }));
                } else {
                  rows = [{ label: null, product: i.sold }];
                }
                return (
                  <div key={idx} style={{ marginBottom: 16 }}>
                    <p
                      style={{
                        margin: '0 0 10px',
                        fontSize: 17,
                        fontWeight: 900,
                        letterSpacing: 0.3,
                        borderBottom: '2px solid #333',
                        display: 'inline-block',
                        paddingBottom: 2,
                      }}
                    >
                      {i.category}
                    </p>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                        marginLeft: 4,
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#F1EDE7' }}>
                          <th style={{ ...cellHead, width: '18%' }}>ตำแหน่ง</th>
                          <th style={{ ...cellHead, width: '26%' }}>สินค้า</th>
                          {isFilm && <th style={cellHead}>ขนาดที่วัด (กว้าง × ยาว)</th>}
                          {isFilm && <th style={{ ...cellHead, width: '20%' }}>ตัด</th>}
                          <th style={{ ...cellHead, width: 70 }}>ใช้จริง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, ri) => {
                          const stockMatch = stock.find((s) => s.name === r.product);
                          const short = stockMatch?.shortName || r.product;
                          // The product only earns a line of its own when it
                          // changes; repeating "3M60" five times is noise the
                          // technician has to read past.
                          const sameAsAbove = ri > 0 && rows[ri - 1].product === r.product;
                          return (
                            <tr key={ri}>
                              <td style={{ ...cellBody, fontWeight: 'bold' }}>{r.label ?? '—'}</td>
                              <td style={cellBody}>
                                {sameAsAbove ? (
                                  <span style={{ color: '#999' }}>&#8243;</span>
                                ) : (
                                  <>
                                    <span style={{ fontSize: 15, fontWeight: 'bold' }}>
                                      {short}
                                    </span>
                                    {stockMatch?.shortName && (
                                      <span style={{ fontSize: 10, color: '#777', marginLeft: 4 }}>
                                        ({r.product})
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                              {isFilm && <td style={cellWrite}>&nbsp;</td>}
                              {isFilm && <td style={cellWrite}>&nbsp;</td>}
                              <td style={cellWrite}>&nbsp;</td>
                            </tr>
                          );
                        })}
                        {isFilm && (
                          <tr>
                            {/* Spans everything except ใช้จริง, so the total box
                                sits directly under the column it totals. */}
                            <td colSpan={4} style={{ ...cellBody, textAlign: 'right' }}>
                              รวมใช้จริง
                            </td>
                            <td style={cellWrite}>&nbsp;</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
            {cat === WRAP_CATEGORY && wrapOptionsBlock()}
            {notesBlock(cat)}
            {extrasBlock(16)}
            <p
              style={{
                margin: '0 0 16px',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
              }}
            >
              ชื่อช่างที่ทำ
              {t.techByCategory && t.techByCategory[cat] && t.techByCategory[cat].length > 0 ? (
                <span style={{ fontWeight: 'bold' }}>{t.techByCategory[cat].join(', ')}</span>
              ) : (
                <span
                  style={{ display: 'inline-block', borderBottom: '1px solid #999', width: 240 }}
                >
                  &nbsp;
                </span>
              )}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <div
                style={{
                  flex: 1,
                  border: '1.5px solid #555',
                  borderRadius: 6,
                  padding: '10px 12px',
                }}
              >
                <p
                  style={{
                    margin: '0 0 8px',
                    fontWeight: 'bold',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      border: '2px solid #D8722A',
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  ></span>
                  QC ก่อนติดตั้ง
                </p>
                <p style={{ margin: 0, fontSize: 11 }}>
                  วันที่ ....................................
                </p>
              </div>
              <div
                style={{
                  flex: 1,
                  border: '1.5px solid #555',
                  borderRadius: 6,
                  padding: '10px 12px',
                }}
              >
                <p
                  style={{
                    margin: '0 0 8px',
                    fontWeight: 'bold',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      border: '2px solid #D8722A',
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  ></span>
                  QC หลังติดตั้ง
                </p>
                <p style={{ margin: 0, fontSize: 11 }}>
                  วันที่ ....................................
                </p>
              </div>
            </div>
          </div>
        ))}
        {categories.includes('ฟิล์มกรองแสง') && (
          <div className="print-page" style={{ pageBreakBefore: 'always' }}>
            <h2 style={{ textAlign: 'center', marginBottom: 10, fontSize: 16 }}>
              ใบตรวจเช็คสภาพก่อนติดตั้ง (ฟิล์มกรองแสง)
            </h2>
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              <span>
                ยี่ห้อ/รุ่นรถ:{' '}
                <b>
                  {t.brand} {t.model}
                </b>
              </span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <span>
                ทะเบียนรถ/เลขถัง: <b>{t.plate}</b>
              </span>
            </div>
            {QC_CHECKLIST_SECTIONS.map((section) => (
              <div key={section.title} style={{ marginBottom: 6 }}>
                <p style={{ fontSize: 10, fontWeight: 'bold', margin: '0 0 2px' }}>
                  {section.title}
                </p>
                <table className="compact-table">
                  <thead>
                    <tr>
                      <th>รายการ</th>
                      <th style={{ width: 20 }}>ปกติ</th>
                      <th style={{ width: 24 }}>ผิดปกติ</th>
                      <th style={{ width: 20 }}>ไม่มี</th>
                      <th style={{ width: 150 }}>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item) => (
                      <tr key={item}>
                        <td>{item}</td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ fontSize: 11, marginTop: 20 }}>
              ลงชื่อ................................ผู้ตรวจสอบก่อนติดตั้ง
            </p>
          </div>
        )}
        {categories.includes('ฟิล์มกันรอย') && (
          <div className="print-page" style={{ pageBreakBefore: 'always' }}>
            <h2 style={{ textAlign: 'center', marginBottom: 12 }}>ใบเช็ครถ (ฟิล์มกันรอย / WRAP)</h2>
            <div style={{ fontSize: 11, marginBottom: 10 }}>
              <span>
                ยี่ห้อ/รุ่นรถ:{' '}
                <b>
                  {t.brand} {t.model}
                </b>
              </span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <span>
                ทะเบียนรถ/เลขถัง: <b>{t.plate}</b>
              </span>
            </div>
            <table style={{ fontSize: 11, marginBottom: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: '1%', whiteSpace: 'nowrap' }}>ลำดับที่</th>
                  <th>ตำแหน่ง</th>
                  <th>รายละเอียด</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((n) => (
                  <tr key={n}>
                    <td style={{ textAlign: 'center' }}>{n}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 14, marginBottom: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  flex: 1,
                  minHeight: 150,
                  border: '1px dashed #999',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#999',
                }}
              >
                แผนผังตัวรถ (สำหรับทำเครื่องหมายจุดที่ตรวจพบ)
              </div>
              <div style={{ width: 200, flexShrink: 0 }}>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 'bold',
                    margin: '0 0 4px',
                    textAlign: 'center',
                  }}
                >
                  ภายในตัวรถ
                </p>
                <table style={{ fontSize: 10 }}>
                  <tbody>
                    {WRAP_INTERIOR_PARTS.map(([left, right]) => (
                      <tr key={left}>
                        <td>{left}</td>
                        <td>{right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
              <div
                style={{
                  flex: 1,
                  minHeight: 150,
                  border: '1px dashed #999',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#999',
                }}
              >
                แผนผังตัวรถ (ด้านนอก)
              </div>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 'bold',
                    margin: '0 0 4px',
                    textAlign: 'center',
                  }}
                >
                  ภายนอกตัวรถ
                </p>
                <table style={{ fontSize: 11, marginBottom: 10, width: 200 }}>
                  <tbody>
                    <tr>
                      <td>ล้อหน้าซ้าย</td>
                      <td>ล้อหน้าขวา</td>
                    </tr>
                    <tr>
                      <td>ล้อหลังซ้าย</td>
                      <td>ล้อหลังขวา</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            {wrapOptionsBlock()}
            <p style={{ fontSize: 11, marginTop: 20 }}>
              ลงชื่อ................................ผู้ตรวจสอบก่อนติดตั้ง
            </p>
          </div>
        )}
      </div>
    );
  } else if (printMode === 'sale') {
    content = (
      <div className="print-area">
        {/* One page block, so fitPrintPages() can shrink it to A4 when a ticket
            carries enough products and notes to spill onto a second sheet. */}
        <div className="print-page">
          <h1 style={{ margin: '0 0 14px', fontSize: 22, textAlign: 'center' }}>ใบงานขาย</h1>
          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <p style={{ margin: '0 0 6px', fontSize: 12 }}>เลขที่เอกสาร: {t.id}</p>
            {jobDates()}
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
            <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
              บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
            </p>
          </div>
          <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>{shopName(t.shop)}</p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 28px',
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            <span>
              ชื่อลูกค้า: <b>{t.customer}</b>
            </span>
            <span>
              เบอร์โทร: <b>{t.phone}</b>
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 22px',
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            <span>
              ยี่ห้อรถ: <b>{t.brand}</b>
            </span>
            <span>
              รุ่นรถ: <b>{t.model}</b>
            </span>
            <span>
              สีรถ: <b>{t.color}</b>
            </span>
            <span>
              ทะเบียนรถ/เลขถัง: <b>{t.plate}</b>
            </span>
            <span>
              ประเภทรถ: <b>{t.carType}</b>
            </span>
          </div>
          <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
          {/*
            A ticket carrying film AND audio printed as two headings that looked
            like the rest of the page, so nobody could tell at a glance that the
            job had two halves — or spot that one of them was missing. The strip
            says how many there are and what each came to; the blocks below are
            numbered to match and ruled down the side so they read as units.
            None of it appears for a single-category ticket, which needs no map.
          */}
          {categories.length > 1 && (
            <div
              style={{
                border: '1.5px solid #333',
                borderRadius: 6,
                padding: '6px 10px',
                marginBottom: 12,
                display: 'flex',
                gap: '4px 14px',
                alignItems: 'center',
                flexWrap: 'wrap',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 'bold' }}>งานนี้มี {categories.length} ชนิดสินค้า</span>
              {categories.map((cat, ci) => (
                <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={stepBadge}>{ci + 1}</span>
                  {cat} <b>{fmt(categoryTotals[cat] || 0)}</b>
                </span>
              ))}
            </div>
          )}
          {t.items
            .filter((i) => i.sold)
            .map((i, idx) => {
              let rows: { label: string | null; product: string }[];
              if (i.positions && i.positions.length) {
                const grouped: Record<string, string[]> = {};
                i.positions.forEach((p) => {
                  if (!grouped[p.product]) grouped[p.product] = [];
                  grouped[p.product].push(p.position);
                });
                rows = Object.entries(grouped).map(([product, labels]) => ({
                  label: labels.join(', '),
                  product,
                }));
              } else {
                rows = [{ label: null, product: i.sold }];
              }
              const multi = categories.length > 1;
              return (
                <div
                  key={idx}
                  style={
                    multi
                      ? { marginBottom: 16, borderLeft: '3px solid #333', paddingLeft: 10 }
                      : { marginBottom: 16 }
                  }
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 10,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 17,
                        fontWeight: 900,
                        letterSpacing: 0.3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                      }}
                    >
                      {multi && (
                        <span style={{ ...stepBadge, width: 20, height: 20, lineHeight: '18px' }}>
                          {categories.indexOf(i.category) + 1}
                        </span>
                      )}
                      <span style={{ borderBottom: '2px solid #333', paddingBottom: 2 }}>
                        {i.category}
                      </span>
                    </p>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        ช่าง:{' '}
                        <b>
                          {t.techByCategory &&
                          t.techByCategory[i.category] &&
                          t.techByCategory[i.category].length
                            ? t.techByCategory[i.category].join(', ')
                            : '-'}
                        </b>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 2 }}>
                        ยอดรวม: {fmt(itemNetPrice(mapItem(i)))}
                      </div>
                    </div>
                  </div>
                  {rows.map((r, ri) => {
                    const stockMatch = stock.find((s) => s.name === r.product);
                    const short = stockMatch?.shortName || r.product;
                    return (
                      <div
                        key={ri}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 8,
                          paddingLeft: 12,
                        }}
                      >
                        {r.label && <span style={emboss}>{r.label}</span>}
                        <span style={{ fontSize: 18, fontWeight: 'bold' }}>{short}</span>
                        <span style={{ fontSize: 11, color: '#777' }}>({r.product})</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
          <div style={{ fontSize: 12, marginBottom: 16 }}>
            <p style={{ fontWeight: 'bold', marginBottom: 6 }}>ข้อมูลการชำระเงิน</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span>ยอดสุทธิ</span>
              <span>{fmt(total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span>ชำระแล้ว</span>
              <span>{fmt(paid)}</span>
            </div>
            {/*
            Every receipt on its own line — "ชำระมัดจำ (โอนเงิน) 3,000.00" — not
            just when there are several of them. A single figure says how much
            arrived but not on what terms or through which channel, and that is
            what the customer and the shop end up arguing about.
          */}
            {receivedPayments.length > 0 && (
              <div style={{ margin: '0 0 8px 12px' }}>
                {receivedPayments.map((p, pi) => (
                  <div
                    key={pi}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                  >
                    <span>
                      {paymentLabel(p.type)}
                      {p.method ? ` (${p.method})` : ''}
                      {p.date ? ` · ${fmtThaiDate(new Date(p.date))}` : ''}
                    </span>
                    <span>{fmt(Number(p.amount || 0))}</span>
                  </div>
                ))}
              </div>
            )}
            {total - paid <= 0 ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 'bold',
                  color: '#2F7A4F',
                }}
              >
                <span>ชำระครบแล้ว</span>
                <span>-</span>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontWeight: 900,
                  fontSize: 20,
                  color: '#B23A48',
                  border: '3px solid #B23A48',
                  borderRadius: 8,
                  padding: '8px 14px',
                  background: '#FBEAEC',
                }}
              >
                <span>ค้างชำระ</span>
                <span>{fmt(total - paid)}</span>
              </div>
            )}
            {t.items.some((i) => i.interested) && (
              // Only the TOTAL is green — it is the one number the shop wants to
              // catch the eye. The breakdown under it is working shown, and in ink
              // it reads as detail rather than as three more highlighted figures.
              //
              // `print-gain` rather than an inline colour: @media print flattens
              // every colour inside .print-area to ink, so an inline value here
              // would look right on screen and print black (see app/globals.css).
              <div style={{ marginTop: 8 }}>
                <div
                  className="print-gain"
                  style={{ display: 'flex', justifyContent: 'space-between', color: '#2F7A4F' }}
                >
                  <span>ส่วนต่างเชียร์ขาย (Cheer-up)</span>
                  <span>
                    {(() => {
                      const cu = t.items.reduce(
                        (s, i) =>
                          i.interested
                            ? s + (Number(i.soldPrice || 0) - Number(i.interestedPrice || 0))
                            : s,
                        0,
                      );
                      return (cu >= 0 ? '+' : '') + fmt(cu);
                    })()}
                  </span>
                </div>
                {/*
                The figure alone does not say what it was measured against, so
                each baseline product is listed with its price — short name
                first, the same way the item rows above read, and grouped under
                its category so a ticket carrying film AND audio does not read as
                one undifferentiated list.
              */}
                {[...new Set(t.items.filter((i) => i.interested).map((i) => i.category))].map(
                  (cat) => {
                    const rows = t.items.filter((i) => i.interested && i.category === cat);
                    const catDiff = rows.reduce(
                      (s, i) => s + (Number(i.soldPrice || 0) - Number(i.interestedPrice || 0)),
                      0,
                    );
                    return (
                      <div key={cat} style={{ marginTop: 3 }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 11,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{cat || 'ไม่ระบุชนิดสินค้า'}</span>
                          <span>
                            {catDiff >= 0 ? '+' : ''}
                            {fmt(catDiff)}
                          </span>
                        </p>
                        {rows.map((i, ci) => {
                          const stockMatch = stock.find((s) => s.name === i.interested);
                          const short = stockMatch?.shortName || i.interested;
                          return (
                            <p
                              key={ci}
                              style={{ margin: '1px 0 0 10px', fontSize: 10, color: '#999' }}
                            >
                              จาก <b>{short}</b>
                              {stockMatch?.shortName ? ` (${i.interested})` : ''} &middot;{' '}
                              {fmt(Number(i.interestedPrice || 0))}
                            </p>
                          );
                        })}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
          {categories.includes(WRAP_CATEGORY) && wrapOptionsBlock()}
          {notesBlock(null)}
          {extrasBlock(16)}
          <div style={{ display: 'flex', gap: 12 }}>
            <div
              style={{ flex: 1, border: '1.5px solid #555', borderRadius: 6, padding: '10px 12px' }}
            >
              <p
                style={{
                  margin: '0 0 8px',
                  fontWeight: 'bold',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 16,
                    height: 16,
                    border: '2px solid #D8722A',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                ></span>
                ส่งมอบงาน
              </p>
              <p style={{ margin: 0, fontSize: 11 }}>วันที่ ....................................</p>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (printMode === 'offsite') {
    content = (
      <div className="print-area offsite-form">
        <h1 style={{ margin: '0 0 14px', fontSize: 22, textAlign: 'center' }}>ใบงานนอกสถานที่</h1>
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12 }}>เลขที่เอกสาร: {t.id}</p>
          {jobDates()}
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
            บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
          </p>
        </div>
        <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>{shopName(t.shop)}</p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 28px',
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          <span>
            ชื่อลูกค้า: <b>{t.customer}</b>
          </span>
          {t.phone && (
            <span>
              เบอร์โทร: <b>{t.phone}</b>
            </span>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 22px',
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {t.brand && (
            <span>
              ยี่ห้อรถ: <b>{t.brand}</b>
            </span>
          )}
          {t.model && (
            <span>
              รุ่นรถ: <b>{t.model}</b>
            </span>
          )}
          {t.color && (
            <span>
              สีรถ: <b>{t.color}</b>
            </span>
          )}
          {t.plate && (
            <span>
              ทะเบียนรถ/เลขถัง: <b>{t.plate}</b>
            </span>
          )}
          {t.carType && (
            <span>
              ประเภทรถ: <b>{t.carType}</b>
            </span>
          )}
        </div>
        {t.extras?.['นอกสถานที่'] && (
          <div
            style={{
              fontSize: 12,
              marginBottom: 10,
              background: '#EAF1FB',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            <p style={{ margin: 0 }}>
              <b>สถานที่:</b> {(t.extras['นอกสถานที่'].mapLabel as string) || '-'}
            </p>
            {(t.extras['นอกสถานที่'].mapLink as string) && (
              <p style={{ margin: '2px 0 0' }}>
                <b>แผนที่:</b> {t.extras['นอกสถานที่'].mapLink as string}
              </p>
            )}
          </div>
        )}
        {notesBlock(null)}
        <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
        {t.items
          .filter((i) => i.sold)
          .map((i, idx) => {
            let rows: { label: string | null; product: string }[];
            if (i.positions && i.positions.length) {
              const grouped: Record<string, string[]> = {};
              i.positions.forEach((p) => {
                if (!grouped[p.product]) grouped[p.product] = [];
                grouped[p.product].push(p.position);
              });
              rows = Object.entries(grouped).map(([product, labels]) => ({
                label: labels.join(', '),
                product,
              }));
            } else {
              rows = [{ label: null, product: i.sold }];
            }
            return (
              <div key={idx} style={{ marginBottom: 14 }}>
                <p
                  style={{
                    margin: '0 0 8px',
                    fontSize: 15,
                    fontWeight: 900,
                    borderBottom: '2px solid #333',
                    display: 'inline-block',
                    paddingBottom: 2,
                  }}
                >
                  {i.category}
                </p>
                {rows.map((r, ri) => {
                  const stockMatch = stock.find((s) => s.name === r.product);
                  const short = stockMatch?.shortName || r.product;
                  return (
                    <div
                      key={ri}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 6,
                        paddingLeft: 12,
                      }}
                    >
                      {r.label && <span style={emboss}>{r.label}</span>}
                      <span style={{ fontSize: 15, fontWeight: 'bold' }}>{short}</span>
                      <span style={{ fontSize: 11, color: '#777' }}>({r.product})</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        <div style={{ borderTop: '1.5px solid #333', margin: '10px 0 16px' }}></div>
        <p style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
          พื้นที่สำหรับวาดแบบอาคาร/ตำแหน่งติดตั้งที่หน้างาน
        </p>
        <div
          style={{
            border: '1.5px dashed #999',
            borderRadius: 6,
            minHeight: 380,
            width: '100%',
            boxSizing: 'border-box',
          }}
        ></div>
      </div>
    );
  } else if (printMode === 'doc') {
    // Every row's price BEFORE its discount, so "ส่วนลดรวม" has something to be
    // subtracted from — `total` is already net.
    const grossTotal = t.items
      .filter((i) => i.sold)
      .reduce((s, i) => s + Number(i.soldPrice || 0), 0);
    const totalDiscount = grossTotal - total;
    const isTaxInvoice = docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน';
    const isQuotation = docType === 'ใบเสนอราคา';
    const docPrefix = isQuotation ? 'QT' : isTaxInvoice ? 'INV' : 'RCT';
    // Tick boxes for the shop's own channels, ticked from what was actually
    // received. A channel used once but since removed from the shop's list still
    // shows, otherwise the document would claim money arrived by nothing.
    const usedMethods = new Set(receivedPayments.map((p) => p.method).filter(Boolean));
    const channels = [
      ...new Set([...(info.paymentChannels ?? []).filter(Boolean), ...usedMethods]),
    ];

    // One row per product, with the positions it covers folded into a quantity.
    const lines = t.items
      .filter((i) => i.sold)
      .flatMap((i) => {
        if (i.positions && i.positions.length) {
          const grouped: Record<string, { labels: string[]; price: number }> = {};
          i.positions.forEach((p) => {
            if (!grouped[p.product]) grouped[p.product] = { labels: [], price: 0 };
            grouped[p.product].labels.push(p.position);
            grouped[p.product].price += Number(p.price || 0);
          });
          return Object.entries(grouped).map(([product, g]) => ({
            qty: g.labels.length,
            category: i.category,
            product,
            detail: g.labels.join(', '),
            amount: g.price,
          }));
        }
        return [
          {
            qty: 1,
            category: i.category,
            product: i.sold,
            detail: '',
            amount: Number(i.soldPrice || 0),
          },
        ];
      });

    const totalRow = (label: string, value: string, strong = false) => (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 20,
          fontSize: strong ? 13 : 12,
          fontWeight: strong ? 'bold' : 'normal',
          padding: strong ? '6px 10px' : '3px 10px',
          background: strong ? DOC_ACCENT : 'transparent',
          color: strong ? '#fff' : undefined,
          borderRadius: strong ? 4 : 0,
        }}
        className={strong ? 'doc-total' : undefined}
      >
        <span>{label}</span>
        <span>{value}</span>
      </div>
    );

    content = (
      <div className="print-area">
        <div className="print-page">
          {/* The title band. The sample the shop brought in leads with the
              document's name rather than the shop's, which is also what makes a
              receipt findable in a stack of them. */}
          <div
            style={{
              background: DOC_ACCENT,
              color: '#fff',
              borderRadius: 6,
              padding: '10px 16px',
              marginBottom: 14,
              textAlign: 'center',
            }}
            className="doc-band"
          >
            <p style={{ margin: 0, fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 }}>
              {docType}
            </p>
            {/* Own line each, under the title. Run together on one line they
                read as a single reference and the eye has to split them; the
                number is what gets quoted on the phone. */}
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>
              {/* The ticket id already carries the shop — JT-CM-00216. Prefixing
                  t.shop again printed RCT-CM-CM-00216 on every document. */}
              เลขที่เอกสาร: {docPrefix}-{t.id.replace('JT-', '')}
            </p>
            <p style={{ margin: '1px 0 0', fontSize: 12 }}>
              วันที่เอกสาร: {fmtThaiDate(new Date())}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 11 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>ข้อมูลลูกค้า :</p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{buyerName || t.customer}</p>
              {isTaxInvoice && buyerAddress && <p style={{ margin: '2px 0 0' }}>{buyerAddress}</p>}
              {isTaxInvoice && buyerTaxId && (
                <p style={{ margin: '2px 0 0' }}>เลขผู้เสียภาษี {buyerTaxId}</p>
              )}
              {t.phone && <p style={{ margin: '2px 0 0' }}>โทร {t.phone}</p>}
              <p style={{ margin: '2px 0 0' }}>
                รถ: {t.brand} {t.model} &middot; {t.plate}
              </p>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>
                {isQuotation ? 'ผู้เสนอราคา :' : 'ผู้ออกใบเสร็จรับเงิน :'}
              </p>
              {/*
                Branch first, legal entity under it. The customer knows the shop
                by its branch — it is the name on the door and on the phone — and
                the นิติบุคคล line is there because the tax id below belongs to
                it, not because anyone looks the document up by it.
              */}
              <p style={{ margin: 0, fontWeight: 'bold' }}>{shopName(t.shop)}</p>
              {showCompanyInfo && info.companyName && (
                <p style={{ margin: '2px 0 0' }}>{info.companyName}</p>
              )}
              {info.address && <p style={{ margin: '2px 0 0' }}>{info.address}</p>}
              {info.phone && <p style={{ margin: '2px 0 0' }}>โทร {info.phone}</p>}
              {showCompanyInfo && info.taxId && (
                <p style={{ margin: '2px 0 0' }}>เลขผู้เสียภาษี {info.taxId}</p>
              )}
            </div>
          </div>

          <table style={{ marginBottom: 12, fontSize: 11 }} className="doc-table">
            <thead>
              <tr>
                <th style={{ width: 50, textAlign: 'center' }}>จำนวน</th>
                <th>รายการ</th>
                <th style={{ width: 100, textAlign: 'right' }}>ราคา</th>
                <th style={{ width: 100, textAlign: 'right' }}>ยอดรวม</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, li) => {
                const stockMatch = stock.find((s) => s.name === l.product);
                const short = stockMatch?.shortName || l.product;
                return (
                  <tr key={li}>
                    <td style={{ textAlign: 'center' }}>{l.qty}</td>
                    <td>
                      <b>{short}</b>
                      {stockMatch?.shortName ? ` (${l.product})` : ''}
                      <div style={{ fontSize: 10, color: '#555' }}>
                        {l.category}
                        {l.detail ? ` — ${l.detail}` : ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(l.amount / (l.qty || 1))}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(l.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <div style={{ width: 260 }}>
              {totalDiscount > 0 && totalRow('ยอดรวม', fmt(grossTotal))}
              {totalDiscount > 0 && totalRow('ส่วนลดรวม', `-${fmt(totalDiscount)}`)}
              {isTaxInvoice && totalRow('มูลค่าก่อนภาษี', fmt(total / 1.07))}
              {isTaxInvoice && totalRow('ภาษีมูลค่าเพิ่ม 7%', fmt(total - total / 1.07))}
              {totalRow('ยอดรวมสุทธิ', fmt(total), true)}
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 10,
                  fontStyle: 'italic',
                  textAlign: 'right',
                  paddingRight: 10,
                }}
              >
                ( {thaiBahtText(total)} )
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', marginBottom: 12 }}>
            {!isQuotation && (
              <div
                style={{
                  flex: 1,
                  border: '1px solid #666',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                }}
              >
                <p style={{ margin: '0 0 5px', fontWeight: 'bold' }}>ช่องทางการชำระเงิน</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  {channels.map((m) => (
                    <span key={m} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 13,
                          height: 13,
                          border: '1.5px solid #333',
                          borderRadius: 2,
                          textAlign: 'center',
                          lineHeight: '11px',
                          fontSize: 11,
                          fontWeight: 'bold',
                        }}
                      >
                        {usedMethods.has(m) ? '✓' : ' '}
                      </span>
                      {m}
                    </span>
                  ))}
                </div>
                {receivedPayments.length > 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: 10, fontWeight: 'bold' }}>
                    รายละเอียดการชำระเงิน
                  </p>
                )}
                {receivedPayments.map((p, pi) => (
                  <p key={pi} style={{ margin: '2px 0 0', fontSize: 10, color: '#444' }}>
                    {paymentLabel(p.type)} {fmt(Number(p.amount || 0))} บาท
                    {p.method ? ` (${p.method})` : ''}
                    {p.date ? ` · ${fmtThaiDate(new Date(p.date))}` : ''}
                  </p>
                ))}
                <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>
                  {total - paid <= 0 ? 'ชำระครบแล้ว' : `คงเหลือ ${fmt(total - paid)} บาท`}
                </p>
              </div>
            )}
            <div style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
              {/* Just the signature. Naming the issuer again here repeated what
                  the header already says — and the person signing is a member of
                  staff, not the company. */}
              <p style={{ margin: '26px 0 0' }}>
                ลงชื่อ .............................................
              </p>
              <p style={{ margin: '4px 0 0' }}>
                {isQuotation ? 'ผู้เสนอราคา' : 'ผู้รับเงิน'} &middot; วันที่{' '}
                {fmtThaiDate(new Date())}
              </p>
            </div>
          </div>

          {showDisclaimer && (
            <p
              style={{
                fontSize: 9,
                color: '#777',
                lineHeight: 1.5,
                borderTop: '1px solid #ddd',
                paddingTop: 6,
                margin: 0,
              }}
            >
              กรุณาตรวจเช็คบริเวณรอบรถของท่านทุกครั้งก่อนเข้าบริการ
              หากท่านนำรถไปใช้แล้วเกิดความเสียหายบริเวณรอบรถทางร้านจะไม่รับผิดชอบใดๆทั้งสิ้น
              ยกเว้นความเสียหายอยู่ในการรับประกันสินค้า
            </p>
          )}
        </div>
      </div>
    );
  }

  return createPortal(content, document.body);
}

// Map a client TicketItem into the pure-domain shape itemNetPrice expects.
function mapItem(i: {
  soldPrice: number | string;
  discountType?: 'percent' | 'amount' | null;
  discountValue?: number | string;
}) {
  return {
    soldPrice: Number(i.soldPrice || 0),
    discountType: i.discountType ?? undefined,
    discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
  };
}
