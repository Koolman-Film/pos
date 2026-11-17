import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PrintJobSheet } from '@/components/tickets/PrintJobSheet';
import type { Ticket } from '@/components/tickets/types';

/**
 * ใบงานติดตั้ง แยกตามวันติดตั้ง (migration 0089, ร้านแจ้ง 16 พ.ย. 2569).
 *
 * ใบงานขายแยกใบตามวันส่งของไปแล้ว แต่ใบที่ช่างถืออยู่ยังพาดหัวด้วยวันของหัว
 * ใบงานเสมอ — JT-LPG-00142 มีฟิล์มนิรภัยที่นัดติดวันที่ 18 แต่กระดาษหน้านั้น
 * เขียนว่า "วันที่รับงาน 16 พ.ย. 2569 15:00" ซึ่งเป็นวันของงานแรก กระดาษใบนั้น
 * คือสิ่งที่ส่งช่างไปรอรถผิดวัน
 *
 * ข้อสุดท้ายคือด่านกันเผลอ: งานที่ทำรอบเดียว ซึ่งเป็นงานเกือบทั้งหมดของร้าน
 * ต้องได้กระดาษหน้าตาเดิมทุกประการ
 */
const ticket = (items: Ticket['items']): Ticket =>
  ({
    id: 'JT-LPG-00142',
    shop: 'lpg',
    customer: 'คุณ อัครพัชร์ มหายศนันท์',
    phone: '0850388388',
    plate: '015070',
    carType: 'SUV เล็ก',
    brand: 'JAECOO',
    model: '6T REEV',
    color: 'ดำ',
    serviceType: '',
    status: 'จองแล้ว',
    bookingChannel: 'Walk-in',
    techByCategory: {},
    dropOffDateObj: new Date('2026-11-16T15:00:00+07:00'),
    pickupDateObj: new Date('2026-11-16T17:00:00+07:00'),
    extras: {},
    items,
    payments: [],
    notes: '',
  }) as unknown as Ticket;

const item = (over: Partial<Ticket['items'][number]> = {}) =>
  ({
    category: 'ฟิล์มกรองแสง',
    booked: '',
    bookedPrice: 0,
    sold: 'ฟิล์ม FN XT 05',
    soldPrice: 12200,
    positions: [],
    ...over,
  }) as Ticket['items'][number];

const renderJob = (t: Ticket) =>
  render(
    <PrintJobSheet
      t={t}
      printMode="job"
      currentUserName="Fai Acc"
      shopName={() => 'FINNIX FILM ลำปาง'}
      shopInfo={{}}
      stock={[]}
      extraOptions={[]}
      total={17000}
      paid={17000}
      docType="ใบเสร็จรับเงิน"
      buyerName=""
      buyerTaxId=""
      buyerAddress=""
      showCompanyInfo={false}
      showDisclaimer={false}
    />,
  );

/** ใบพิมพ์ถูก portal ไปไว้ที่ body — หน้ากระดาษจึงไม่ได้อยู่ใน container. */
const pages = () => Array.from(document.body.querySelectorAll<HTMLElement>('.print-page'));
/** หน้าใบงานติดตั้งเท่านั้น — ใบตรวจสภาพฟิล์มต่อท้ายไม่ใช่หน้าของงาน. */
const jobPages = () => pages().filter((p) => within(p).queryByText('ใบงานติดตั้ง'));

const later = item({
  category: 'ฟิล์มนิรภัย',
  sold: 'ฟิล์มนิรภัย Sunroof',
  soldPrice: 8900,
  receivedAt: '2026-11-18',
  deliveredAt: '2026-11-18',
});

