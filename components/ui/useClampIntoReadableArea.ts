'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * เลื่อนกล่องที่ลอยอยู่ กลับเข้า "พื้นที่อ่านได้" หลังจากที่มันกางออกมาแล้ว.
 *
 * วัดจากของจริงแทนที่จะเดาจากตำแหน่งตอนเขียนโค้ด เพราะตัวที่เปิดกล่องตัวเดียวกัน
 * อยู่คนละที่บนจอคอมกับจอมือถือ และการ์ดสรุปกับแถวในตารางก็ชิดคนละด้านกัน
 *
 * พื้นที่อ่านได้คือ `<main>` ตัดกับขอบหน้าต่าง ไม่ใช่ขอบหน้าต่างอย่างเดียว —
 * ครั้งแรกผมหนีบไว้กับหน้าต่าง กล่องเลยผ่านด่าน "อยู่ในจอ" ทั้งที่ไปนอนอยู่ใต้
 * แถบเมนูที่ลอยทับซ้ายมืออยู่ อ่านไม่ได้เหมือนเดิม (ร้านเจอซ้ำ 2 ต.ค. 2569)
 * ส่วนขอบหน้าต่างก็ยังต้องนับ เพราะเมื่อจอแคบกว่าความกว้างของ `<main>` ตัวมันเอง
 * ล้นออกไปนอกจอ
 *
 * ตัวฮุกนี้จัดการแค่ "เลื่อนให้พ้นขอบ" — กล่องต้องแคบพอจะอยู่ในพื้นที่นั้นได้
 * เองด้วย (`maxWidth` ของมัน) เพราะถ้ากว้างเกินกว่าช่องว่างที่มี ไม่ว่าจะเลื่อน
 * ไปทางไหนก็ยังมีด้านที่ตกขอบอยู่ดี
 *
 * @param revision ค่าที่เปลี่ยนเมื่อเนื้อในกล่องเปลี่ยนขนาด เช่น จำนวนรายการ
 */
export function useClampIntoReadableArea(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  revision: unknown,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    /*
      ล้างการเลื่อนออกก่อนวัด แล้วคำนวณรอบเดียวจบ.

      ถ้าวัดทั้งที่ยังเลื่อนอยู่ ต้องลบค่าที่เลื่อนไว้ออกเอง ซึ่งแปลว่าผลลัพธ์
      ขึ้นกับว่าค่าที่วัดได้สะท้อน transform แล้วจริงไหม — จริงบนเบราว์เซอร์
      แต่ไม่จริงใน jsdom และ effect ที่ป้อนค่าตัวเองกลับเข้าไปแบบนั้นวนไม่รู้จบ
      เมื่อสมมติฐานพัง (เจอตอนเขียนเทสต์) วัดจากศูนย์เสมอจึงไม่มีทางวน
    */
    el.style.transform = '';
    const box = el.getBoundingClientRect();
    const margin = 8;
    const column = el.closest('main')?.getBoundingClientRect();
    const minLeft = Math.max(column ? column.left : 0, 0) + margin;
    const maxRight =
      Math.min(column ? column.right : window.innerWidth, window.innerWidth) - margin;
    let next = 0;
    // ชิดซ้ายก่อน: ถ้าแคบจนเลือกได้ด้านเดียว ด้านที่ต้องเห็นคือด้านที่มีชื่อรายการ
    if (box.left < minLeft) next = minLeft - box.left;
    else if (box.right > maxRight) next = Math.max(maxRight - box.right, minLeft - box.left);
    // เขียนลงโหนดตรง ๆ ไม่เก็บเป็น state: ค่านี้ไม่มีใครอ่านนอกจากตัวกล่องเอง
    // และกล่องถูกถอดออกตอนปิดอยู่แล้ว จึงไม่มีอะไรต้องรีเซ็ต
    if (next) el.style.transform = `translateX(${next}px)`;
  }, [ref, open, revision]);
}
