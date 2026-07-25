'use client';

import { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { fmt, fmtThaiDate, thaiBahtText } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { itemNetPrice } from '@/lib/domain/tickets';

import type { ShopInfo, StockRow, Ticket } from './types';

export type PrintMode = 'job' | 'sale' | 'offsite' | 'doc' | null;

const emboss: CSSProperties = {
  display: 'inline-block',
  padding: '2px 9px',
  borderRadius: 5,
  background: '#FFF1BF',
  border: '1px solid #D8A83A',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(0,0,0,.18)',
  fontWeight: 'bold',
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

  function extrasBlock(gap: number) {
    if (filledExtras.length === 0) return null;
    return (
      <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: gap }}>
        {filledExtras.map((name) => {
          const ex = t.extras[name];
          if (name === 'รถสไลด์') {
            const legs = (ex.legs as { from?: string; to?: string; date?: string; time?: string }[]) || [];
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

  let content: React.ReactNode = null;

  if (printMode === 'job') {
    content = (
      <div className="print-area">
        {categories.map((cat, catIdx) => (
          <div key={cat} style={catIdx > 0 ? { pageBreakBefore: 'always' } : {}}>
            <h1 style={{ margin: '0 0 14px', fontSize: 22, textAlign: 'center' }}>ใบงานติดตั้ง</h1>
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12 }}>เลขที่เอกสาร: {t.id}</p>
              <p
                style={{
                  margin: 0,
                  display: 'inline-block',
                  fontSize: 17,
                  fontWeight: 'bold',
                  border: '2px solid #D8A83A',
                  borderRadius: 6,
                  padding: '4px 12px',
                  background: '#FFF7DD',
                }}
              >
                วันที่ส่งงาน: {fmtThaiDate(t.pickupDateObj)}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
                บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
              </p>
            </div>
            <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>{shopName(t.shop)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 28px', fontSize: 13, marginBottom: 8 }}>
              <span>
                ชื่อลูกค้า: <b>{t.customer}</b>
              </span>
              <span>
                เบอร์โทร: <b>{t.phone}</b>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 22px', fontSize: 13, marginBottom: 10 }}>
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
                งานนี้มี {categories.length} ชนิดสินค้า — หน้านี้แสดงเฉพาะ &quot;{cat}&quot; (หน้า {catIdx + 1}/
                {categories.length})
              </p>
            )}
            <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
            {t.items
              .filter((i) => i.sold && i.category === cat)
              .map((i, idx) => {
                let rows: { label: string | null; product: string }[];
                if (i.positions && i.positions.length) {
                  const grouped: Record<string, string[]> = {};
                  i.positions.forEach((p) => {
                    if (!grouped[p.product]) grouped[p.product] = [];
                    grouped[p.product].push(p.position);
                  });
                  rows = Object.entries(grouped).map(([product, labels]) => ({ label: labels.join(', '), product }));
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
                    {rows.map((r, ri) => {
                      const stockMatch = stock.find((s) => s.name === r.product);
                      const short = stockMatch?.shortName || r.product;
                      return (
                        <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingLeft: 12 }}>
                          {r.label && <span style={emboss}>{r.label}</span>}
                          <span style={{ fontSize: 18, fontWeight: 'bold' }}>{short}</span>
                          <span style={{ fontSize: 11, color: '#777' }}>({r.product})</span>
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: 11,
                              color: '#444',
                              whiteSpace: 'nowrap',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {(i.category === 'ฟิล์มกรองแสง' || i.category === 'ฟิล์มกันรอย') && (
                              <>
                                ขนาด
                                <span style={{ display: 'inline-block', borderBottom: '1px solid #999', width: 120 }}>&nbsp;</span>
                                &nbsp;ตัด
                                <span style={{ display: 'inline-block', borderBottom: '1px solid #999', width: 120 }}>&nbsp;</span>
                                &nbsp;
                              </>
                            )}
                            ใช้จริง
                            <span style={{ display: 'inline-block', borderBottom: '1px solid #999', width: 30 }}>&nbsp;</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
            {t.notes && (
              <p style={{ fontSize: 12, margin: '0 0 10px' }}>
                <b>หมายเหตุ:</b> {t.notes}
              </p>
            )}
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
                <span style={{ display: 'inline-block', borderBottom: '1px solid #999', width: 240 }}>&nbsp;</span>
              )}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, border: '1.5px solid #555', borderRadius: 6, padding: '10px 12px' }}>
                <p style={{ margin: '0 0 8px', fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #D8722A', borderRadius: 3, flexShrink: 0 }}></span>
                  QC ก่อนติดตั้ง
                </p>
                <p style={{ margin: 0, fontSize: 11 }}>วันที่ ....................................</p>
              </div>
              <div style={{ flex: 1, border: '1.5px solid #555', borderRadius: 6, padding: '10px 12px' }}>
                <p style={{ margin: '0 0 8px', fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #D8722A', borderRadius: 3, flexShrink: 0 }}></span>
                  QC หลังติดตั้ง
                </p>
                <p style={{ margin: 0, fontSize: 11 }}>วันที่ ....................................</p>
              </div>
            </div>
          </div>
        ))}
        {categories.includes('ฟิล์มกรองแสง') && (
          <div style={{ pageBreakBefore: 'always' }}>
            <h2 style={{ textAlign: 'center', marginBottom: 10, fontSize: 16 }}>ใบตรวจเช็คสภาพก่อนติดตั้ง (ฟิล์มกรองแสง)</h2>
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
            {[
              {
                title: 'ระบบไฟฟ้า',
                items: ['ไฟหน้า', 'ไฟหรี่', 'ไฟสูง', 'สปอตไลท์', 'ไฟเลี้ยวหน้า', 'ไฟเลี้ยวข้าง'],
              },
              { title: 'ระบบเครื่องเสียง', items: ['เครื่องเล่นวิทยุเดิม', 'ทวิตเตอร์ซ้าย-ขวา', 'ลำโพงหน้า'] },
              { title: 'สภาพภายในรถ', items: ['เพดานรถ', 'คอนโซลรถ', 'เบาะรถ', 'แผงข้าง'] },
              { title: 'สภาพภายนอกรถ', items: ['สภาพรอบคัน', 'กระจกบานหน้า-หลัง', 'กระจกบานข้าง'] },
            ].map((section) => (
              <div key={section.title} style={{ marginBottom: 6 }}>
                <p style={{ fontSize: 10, fontWeight: 'bold', margin: '0 0 2px' }}>{section.title}</p>
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
            <p style={{ fontSize: 11, marginTop: 20 }}>ลงชื่อ................................ผู้ตรวจสอบก่อนติดตั้ง</p>
          </div>
        )}
        {categories.includes('ฟิล์มกันรอย') && (
          <div style={{ pageBreakBefore: 'always' }}>
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
                style={{ flex: 1, minHeight: 150, border: '1px dashed #999', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}
              >
                แผนผังตัวรถ (สำหรับทำเครื่องหมายจุดที่ตรวจพบ)
              </div>
              <div style={{ width: 200, flexShrink: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 'bold', margin: '0 0 4px', textAlign: 'center' }}>ภายในตัวรถ</p>
                <table style={{ fontSize: 10 }}>
                  <tbody>
                    <tr>
                      <td>หน้าจอ</td>
                      <td>Pino Black</td>
                    </tr>
                    <tr>
                      <td>กาบประตูหน้าซ้าย</td>
                      <td>ที่เก็บของด้านหลัง</td>
                    </tr>
                    <tr>
                      <td>กาบประตูหน้าซ้าย</td>
                      <td>หน้าปัดรถยนต์</td>
                    </tr>
                    <tr>
                      <td>กาบประตูหน้าซ้าย</td>
                      <td>แผงเกียร์</td>
                    </tr>
                    <tr>
                      <td>กาบประตูหน้าซ้าย</td>
                      <td>ช่องเก็บของกลาง</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
              <div
                style={{ flex: 1, minHeight: 150, border: '1px dashed #999', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}
              >
                แผนผังตัวรถ (ด้านนอก)
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 'bold', margin: '0 0 4px', textAlign: 'center' }}>ภายนอกตัวรถ</p>
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
            <p style={{ fontSize: 11, marginTop: 20 }}>ลงชื่อ................................ผู้ตรวจสอบก่อนติดตั้ง</p>
          </div>
        )}
      </div>
    );
  } else if (printMode === 'sale') {
    content = (
      <div className="print-area">
        <h1 style={{ margin: '0 0 14px', fontSize: 22, textAlign: 'center' }}>ใบงานขาย</h1>
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12 }}>เลขที่เอกสาร: {t.id}</p>
          <p
            style={{
              margin: 0,
              display: 'inline-block',
              fontSize: 17,
              fontWeight: 'bold',
              border: '2px solid #D8A83A',
              borderRadius: 6,
              padding: '4px 12px',
              background: '#FFF7DD',
            }}
          >
            วันที่ส่งงาน: {fmtThaiDate(t.pickupDateObj)}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
            บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
          </p>
        </div>
        <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>{shopName(t.shop)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 28px', fontSize: 13, marginBottom: 8 }}>
          <span>
            ชื่อลูกค้า: <b>{t.customer}</b>
          </span>
          <span>
            เบอร์โทร: <b>{t.phone}</b>
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 22px', fontSize: 13, marginBottom: 10 }}>
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
              rows = Object.entries(grouped).map(([product, labels]) => ({ label: labels.join(', '), product }));
            } else {
              rows = [{ label: null, product: i.sold }];
            }
            return (
              <div key={idx} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <p
                    style={{
                      margin: 0,
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
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#666' }}>
                      ช่าง:{' '}
                      <b>
                        {t.techByCategory && t.techByCategory[i.category] && t.techByCategory[i.category].length
                          ? t.techByCategory[i.category].join(', ')
                          : '-'}
                      </b>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 2 }}>ยอดรวม: {fmt(itemNetPrice(mapItem(i)))}</div>
                  </div>
                </div>
                {rows.map((r, ri) => {
                  const stockMatch = stock.find((s) => s.name === r.product);
                  const short = stockMatch?.shortName || r.product;
                  return (
                    <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingLeft: 12 }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span>ชำระแล้ว</span>
            <span>{fmt(paid)}</span>
          </div>
          {total - paid <= 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#2F7A4F' }}>
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
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8A5A12' }}>
                <span>ส่วนต่างเชียร์ขาย (Cheer-up)</span>
                <span>
                  {(() => {
                    const cu = t.items.reduce(
                      (s, i) => (i.interested ? s + (Number(i.soldPrice || 0) - Number(i.interestedPrice || 0)) : s),
                      0
                    );
                    return (cu >= 0 ? '+' : '') + fmt(cu);
                  })()}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: '#999' }}>
                จาก {t.items.filter((i) => i.interested).map((i) => i.interested).join(', ')}
              </p>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1.5px solid #333', margin: '10px 0' }}></div>
        {t.notes && (
          <p style={{ fontSize: 12, margin: '0 0 10px' }}>
            <b>หมายเหตุ:</b> {t.notes}
          </p>
        )}
        {extrasBlock(16)}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, border: '1.5px solid #555', borderRadius: 6, padding: '10px 12px' }}>
            <p style={{ margin: '0 0 8px', fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #D8722A', borderRadius: 3, flexShrink: 0 }}></span>
              ส่งมอบงาน
            </p>
            <p style={{ margin: 0, fontSize: 11 }}>วันที่ ....................................</p>
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
          <p
            style={{
              margin: 0,
              display: 'inline-block',
              fontSize: 17,
              fontWeight: 'bold',
              border: '2px solid #D8A83A',
              borderRadius: 6,
              padding: '4px 12px',
              background: '#FFF7DD',
            }}
          >
            วันที่ส่งงาน: {fmtThaiDate(t.pickupDateObj)}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>จองผ่าน: {t.bookingChannel || '-'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
            บันทึกโดย: {t.createdBy || '-'} &middot; พิมพ์โดย: {currentUserName || '-'}
          </p>
        </div>
        <p style={{ fontSize: 16, fontWeight: 'bold', margin: '0 0 10px' }}>{shopName(t.shop)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 28px', fontSize: 13, marginBottom: 8 }}>
          <span>
            ชื่อลูกค้า: <b>{t.customer}</b>
          </span>
          {t.phone && (
            <span>
              เบอร์โทร: <b>{t.phone}</b>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 22px', fontSize: 13, marginBottom: 10 }}>
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
          <div style={{ fontSize: 12, marginBottom: 10, background: '#EAF1FB', borderRadius: 6, padding: '8px 10px' }}>
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
        {t.notes && (
          <p style={{ fontSize: 12, margin: '0 0 10px' }}>
            <b>หมายเหตุ:</b> {t.notes}
          </p>
        )}
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
              rows = Object.entries(grouped).map(([product, labels]) => ({ label: labels.join(', '), product }));
            } else {
              rows = [{ label: null, product: i.sold }];
            }
            return (
              <div key={idx} style={{ marginBottom: 14 }}>
                <p
                  style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 900, borderBottom: '2px solid #333', display: 'inline-block', paddingBottom: 2 }}
                >
                  {i.category}
                </p>
                {rows.map((r, ri) => {
                  const stockMatch = stock.find((s) => s.name === r.product);
                  const short = stockMatch?.shortName || r.product;
                  return (
                    <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, paddingLeft: 12 }}>
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
        <p style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>พื้นที่สำหรับวาดแบบอาคาร/ตำแหน่งติดตั้งที่หน้างาน</p>
        <div style={{ border: '1.5px dashed #999', borderRadius: 6, minHeight: 380, width: '100%', boxSizing: 'border-box' }}></div>
      </div>
    );
  } else if (printMode === 'doc') {
    const totalDiscount = t.items.reduce((s, i) => s + (Number(i.soldPrice || 0) - itemNetPrice(mapItem(i))), 0);
    content = (
      <div className="print-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>{(showCompanyInfo && info.companyName) || shopName(t.shop)}</h2>
            {showCompanyInfo && info.companyName && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#333' }}>{shopName(t.shop)}</p>
            )}
            {(info.address || info.phone) && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#555', maxWidth: 280 }}>
                {info.address}
                {info.phone ? ` โทร ${info.phone}` : ''}
              </p>
            )}
            {showCompanyInfo && info.taxId && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#555' }}>เลขผู้เสียภาษี {info.taxId}</p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12 }}>
              เลขที่เอกสาร{' '}
              {docType === 'ใบเสนอราคา' ? 'QT' : docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน' ? 'INV' : 'RCT'}-
              {t.shop.toUpperCase()}-{t.id.replace('JT-', '')}
            </p>
            <h3 style={{ margin: '4px 0 0' }}>{docType}</h3>
            <p style={{ fontSize: 12, margin: '2px 0 0' }}>
              วันที่ {new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <table style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>ชื่อลูกค้า</th>
              <td>{buyerName || t.customer}</td>
            </tr>
            {docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน' && (
              <>
                {buyerAddress && (
                  <tr>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>ที่อยู่ (นิติบุคคล)</th>
                    <td>{buyerAddress}</td>
                  </tr>
                )}
                {buyerTaxId && (
                  <tr>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>เลขผู้เสียภาษี</th>
                    <td>{buyerTaxId}</td>
                  </tr>
                )}
              </>
            )}
            <tr>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>&nbsp;</th>
              <td>
                {t.brand} {t.model} &middot; {t.plate}
              </td>
            </tr>
          </tbody>
        </table>
        <table style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>รายการ</th>
              <th style={{ width: 110, textAlign: 'right' }}>จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {t.items
              .filter((i) => i.sold)
              .flatMap((i, idx) => {
                if (i.positions && i.positions.length) {
                  const grouped: Record<string, { labels: string[]; price: number }> = {};
                  i.positions.forEach((p) => {
                    if (!grouped[p.product]) grouped[p.product] = { labels: [], price: 0 };
                    grouped[p.product].labels.push(p.position);
                    grouped[p.product].price += Number(p.price || 0);
                  });
                  return Object.entries(grouped).map(([product, g], gi) => {
                    const stockMatch = stock.find((s) => s.name === product);
                    const short = stockMatch?.shortName || product;
                    return (
                      <tr key={idx + '-' + gi}>
                        <td>
                          {i.category} — {g.labels.join(', ')}: <b>{short}</b> ({product})
                        </td>
                        <td style={{ width: 110, textAlign: 'right' }}>{fmt(g.price)}</td>
                      </tr>
                    );
                  });
                }
                const stockMatch = stock.find((s) => s.name === i.sold);
                const short = stockMatch?.shortName || i.sold;
                return [
                  <tr key={idx}>
                    <td>
                      {i.category}: <b>{short}</b> ({i.sold})
                    </td>
                    <td style={{ width: 110, textAlign: 'right' }}>{fmt(Number(i.soldPrice))}</td>
                  </tr>,
                ];
              })}
          </tbody>
        </table>
        {totalDiscount > 0 ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#B23A48', marginBottom: 8 }}>
            <span>ส่วนลดรวม</span>
            <span>-{fmt(totalDiscount)}</span>
          </div>
        ) : null}
        {docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน' ? (
          <table style={{ marginBottom: 12 }}>
            <tbody>
              <tr>
                <th>มูลค่าก่อนภาษี</th>
                <td style={{ width: 110, textAlign: 'right' }}>{fmt(total / 1.07)}</td>
              </tr>
              <tr>
                <th>ภาษีมูลค่าเพิ่ม 7%</th>
                <td style={{ width: 110, textAlign: 'right' }}>{fmt(total - total / 1.07)}</td>
              </tr>
              <tr>
                <th style={{ fontWeight: 'bold' }}>ยอดรวมสุทธิ</th>
                <td style={{ width: 110, fontWeight: 'bold', textAlign: 'right' }}>{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table style={{ marginBottom: 12 }}>
            <tbody>
              <tr>
                <th style={{ fontWeight: 'bold' }}>ยอดรวมสุทธิ</th>
                <td style={{ width: 110, fontWeight: 'bold', textAlign: 'right' }}>{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p style={{ textAlign: 'right', fontStyle: 'italic', margin: '0 0 16px', fontSize: 12 }}>( {thaiBahtText(total)} )</p>
        {docType !== 'ใบเสนอราคา' && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>รายละเอียดการชำระเงิน</p>
            <table style={{ fontSize: 11 }}>
              <tbody>
                {t.payments.map((p, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: '3px 6px' }}>
                      {p.type} &middot; {p.method}
                    </td>
                    <td style={{ width: 110, textAlign: 'right', padding: '3px 6px' }}>{fmt(Number(p.amount))}</td>
                  </tr>
                ))}
                <tr>
                  <th style={{ padding: '3px 6px' }}>สถานะ</th>
                  <td style={{ width: 110, fontWeight: 'bold', textAlign: 'right', padding: '3px 6px' }}>
                    {total - paid <= 0 ? 'ชำระครบแล้ว' : `คงเหลือ ${fmt(total - paid)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {showDisclaimer && (
          <p style={{ fontSize: 10, color: '#777', lineHeight: 1.6, marginBottom: 20, borderTop: '1px solid #ddd', paddingTop: 8 }}>
            กรุณาตรวจเช็คบริเวณรอบรถของท่านทุกครั้งก่อนเข้าบริการ
            หากท่านนำรถไปใช้แล้วเกิดความเสียหายบริเวณรอบรถทางร้านจะไม่รับผิดชอบใดๆทั้งสิ้น
            ยกเว้นความเสียหายอยู่ในการรับประกันสินค้า
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 44, fontSize: 12 }}>
          <span>ลงชื่อ..................... {docType === 'ใบเสนอราคา' ? 'ผู้เสนอราคา' : 'ผู้รับเงิน'}</span>
        </div>
      </div>
    );
  }

  return createPortal(content, document.body);
}

// Map a client TicketItem into the pure-domain shape itemNetPrice expects.
function mapItem(i: { soldPrice: number | string; discountType?: 'percent' | 'amount' | null; discountValue?: number | string }) {
  return {
    soldPrice: Number(i.soldPrice || 0),
    discountType: i.discountType ?? undefined,
    discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
  };
}