describe('ใบงานติดตั้ง — แยกตามวันติดตั้ง', () => {
  it('หน้าของของที่ติดอีกวัน บอกวันของมันเอง ไม่ใช่วันของหัวใบงาน', () => {
    renderJob(ticket([item(), later]));
    const second = jobPages()[1];
    expect(
      within(second).getByText(/วันที่รับงาน \(งานในใบนี้\): 18 พ.ย. 2569/),
    ).toBeInTheDocument();
    expect(
      within(second).getByText(/วันที่ส่งงาน \(งานในใบนี้\): 18 พ.ย. 2569/),
    ).toBeInTheDocument();
    // วันของทั้งใบงานยังอยู่เป็นบรรทัดเล็ก — การรับประกันนับจากวันที่รถเข้ามาครั้งแรก
    expect(within(second).getByText(/ทั้งใบงาน: รับ 16 พ.ย. 2569 15:00/)).toBeInTheDocument();
  });

  it('หน้าของงานวันแรก ไม่ได้ถูกวันของรอบหลังมาทับ', () => {
    /*
      หน้าที่ยืมวันของใบงานมา ไม่ได้เปลี่ยนอะไรเลย รวมถึงเวลานัดที่ยังติดมา
      ด้วย — ของรอบแรกยังเป็นงานของใบงานใบนั้นตามเดิม
    */
    renderJob(ticket([item(), later]));
    const first = jobPages()[0];
    expect(within(first).getByText(/วันที่รับงาน: 16 พ.ย. 2569 15:00/)).toBeInTheDocument();
    expect(within(first).queryByText(/18 พ.ย. 2569/)).not.toBeInTheDocument();
  });

  it('ป้ายเซอร์วิสยังอยู่กับงานรอบแรก ไม่ตามไปทับหน้าของรอบหลัง', () => {
    /*
      เจอตอนตรวจของจริง (JT-CM-00219): ใบงานที่มีเซอร์วิสบันทึกไว้ พาดหัวทุก
      หน้าด้วยวันของเซอร์วิสนั้น หน้าที่บอกว่า "ของวันที่ 19 พ.ย." จึงมีหัว
      เขียนว่ารับงาน 30 ก.ย. — สองบรรทัดในกระดาษแผ่นเดียวกันที่ขัดกันเอง

      เซอร์วิสคือรถที่กลับเข้ามาทั้งใบ มันจึงพูดแทนงานรอบแรกได้ แต่พูดแทน
      รอบที่ถูกนัดวันไว้เองไม่ได้
    */
    const withService = {
      ...ticket([item(), later]),
      extras: { Service: { checked: true } },
      serviceVisits: [
        { receivedAt: '2026-09-30', deliveredAt: '', receivedTime: '', deliveredTime: '' },
      ],
    } as unknown as Ticket;
    renderJob(withService);
    const [first, second] = jobPages();
    expect(within(first).getByText(/วันที่รับงาน \(เซอร์วิส\): 30 ก.ย. 2569/)).toBeInTheDocument();
    expect(
      within(second).getByText(/วันที่รับงาน \(งานในใบนี้\): 18 พ.ย. 2569/),
    ).toBeInTheDocument();
    expect(within(second).queryByText(/เซอร์วิส\): 30 ก.ย./)).not.toBeInTheDocument();
  });

  it('ของชนิดเดียวกันที่ติดคนละวัน ก็ยังเป็นคนละหน้า', () => {
    /*
      แยกตามวันก่อน แล้วค่อยแยกตามชนิดสินค้า — ฟิล์มกรองแสงสองรอบคือการทำงาน
      สองครั้ง ไม่ใช่หน้าเดียวที่มีของสองวันปนกัน
    */
    renderJob(
      ticket([item(), item({ sold: 'ฟิล์ม FINNIX Extra Clear', deliveredAt: '2026-11-18' })]),
    );
    const list = jobPages();
    expect(list).toHaveLength(2);
    expect(within(list[0]).getByText(/ฟิล์ม FN XT 05/)).toBeInTheDocument();
    expect(within(list[1]).getByText(/ฟิล์ม FINNIX Extra Clear/)).toBeInTheDocument();
  });

  it('ของที่ติดคนละวัน ไม่ไปโผล่บนหน้าของอีกวัน', () => {
    renderJob(ticket([item(), later]));
    expect(within(jobPages()[0]).queryByText(/ฟิล์มนิรภัย Sunroof/)).not.toBeInTheDocument();
    expect(within(jobPages()[1]).queryByText(/ฟิล์ม FN XT 05/)).not.toBeInTheDocument();
  });

  it('บรรทัดบอกหน้า พูดถึงวัน ไม่ใช่แค่ชนิดสินค้า', () => {
    renderJob(ticket([item(), later]));
    expect(
      within(jobPages()[1]).getByText(/ติดตั้ง 2 วัน .* "ฟิล์มนิรภัย" ของวันที่ 18 พ.ย. 2569/),
    ).toBeInTheDocument();
  });

  it('งานที่ทำรอบเดียว ได้กระดาษหน้าตาเดิมทุกประการ', () => {
    renderJob(ticket([item(), item({ category: 'สเปรย์', sold: 'สเปรย์ มิ้นท์' })]));
    const list = jobPages();
    expect(list).toHaveLength(2);
    // ไม่มีคำว่า "งานในใบนี้" โผล่มา และหัววันยังเป็นวันของใบงานพร้อมเวลานัด
    expect(screen.queryByText(/งานในใบนี้/)).not.toBeInTheDocument();
    expect(within(list[0]).getByText(/วันที่รับงาน: 16 พ.ย. 2569 15:00/)).toBeInTheDocument();
    expect(
      within(list[0]).getByText(/งานนี้มี 2 ชนิดสินค้า .* "ฟิล์มกรองแสง" \(หน้า 1\/2\)/),
    ).toBeInTheDocument();
  });
});
