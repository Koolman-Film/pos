'use client';

import { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { fmt, fmtThaiDate, thaiBahtText } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { itemNetPrice } from '@/lib/domain/tickets';

import { SERVICE_EXTERIOR_PARTS, SERVICE_INTERIOR_PARTS, SERVICE_POINT_ROWS } from './serviceForm';
import { WRAP_CATEGORY, WRAP_OPTIONS } from './wrapOptions';

import type {
  InsuranceClaim,
  InsurancePolicy,
  ServiceVisit,
  ShopInfo,
  StockRow,
  Ticket,
} from './types';
import { coverageText } from './detail/InsuranceSection';

export type PrintMode =
  'job' | 'sale' | 'offsite' | 'doc' | 'service' | 'insurance' | 'claim' | null;

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
 * Thai heading with its English underneath, for the financial documents.
 *
 * Thai stays the label — this is a Thai shop issuing a Thai receipt — and the
 * English rides along smaller and greyer. A customer who needs the English is
 * the one who cannot read the line above it, so it has to be there without
 * competing with it.
 */
function bi(th: string, en: string) {
  return (
    <>
      {th}
      <span style={{ fontWeight: 'normal', fontSize: 9, color: '#6B6B6B' }}> / {en}</span>
    </>
  );
}

/** The document name in English, for the band under the Thai one. */
function docTypeEn(docType: string): string {
  if (docType === 'ใบเสนอราคา') return 'QUOTATION';
  if (docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน') return 'TAX INVOICE / RECEIPT';
  return 'RECEIPT';
}

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
 * The car outlines the technician marks up on the ใบเช็ครถ, in the order the
 * paper form has them: interior, then both flanks, then rear and front.
 *
 * Extracted from the prototype, where they were three inline base64 PNGs
 * totalling ~520KB — which is why the port dropped them for dashed placeholder
 * boxes and left a note to re-add them as assets. As /public files reduced to a
 * 32-colour palette they come to 84KB, and the browser caches them across every
 * sheet printed instead of re-parsing them out of the bundle each time.
 *
 * `maxWidth` keeps each drawing at a sane size on a wide screen; the print sheet
 * is narrow enough that `width: 100%` governs there.
 */
const WRAP_DIAGRAMS = [
  { src: '/wrap/wrap-interior.png', alt: 'แผนผังภายในตัวรถ (คอนโซลหน้า)', maxWidth: 330 },
  { src: '/wrap/wrap-body.png', alt: 'แผนผังตัวรถด้านข้าง ซ้าย (L) และขวา (R)', maxWidth: 300 },
  {
    src: '/wrap/wrap-exterior.png',
    alt: 'แผนผังตัวรถด้านหลัง (B) และด้านหน้า (F)',
    maxWidth: 330,
  },
] as const;

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
 * The wrap (ฟิล์มกันรอย) sheet's three car diagrams were inline base64 in the
 * prototype (~520KB), so the port left labelled placeholder boxes and a note to
 * re-add them as assets. Done: they are /public/wrap PNGs now, palette-reduced
 * to 84KB in total — see WRAP_DIAGRAMS.
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
  serviceVisit = null,
  insurancePolicy = null,
  insuranceClaim = null,
  technicianOptions = [],
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
  /** The visit to print on the service sheet; null prints a blank one. */
  serviceVisit?: ServiceVisit | null;
  /** The policy behind a ใบเสร็จค่าประกัน or a ใบเคลมประกัน. */
  insurancePolicy?: InsurancePolicy | null;
  /**
   * The claim being printed on a ใบเคลมประกัน. null prints a blank one — the
   * sheet you carry to the car before anything is recorded.
   */
  insuranceClaim?: InsuranceClaim | null;
  /** ทีมช่าง tick row — the shop's own list, not the paper form's old names. */
  technicianOptions?: string[];
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
            {/*
              The shop's own car diagrams, back where they belong. They were
              inline base64 in the prototype (three of them, ~520KB), so the port
              left labelled dashed boxes in their place and flagged it. They live
              in /public/wrap now, palette-reduced to 84KB all told, which is
              what makes them cheap enough to ship.

              Layout follows the paper form: the drawings run down the left, the
              two part tables stack on the right. The L / R / B / F letters are
              part of the artwork.
            */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {WRAP_DIAGRAMS.map((d) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={d.src}
                    src={d.src}
                    alt={d.alt}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: d.maxWidth,
                      marginBottom: 6,
                    }}
                  />
                ))}
                <p style={{ margin: '2px 0 0', fontSize: 9, color: '#555' }}>
                  L = ซ้าย &middot; R = ขวา &middot; F = หน้า &middot; B = หลัง &middot;
                  ทำเครื่องหมายบนภาพตรงจุดที่ตรวจพบ
                </p>
              </div>
              <div style={{ width: 210, flexShrink: 0 }}>
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
                <table style={{ fontSize: 10, marginBottom: 12 }}>
                  <tbody>
                    {WRAP_INTERIOR_PARTS.map(([left, right]) => (
                      <tr key={left}>
                        <td>{left}</td>
                        <td>{right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <table style={{ fontSize: 10 }}>
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
  } else if (printMode === 'service' || printMode === 'claim') {
    /*
      ใบเซอร์วิส ลูกค้าหน้าร้าน, following the shop's paper form.

      `serviceVisit` null means a blank sheet: the header still comes from the
      ticket (the car and customer are known either way), and everything the
      technician fills in at the car is left empty to write on. With a visit it
      prints the recorded answers instead — both ways of working, as asked.
    */
    const v = serviceVisit;
    /*
      ใบเคลมประกัน is the SAME sheet as the ใบเซอร์วิส — the technician does the
      same walk-around and writes on the same boxes — with the cover printed at
      the top so everyone can see what is left before anything is promised.
      Building it as a second layout would have been two forms to keep in step.
    */
    const isClaim = printMode === 'claim';
    const pol = insurancePolicy;
    const usedBig = pol?.claims.reduce((n, c) => n + Number(c.bigUsed || 0), 0) ?? 0;
    const usedSmall = pol?.claims.reduce((n, c) => n + Number(c.smallUsed || 0), 0) ?? 0;
    const mark = (on: boolean) => (
      <span
        style={{
          display: 'inline-block',
          width: 13,
          height: 13,
          border: '1.5px solid #333',
          borderRadius: 999,
          textAlign: 'center',
          lineHeight: '11px',
          fontSize: 10,
          fontWeight: 'bold',
          flexShrink: 0,
        }}
      >
        {on ? '✓' : ' '}
      </span>
    );
    const line = (label: string, value: string, width: number) => (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        {label}
        <span
          style={{
            display: 'inline-block',
            minWidth: width,
            borderBottom: '1px solid #555',
            fontWeight: 'bold',
            paddingLeft: 3,
          }}
        >
          {value || ' '}
        </span>
      </span>
    );
    const checkCell = (part: string) => (
      <tr key={part}>
        <td style={{ padding: '2px 6px' }}>{part}</td>
        <td style={{ padding: '2px 6px', fontWeight: 'bold', width: 90 }}>
          {v?.checks?.[part] || ' '}
        </td>
      </tr>
    );

    content = (
      <div className="print-area">
        <div className="print-page">
          <h2 style={{ textAlign: 'center', margin: '0 0 10px', fontSize: 17 }}>
            {isClaim ? 'ใบเคลมประกันฟิล์มกันรอย' : 'ใบเซอร์วิส ลูกค้าหน้าร้าน'}
          </h2>
          {isClaim ? (
            <p style={{ textAlign: 'right', margin: '0 0 6px', fontSize: 11 }}>
              ใบงาน {t.id}
              {insuranceClaim?.claimedAt
                ? ` · วันที่เคลม ${fmtThaiDate(new Date(insuranceClaim.claimedAt))}`
                : ''}
            </p>
          ) : (
            v && (
              <p style={{ textAlign: 'right', margin: '0 0 6px', fontSize: 11 }}>
                ครั้งที่ <b>{v.visitNo}</b> &middot; ใบงาน {t.id}
              </p>
            )
          )}

          <div style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: '5px 18px' }}>
            {line('ชื่อลูกค้า', t.customer, 150)}
            {line('เบอร์โทร', t.phone, 110)}
          </div>
          <div
            style={{
              fontSize: 11,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '5px 18px',
              margin: '5px 0 10px',
            }}
          >
            {line('ยี่ห้อรถ', t.brand, 90)}
            {line('รุ่นรถ', t.model, 90)}
            {line('สีรถ', t.color, 60)}
            {line('ทะเบียน', t.plate, 90)}
          </div>

          {/* ข้อมูลประกัน. Boxed and ringed because it is the one thing on this
              sheet that decides what the shop may do: how much cover is left,
              and whether it has run out. */}
          {isClaim && pol && (
            <div
              style={{
                border: '1.5px solid #333',
                borderRadius: 4,
                padding: '6px 10px',
                marginBottom: 8,
                fontSize: 11,
              }}
            >
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 'bold' }}>
                ข้อมูลประกัน: {pol.planName || 'ประกันฟิล์มกันรอย'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
                {line('ความคุ้มครองทั้งหมด', coverageText(pol.bigPieces, pol.smallPieces), 150)}
                {line('ใช้ไปแล้ว', `${usedBig} ชิ้นใหญ่, ${usedSmall} ชิ้นเล็ก`, 130)}
                {line(
                  'คงเหลือ',
                  `${pol.bigPieces - usedBig} ชิ้นใหญ่, ${pol.smallPieces - usedSmall} ชิ้นเล็ก`,
                  130,
                )}
                {line(
                  'คุ้มครองถึง',
                  pol.endsAt ? fmtThaiDate(new Date(`${pol.endsAt}T00:00:00`)) : '',
                  110,
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 4 }}>
                {line(
                  'เคลมครั้งนี้',
                  insuranceClaim
                    ? `${insuranceClaim.bigUsed} ชิ้นใหญ่, ${insuranceClaim.smallUsed} ชิ้นเล็ก`
                    : '',
                  150,
                )}
                {line('รายการที่เคลม', insuranceClaim?.detail ?? '', 260)}
              </div>
              {pol.terms && (
                <p style={{ margin: '4px 0 0', fontSize: 10, color: '#555' }}>
                  เงื่อนไข: {pol.terms}
                </p>
              )}
            </div>
          )}

          {/* ฟิล์มที่ใช้ — the ชื่อสินค้า, which already states the thickness.
              The shop keeps one SKU per thickness, so a separate ประเภท /
              ความหนา / รหัสสี row only asked for the same fact three times. */}
          <table style={{ fontSize: 11, marginBottom: 8 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 'bold', fontSize: 13, width: 100 }}>ฟิล์มที่ใช้</td>
                <td colSpan={7} style={{ fontWeight: 'bold' }}>
                  {v?.filmProduct || ' '}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold' }}>เซลล์รับรถ</td>
                <td colSpan={2} style={{ fontWeight: 'bold' }}>
                  {v?.salesBy || ' '}
                </td>
                <td colSpan={2} style={{ fontWeight: 'bold', textAlign: 'center' }}>
                  QC ผู้รับผิดชอบ
                </td>
                <td colSpan={3} style={{ fontWeight: 'bold' }}>
                  {v?.qcBy || ' '}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              fontSize: 11,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '5px 16px',
              marginBottom: 10,
            }}
          >
            {line('วันรับรถ', v?.receivedAt ? fmtThaiDate(new Date(v.receivedAt)) : '', 100)}
            {line('เวลารับรถ', v?.receivedTime ?? '', 60)}
            {line('วันส่งมอบรถ', v?.deliveredAt ? fmtThaiDate(new Date(v.deliveredAt)) : '', 100)}
            {line('เวลาส่งมอบรถ', v?.deliveredTime ?? '', 60)}
          </div>

          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* Same drawings as the ใบเช็ครถ — the technician marks the car up
                by hand here too, on either kind of sheet. */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {WRAP_DIAGRAMS.map((d) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={d.src}
                  src={d.src}
                  alt={d.alt}
                  style={{
                    display: 'block',
                    width: '100%',
                    maxWidth: d.maxWidth,
                    marginBottom: 6,
                  }}
                />
              ))}
              <p style={{ margin: '2px 0 0', fontSize: 9, color: '#555' }}>
                L = ซ้าย &middot; R = ขวา &middot; F = หน้า &middot; B = หลัง
              </p>
            </div>

            <div style={{ width: 230, flexShrink: 0 }}>
              <table style={{ fontSize: 10, marginBottom: 10 }}>
                <thead>
                  <tr>
                    <th colSpan={2} style={{ textAlign: 'center' }}>
                      ภายในรถ
                    </th>
                  </tr>
                </thead>
                <tbody>{SERVICE_INTERIOR_PARTS.map(checkCell)}</tbody>
              </table>
              <table style={{ fontSize: 10, marginBottom: 10 }}>
                <thead>
                  <tr>
                    <th colSpan={2} style={{ textAlign: 'center' }}>
                      ภายนอกรถ
                    </th>
                  </tr>
                </thead>
                <tbody>{SERVICE_EXTERIOR_PARTS.map(checkCell)}</tbody>
              </table>

              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 'bold' }}>
                เช็คสภาพงาน รอบคัน
                {v?.overallOk === true ? ' — ปกติ' : v?.overallOk === false ? ' — พบปัญหา' : ''}
              </p>
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                ลูกค้า {mark(v?.customerWaits === true)} รอ {mark(v?.customerWaits === false)} ไม่รอ
              </p>

              <table style={{ fontSize: 9 }}>
                <thead>
                  <tr>
                    <th colSpan={4} style={{ textAlign: 'center' }}>
                      จุดพิเศษลูกค้าต้องการแก้ไข
                    </th>
                  </tr>
                  <tr>
                    <th style={{ width: 22 }}>จุด</th>
                    <th>ตำแหน่ง</th>
                    <th>รายละเอียด</th>
                    <th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: SERVICE_POINT_ROWS }, (_, i) => i + 1).map((seq) => {
                    const p = v?.points?.find((x) => x.seq === seq);
                    return (
                      <tr key={seq}>
                        <td style={{ textAlign: 'center' }}>{seq}.</td>
                        <td>{p?.position || ' '}</td>
                        <td>{p?.detail || ' '}</td>
                        <td>{p?.note || ' '}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ทีมช่าง — the shop's own technician list, not the seven names the
              paper form was printed with years ago. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px 16px',
              marginTop: 10,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 'bold' }}>ทีมช่าง :</span>
            {technicianOptions.map((name) => (
              <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {mark(!!v?.technicians?.includes(name))}
                {name}
              </span>
            ))}
          </div>

          {v?.notes && (
            <p style={{ margin: '8px 0 0', fontSize: 11 }}>
              <b>หมายเหตุ:</b> {v.notes}
            </p>
          )}
        </div>
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
    // Only the channels money actually arrived by, in the order it arrived.
    // The shop's full list used to print with empty boxes beside the unused
    // ones, which is a form to fill in — a receipt records what happened. Read
    // off the payments rather than the shop's configured list, so a channel
    // dropped from จัดการสิทธิ์ after the fact still appears on the old receipt.
    const usedChannels = [...new Set(receivedPayments.map((p) => p.method).filter(Boolean))];

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

    const totalRow = (label: React.ReactNode, value: string, strong = false) => (
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
              receipt findable in a stack of them.

              Three columns so the band keeps its place in the middle of the
              page while shrinking to the width of the title: an empty column
              balances the เลขที่ / วันที่ block on the right. A band stretched
              across the full width made the title look like a section heading
              rather than the name of the document. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div style={{ flex: 1 }} />
            <div
              style={{
                background: DOC_ACCENT,
                color: '#fff',
                borderRadius: 6,
                padding: '8px 22px',
                textAlign: 'center',
              }}
              className="doc-band"
            >
              <p style={{ margin: 0, fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 }}>
                {docType}
              </p>
              <p style={{ margin: '1px 0 0', fontSize: 10, letterSpacing: 1.5, opacity: 0.9 }}>
                {docTypeEn(docType)}
              </p>
            </div>
            {/* Own line each, off to the right. Run together on one line they
                read as a single reference and the eye has to split them; the
                number is what gets quoted on the phone. */}
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 12 }}>
                {/* The ticket id already carries the shop — JT-CM-00216. Prefixing
                    t.shop again printed RCT-CM-CM-00216 on every document. */}
                {bi('เลขที่เอกสาร', 'No.')}: {docPrefix}-{t.id.replace('JT-', '')}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12 }}>
                {bi('วันที่เอกสาร', 'Date')}: {fmtThaiDate(new Date())}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 11 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>
                {bi('ข้อมูลลูกค้า', 'Customer')} :
              </p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{buyerName || t.customer}</p>
              {isTaxInvoice && buyerAddress && <p style={{ margin: '2px 0 0' }}>{buyerAddress}</p>}
              {isTaxInvoice && buyerTaxId && (
                <p style={{ margin: '2px 0 0' }}>
                  {bi('เลขผู้เสียภาษี', 'Tax ID')} {buyerTaxId}
                </p>
              )}
              {t.phone && (
                <p style={{ margin: '2px 0 0' }}>
                  {bi('โทร', 'Tel')} {t.phone}
                </p>
              )}
              <p style={{ margin: '2px 0 0' }}>
                {bi('รถ', 'Vehicle')}: {t.brand} {t.model} &middot; {t.plate}
              </p>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>
                {isQuotation
                  ? bi('ผู้เสนอราคา', 'Issued by')
                  : bi('ผู้ออกใบเสร็จรับเงิน', 'Issued by')}{' '}
                :
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
              {info.phone && (
                <p style={{ margin: '2px 0 0' }}>
                  {bi('โทร', 'Tel')} {info.phone}
                </p>
              )}
              {showCompanyInfo && info.taxId && (
                <p style={{ margin: '2px 0 0' }}>
                  {bi('เลขผู้เสียภาษี', 'Tax ID')} {info.taxId}
                </p>
              )}
            </div>
          </div>

          <table style={{ marginBottom: 12, fontSize: 11 }} className="doc-table">
            <thead>
              <tr>
                {/* The English sits under each heading rather than beside it:
                    the จำนวน column is 50px wide and a slash would wrap it. */}
                <th style={{ width: 50, textAlign: 'center' }}>
                  จำนวน
                  <div style={{ fontWeight: 'normal', fontSize: 9 }}>Qty</div>
                </th>
                <th>
                  รายการ
                  <div style={{ fontWeight: 'normal', fontSize: 9 }}>Description</div>
                </th>
                <th style={{ width: 100, textAlign: 'right' }}>
                  ราคา
                  <div style={{ fontWeight: 'normal', fontSize: 9 }}>Unit Price</div>
                </th>
                <th style={{ width: 100, textAlign: 'right' }}>
                  ยอดรวม
                  <div style={{ fontWeight: 'normal', fontSize: 9 }}>Amount</div>
                </th>
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
              {totalDiscount > 0 && totalRow(bi('ยอดรวม', 'Subtotal'), fmt(grossTotal))}
              {totalDiscount > 0 && totalRow(bi('ส่วนลดรวม', 'Discount'), `-${fmt(totalDiscount)}`)}
              {isTaxInvoice &&
                totalRow(bi('มูลค่าก่อนภาษี', 'Amount before VAT'), fmt(total / 1.07))}
              {isTaxInvoice &&
                totalRow(bi('ภาษีมูลค่าเพิ่ม 7%', 'VAT 7%'), fmt(total - total / 1.07))}
              {totalRow(bi('ยอดรวมสุทธิ', 'Grand Total'), fmt(total), true)}
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

          {/*
            2:1, not 50/50. A channel here is the shop's full deposit line —
            "ธนาคารกสิกรไทย เลขบัญชี 236-1-38053-6 ชื่อบัญชี หจก.คูลมาน ลำปาง" —
            and half a page wrapped it across three lines. The signature needs a
            line and two words; the money needs the room.
          */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 12 }}>
            {!isQuotation && (
              <div
                style={{
                  flex: 2,
                  border: '1px solid #666',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                }}
              >
                <p style={{ margin: '0 0 5px', fontWeight: 'bold' }}>
                  {bi('ช่องทางการชำระเงิน', 'Payment Method')}
                </p>
                {/*
                  Only the channels the money actually came in by. Printing the
                  shop's whole list with empty boxes beside it said nothing —
                  a receipt records what happened, it is not a form to fill in.
                */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  {usedChannels.map((m) => (
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
                          flexShrink: 0,
                        }}
                      >
                        ✓
                      </span>
                      {m}
                    </span>
                  ))}
                </div>
                {receivedPayments.length > 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: 10, fontWeight: 'bold' }}>
                    {bi('รายละเอียดการชำระเงิน', 'Payment Details')}
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
                  {total - paid <= 0 ? (
                    bi('ชำระครบแล้ว', 'Paid in full')
                  ) : (
                    <>
                      {bi('คงเหลือ', 'Balance due')} {fmt(total - paid)} บาท
                    </>
                  )}
                </p>
              </div>
            )}
            <div style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
              {/* Just the signature. Naming the issuer again here repeated what
                  the header already says — and the person signing is a member of
                  staff, not the company. */}
              <p style={{ margin: '26px 0 0' }}>
                {bi('ลงชื่อ', 'Signature')} .............................................
              </p>
              <p style={{ margin: '4px 0 0' }}>
                {isQuotation ? bi('ผู้เสนอราคา', 'Quoted by') : bi('ผู้รับเงิน', 'Received by')}{' '}
                &middot; {bi('วันที่', 'Date')} {fmtThaiDate(new Date())}
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
  } else if (printMode === 'insurance' && insurancePolicy) {
    /*
      ใบเสร็จค่าประกัน — its own receipt, because a policy is its own sale.

      ประกัน is not on the ticket’s ใบเสร็จ whenever it was bought: with the
      install or a year later, the money belongs to the day the policy was
      sold, and one document per sale is what keeps that straight. Same band
      and same layout as the financial document, so a customer holding both
      recognises them as coming from the same shop.
    */
    const v = insurancePolicy;
    const usedBig = v.claims.reduce((n, c) => n + Number(c.bigUsed || 0), 0);
    const usedSmall = v.claims.reduce((n, c) => n + Number(c.smallUsed || 0), 0);
    const row = (label: string, value: string) => (
      <tr>
        <td style={{ padding: '4px 8px', width: 150, fontWeight: 'bold' }}>{label}</td>
        <td style={{ padding: '4px 8px' }}>{value || ' '}</td>
      </tr>
    );

    content = (
      <div className="print-area">
        <div className="print-page">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }} />
            <div
              style={{
                background: DOC_ACCENT,
                color: '#fff',
                borderRadius: 6,
                padding: '8px 22px',
                textAlign: 'center',
              }}
              className="doc-band"
            >
              <p style={{ margin: 0, fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 }}>
                ใบเสร็จค่าประกัน
              </p>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 12 }}>
                {bi('เลขที่เอกสาร', 'No.')}: INS-{t.id.replace('JT-', '')}
                {v.id ? `-${v.id}` : ''}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12 }}>
                {bi('วันที่เอกสาร', 'Date')}:{' '}
                {v.soldAt ? fmtThaiDate(new Date(v.soldAt)) : fmtThaiDate(new Date())}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 11 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>ข้อมูลลูกค้า :</p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{t.customer}</p>
              {t.phone && <p style={{ margin: '2px 0 0' }}>โทร {t.phone}</p>}
              <p style={{ margin: '2px 0 0' }}>
                รถ: {t.brand} {t.model} &middot; {v.plate || t.plate}
              </p>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p style={{ margin: '0 0 3px', fontWeight: 'bold', fontSize: 12 }}>ผู้ออกใบเสร็จ :</p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{shopName(t.shop)}</p>
              {info.address && <p style={{ margin: '2px 0 0' }}>{info.address}</p>}
              {info.phone && <p style={{ margin: '2px 0 0' }}>โทร {info.phone}</p>}
            </div>
          </div>

          <table style={{ fontSize: 11, marginBottom: 12 }}>
            <tbody>
              {row('แผนประกัน', v.planName || 'ประกันฟิล์มกันรอย')}
              {row('ความคุ้มครอง', coverageText(v.bigPieces, v.smallPieces))}
              {row(
                'ระยะเวลาคุ้มครอง',
                `${v.startsAt ? fmtThaiDate(new Date(v.startsAt)) : '-'} ถึง ${
                  v.endsAt ? fmtThaiDate(new Date(v.endsAt)) : '-'
                }`,
              )}
              {row('ใบงานอ้างอิง', t.id)}
              {v.terms ? row('เงื่อนไข', v.terms) : null}
              {v.notes ? row('หมายเหตุ', v.notes) : null}
            </tbody>
          </table>

          <div
            className="doc-total"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              background: DOC_ACCENT,
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 'bold',
              marginBottom: 14,
            }}
          >
            <span>ยอดชำระค่าประกัน</span>
            <span>{fmt(v.price)}</span>
          </div>

          {/* The claims already written against this policy, so the copy in the
              customer’s folder says what is left of the cover. */}
          {v.claims.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 'bold' }}>
                {bi('ประวัติการเคลม', 'Claim History')}
              </p>
              <table style={{ fontSize: 11 }}>
                <tbody>
                  {v.claims.map((c, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 8px', width: 110 }}>
                        {c.claimedAt ? fmtThaiDate(new Date(c.claimedAt)) : '-'}
                      </td>
                      <td style={{ padding: '3px 8px' }}>{c.detail || '-'}</td>
                      <td style={{ padding: '3px 8px', width: 150 }}>
                        {c.bigUsed} ชิ้นใหญ่, {c.smallUsed} ชิ้นเล็ก
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 'bold' }}>
                {bi('คงเหลือ', 'Remaining')} {v.bigPieces - usedBig} ชิ้นใหญ่,{' '}
                {v.smallPieces - usedSmall} ชิ้นเล็ก
              </p>
            </div>
          )}

          <div style={{ textAlign: 'right', fontSize: 11, marginTop: 24 }}>
            <p style={{ margin: 0 }}>
              {bi('ลงชื่อ', 'Signature')} .............................................
            </p>
            <p style={{ margin: '4px 0 0' }}>
              {bi('ผู้รับเงิน', 'Received by')} &middot; {bi('วันที่', 'Date')}{' '}
              {v.soldAt ? fmtThaiDate(new Date(v.soldAt)) : fmtThaiDate(new Date())}
            </p>
          </div>
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
