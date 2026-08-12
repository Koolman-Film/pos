'use client';

import type { Ticket } from '../types';

/**
 * หมายเหตุ — one ticket-wide box, plus one box per ชนิดสินค้า on the ticket.
 *
 * ใบงานติดตั้ง prints a separate page for each category, so a single shared note
 * meant the film instructions were printed on the audio technician's sheet as
 * well. The per-category boxes appear only for categories this ticket actually
 * carries: an empty box for a category nobody sold is a field to skip past.
 */
export function NotesSection({
  t,
  setNote,
  setCategoryNote,
}: {
  t: Ticket;
  setNote: (v: string) => void;
  setCategoryNote: (category: string, v: string) => void;
}) {
  const categories = [...new Set(t.items.map((i) => i.category).filter(Boolean))];

  return (
    <div className="mb-5">
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink-soft)' }}>
        หมายเหตุ (พิมพ์ในใบงานทุกใบ)
      </label>
      <textarea
        value={t.notes || ''}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ข้อมูลสำคัญที่ต้องการบันทึกไว้..."
        rows={2}
        className="field w-full text-sm px-3 py-2"
        style={{ resize: 'vertical' }}
      />

      {categories.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>
            <i className="fa-solid fa-note-sticky mr-1.5"></i>หมายเหตุแยกตามชนิดสินค้า
            <span className="ml-1" style={{ color: 'var(--ink-faint)' }}>
              (พิมพ์เฉพาะในใบงานติดตั้งของชนิดนั้น)
            </span>
          </p>
          {categories.map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <label className="text-xs block mb-1" style={{ color: 'var(--ink-faint)' }}>
                {cat}
              </label>
              <textarea
                value={t.notesByCategory?.[cat] ?? ''}
                onChange={(e) => setCategoryNote(cat, e.target.value)}
                aria-label={`หมายเหตุสำหรับ ${cat}`}
                placeholder={`หมายเหตุเฉพาะงาน ${cat}...`}
                rows={2}
                className="field w-full text-sm px-3 py-2"
                style={{ resize: 'vertical' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
