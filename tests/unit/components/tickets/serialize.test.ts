import { describe, it, expect } from 'vitest';

import { serializeTicket } from '@/components/tickets/serialize';
import type { Ticket } from '@/components/tickets/types';

/**
 * `serializeTicket` is the boundary between the client draft and the server
 * action, and a field silently missing here is invisible everywhere else: the
 * form works, the save succeeds, and the data is just gone.
 *
 * That is exactly what happened with `actualQtyMap` — it was dropped in this
 * function, so a technician's recorded usage never reached the server and stock
 * never moved. These tests pin the whole item payload, with the quantity map
 * first among equals.
 */

const baseTicket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 'JT-CM-00001',
    shop: 'cm',
    customer: 'คุณ เอ',
    phone: '081-234-5678',
    plate: '250 กก',
    carType: 'เก๋งเล็ก',
    brand: 'Toyota',
    model: 'Vios',
    color: 'ขาว',
    serviceType: 'เข้าทำ/ติดตั้ง',
    status: 'จองแล้ว',
    bookingChannel: 'Walk-in',
    techByCategory: {},
    dropOffDateObj: new Date('2026-07-24T09:00:00Z'),
    pickupDateObj: new Date('2026-07-24T17:00:00Z'),
    extras: {},
    notes: '',
    createdBy: 'แอดมิน',
    qcPhotos: [],
    installConfirmed: false,
    installConfirmedAt: '',
    items: [],
    payments: [],
    ...over,
  }) as unknown as Ticket;

const itemWith = (over: Record<string, unknown> = {}) => ({
  category: 'ฟิล์มกรองแสง',
  booked: '',
  bookedPrice: 0,
  sold: 'ฟิล์ม 3M CRM 60%',
  soldPrice: 5000,
  discountType: null,
  discountValue: undefined,
  positions: [],
  ...over,
});

const firstItem = (t: Ticket) => serializeTicket(t, false).items[0];

