/** @type {import('next').NextConfig} */

/* Type errors fail the build again.
 *
 * `ignoreBuildErrors: true` was set during the prototype and then quietly
 * became load-bearing. It is how a `Result` union that TypeScript could not
 * narrow shipped to production, and it is why nothing objected when a jsonb
 * `contains()` filter was passed a raw array — the query errored at runtime and
 * the page rendered an empty section, which reads to a visitor exactly like
 * "this committee has no trails." The build now runs `tsc` and stops on it.
 *
 * ESLint stays off during builds because it is not installed in CI; `tsc
 * --noEmit` is the check that has actually caught things here.
 */
/* Security headers.
 *
 * The CSP is deliberately not `unsafe-inline`-free: Next injects inline
 * bootstrap scripts and this app ships inline `style` attributes, so a strict
 * policy would need nonces threaded through the whole tree. What this policy
 * does buy is real — no framing, no plugin content, no form posting to another
 * origin, and connections limited to Supabase — and it is honest about what it
 * does not cover rather than pretending to be strict.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

const HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

export default {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [{ source: '/:path*', headers: HEADERS }]
  },
}
