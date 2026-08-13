/**
 * Shrink a printed page so it stops spilling onto a second sheet.
 *
 * A ticket with three products, per-category notes and a long extras block
 * overflowed A4 by a few centimetres — and the second sheet carried nothing but
 * the signature boxes. The shop's answer was to reprint at 90% from the browser
 * dialog every time, which is a step nobody remembers under pressure.
 *
 * The measurement has to happen before `window.print()`, and `.print-area` is
 * `display: none` on screen, so the sheet is briefly laid out off-screen at the
 * printed content width (`.print-measuring` in app/globals.css, which is why the
 * print typography lives outside the media query). Nothing is ever visible: the
 * class is added and removed inside one synchronous call, with no paint between.
 */

/** A4 minus the `@page` margins in app/globals.css (297mm − 2×20mm). */
const PAGE_HEIGHT_MM = 257;

/**
 * Below this the sheet stops being worth printing, so it is allowed to run onto
 * a second page instead. A job that overflows this much is a data problem — a
 * ticket with twenty items — not a layout one.
 */
const MIN_SCALE = 0.65;

const mmToPx = (mm: number) => (mm / 25.4) * 96;

/**
 * Scales every `.print-page` inside `.print-area` that would not fit, leaving
 * the ones that already fit untouched. Safe to call repeatedly; each call starts
 * from the unscaled layout.
 */
export function fitPrintPages(): void {
  const area = document.querySelector<HTMLElement>('.print-area');
  if (!area) return;
  const pages = Array.from(area.querySelectorAll<HTMLElement>('.print-page'));
  if (pages.length === 0) return;

  // Measure from scratch — a previous print may have left a scale on these.
  pages.forEach((p) => {
    p.style.zoom = '';
  });

  const wasHidden = !area.classList.contains('print-measuring');
  if (wasHidden) area.classList.add('print-measuring');
  try {
    const limit = mmToPx(PAGE_HEIGHT_MM);
    for (const page of pages) {
      const height = page.getBoundingClientRect().height;
      if (height <= limit) continue;
      const scale = limit / height;
      // `zoom` rather than `transform: scale()`: a transform leaves the
      // element's original box behind, so the printer still paginates as if
      // nothing had shrunk. zoom reflows, which is the whole point here.
      page.style.zoom = String(Math.max(MIN_SCALE, Math.floor(scale * 100) / 100));
    }
  } finally {
    if (wasHidden) area.classList.remove('print-measuring');
  }
}