describe('serializeTicket — actual quantities', () => {
  it('carries the recorded quantity map through to the payload', () => {
    const t = baseTicket({
      items: [itemWith({ actualQtyMap: { 'ฟิล์ม 3M CRM 60%': 2 } })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).actualQty).toEqual({ 'ฟิล์ม 3M CRM 60%': 2 });
  });

  it('coerces the string an <input type=number> produces into a number', () => {
    const t = baseTicket({
      items: [itemWith({ actualQtyMap: { A: '3' } })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).actualQty).toEqual({ A: 3 });
  });

  it('emits an empty map when nothing was recorded', () => {
    const t = baseTicket({ items: [itemWith()] } as unknown as Partial<Ticket>);
    expect(firstItem(t).actualQty).toEqual({});
  });

  it('drops a blank entry rather than sending NaN to the database', () => {
    // A half-filled row yields '' — Number('') is 0, but an explicit non-numeric
    // string is NaN, and jsonb would happily store null for it.
    const t = baseTicket({
      items: [itemWith({ actualQtyMap: { A: '', B: 'abc', C: 4 } })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).actualQty).toEqual({ C: 4 });
  });

  it('drops zero quantities, which are equivalent to nothing recorded', () => {
    const t = baseTicket({
      items: [itemWith({ actualQtyMap: { A: 0, B: 1 } })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).actualQty).toEqual({ B: 1 });
  });

  it('keeps each item’s map separate', () => {
    const t = baseTicket({
      items: [
        itemWith({ actualQtyMap: { A: 1 } }),
        itemWith({ category: 'เครื่องเสียง', actualQtyMap: { B: 2 } }),
      ],
    } as unknown as Partial<Ticket>);
    const payload = serializeTicket(t, false);
    expect(payload.items[0].actualQty).toEqual({ A: 1 });
    expect(payload.items[1].actualQty).toEqual({ B: 2 });
  });
});

describe('serializeTicket — the rest of the item payload', () => {
  it('passes prices and the discount through unchanged', () => {
    const t = baseTicket({
      items: [itemWith({ soldPrice: 5000, discountType: 'percent', discountValue: 10 })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t)).toMatchObject({
      category: 'ฟิล์มกรองแสง',
      sold: 'ฟิล์ม 3M CRM 60%',
      soldPrice: 5000,
      discountType: 'percent',
      discountValue: 10,
    });
  });

  it('normalises an empty discountValue to null rather than 0', () => {
    // 0 and "no discount" are different: itemNetPrice treats a 0 discount as
    // falsy anyway, but null is what the column means.
    const t = baseTicket({
      items: [itemWith({ discountType: 'amount', discountValue: '' })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).discountValue).toBeNull();
  });

  it('serialises positions with numeric prices', () => {
    const t = baseTicket({
      items: [
        itemWith({
          positions: [{ position: 'บานหน้า', product: 'ฟิล์ม A', price: '1200' }],
        }),
      ],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).positions).toEqual([
      { position: 'บานหน้า', product: 'ฟิล์ม A', price: 1200 },
    ]);
  });

  it('defaults missing text fields to empty strings, never undefined', () => {
    const t = baseTicket({
      items: [itemWith({ booked: undefined, sold: undefined })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).booked).toBe('');
    expect(firstItem(t).sold).toBe('');
  });

  it('sends dates as ISO strings', () => {
    const payload = serializeTicket(baseTicket(), false);
    expect(payload.dropOffDate).toBe('2026-07-24T09:00:00.000Z');
    expect(payload.pickupDate).toBe('2026-07-24T17:00:00.000Z');
  });
});

describe('serializeTicket — สินค้าที่สนใจ (cheer-up baseline)', () => {
  it('carries the interested product and its price into the payload', () => {
    // Until migration 0015 these two never left the form, so reopening a saved
    // ticket showed an empty picker and lost the cheer-up comparison with it.
    const t = baseTicket({
      items: [itemWith({ interested: 'ฟิล์ม 3M CRM 40%', interestedPrice: 1700 })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).interested).toBe('ฟิล์ม 3M CRM 40%');
    expect(firstItem(t).interestedPrice).toBe(1700);
  });

  it('coerces the string an <input type=number> produces', () => {
    const t = baseTicket({
      items: [itemWith({ interested: 'A', interestedPrice: '1700' })],
    } as unknown as Partial<Ticket>);
    expect(firstItem(t).interestedPrice).toBe(1700);
  });

  it('sends an empty baseline when none was chosen', () => {
    const t = baseTicket({ items: [itemWith()] } as unknown as Partial<Ticket>);
    expect(firstItem(t).interested).toBe('');
    expect(firstItem(t).interestedPrice).toBe(0);
  });
});

/**
 * หมายเหตุแยกตามชนิดสินค้า and the ฟิล์มกันรอย tick list ride in the `extras`
 * jsonb under `__meta`, the same escape hatch `notes` and `qcPhotos` already
 * use. Nothing else on the round trip would notice if they were dropped here,
 * which is exactly how สินค้าที่สนใจ went missing for a whole trial run.
 */
const meta = (t: Ticket) =>
  serializeTicket(t, false).extras.__meta as {
    notesByCategory: Record<string, string>;
    wrapOptions: string[];
    qcAlbumUrl: string;
    qcBy: string;
  };

describe('serializeTicket — per-category notes and wrap options', () => {
  it('carries a note written against one ชนิดสินค้า', () => {
    const t = baseTicket({
      notesByCategory: { ฟิล์มกรองแสง: 'ลูกค้าขอเข้มพิเศษบานหน้า' },
    } as unknown as Partial<Ticket>);
    expect(meta(t).notesByCategory).toEqual({ ฟิล์มกรองแสง: 'ลูกค้าขอเข้มพิเศษบานหน้า' });
  });

  it('drops a note that was typed and then cleared', () => {
    const t = baseTicket({
      notesByCategory: { ฟิล์มกรองแสง: '   ', เครื่องเสียง: 'ถอดลำโพงเดิมเก็บไว้' },
    } as unknown as Partial<Ticket>);
    expect(meta(t).notesByCategory).toEqual({ เครื่องเสียง: 'ถอดลำโพงเดิมเก็บไว้' });
  });

  it('carries the ticked Option / รายการแถม entries', () => {
    const t = baseTicket({
      wrapOptions: ['แถม หน้าจอ', 'แกะ โลโก้'],
    } as unknown as Partial<Ticket>);
    expect(meta(t).wrapOptions).toEqual(['แถม หน้าจอ', 'แกะ โลโก้']);
  });

  it('sends empty containers rather than undefined for a ticket with neither', () => {
    expect(meta(baseTicket()).notesByCategory).toEqual({});
    expect(meta(baseTicket()).wrapOptions).toEqual([]);
  });

  it('carries the QC ผู้รับผิดชอบ, trimmed', () => {
    // The one name the ใบงานติดตั้ง, ใบเซอร์วิส and ใบเคลม all print.
    const t = baseTicket({ qcBy: '  คุณนิด  ' } as unknown as Partial<Ticket>);
    expect(meta(t).qcBy).toBe('คุณนิด');
    expect(meta(baseTicket()).qcBy).toBe('');
  });

  it('carries the external QC album link, trimmed', () => {
    const t = baseTicket({
      qcAlbumUrl: '  https://drive.google.com/drive/folders/abc123  ',
    } as unknown as Partial<Ticket>);
    expect(meta(t).qcAlbumUrl).toBe('https://drive.google.com/drive/folders/abc123');
    expect(meta(baseTicket()).qcAlbumUrl).toBe('');
  });
});

describe('serializeTicket — payment dates', () => {
  it('keeps the stored date instead of walking it back a day', () => {
    // `new Date(d + 'T00:00:00').toISOString()` reports local midnight in UTC,
    // which in Asia/Bangkok is 17:00 the day before — so every save moved each
    // payment one day earlier. Same defect the accounting dates had.
    const t = baseTicket({
      payments: [{ type: 'มัดจำ', method: 'เงินสด', amount: 1000, date: '2026-08-13' }],
    } as unknown as Partial<Ticket>);
    expect(serializeTicket(t, false).payments[0].paidAt).toBe('2026-08-13');
  });

  it('falls back to the local today, not the UTC one', () => {
    const t = baseTicket({
      payments: [{ type: 'มัดจำ', method: 'เงินสด', amount: 1000, date: '' }],
    } as unknown as Partial<Ticket>);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(serializeTicket(t, false).payments[0].paidAt).toBe(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );
  });
});

describe('serializeTicket — รายได้ / รับแทน', () => {
  it('sends the choice the counter made', () => {
    const t = baseTicket({ revenueKind: 'รับแทน' } as unknown as Partial<Ticket>);
    expect(serializeTicket(t, false).revenueKind).toBe('รับแทน');
  });

  it('treats a ticket that predates the choice as รายได้', () => {
    // Every ticket already in the database arrives without the field; none of
    // them may quietly stop counting as takings.
    expect(serializeTicket(baseTicket(), false).revenueKind).toBe('รายได้');
  });

  it('refuses anything that is not one of the two', () => {
    const t = baseTicket({ revenueKind: 'อย่างอื่น' } as unknown as Partial<Ticket>);
    expect(serializeTicket(t, false).revenueKind).toBe('รายได้');
  });
});
