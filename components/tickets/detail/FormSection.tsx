'use client';

/**
 * One numbered block of the ticket form.
 *
 * The form used to be a single column of faintly-tinted panels with 10px grey
 * headings, so on a phone at the counter it read as one long scroll with no
 * landmarks — staff kept scrolling past การชำระเงิน looking for it. The
 * financial-document block was the exception: a coloured border and a solid
 * heading made it findable at a glance, which is the treatment the trial run
 * asked for on the rest.
 *
 * Each step keeps ONE accent colour, used for the number badge, the border and
 * the heading, so the block is identifiable by colour before it is read.
 */

export type SectionTone = {
  /** Heading text. */
  ink: string;
  /** Border and number badge. */
  line: string;
  /** Panel fill. */
  fill: string;
};

export const SECTION_TONES: Record<'job' | 'items' | 'payment' | 'document' | 'tech', SectionTone> =
  {
    job: { ink: '#8A5A12', line: '#D8A83A', fill: '#FDF7EA' },
    items: { ink: '#286B62', line: '#2F8F82', fill: '#EAF4F2' },
    payment: { ink: '#3F6B33', line: '#6C9A56', fill: '#EFF5EA' },
    // Unchanged — this is the block the others are being made to look like.
    document: { ink: '#1D4ED8', line: '#2563EB', fill: '#EAF1FB' },
    tech: { ink: '#5B4291', line: '#8B6BC4', fill: '#F1ECFA' },
  };

export function FormSection({
  step,
  title,
  icon,
  tone,
  hint,
  children,
}: {
  step: number;
  title: string;
  /** Font Awesome class, e.g. `fa-car`. */
  icon: string;
  tone: SectionTone;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl p-4 mb-5"
      style={{ background: tone.fill, border: `1.5px solid ${tone.line}` }}
      aria-label={title}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ width: 22, height: 22, background: tone.line, color: '#fff' }}
          aria-hidden="true"
        >
          {step}
        </span>
        <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: tone.ink }}>
          <i className={`fa-solid ${icon}`}></i>
          {title}
        </p>
      </div>
      {hint && (
        <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}
