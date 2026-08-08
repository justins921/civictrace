import Link from 'next/link'
import { db, money, partyLetter, officeLine, hrefFor, fetchAll, CYCLE, CYCLE_LABEL } from '@/lib/db'

export const metadata = {
  title: "Wisconsin's federal delegation — CivicTrace",
  description: 'All ten members, with direct PAC contributions reported this cycle and links to every original filing.',

}

export const revalidate = 3600

export default async function Delegation() {
  const [{ data: members }, sectors] = await Promise.all([
    // bounds-ok: Wisconsin's delegation is ten members, and member_sector_money
    // is one row per member per sector — ten times a ~25-name vocabulary.
    db.from('member').select('*').order('chamber', { ascending: false })
      .order('district').limit(50),
    // `.limit(2000)` here was `.limit(1000)` wearing a comment that said
    // otherwise: PostgREST enforces its own 1,000-row ceiling and returns
    // exactly that, HTTP 200, no warning. Every member's PAC total on this page
    // is summed from these rows. 129 today, so it was harmless — and it was the
    // precise defect the bounds check exists to prevent, sitting inside the
    // bounds check's own approval. The check now rejects any limit above the
    // ceiling; this pages instead.
    fetchAll<any>('member_sector_money',
      (q: any) => q.eq('cycle', CYCLE).order('bioguide')),
  ])

  const byBio: Record<string, any[]> = {}
  for (const s of sectors) (byBio[s.bioguide] ||= []).push(s)
  for (const k in byBio) byBio[k].sort((a, b) => Number(b.total) - Number(a.total))

  return (
    <div className="wrap">
      <h1 className="section">Wisconsin&apos;s federal delegation</h1>
      <p className="lede">
        Ten members. Every dollar below is a direct PAC contribution (FEC transaction type 24K)
        reported in the {CYCLE_LABEL}, with memo entries excluded so nothing is counted twice.
        Independent expenditures are tracked separately and are <em>not</em> included — they are
        spending <em>about</em> a candidate, not money <em>to</em> them.
      </p>

      <div className="note">
        <strong>These are giver-side figures and they will not match the FEC candidate page.</strong>{' '}
        We count what the giving committees reported on their Schedule B. The FEC&apos;s
        &ldquo;contributions from other committees&rdquo; line counts what the receiving campaign
        reported on its Schedule A. Those two ledgers never tie exactly — monthly versus quarterly
        filers, amendments, and one-sided itemization all cause drift. Neither ledger is an error.
        A worked example with both numbers is on the{' '}
        <Link href="/methodology">methodology page</Link>, where our side of it is read from the
        published data rather than typed into the sentence. We show the giver&apos;s ledger because
        it is the one that tells you <em>who</em> gave — but you should know which ledger you are
        reading, so we say so here instead of burying it.
      </div>

      <div className="grid g3" style={{ marginTop: 18 }}>
        {(members || []).map((m: any) => {
          const secs = byBio[m.bioguide] || []
          const total = secs.reduce((a, s) => a + Number(s.total), 0)
          const cmtes = secs.reduce((a, s) => a + Number(s.committees), 0)
          return (
            <Link key={m.bioguide} href={`/member/${m.slug}`} className="card"
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`chip ${partyLetter(m.party)}`}>{partyLetter(m.party)}</span>
                {m.full_name}
              </h3>
              <div className="small">{officeLine(m)}</div>
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow">PAC money, {CYCLE_LABEL}</div>
                <div className="kpi mono">{money(total)}</div>
                <div className="small">{cmtes} committees</div>
              </div>
              <div style={{ marginTop: 14 }}>
                {secs.slice(0, 5).map(s => (
                  <div key={s.sector} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, gap: 8 }}>
                      <span>{s.sector}</span>
                      <span className="mono small">{money(s.total)}</span>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${total ? Math.max(2, (100 * Number(s.total)) / total) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="btn" style={{ marginTop: 14 }}>See full record →</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
