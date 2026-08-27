import type { Metadata } from 'next';
import { Noto_Sans_Thai, Plus_Jakarta_Sans } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@/components/layout/theme';
/*
  Font Awesome, served from our own origin instead of cdnjs.

  It used to be a <link> to cdnjs in <head>, which is render-blocking: every
  page waited on a THIRD-PARTY origin — its own DNS, TLS handshake and cache
  miss — for 102 kB of CSS, and then again for a 156 kB webfont the CSS asks
  for, before the browser could paint anything.

  Imported here instead, so it ships from the same origin as the app on a
  connection the browser has already opened. Pinned to 6.5.1, the exact version
  the CDN was serving, so no icon changes with it.
*/
import '@fortawesome/fontawesome-free/css/all.min.css';
import './globals.css';

// The prototype pulled these two families from the Google Fonts CDN at runtime.
// `next/font/google` fetches them at build time and self-hosts, which keeps the
// exact same typefaces and weights while removing a third-party request from
// every page load — worth having for a shop-floor app on unreliable wifi, and it
// eliminates the font-swap flash. Exposed as CSS variables because the
// `font-family` stack lives in app/globals.css, not on a className.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const notoThai = Noto_Sans_Thai({
  subsets: ['thai'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Finnix Film — ระบบบริหารจัดการร้าน',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-theme` is the switch `app/globals.css` keys the dark token block
    // off. The server renders the light default and the blocking script below
    // corrects it during HTML parsing, before the first paint;
    // `suppressHydrationWarning` stops React from flagging the difference it
    // finds on `<html>` at hydration time.
    <html
      lang="th"
      data-theme="light"
      className={`${jakarta.variable} ${notoThai.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Must stay first in <head> and must stay synchronous — anything that
            defers it (async/defer, moving it into <body>, a Client Component)
            reintroduces the flash of light theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
