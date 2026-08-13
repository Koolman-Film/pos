import { createClient } from '@/lib/supabase/client';

/**
 * Browser-side upload into one of the private attachment buckets.
 *
 * The upload runs from the browser, not through a Server Action: an action's
 * request body is capped (1 MB by default) and a phone photo of a slip or a QC
 * shot routinely exceeds that. Only the resulting PATH travels through the
 * action afterwards. Storage RLS re-checks the caller on the way in, so this is
 * not a hole — the bucket policies are the gate (migrations 0014 and 0018).
 *
 * Shared by the expense receipts and the ticket's slips/QC photos, which had
 * grown identical copies of this loop.
 */

export type StoredFile = {
  /** Key within the bucket, e.g. `cm/9f2c…-slip.jpg`. */
  path: string;
  /** The original filename — storage keys are ASCII-safe, this is not. */
  fileName: string;
  mimeType: string;
  size: number;
};

/**
 * Uploads every file and returns their stored identities, in order.
 *
 * Throws on the first failure, naming the file — a half-finished set that the
 * caller cannot tell apart from a complete one is worse than an error message.
 */
export async function uploadAttachments(
  bucket: string,
  folder: string,
  files: File[],
): Promise<StoredFile[]> {
  if (files.length === 0) return [];
  const supabase = createClient();
  const stored: StoredFile[] = [];

  for (const file of files) {
    // Storage keys stay ASCII; a Thai filename survives in `fileName`.
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
    const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) throw new Error(`อัปโหลด "${file.name}" ไม่สำเร็จ — ${error.message}`);
    stored.push({ path, fileName: file.name, mimeType: file.type, size: file.size });
  }
  return stored;
}

/**
 * Removes objects that were uploaded but never committed — the user picked the
 * wrong file and took it off the form again. Failure is ignored on purpose: an
 * orphaned object is litter, not a reason to interrupt what they were doing.
 */
export async function discardAttachments(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await createClient().storage.from(bucket).remove(paths);
  } catch {
    // Deliberately silent — see above.
  }
}

/** The display name carried in a stored path (`<uuid>-<name>` after the folder). */
export function fileNameFromPath(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/^[0-9a-f-]{36}-/i, '');
}
