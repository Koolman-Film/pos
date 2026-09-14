/**
 * Hands the browser a file a Server Action built.
 *
 * Exports are produced on the server — where the capability is checked and the
 * figures are recomputed rather than taken from the page — and come back as
 * base64, because a Server Action returns data, not a download. This turns that
 * back into a file. Shared by the expense export and the account ledger, which
 * had begun to grow a copy each.
 */
export function downloadBase64(
  base64: string,
  fileName: string,
  mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
