import { describe, it, expect, beforeEach } from 'vitest';

import {
  TICKET_FILTER_KEY,
  rememberTicketFilter,
  ticketFilterQuery,
  ticketsHref,
} from '@/lib/browser/ticketFilter';

/** กลับไปรายการใบงาน ต้องกลับไปที่มุมมองเดิม ไม่ใช่รายการรวมทุกร้าน. */

const base = {
  shop: 'all',
  status: 'all',
  customer: 'all',
  search: '',
  period: 'month',
  periodValue: '2026-09',
  rangeStart: '2026-09-01',
  rangeEnd: '2026-09-18',
};

beforeEach(() => sessionStorage.clear());

describe('ticketFilterQuery', () => {
  it('carries the branch, status, customer and search that are set', () => {
    const q = ticketFilterQuery({
      ...base,
      shop: 'lp',
      status: 'ค้างชำระ',
      customer: 'คุณ ปรีชา',
      search: '3ขค',
    });
    const params = new URLSearchParams(q);
    expect(params.get('shop')).toBe('lp');
    expect(params.get('status')).toBe('ค้างชำระ');
    expect(params.get('customer')).toBe('คุณ ปรีชา');
    expect(params.get('q')).toBe('3ขค');
  });

  it('leaves out what is still on ทุกร้าน / ทุกสถานะ / ทุกลูกค้า', () => {
    const params = new URLSearchParams(ticketFilterQuery(base));
    expect(params.get('shop')).toBeNull();
    expect(params.get('status')).toBeNull();
    expect(params.get('customer')).toBeNull();
    expect(params.get('q')).toBeNull();
  });

  it('carries the month with a monthly view, and the dates with a range', () => {
    expect(new URLSearchParams(ticketFilterQuery(base)).get('pv')).toBe('2026-09');
    const range = new URLSearchParams(ticketFilterQuery({ ...base, period: 'range' }));
    expect(range.get('period')).toBe('range');
    expect(range.get('rs')).toBe('2026-09-01');
    expect(range.get('re')).toBe('2026-09-18');
    // The month box says nothing about a range.
    expect(range.get('pv')).toBeNull();
  });
});

describe('rememberTicketFilter / ticketsHref', () => {
  it('returns to the view the list was left on', () => {
    rememberTicketFilter({ ...base, shop: 'lp', status: 'ค้างชำระ' });
    const href = ticketsHref();
    expect(href.startsWith('/tickets?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('shop')).toBe('lp');
    expect(params.get('status')).toBe('ค้างชำระ');
  });

  it('falls back to the plain list when nothing was remembered', () => {
    expect(ticketsHref()).toBe('/tickets');
  });

  it('stores under one key, so the next visit overwrites the last', () => {
    rememberTicketFilter({ ...base, shop: 'lp' });
    rememberTicketFilter({ ...base, shop: 'cm' });
    expect(new URLSearchParams(sessionStorage.getItem(TICKET_FILTER_KEY) ?? '').get('shop')).toBe(
      'cm',
    );
  });
});
