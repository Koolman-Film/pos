import { describe, it, expect } from 'vitest';

import {
  diffLines,
  docHref,
  entitiesOf,
  flattenChange,
  formatValue,
  groupByTransaction,
  readEntry,
  type ActivityEntry,
} from '@/lib/domain/activity';

/**
 * ประวัติการใช้งาน (ร้านขอ 19 ก.ย. 2569) — "มีบางคนแก้ไขงานทับงานที่ถูกต้องแล้ว".
 *
 * The log stores column names and raw values; a history the shop cannot read
 * answers nothing. These pin the reading: labels, values, and above all that a
 * collection rewritten on every save reads as what actually moved.
 */

describe('formatValue', () => {
  it('reads money, dates and blanks the way the rest of the app does', () => {
    expect(formatValue(6500, 'amount')).toBe('6,500.00');
    expect(formatValue('4400', 'amount')).toBe('4,400.00');
    expect(formatValue('2026-09-18')).toBe('18 ก.ย. 2569');
    expect(formatValue('')).toBe('—');
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('ใช่');
  });

  it('reads a ตำแหน่ง as a place and a product, not three fields', () => {
    expect(formatValue([{ position: 'หน้า', product: 'ฟิล์ม X', price: 1000 }])).toBe(
      'หน้า: ฟิล์ม X (1,000.00)',
    );
  });
});

describe('flattenChange', () => {
  it('labels a column in Thai', () => {
    expect(flattenChange('color', 'ขาว', 'แดง')).toEqual([
      { path: 'สี', before: 'ขาว', after: 'แดง' },
    ]);
  });

  it('walks into a jsonb column and names only the part that changed', () => {
    const before = { Service: { checked: true, serviceCount: 6 }, Tint: { checked: true } };
    const after = { Service: { checked: true, serviceCount: 12 }, Tint: { checked: true } };
    expect(flattenChange('extras', before, after)).toEqual([
      { path: 'ข้อมูลเพิ่มเติม › Service › serviceCount', before: '6', after: '12' },
    ]);
  });
});

describe('diffLines — a collection rewritten on every save', () => {
  const pay = (uid: string, amount: number, paid_at = '2026-09-18') => ({
    uid,
    type: 'มัดจำ',
    method: 'เงินสด',
    amount,
    paid_at,
    slips: 0,
  });

  it('reads one payment amount changed as exactly that', () => {
    const lines = diffLines(
      'payments',
      [pay('p1', 2000), pay('p2', 4400)],
      [pay('p1', 2000), pay('p2', 4500)],
    );
    expect(lines).toEqual([
      {
        kind: 'changed',
        label: 'มัดจำ เงินสด 4,500.00',
        fields: [{ path: 'จำนวนเงิน', before: '4,400.00', after: '4,500.00' }],
      },
    ]);
  });

  it('matches payments on their key even when the order moved', () => {
    const lines = diffLines(
      'payments',
      [pay('p1', 2000), pay('p2', 4400)],
      [pay('p2', 4400, '2026-09-10'), pay('p1', 2000)],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'changed',
      fields: [{ path: 'วันที่จ่าย/รับเงิน', before: '18 ก.ย. 2569', after: '10 ก.ย. 2569' }],
    });
  });

  it('says a payment was removed, and which', () => {
    const lines = diffLines('payments', [pay('p1', 2000), pay('p2', 4400)], [pay('p1', 2000)]);
    expect(lines).toEqual([
      expect.objectContaining({ kind: 'removed', label: 'มัดจำ เงินสด 4,400.00' }),
    ]);
  });

  it('pairs ticket lines that have no key by what is left, so an edit reads as an edit', () => {
    const item = (sold: string, sold_price: number) => ({
      category: 'ฟิล์มกรองแสง',
      sold,
      sold_price,
      positions: [],
    });
    const lines = diffLines(
      'items',
      [item('3M Crystalline', 12000), item('Lamina', 6000)],
      [item('3M Crystalline', 12000), item('Lamina', 5500)],
    );
    expect(lines).toEqual([
      {
        kind: 'changed',
        label: 'Lamina',
        fields: [{ path: 'ราคาขาย', before: '6,000.00', after: '5,500.00' }],
      },
    ]);
  });

  it('reports nothing for a save that changed nothing', () => {
    expect(diffLines('payments', [pay('p1', 2000)], [pay('p1', 2000)])).toEqual([]);
  });

  it('reads a new ticket’s first lines as additions', () => {
    expect(diffLines('payments', null, [pay('p1', 2000)])).toEqual([
      expect.objectContaining({ kind: 'added', label: 'มัดจำ เงินสด 2,000.00' }),
    ]);
  });
});

describe('readEntry', () => {
  it('reads an edit as fields before and after', () => {
    const r = readEntry({ entity: 'tickets', action: 'แก้ไข', changes: { color: ['ขาว', 'แดง'] } });
    expect(r).toEqual({ shape: 'fields', fields: [{ path: 'สี', before: 'ขาว', after: 'แดง' }] });
  });

  it('reads a deleted row as what it held, without the bookkeeping', () => {
    const r = readEntry({
      entity: 'expenses',
      action: 'ลบ',
      changes: {
        id: 7,
        description: 'ค่าไฟ',
        amount: 1200,
        created_at: '2026-09-01T00:00:00Z',
        note: '',
      },
    });
    expect(r).toEqual({
      shape: 'snapshot',
      fields: [
        { label: 'รายการ', value: 'ค่าไฟ' },
        { label: 'จำนวนเงิน', value: '1,200.00' },
      ],
    });
  });

  it('reads a lines entry part by part', () => {
    const r = readEntry({
      entity: 'ticket_lines',
      action: 'แก้ไข',
      changes: { payments: [[{ uid: 'p1', amount: 1 }], [{ uid: 'p1', amount: 2 }]] },
    });
    expect(r.shape).toBe('lines');
    if (r.shape === 'lines') expect(r.parts[0].label).toBe('การรับเงิน');
  });
});

describe('where a document opens', () => {
  it('sends ticket-side entries to the ticket, PO entries to the PO', () => {
    expect(docHref('ticket_lines', 'JT-CM-00214')).toBe('/tickets/JT-CM-00214');
    expect(docHref('service_visits', 'JT-CM-00214')).toBe('/tickets/JT-CM-00214');
    expect(docHref('orders', 'WS-NT-0001')).toBe('/wholesale/WS-NT-0001');
    expect(docHref('expenses', 'POS-CM-6909003')).toBeNull();
  });

  it('files the service and insurance tables under one module', () => {
    expect(entitiesOf('ประกัน/เซอร์วิส')).toEqual(
      expect.arrayContaining(['service_visits', 'service_visit_lines', 'insurance_claims']),
    );
  });
});

describe('groupByTransaction', () => {
  const e = (id: number, tx: number, actorName = 'พนักงานขาย'): ActivityEntry => ({
    id,
    at: '2026-09-21T03:00:00Z',
    tx,
    actorName,
    shop: 'cm',
    entity: 'tickets',
    recordId: 'JT-1',
    docRef: 'JT-1',
    action: 'แก้ไข',
    changes: {},
  });

  it('keeps one save together and splits separate saves', () => {
    const groups = groupByTransaction([e(3, 10), e(2, 10), e(1, 9)]);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([[3, 2], [1]]);
  });
});
