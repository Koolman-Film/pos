import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MultiSelectFilter } from '@/components/ui/MultiSelectFilter';

const STATUSES = ['รอ EDC ก่อนติดตั้ง', 'รอการติดตั้ง', 'เสร็จสิ้น'];

function Harness({ options = STATUSES }: { options?: string[] }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <MultiSelectFilter
      ariaLabel="กรองตามสถานะงาน"
      label="ทุกสถานะ"
      unit="สถานะ"
      options={options}
      values={values}
      onChange={setValues}
    />
  );
}

/** กล่องที่กางออกมา — หาเจอจากปุ่มที่คุมมันอยู่ ไม่ต้องรู้ชื่อ id ที่ React ตั้งให้ */
function panelOf(button: HTMLElement) {
  const id = button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const el = document.getElementById(id!);
  expect(el).not.toBeNull();
  return el!;
}

describe('MultiSelectFilter', () => {
  it('เลือกหลายค่าได้ และปุ่มสรุปด้วยหน่วยที่ส่งมา', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'กรองตามสถานะงาน' });
    expect(button).toHaveTextContent('ทุกสถานะ');

    await user.click(button);
    await user.click(screen.getByRole('checkbox', { name: 'รอการติดตั้ง' }));
    // ค่าเดียวบอกชื่อไปเลย อ่านง่ายกว่า "1 สถานะ"
    expect(button).toHaveTextContent('รอการติดตั้ง');

    await user.click(screen.getByRole('checkbox', { name: 'เสร็จสิ้น' }));
    expect(button).toHaveTextContent('2 สถานะ');

    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(button).toHaveTextContent('ทุกสถานะ');
  });

  it('ค่าที่เลือกไว้แต่หายไปจากรายการ ยังอยู่ให้ติ๊กออกได้', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'กรองตามสถานะงาน' }));
    await user.click(screen.getByRole('checkbox', { name: 'เสร็จสิ้น' }));
    // ตารางถูกกรองจนไม่เหลือแถวของสถานะนั้น ตัวกรองต้องไม่คลายตัวเอง
    rerender(<Harness options={['รอการติดตั้ง']} />);
    expect(screen.getByRole('button', { name: 'กรองตามสถานะงาน' })).toHaveTextContent('เสร็จสิ้น');
  });
});

/**
 * กล่องต้องอยู่ในพื้นที่อ่านได้ (ร้านเจอ 6 ต.ค. 2569).
 *
 * กล่องกางจากขอบขวาของปุ่ม คือกางไปทางซ้าย ซึ่งถูกเมื่อตัวกรองอยู่ขวามือ แต่ใน
 * โมดูลรายได้ปุ่มตัวแรกอยู่ชิดซ้ายของการ์ด และชื่อสถานะยาว กล่องจึงยื่นไปนอนใต้
 * แถบเมนูจนอ่านชื่อสถานะไม่ครบ
 */
describe('MultiSelectFilter — กล่องต้องไม่ตกขอบ', () => {
  const rect = (left: number, right: number) =>
    ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 }) as DOMRect;

  it('ยื่นไปใต้แถบเมนู ถูกเลื่อนกลับเข้าคอลัมน์เนื้อหา', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        // แถบเมนูกว้าง 256 — เนื้อหาเริ่มที่ 256 ส่วนกล่องกางไปอยู่ที่ 70
        return this.tagName === 'MAIN' ? rect(256, 1000) : rect(70, 390);
      });
    try {
      render(
        <main>
          <Harness />
        </main>,
      );
      const button = screen.getByRole('button', { name: 'กรองตามสถานะงาน' });
      await user.click(button);
      // 70 + 194 = 264 — ขอบซ้ายของเนื้อหา บวกระยะขอบที่เผื่อไว้
      expect(panelOf(button).style.transform).toBe('translateX(194px)');
    } finally {
      spy.mockRestore();
    }
  });

  it('อยู่ในคอลัมน์อยู่แล้ว ไม่ต้องเลื่อน', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'MAIN' ? rect(256, 1000) : rect(600, 920);
      });
    try {
      render(
        <main>
          <Harness />
        </main>,
      );
      const button = screen.getByRole('button', { name: 'กรองตามสถานะงาน' });
      await user.click(button);
      expect(panelOf(button).style.transform).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});
