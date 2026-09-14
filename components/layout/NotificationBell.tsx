'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  actionableAlerts,
  LEVEL_LABEL,
  LEVEL_ORDER,
  urgentItemIds,
  type AlertItem,
  type AlertLevel,
  type AlertSnapshot,
} from '@/lib/alerts/types';
import { fmtThaiDayString } from '@/lib/domain/format';

/**
 * การแจ้งเตือน — กระดิ่ง, หน้าต่างสรุปวันละครั้ง และแถบเรื่องด่วนใหม่.
 *
 * The three surfaces agreed with the shop (docs/DESIGN-notifications.md):
 *
 *   1. กระดิ่ง — always there, counting ด่วน + ต้องทำ. It replaces a bell whose
 *      red dot was hard-coded and lit whether or not anything was waiting, which
 *      is how people learn to ignore a red dot.
 *   2. หน้าต่างสรุป — on the first open of the day, only when this person has
 *      something to do. "รับทราบ · ซ่อนถึงพรุ่งนี้" hides it until tomorrow; if
 *      the work is still there tomorrow, so is the window. ไปดู or ปิด only put
 *      it away for this browser session.
 *   3. แถบด่วน — after acknowledging, an URGENT record that was not on screen at
 *      the time gets a small notice in the corner. New ต้องทำ items only move
 *      the count: interrupting somebody for routine work is how a window
 *      becomes something to click away.
 *
 * Refreshes when the page changes, when the tab comes back into view, and every
 * five minutes. Nothing here is decided in the browser; it only shows what the
 * server worked out.
 */

const REFRESH_MS = 5 * 60 * 1000;

const TONE: Record<AlertLevel, { fg: string; bg: string; icon: string }> = {
  urgent: { fg: '#B23A48', bg: '#FBEAEC', icon: 'fa-triangle-exclamation' },
  todo: { fg: '#8A5A12', bg: '#FBF1DA', icon: 'fa-list-check' },
  info: { fg: 'var(--ink-soft)', bg: 'var(--paper)', icon: 'fa-circle-info' },
};

const readSession = (key: string) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSession = (key: string, value: string) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private browsing: the window may reappear on the next page. Acceptable.
  }
};

