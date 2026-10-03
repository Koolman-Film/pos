'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * ตัวกรองที่เลือกได้หลายค่าพร้อมกัน.
 *
 * `<select multiple>` ของเบราว์เซอร์ตอบโจทย์นี้บนกระดาษ แต่บนเครื่องจริงมันคือ
 * กล่องสูงที่กินที่ในแถวตัวกรอง และต้องกด Ctrl ค้างไว้ถึงจะเลือกหลายค่าได้ ซึ่ง
 * ไม่มีอะไรบนหน้าจอบอก คนที่ไม่รู้จะเลือกได้ทีละค่าเดียวตลอดไป
 *
 * ตัวนี้จึงเป็นปุ่มที่บอกสรุปว่าเลือกอะไรไว้ กดแล้วกางรายการติ๊ก — กว้างเท่า
 * ตัวกรองอื่นในแถวเดียวกัน และเลือกหลายค่าได้โดยไม่ต้องรู้ทางลัดอะไร
 *
 * ไม่มีค่าไหนถูกเลือก = ไม่กรอง ซึ่งเป็นคนละเรื่องกับ "เลือกครบทุกค่า" ในทาง
 * ตรรกะ แต่ให้ผลเหมือนกันบนตาราง และเป็นสภาพที่คนอ่านเข้าใจได้ทันทีว่าแปลว่า
 * ยังไม่ได้กรองอะไร
 */
export function MultiSelectFilter({
  label,
  unit,
  options,
  values,
  onChange,
  ariaLabel,
}: {
  /** คำที่ขึ้นบนปุ่มเมื่อยังไม่ได้เลือกอะไร เช่น "ทุกสถานะ". */
  label: string;
  /**
   * หน่วยของสิ่งที่เลือก ใช้ตอนสรุปว่า "2 สถานะ" / "2 ช่องทาง".
   *
   * เคยเขียนคำว่า "สถานะ" ไว้ในคอมโพเนนต์ตรง ๆ เพราะตัวกรองแรกที่ใช้มันคือ
   * ตัวกรองสถานะ พอมีตัวที่สองคำนั้นก็ติดไปด้วย แล้วปุ่มจองผ่านก็ขึ้นว่า
   * "2 สถานะ"
   */
  unit: string;
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // ปิดเมื่อคลิกข้างนอก — แบบเดียวกับ SearchableSelect ที่อยู่บนฟอร์มเดียวกัน
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /*
    ค่าที่เลือกไว้แต่หายไปจากรายการ ยังนับว่าเลือกอยู่.

    ตารางที่ถูกกรองอยู่อาจไม่เหลือแถวของค่านั้นแล้ว ถ้าตัดทิ้งเงียบ ๆ ตัวกรอง
    จะคลายตัวเองโดยที่คนใช้ไม่ได้สั่ง
  */
  const shown = [...new Set([...options, ...values])];

  const summary =
    values.length === 0 ? label : values.length === 1 ? values[0] : `${values.length} ${unit}`;

  const toggle = (o: string) =>
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="field text-xs px-2.5 py-1.5 flex items-center gap-2"
        style={{ fontWeight: values.length > 0 ? 600 : 400 }}
      >
        <span className="truncate" style={{ maxWidth: '12rem' }}>
          {summary}
        </span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-[10px]`}></i>
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 mt-1 rounded-xl p-2 z-20"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            minWidth: '13rem',
            maxHeight: '18rem',
            overflowY: 'auto',
          }}
        >
          {shown.length === 0 && (
            <p className="text-xs px-2 py-1" style={{ color: 'var(--ink-faint)' }}>
              ไม่มี{unit}ให้เลือก
            </p>
          )}
          {shown.map((o) => (
            <label
              key={o}
              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg cursor-pointer"
              style={{ whiteSpace: 'nowrap' }}
            >
              <input type="checkbox" checked={values.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs px-2 py-1.5 mt-1 w-full text-left rounded-lg"
              style={{ color: 'var(--primary)', borderTop: '1px solid var(--line)' }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      )}
    </div>
  );
}
