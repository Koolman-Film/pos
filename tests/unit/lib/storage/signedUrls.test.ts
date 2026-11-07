import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { cachedSignedUrl, resetSignedUrlCache, signedUrl } from '@/lib/storage/signedUrls';

/**
 * ลิงก์ที่เซ็นแล้วถูกใช้สองทางตั้งแต่มีการ์ดชี้ดู — ชี้ แล้วกด ไฟล์เดียวกัน
 * จึงถูกขอซ้ำได้ง่ายมาก และลิงก์มีอายุแค่หนึ่งนาที
 */

const PATH = 'cm/3f2504e0-4f89-41d3-9a0c-0305e82c3301-slip.jpg';

beforeEach(() => resetSignedUrlCache());
afterEach(() => vi.useRealTimers());

describe('signedUrl', () => {
  it('ขอรอบเดียวแล้วใช้เส้นเดิม', async () => {
    const action = vi.fn(async () => ({ url: 'https://signed.example/a.jpg' }));

    expect(await signedUrl(PATH, action)).toEqual({ url: 'https://signed.example/a.jpg' });
    expect(await signedUrl(PATH, action)).toEqual({ url: 'https://signed.example/a.jpg' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('สองคำขอพร้อมกันรอคำขอเดียวกัน', async () => {
    // ชี้เมาส์แล้วกดทันที — คำขอแรกยังวิ่งอยู่ตอนคำขอที่สองเกิด
    let release!: (v: { url: string }) => void;
    const action = vi.fn(() => new Promise<{ url: string }>((r) => (release = r)));

    const a = signedUrl(PATH, action);
    const b = signedUrl(PATH, action);
    release({ url: 'https://signed.example/a.jpg' });

    expect(await a).toEqual({ url: 'https://signed.example/a.jpg' });
    expect(await b).toEqual({ url: 'https://signed.example/a.jpg' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('เส้นที่ใกล้หมดอายุถูกทิ้ง แล้วขอใหม่', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ url: 'https://signed.example/first.jpg' })
      .mockResolvedValueOnce({ url: 'https://signed.example/second.jpg' });

    vi.useFakeTimers();
    await signedUrl(PATH, action);
    // อายุจริง 60 วิ แคชปล่อยที่ 40 วิ — 41 วิจึงต้องเป็นเส้นใหม่
    vi.advanceTimersByTime(41_000);

    expect(cachedSignedUrl(PATH)).toBeNull();
    expect(await signedUrl(PATH, action)).toEqual({ url: 'https://signed.example/second.jpg' });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('คำขอที่ล้มเหลวไม่ถูกจำไว้ — ชี้ใหม่ต้องได้ลองใหม่', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ error: 'ไม่มีสิทธิ์' })
      .mockResolvedValueOnce({ url: 'https://signed.example/ok.jpg' });

    expect(await signedUrl(PATH, action)).toEqual({ error: 'ไม่มีสิทธิ์' });
    expect(await signedUrl(PATH, action)).toEqual({ url: 'https://signed.example/ok.jpg' });
  });

  it('action ที่ระเบิด กลายเป็นข้อความผิดพลาด ไม่ใช่ error ที่หลุดออกไป', async () => {
    // การ์ดชี้ดูไม่มี try/catch ของตัวเอง — มันเกิดระหว่างเลื่อนเมาส์เฉย ๆ
    const action = vi.fn(async () => {
      throw new Error('เครือข่ายล่ม');
    });

    expect(await signedUrl(PATH, action)).toEqual({ error: 'เครือข่ายล่ม' });
  });
});