export function NotificationBell({
  loadAction,
  ackAction,
}: {
  loadAction: () => Promise<AlertSnapshot>;
  ackAction: (urgentKeys: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<AlertSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [closedForSession, setClosedForSession] = useState(false);
  const [toast, setToast] = useState<AlertItem | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const next = await loadAction();
        if (!alive) return;
        setSnapshot(next);
        setClosedForSession(readSession(`alerts:closed:${next.today}`) === '1');
        if (next.ackedToday) {
          const seen = new Set(next.ackedKeys);
          const fresh = next.alerts.find(
            (a) => a.level === 'urgent' && a.itemIds.some((id) => !seen.has(id)),
          );
          if (fresh) {
            // Once per set of new records per session — a poll every five
            // minutes must not keep re-announcing the same cheque.
            const mark = `alerts:toast:${next.today}:${fresh.itemIds
              .filter((id) => !seen.has(id))
              .sort()
              .join('|')}`;
            if (readSession(mark) !== '1') {
              writeSession(mark, '1');
              setToast(fresh);
            }
          }
        }
      } catch {
        // A helper, not the page: a failed poll keeps the last known state.
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname, loadAction]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 15_000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const alerts = snapshot?.alerts ?? [];
  const actionable = actionableAlerts(alerts);
  const badge = actionable.reduce((n, a) => n + a.count, 0);
  const showDaily =
    !!snapshot && !snapshot.ackedToday && !closedForSession && actionable.length > 0;
  const urgentCount = alerts.filter((a) => a.level === 'urgent').reduce((n, a) => n + a.count, 0);
  const todoCount = alerts.filter((a) => a.level === 'todo').reduce((n, a) => n + a.count, 0);

  function closeForSession() {
    if (snapshot) writeSession(`alerts:closed:${snapshot.today}`, '1');
    setClosedForSession(true);
  }

  async function acknowledge() {
    if (!snapshot) return;
    setAcking(true);
    setAckError(null);
    const keys = urgentItemIds(alerts);
    try {
      const res = await ackAction(keys);
      if (!res.ok) {
        setAckError(res.error || 'บันทึกไม่สำเร็จ ลองอีกครั้ง');
        return;
      }
      setSnapshot({ ...snapshot, ackedToday: true, ackedKeys: keys });
    } catch {
      setAckError('บันทึกไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setAcking(false);
    }
  }

  const row = (a: AlertItem, onNavigate: () => void, compact = false) => (
    <Link
      key={a.key}
      href={a.href}
      onClick={onNavigate}
      className="flex items-start gap-2.5 px-3.5 py-2.5"
      style={{ borderTop: '1px solid var(--line)' }}
    >
      <i
        className={`fa-solid ${TONE[a.level].icon} text-xs mt-1`}
        style={{ color: TONE[a.level].fg }}
      ></i>
      <span className="flex-1 min-w-0">
        <span className="text-sm block" style={{ color: 'var(--ink)' }}>
          {a.title}
        </span>
        {!compact && a.examples.length > 0 && (
          <span className="text-xs block truncate" style={{ color: 'var(--ink-faint)' }}>
            {a.examples.join(', ')}
            {a.count > a.examples.length ? ' …' : ''}
          </span>
        )}
      </span>
      <span
        className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ background: TONE[a.level].bg, color: TONE[a.level].fg }}
      >
        {a.count}
      </span>
    </Link>
  );

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={badge > 0 ? `การแจ้งเตือน ${badge} เรื่อง` : 'การแจ้งเตือน'}
          className="icon-tile relative"
          style={{ background: 'var(--paper)' }}
        >
          <i className="fa-regular fa-bell text-sm" style={{ color: 'var(--ink-soft)' }} />
          {badge > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
              style={{
                background: urgentCount > 0 ? '#B23A48' : '#8A5A12',
                color: '#fff',
              }}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              className="absolute right-0 mt-2 z-50 card overflow-hidden"
              style={{ width: 'min(360px, 90vw)' }}
              role="menu"
            >
              <p className="text-sm font-semibold px-3.5 py-3">การแจ้งเตือน</p>
              {alerts.length === 0 ? (
                <p
                  className="text-sm px-3.5 pb-4"
                  style={{ color: 'var(--ink-faint)', borderTop: '1px solid var(--line)' }}
                >
                  <i className="fa-regular fa-circle-check mr-1.5"></i>
                  ไม่มีเรื่องที่ต้องจัดการตอนนี้
                </p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                  {LEVEL_ORDER.map((level) => {
                    const group = alerts.filter((a) => a.level === level);
                    if (group.length === 0) return null;
                    return (
                      <div key={level}>
                        <p
                          className="text-xs font-semibold px-3.5 pt-2.5 pb-1.5"
                          style={{ color: TONE[level].fg }}
                        >
                          {LEVEL_LABEL[level]}
                        </p>
                        {group.map((a) => row(a, () => setOpen(false)))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showDaily && snapshot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-alerts-title"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(20, 14, 12, 0.45)' }}
        >
          <div className="card w-full overflow-hidden" style={{ maxWidth: 480 }}>
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
              <div>
                <p id="daily-alerts-title" className="text-base font-bold">
                  สิ่งที่รอคุณวันนี้
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                  {fmtThaiDayString(snapshot.today)}
                  {urgentCount > 0 ? ` · ด่วน ${urgentCount}` : ''}
                  {todoCount > 0 ? ` · ต้องทำ ${todoCount}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForSession}
                aria-label="ปิดไว้ก่อน"
                className="text-sm px-2"
                style={{ color: 'var(--ink-soft)' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {actionable.map((a) => row(a, closeForSession, true))}
            </div>
            {ackError && (
              <p className="text-xs px-4 pt-2" style={{ color: '#B23A48' }} role="alert">
                {ackError}
              </p>
            )}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                รายการที่ยังค้าง จะขึ้นอีกพรุ่งนี้
              </span>
              <button
                type="button"
                onClick={acknowledge}
                disabled={acking}
                className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex-shrink-0"
              >
                รับทราบ · ซ่อนถึงพรุ่งนี้
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[55] card px-4 py-3 flex items-start gap-3"
          style={{ maxWidth: 360, borderLeft: `4px solid ${TONE.urgent.fg}` }}
        >
          <i
            className="fa-solid fa-triangle-exclamation mt-0.5"
            style={{ color: TONE.urgent.fg }}
          ></i>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: TONE.urgent.fg }}>
              มีเรื่องด่วนใหม่
            </p>
            <p className="text-sm">{toast.title}</p>
            <Link
              href={toast.href}
              onClick={() => setToast(null)}
              className="text-xs font-semibold"
              style={{ color: 'var(--primary)' }}
            >
              ไปดู ›
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="ปิดแถบแจ้งเตือน"
            className="text-sm"
            style={{ color: 'var(--ink-soft)' }}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}
    </>
  );
}
