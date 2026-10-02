'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CountPopover } from '@/components/ui/CountPopover';
import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import { fmt, fmtThaiDateLong, shortShopName } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { captureElement, downloadDataUrl, reportFileName } from '@/lib/print/captureScreen';

import {
  nextDay,
  previousDay,
  type CountItem,
  type DailyReport,
  type Outstanding,
  type SourceRow,
} from './buildDailyReport';

/**
 * รายงานการเงินรายวัน — the screen and its printed page.
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
  linksToMoney = true,
}: {
  report: DailyReport;
  today: string;
  shopFilter: string;
  shops: Shop[];
  scopeName: string;
  /** More than one branch on the page — name the branch beside each account. */
  showShopColumn: boolean;
  /**
   * Whether the reader may open การจัดการเงิน/บัญชี. The report has its own
   * permission, so someone can see it without the money module; for them an
   * account name is text, not a link to a page that would not open.
   */
  linksToMoney?: boolean;
}) {
  const router = useRouter();
  const mounted = useIsMounted();
  const { sales, inflow, outflow, balances } = report;

  /*
    บันทึกเป็นรูป และ พิมพ์ — ใช้ภาพเดียวกัน (ร้านขอ 2 ต.ค. 2569).

    ร้านบอกว่า PDF ตารางเปล่าของเดิม "ดูยากกว่าที่เห็นบนหน้าจอ" ทางที่ตรงที่สุด
    คือให้สิ่งที่พิมพ์ออกไป *เป็น* หน้าจอ ไม่ใช่การจัดหน้าใหม่ให้คล้ายหน้าจอ —
    อย่างหลังคือสิ่งที่มีอยู่แล้วและเป็นสิ่งที่ร้านบอกว่าอ่านยาก

    ผลพลอยได้ที่สำคัญกว่าความง่าย: ภาพกับใบพิมพ์มาจากการวาดครั้งเดียวกัน จึง
    ไม่มีทางที่สองอย่างนี้จะพูดตัวเลขคนละชุด
  */
  const sheetRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState('');
  const [captureError, setCaptureError] = useState('');

  async function capture(): Promise<string> {
    const node = sheetRef.current;
    if (!node) throw new Error('ไม่พบส่วนของรายงานที่จะบันทึก');
    /*
      พื้นขาวเสมอ ไม่ใช่สีพื้นของธีมที่เปิดอยู่.

      คนที่เปิดโหมดมืดอยู่ก็ยังส่งรูปให้คนอื่นอ่าน และรูปพื้นดำที่พิมพ์ลงกระดาษ
      คือหมึกเต็มหน้า
    */
    const { dataUrl } = await captureElement(node, { background: '#ffffff' });
    return dataUrl;
  }

  async function saveImage() {
    setCapturing(true);
    setCaptureError('');
    try {
      const dataUrl = await capture();
      downloadDataUrl(dataUrl, reportFileName(report.day, scopeName, 'png'));
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'บันทึกรูปไม่สำเร็จ');
    } finally {
      setCapturing(false);
    }
  }

  async function printImage() {
    setCapturing(true);
    setCaptureError('');
    try {
      const dataUrl = await capture();
      setCaptured(dataUrl);
      // รอให้ <img> เข้า DOM ก่อน ไม่งั้นหน้าต่างพิมพ์เปิดมาบนใบเปล่า
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
      setCaptured('');
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'เตรียมไฟล์พิมพ์ไม่สำเร็จ');
    } finally {
      setCapturing(false);
    }
  }

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

  /*
    รวมรายการของทุกแหล่งเงินเข้าด้วยกัน สำหรับการ์ดด้านบน.

    การ์ดบอกยอดรวมทั้งวัน ป๊อปอัพของมันจึงต้องเป็นรายการทั้งวัน ส่วนป๊อปอัพของ
    แต่ละแถวข้างล่างเป็นของแหล่งเงินนั้นแหล่งเดียว
  */
  const countOf = (rows: SourceRow[]) => rows.reduce((n, r) => n + r.count, 0);
  const itemsOf = (rows: SourceRow[]): CountItem[] =>
    rows.flatMap((r) => r.items).sort((a, b) => b.amount - a.amount);

  const muted = { color: 'var(--ink-soft)' };
  const cell = { padding: '7px 8px' };
  const numCell = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

  return (
    <div className="fade-page">
      {/* ------------------------------------------------------------ header -- */}
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold">รายงานการเงินรายวัน</h1>
          <p className="text-sm mt-0.5" style={muted}>
            {scopeName} · {dateLabel}
          </p>
        </div>
        {/* data-capture-hide: ปุ่มไม่ใช่ส่วนหนึ่งของรายงาน และไม่มีความหมายในภาพนิ่ง */}
        <div className="flex items-center gap-2" data-capture-hide>
          {captureError && (
            <span className="text-xs" style={{ color: '#B23A48' }} role="alert">
              {captureError}
            </span>
          )}
          <button
            onClick={saveImage}
            disabled={capturing}
            className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
            style={{ opacity: capturing ? 0.6 : 1 }}
          >
            <i className="fa-solid fa-image mr-1.5" style={{ color: '#2F6B3F' }}></i>
            {capturing ? 'กำลังบันทึก…' : 'บันทึกเป็นรูป'}
          </button>
          <button
            onClick={printImage}
            disabled={capturing}
            className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
            style={{ opacity: capturing ? 0.6 : 1 }}
          >
            <i className="fa-solid fa-file-pdf mr-1.5" style={{ color: '#C0392B' }}></i>พิมพ์ / PDF
          </button>
        </div>
      </div>

      {/* ----------------------------------------------------------- filter -- */}
      {/* ตัวเลือกวันและสาขา ไม่ติดไปในรูป — มันคือวิธีไปถึงรายงาน ไม่ใช่รายงาน */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2" data-capture-hide>
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

      {/*
        ส่วนที่ติดไปในรูป เริ่มที่หัวรายงาน จบที่การ์ดใบสุดท้าย.

        รูปที่ถูกส่งเข้าแชตต้องบอกตัวเองได้ว่าเป็นรายงานอะไร ของวันไหน สาขาไหน
        โดยไม่มีหน้าเว็บรอบ ๆ ช่วย — หัวรายงานจึงถูกวาดซ้ำไว้ในกรอบนี้
      */}
      <div ref={sheetRef} style={{ background: 'var(--paper)' }}>
        <div className="mb-3">
          <h2 className="text-lg font-bold">รายงานการเงินรายวัน</h2>
          <p className="text-sm mt-0.5" style={muted}>
            {scopeName} · {dateLabel}
          </p>
        </div>

        {/* ------------------------------------------------------------- tiles -- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Tile
            tone="sales"
            icon="fa-cash-register"
            label="ยอดขายที่เก็บเงินได้"
            value={sales.total}
            note={
              <>
                {change !== null &&
                  `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% จากเมื่อวาน · `}
                <CountPopover
                  count={`${sales.documents} งาน`}
                  items={sales.items}
                  label={`${sales.documents} งาน`}
                  title="ใบงาน / PO ที่จ่ายเงินเข้ามาวันนี้"
                />
              </>
            }
          />
          <Tile
            tone="in"
            icon="fa-arrow-down"
            label="เงินรับเข้า"
            value={inflow.total}
            note={
              <CountPopover
                count={`${countOf(inflow.rows)} รายการ`}
                items={itemsOf(inflow.rows)}
                label="รายการเงินรับเข้า"
                title="เงินรับเข้าวันนี้"
              />
            }
            detail={
              /*
              Where the money came from. It differs from ยอดขาย by exactly the
              money taken in for another Finnix shop, so saying so here is what
              lets the two cards be read side by side.
            */
              sales.held > 0 ? (
                <>
                  <div className="flex justify-between gap-2">
                    <span>ยอดขาย</span>
                    <span>{fmt(sales.total)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>เงินรอคืน Finnix</span>
                    <span>{fmt(sales.held)}</span>
                  </div>
                  <div className="mt-0.5">รับเงินไว้แทนสาขาอื่น จึงไม่นับเป็นยอดขาย</div>
                </>
              ) : undefined
            }
          />
          <Tile
            tone="out"
            icon="fa-arrow-up"
            label="ค่าใช้จ่าย"
            value={outflow.total}
            note={
              <CountPopover
                count={`${countOf(outflow.rows)} รายการ`}
                items={itemsOf(outflow.rows)}
                label="รายการค่าใช้จ่าย"
                title="ค่าใช้จ่ายวันนี้"
              />
            }
          />
          <Tile
            tone="net"
            icon="fa-scale-balanced"
            label="เงินสุทธิวันนี้"
            value={net}
            note="รับเข้า − ค่าใช้จ่าย"
            valueColor={net >= 0 ? 'var(--report-in)' : 'var(--report-due)'}
            signed
          />
        </div>

        {report.hasUnmatched && (
          <div className="card p-3 mb-4 text-sm" style={{ borderLeft: '4px solid #B8860B' }}>
            <i className="fa-solid fa-triangle-exclamation mr-1.5" style={{ color: '#B8860B' }}></i>
            มีเงินที่บันทึกด้วยชื่อแหล่งเงินที่ยังไม่ได้ผูกกับบัญชีใด (ทำเครื่องหมาย ⚠) —{' '}
            {linksToMoney ? (
              <Link href="/money" style={{ color: 'var(--primary)' }}>
                ไปผูกที่การจัดการเงิน/บัญชี
              </Link>
            ) : (
              'ผู้ดูแลการจัดการเงิน/บัญชีผูกชื่อให้ได้'
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- ① -- */}
        <div className="card overflow-hidden mb-4">
          <SectionHead
            tone="sales"
            icon="fa-tags"
            title="① ยอดขาย (ที่เก็บเงินได้) แยกตามชนิดสินค้า"
          />
          <div className="p-5 pt-3">
            {sales.channels.length === 0 ? (
              <p className="text-sm" style={muted}>
                ไม่มีการรับชำระเงินในวันนี้
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ ...muted, borderBottom: '1px solid var(--line)' }}>
                    <th style={{ ...cell, textAlign: 'left' }}>ชนิดสินค้า</th>
                    <th style={numCell}>จำนวนงาน</th>
                    <th style={numCell}>ยอดเงิน</th>
                    <th style={{ ...cell, width: '35%' }} className="hidden sm:table-cell">
                      สัดส่วน
                    </th>
                  </tr>
                </thead>
                {sales.channels.map((c) => (
                  <tbody key={c.channel}>
                    <tr style={{ background: 'var(--report-sales-soft)' }}>
                      <td style={{ ...cell, fontWeight: 700 }}>
                        {CHANNEL_LABEL[c.channel] ?? c.channel}
                      </td>
                      <td style={{ ...numCell, fontWeight: 700 }}>
                        <CountPopover
                          count={c.count}
                          items={c.items}
                          label={`${c.count} งาน ${CHANNEL_LABEL[c.channel] ?? c.channel}`}
                          title={`${CHANNEL_LABEL[c.channel] ?? c.channel} — ใบงาน / PO`}
                        />
                      </td>
                      <td style={{ ...numCell, fontWeight: 700 }}>{fmt(c.total)}</td>
                      <td style={cell} className="hidden sm:table-cell text-xs">
                        <span style={muted}>{pct(c.total, sales.total)}% ของยอดขาย</span>
                      </td>
                    </tr>
                    {c.categories.map((cat) => (
                      <tr key={cat.name} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ ...cell, paddingLeft: 22 }}>{cat.name}</td>
                        <td style={numCell}>
                          <CountPopover
                            count={cat.count}
                            items={cat.items}
                            label={`${cat.count} งาน ${cat.name}`}
                            title={`${cat.name} — ใบงาน / PO`}
                          />
                        </td>
                        <td style={numCell}>{fmt(cat.amount)}</td>
                        <td style={cell} className="hidden sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div
                              style={{
                                height: 8,
                                borderRadius: 4,
                                background: 'var(--report-sales)',
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
                    <td style={{ ...numCell, fontWeight: 700 }}>{sales.documents}</td>
                    <td style={{ ...numCell, fontWeight: 700 }}>{fmt(sales.total)}</td>
                    <td className="hidden sm:table-cell"></td>
                  </tr>
                  <OutstandingRow outstanding={sales.outstanding} cell={cell} numCell={numCell} />
                </tfoot>
              </table>
            )}
            {sales.channels.length === 0 && sales.outstanding.count > 0 && (
              <table className="w-full text-sm mt-3">
                <tbody>
                  <OutstandingRow outstanding={sales.outstanding} cell={cell} numCell={numCell} />
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- ② ③ -- */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <SourceCard
            tone="in"
            icon="fa-arrow-down"
            title="② เงินรับเข้า แยกแหล่งเงิน"
            rows={inflow.rows}
            total={inflow.total}
            nameOf={sourceName}
            empty="ไม่มีเงินรับเข้า"
          />
          <SourceCard
            tone="out"
            icon="fa-arrow-up"
            title="③ ค่าใช้จ่าย แยกแหล่งเงิน"
            rows={outflow.rows}
            total={outflow.total}
            nameOf={sourceName}
            empty="ไม่มีค่าใช้จ่าย"
          />
        </div>

        {/* ---------------------------------------------------------------- ④ -- */}
        <div className="card overflow-hidden">
          <SectionHead
            tone="bal"
            icon="fa-vault"
            title="④ ยอดคงเหลือแต่ละแหล่งเงิน ณ สิ้นวัน"
            hint="ยกมา + รับเข้า − จ่ายออก ± โอนระหว่างแหล่งเงิน = คงเหลือ"
          />
          <div className="p-5 pt-3">
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
                        <tr style={{ background: 'var(--report-bal-soft)' }}>
                          <td colSpan={5} style={{ ...cell, fontWeight: 700 }}>
                            {b.name}
                          </td>
                          <td style={{ ...numCell, fontWeight: 700 }}>{fmt(b.total)}</td>
                        </tr>
                      )}
                      {b.accounts.map((a) => (
                        <tr key={a.accountId} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={cell}>
                            {linksToMoney ? (
                              <Link href={`/money/${a.accountId}`} style={{ color: 'var(--ink)' }}>
                                {a.name}
                              </Link>
                            ) : (
                              a.name
                            )}
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
        </div>
      </div>

      {/* ------------------------------------------------------------ print -- */}
      {/*
        ใบที่พิมพ์ = รูปที่เพิ่งแคป ไม่ใช่ตารางที่จัดใหม่.

        ของเดิมเป็นตารางขาวดำอีกชุดหนึ่งที่เขียนไว้คู่ขนานกับหน้าจอ ซึ่งแปลว่า
        มีสองที่ที่ต้องแก้ทุกครั้งที่รายงานเปลี่ยน และเป็นสิ่งที่ร้านบอกว่าอ่าน
        ยากกว่าหน้าจอ (2 ต.ค. 2569) ตอนนี้เหลือที่เดียว

        ยังเก็บตารางเดิมไว้ใต้ `.print-sheet-fallback` สำหรับคนที่กด Ctrl+P เอง
        โดยไม่ผ่านปุ่ม — หน้ากระดาษเปล่าคือสิ่งที่แย่กว่าตารางที่อ่านยาก
      */}
      {mounted &&
        captured &&
        createPortal(
          <div className="print-area print-capture">
            {/* eslint-disable-next-line @next/next/no-img-element --
                next/image ย่อ/แคชรูปจากเซิร์ฟเวอร์ ส่วนนี่คือ data URL ที่เพิ่งวาด
                ในเบราว์เซอร์เพื่อส่งเข้าหน้าต่างพิมพ์ทันที ไม่มีอะไรให้ย่อหรือแคช */}
            <img src={captured} alt="" style={{ width: '100%' }} />
          </div>,
          document.body,
        )}
      {mounted &&
        !captured &&
        createPortal(
          <div className="print-area">
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>
              รายงานการเงินรายวัน
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
                  <td>
                    {fmt(inflow.total)}
                    {sales.held > 0 && (
                      <div style={{ fontSize: 9 }}>
                        ยอดขาย {fmt(sales.total)} + เงินรอคืน Finnix {fmt(sales.held)}
                      </div>
                    )}
                  </td>
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
                  <th>จำนวนงาน</th>
                  <th>ยอดเงิน</th>
                  <th>สัดส่วน</th>
                </tr>
              </thead>
              <tbody>
                {sales.channels.flatMap((c) => [
                  <tr key={c.channel}>
                    <td style={{ fontWeight: 700 }}>{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                    <td style={{ fontWeight: 700 }}>{c.count}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(c.total)}</td>
                    <td>{pct(c.total, sales.total)}%</td>
                  </tr>,
                  ...c.categories.map((cat) => (
                    <tr key={`${c.channel}-${cat.name}`}>
                      <td style={{ paddingLeft: 14 }}>{cat.name}</td>
                      <td>{cat.count}</td>
                      <td>{fmt(cat.amount)}</td>
                      <td>{pct(cat.amount, sales.total)}%</td>
                    </tr>
                  )),
                ])}
                <tr>
                  <td style={{ fontWeight: 700 }}>รวมยอดขาย</td>
                  <td style={{ fontWeight: 700 }}>{sales.documents}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(sales.total)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td>งานขายค้างชำระ ({DUE_LABEL})</td>
                  <td>{sales.outstanding.count}</td>
                  <td>{fmt(sales.outstanding.amount)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

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

type Tone = 'sales' | 'in' | 'out' | 'bal' | 'net' | 'due';

/** Each tone is a pair of tokens in globals.css: an ink and the tint it sits on. */
const ink = (t: Tone) => `var(--report-${t})`;
const tint = (t: Tone) => `var(--report-${t}-soft)`;

function Tile({
  tone,
  icon,
  label,
  value,
  note,
  detail,
  valueColor,
  signed,
}: {
  tone: Tone;
  icon: string;
  label: string;
  value: number;
  /** ไม่ใช่แค่ข้อความ: ตัวเลขจำนวนในบรรทัดนี้กดดูที่มาได้ (2 ต.ค. 2569). */
  note: React.ReactNode;
  /** A breakdown under the figure, set off by a rule. */
  detail?: React.ReactNode;
  valueColor?: string;
  signed?: boolean;
}) {
  return (
    <div className="card p-4" style={{ background: tint(tone), borderColor: 'transparent' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold" style={{ color: ink(tone) }}>
          {label}
        </p>
        <i className={`fa-solid ${icon} text-xs`} style={{ color: ink(tone) }} aria-hidden></i>
      </div>
      <p className="text-xl font-bold mt-1" style={{ color: valueColor }}>
        {signed && value > 0 ? '+' : ''}
        {fmt(value)}
      </p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
        {note}
      </p>
      {detail && (
        <div
          className="text-xs mt-2 pt-2 tabular-nums"
          style={{ color: 'var(--ink-soft)', borderTop: `1px solid ${ink(tone)}33` }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

/** A card's heading, on its section's tint, so the four questions read apart at a glance. */
function SectionHead({
  tone,
  icon,
  title,
  hint,
}: {
  tone: Tone;
  icon: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="px-5 py-3 flex items-center gap-3" style={{ background: tint(tone) }}>
      <span
        className="flex items-center justify-center rounded-lg flex-shrink-0"
        style={{ width: 30, height: 30, background: 'var(--surface)', color: ink(tone) }}
        aria-hidden
      >
        <i className={`fa-solid ${icon} text-sm`}></i>
      </span>
      <div>
        <h2 className="font-bold" style={{ color: ink(tone) }}>
          {title}
        </h2>
        {hint && (
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

const DUE_LABEL = 'รอ QC · ออกใบงานแล้ว · กำลังติดตั้ง · รอส่งมอบ · ค้างชำระ';

/** งานขายค้างชำระ — under the total, in the colour this app gives money owed. */
function OutstandingRow({
  outstanding,
  cell,
  numCell,
}: {
  outstanding: Outstanding;
  cell: React.CSSProperties;
  numCell: React.CSSProperties;
}) {
  const due = ink('due');
  return (
    <tr style={{ background: tint('due') }}>
      <td style={cell}>
        <span className="font-semibold" style={{ color: due }}>
          <i className="fa-solid fa-hourglass-half mr-1.5 text-xs" aria-hidden></i>
          งานขายค้างชำระ
        </span>
        <span className="block text-xs" style={{ color: 'var(--ink-soft)' }}>
          สถานะ ณ วันที่เลือก: {DUE_LABEL}
        </span>
      </td>
      <td style={{ ...numCell, fontWeight: 700, color: due }}>
        <CountPopover
          count={outstanding.count}
          items={outstanding.items}
          label={`${outstanding.count} งานขายค้างชำระ`}
          title="งานขายค้างชำระ ณ สิ้นวัน"
          emptyNote="ไม่มีงานค้างชำระในวันนี้"
        />
      </td>
      <td style={{ ...numCell, fontWeight: 700, color: due }}>{fmt(outstanding.amount)}</td>
      <td className="hidden sm:table-cell"></td>
    </tr>
  );
}

function SourceCard({
  tone,
  icon,
  title,
  rows,
  total,
  nameOf,
  empty,
}: {
  tone: Tone;
  icon: string;
  title: string;
  rows: SourceRow[];
  total: number;
  nameOf: (r: SourceRow) => string;
  empty: string;
}) {
  const cell = { padding: '7px 8px' };
  const numCell = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  return (
    <div className="card overflow-hidden">
      <SectionHead tone={tone} icon={icon} title={title} />
      <div className="p-5 pt-3">
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
                    <span
                      className="text-xs ml-1.5 whitespace-nowrap"
                      style={{ color: 'var(--ink-soft)' }}
                    >
                      <CountPopover
                        count={`${r.count} รายการ`}
                        items={r.items}
                        label={`${r.count} รายการของ ${nameOf(r)}`}
                        title={nameOf(r)}
                      />
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
    </div>
  );
}
