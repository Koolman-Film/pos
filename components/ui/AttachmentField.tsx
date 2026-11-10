'use client';

import { useState } from 'react';

import { AttachmentLinks } from '@/components/ui/AttachmentLinks';
import { discardAttachments, uploadAttachments } from '@/lib/storage/attachments';

/**
 * The file field behind every "แนบ..." box in the app — the transfer slip on a
 * payment row, the QC photos before installation, and the PO's own evidence.
 *
 * Files upload the moment they are picked, not on save: the chips have to show
 * something real straight away, and a slip photographed on a phone is far too
 * big to travel through a Server Action body. What the record stores is the
 * resulting storage PATH, which is what the serializer sends on.
 *
 * Removing a chip deletes the object as well, so picking the wrong file and
 * taking it off again does not leave litter in the bucket. A file that was
 * already saved on the record is only detached from the row — the object stays
 * until the record itself is saved without it, which is the same thing the
 * expense receipts do.
 *
 * `bucket` is a prop rather than a constant because ขายส่ง keeps its evidence
 * in its own bucket, gated by the wholesale nav instead of the ticket one
 * (migration 0055). Everything else about attaching a file is identical, and
 * the copy that ขายส่ง had grown separately was the broken one — it held the
 * FILENAME in form state and uploaded nothing, so the slip was gone on reload
 * (0086).
 */
export function AttachmentField({
  label,
  paths,
  onChange,
  folder,
  urlAction,
  bucket = 'ticket-attachments',
  accept = 'image/*,.pdf',
  emptyHint,
}: {
  label: string;
  /** Storage paths already on the record. */
  paths: string[];
  onChange: (paths: string[]) => void;
  /** Bucket folder — the shop id, so objects sort by branch. */
  folder: string;
  urlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  /** Which private bucket these files live in. */
  bucket?: string;
  accept?: string;
  emptyHint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only what THIS session uploaded may be deleted from storage on removal; a
  // path that arrived with the record might be referenced by a saved row.
  const [uploadedNow, setUploadedNow] = useState<string[]>([]);

  async function add(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const stored = await uploadAttachments(bucket, folder || 'unknown', files);
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
      void discardAttachments(bucket, [path]);
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

      {/* ชิปที่กดดูไฟล์ได้ — ตัวเดียวกับที่ใช้แสดงไฟล์ในที่ที่แก้ไม่ได้ */}
      <AttachmentLinks paths={paths} urlAction={urlAction} variant="chip" onRemove={remove} />
    </div>
  );
}
