'use client';

import { useEffect } from 'react';

/**
 * "บันทึกแล้ว" — a message that appears, is read, and goes away.
 *
 * Saving a ใบงาน used to close it and drop you back on the list, so the only
 * way to confirm the save had worked was that the page had changed. That cost
 * the shop the thing it was working on: after every save somebody had to find
 * the same job again to carry on with it, and a long list makes that a search.
 *
 * The page now stays where it is, and this says the save happened. Deliberately
 * NOT a dialog with a button: a confirmation that has to be dismissed is a
 * second click for something the user already knows the answer to.
 *
 * Printing a sheet straight after saving is normal here, and the toast must
 * not land on the paper. It does not: it renders inside `.app-shell`, which
 * `@media print` hides (app/globals.css).
 */
export function SavedToast({
  message,
  onDone,
  ms = 2600,
}: {
  /** Null hides it. Changing the text re-shows it, so a second save re-fires. */
  message: string | null;
  onDone: () => void;
  ms?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [message, ms, onDone]);

  if (!message) return null;

  return (
    <div
      // `status`, not `alert`: a save that worked is not an interruption, and
      // an assertive live region would cut off whatever is being read.
      role="status"
      aria-live="polite"
      className="fixed left-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
      style={{
        // Bottom-centre, above the content and clear of the sidebar, so it does
        // not cover the row that was just saved.
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 60,
        background: '#2F4F2A',
        color: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
      }}
    >
      <i className="fa-solid fa-circle-check"></i>
      {message}
    </div>
  );
}
