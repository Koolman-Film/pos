import type { NextConfig } from 'next';

/*
  Security headers on every response (tests/unit/nextConfig.test.ts).

  - frame-ancestors / X-Frame-Options: another site must not be able to frame
    the POS and trick a signed-in user into clicking its buttons. 'self' rather
    than 'none' so a same-site preview could still frame a page; nothing does
    today. The CSP carries ONLY frame-ancestors: a script policy needs a nonce
    for the inline theme script and is a separate change.
  - nosniff: the browser uses the declared content type, never a guess.
  - Referrer-Policy: other sites see the origin, not ticket and PO URLs.
  - Permissions-Policy: switches off browser features the app never uses. The
    camera (QC photos) and clipboard (copy link) are deliberately left alone.
  HSTS is not set here — Vercel already sends it for the domain.
*/
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'microphone=(), geolocation=(), browsing-topics=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
