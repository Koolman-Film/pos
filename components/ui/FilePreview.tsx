'use client';

import { createPortal } from 'react-dom';

import { useIsMounted } from '@/lib/hooks/useIsMounted';

/**
 * Full-screen look at one stored attachment — a receipt, a transfer slip, a QC
 * photo. Checking one against a figure is a two-second glance, so it opens in
 * place instead of downloading; the "เปิดแท็บใหม่" link is there for anyone who
 * does want the file itself.
 *
 * `url` is always a short-lived signed URL: every bucket here is private, and
 * the link is minted per click by a Server Action rather than stored anywhere.
 */
export function FilePreview({
  url,
  fileName,
  mimeType = '',
  onClose,
}: {
  url: string;
  fileName: string;
  mimeType?: string;
  onClose: () => void;
}) {
  const mounted = useIsMounted();
  if (!mounted) return null;

  const isPdf = /\.pdf$/i.test(fileName) || mimeType === 'application/pdf';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ไฟล์แนบ ${fileName}`}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface)', maxWidth: 900, width: '100%', height: '90vh' }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <p className="text-sm font-semibold truncate">{fileName}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-xs px-3 py-1.5 rounded-lg font-medium"
            >
              เปิดแท็บใหม่
            </a>
            <button
              onClick={onClose}
              aria-label="ปิดหน้าต่างดูไฟล์แนบ"
              className="btn-outline text-xs px-3 py-1.5 rounded-lg font-medium"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto" style={{ background: '#333' }}>
          {isPdf ? (
            <object data={url} type="application/pdf" style={{ width: '100%', height: '100%' }}>
              {/* Rendered only when the browser has no built-in PDF viewer, so a
                  document is never a dead end. */}
              <div className="p-6 text-center text-sm" style={{ color: '#fff' }}>
                <p className="mb-3">เบราว์เซอร์นี้เปิด PDF ในหน้าต่างนี้ไม่ได้</p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary px-4 py-2 rounded-xl font-semibold"
                >
                  เปิด {fileName} ในแท็บใหม่
                </a>
              </div>
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={fileName}
              style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
