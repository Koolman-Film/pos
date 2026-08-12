'use client';

import { useState } from 'react';

import { FilePreview } from '@/components/ui/FilePreview';
import { discardAttachments, fileNameFromPath, uploadAttachments } from '@/lib/storage/attachments';

const BUCKET = 'ticket-attachments';

/**
 * The file field used by the ticket's two attachment points — the transfer slip
 * on a payment row and the QC photos before installation.
 *
 * Files upload the moment they are picked, not on save: the chips have to show
 * something real straight away, and a slip photographed on a phone is far too
 * big to travel through a Server Action body. What the ticket stores is the
 * resulting storage PATH, which is what `serializeTicket` sends on.
 *
 * Removing a chip deletes the object as well, so picking the wrong file and
 * taking it off again does not leave litter in the bucket. A file that was
 * already saved on the ticket is only detached from the row — the object stays
 * until the ticket itself is saved without it, which is the same thing the
 * expense receipts do.
 */
export function AttachmentField({
  label,
  paths,
  onChange,
  folder,
  urlAction,
  accept = 'image/*,.pdf',
  emptyHint,
}: {
  label: string;
  /** Storage paths already on the ticket. */
  paths: string[];
  onChange: (paths: string[]) => void;
  /** Bucket folder — the shop id, so objects sort by branch. */
  folder: string;
  urlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  accept?: string;
  emptyHint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  // Only what THIS session uploaded may be deleted from storage on removal; a
  // path that arrived with the ticket might be referenced by a saved row.
  const [uploadedNow, setUploadedNow] = useState<string[]>([]);

  async function add(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const stored = await uploadAttachments(BUCKET, folder || 'unknown', files);
      const added = stored.map((s) => s.path);
      setUploadedNow((prev) => [...prev, ...added]);
      onChange([...paths, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function remove(path: string) {
    onChange(paths.filter((p) => p !== path));
    if (uploadedNow.includes(path)) {
      setUploadedNow((prev) => prev.filter((p) => p !== path));
      void discardAttachments(BUCKET, [path]);
    }
  }

  async function open(path: string) {
    if (!urlAction) return;
    setOpeningPath(path);
    try {
      const res = await urlAction(path);
      if (res.url) setPreview({ url: res.url, fileName: fileNameFromPath(path) });
      else setError(res.error || 'เปิดไฟล์ไม่สำเร็จ');
    } finally {
      setOpeningPath(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs flex items-center gap-1.5 flex-1 field px-2.5 py-1.5 cursor-pointer"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-paperclip'}`}></i>
        {busy ? 'กำลังอัปโหลด...' : label}
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            void add(files);
          }}
        />
      </label>

      {error && (
        <p className="text-xs" style={{ color: '#B23A48' }} role="alert">
          {error}
        </p>
      )}

      {paths.length === 0 && emptyHint && (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          {emptyHint}
        </p>
      )}

      {paths.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {paths.map((path) => (
            <span
              key={path}
              className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
              style={{ background: 'var(--paper)', color: '#4C7A3E' }}
            >
              <button
                type="button"
                onClick={() => open(path)}
                className="flex items-center gap-1.5"
                title={`ดู ${fileNameFromPath(path)}`}
              >
                <i
                  className={`fa-solid ${
                    openingPath === path ? 'fa-spinner fa-spin' : 'fa-circle-check'
                  }`}
                ></i>
                <span className="truncate" style={{ maxWidth: 160 }}>
                  {fileNameFromPath(path)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(path)}
                aria-label={`เอา ${fileNameFromPath(path)} ออก`}
                style={{ color: '#B23A48' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </span>
          ))}
        </div>
      )}

      {preview && (
        <FilePreview
          url={preview.url}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
