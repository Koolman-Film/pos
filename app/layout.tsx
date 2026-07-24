import type { Metadata } from 'next';
import { THEME_INIT_SCRIPT } from '@/components/layout/theme';
import './globals.css';

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
    <html lang="th" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Must stay first in <head> and must stay synchronous — anything that
            defers it (async/defer, moving it into <body>, a Client Component)
            reintroduces the flash of light theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
