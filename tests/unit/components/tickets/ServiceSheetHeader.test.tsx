import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PrintJobSheet } from '@/components/tickets/PrintJobSheet';
import type { ServiceVisit, Ticket } from '@/components/tickets/types';
import { fmtThaiDate } from '@/lib/domain/format';

/**
 * หัวใบเซอร์วิส (ร้านขอ 19 ก.ย. 2569).
 *
 * The sheet is worked from at the car and never handed to the customer, so what
 * belongs on it is what the technician cannot look up while holding it: how
 * much of the package is left, which day the sheet came off the printer, and
 * when the film was originally fitted.
 */

const visit = (over: Partial<ServiceVisit> = {}): ServiceVisit => ({
  id: 1,
  visitNo: 2,
  plate: 'ไกข 4521',
  receivedAt: '2026-09-18',
  receivedTime: '09:00',
  deliveredAt: '2026-09-18',
  deliveredTime: '11:30',
  salesBy: 'แอดมินระบบ',
  qcBy: 'ช่างเอ',
  technicians: ['ช่างเอ'],
  filmProduct: 'TPU กันรอยเกรดพรีเมียม',
  customerWaits: true,
  overallOk: true,
  checks: {},
  notes: '',
  points: [],
  ...over,
});

const ticket = {
  id: 'JT-CM-00212',
  shop: 'cm',
  customer: 'คุณ สมชาย',
  phone: '0823456789',
  plate: 'ไกข 4521',
  brand: 'Honda',
  model: 'City',
  color: 'ดำ',
  items: [],
  payments: [],
  extras: { Service: { checked: true, serviceCount: 12 } },
  serviceVisits: [visit(), visit({ id: 2, visitNo: 1 })],
  dropOffDateObj: new Date('2026-08-13T09:00:00+07:00'),
  pickupDateObj: new Date('2026-08-13T17:00:00+07:00'),
} as unknown as Ticket;

function renderSheet(serviceVisit: ServiceVisit | null) {
  render(
    <PrintJobSheet
      t={ticket}
      printMode="service"
      currentUserName="แอดมินระบบ"
      shopName={() => 'FINNIX FILM เชียงใหม่'}
      shopInfo={{}}
      stock={[]}
      extraOptions={[]}
      total={0}
      paid={0}
      docType="ใบเสร็จรับเงิน"
      buyerName=""
      buyerTaxId=""
      buyerAddress=""
      showCompanyInfo={false}
      showDisclaimer={false}
      serviceVisit={serviceVisit}
    />,
  );
  return document.querySelector('.print-area')?.textContent ?? '';
}

describe('ใบเซอร์วิส — หัวใบ', () => {
  it('says which visit this is out of the package, and what is left', () => {
    const sheet = renderSheet(visit());
    expect(sheet).toContain('ครั้งที่');
    expect(sheet).toContain('/ 12');
    // Two visits recorded against twelve sold.
    expect(sheet).toContain('เหลืออีก 10 ครั้ง');
  });

  it('carries the day it was printed, so a sheet filled in by hand can be matched back', () => {
    expect(renderSheet(visit())).toContain(`พิมพ์ ${fmtThaiDate(new Date())}`);
  });

  it('names the install dates as such, not as "งานเดิม"', () => {
    const sheet = renderSheet(visit());
    expect(sheet).toContain('วันติดตั้งเดิม');
    expect(sheet).not.toContain('งานเดิม:');
  });

  it('leaves a blank sheet blank to write on, but still dated and counted', () => {
    const sheet = renderSheet(null);
    expect(sheet).toContain('เซอร์วิส 12 ครั้ง');
    expect(sheet).toContain(`พิมพ์ ${fmtThaiDate(new Date())}`);
    // The visit's own dates are the technician's to fill in at the car.
    expect(sheet).not.toContain('18 ก.ย. 2569');
    expect(screen.getByText(/วันรับรถ/)).toBeInTheDocument();
  });
});
