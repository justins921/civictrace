import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { Logo, LockIcon, SearchIcon } from '@/components/Art'
import { ENTITY_NAV, SUB_NAV } from '@/components/nav'
import { MobileNav } from '@/components/MobileNav'

export const metadata: Metadata = {
  title: 'CivicTrace — Wisconsin',
  description:
    'Follow public records. Draw your own conclusions. Campaign finance, votes, bills and earmarks for Wisconsin, traced to the original government filing.',
}

async function freshness() {
  try {
    const { data } = await db.from('data_freshness').select('*').single()
    return data as any
  } catch { return null }
}

const stamp = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US',
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' }) + ' Central'
      : null

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const f = await freshness()
  const stale = f?.last_success
    ? (Date.now() - new Date(f.last_success).getTime()) / 36e5 > 36
    : true
  return (
    <html lang="en">
      <body>
        <header className="site-head">
          <div className="wrap head-row">
            <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
              <Logo />CIVIC<em>TRACE</em>
            </Link>
            <MobileNav />
            <div className="tagline">
              Follow the money.<br /><b>See the record.</b>
            </div>
            <form action="/search" method="get" className="head-search" role="search">
              <span className="head-search-ico" aria-hidden><SearchIcon size={17} /></span>
              <input name="q" type="search" aria-label="Search CivicTrace"
                placeholder="Search politician, donor, bill or industry…" />
            </form>
            <nav className="iconnav" aria-label="Browse by type">
              {ENTITY_NAV.map(({ href, label, Icon }) => (
                <Link key={href} href={href}>
                  <span className="iconnav-i"><Icon size={25} /></span>
                  <span className="iconnav-l">{label}</span>
                </Link>
              ))}
            </nav>
          </div>
          <div className="wrap subnav">
            {SUB_NAV.map(({ href, label }) => (
              <Link key={label} href={href}>{label}</Link>
            ))}
          </div>
        </header>
        <main>{children}</main>
        <footer className="foot">
          <div className="wrap foot-in">
            <span style={{ color: 'var(--navy)', flex: 'none' }}><LockIcon size={26} /></span>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--navy)' }}>
                CivicTrace is nonpartisan and not anti-anyone. We don&apos;t accuse. We illuminate.
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                All data comes from public records: the Federal Election Commission, the U.S. House
                Clerk, the U.S. Senate, GovInfo, the House Appropriations Committee, and the
                unitedstates/congress-legislators project. Read our{' '}
                <Link href="/methodology">methodology</Link> and{' '}
                <Link href="/methodology#sources">data sources</Link>. Found an error?{' '}
                <Link href="/contact">Tell us</Link> — every correction is published.
              </div>
              <div className="tiny" style={{ marginTop: 8 }}>
                Prototype · Wisconsin federal delegation ·{' '}
                {f?.last_success
                  ? <>data last refreshed <strong>{stamp(f.last_success)}</strong>
                      {' '}({Number(f.rollcalls).toLocaleString()} roll calls,{' '}
                      {Number(f.trails).toLocaleString()} trails, latest vote {f.latest_rollcall})
                      {stale && <> — <span style={{ color: '#b23c45' }}>the daily refresh has not
                        succeeded in over 36 hours, so these figures may be behind the filings</span></>}
                      {f.unresolved_error && <> · <span style={{ color: '#b23c45' }}>last run failed</span></>}
                    </>
                  : <span style={{ color: '#b23c45' }}>no successful data refresh is on record</span>}
                . FEC contributor names and addresses may not be sold or used to solicit
                contributions (52 U.S.C. §30111(a)(4)); this site publishes committee-level
                contributions only.
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
/* The layout's revalidate is the floor for every route beneath it, so this line
   silently overrode the 3600 each page sets for itself — 96 regenerations a day
   against one daily data refresh. Matched to the pages it wraps; the footer's
   freshness line comes from `data_freshness`, which is read on each render, so
   nothing about staleness reporting depends on regenerating more often. */
export const revalidate = 3600
