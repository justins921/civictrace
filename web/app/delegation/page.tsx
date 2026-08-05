import Link from 'next/link'
import { db, money, partyLetter, officeLine, hrefFor } from '@/lib/db'

export const revalidate = 3600

export default async function Delegation() {
  const [{ data: members }, { data: sectors }] = await Promise.all([
    db.from('member').select('*').order('chamber', { ascending: false }).order('district'),
    db.from('member_sector_money').select('*').eq('cycle', 2026),
  ])

  const byBio: Record<string, any[]> = {}
  for (const s of sectors || []) (byBio[s.bioguide] ||= []).push(s)
  for (const k in byBio) byBio[k].sort((a, b) => Number(b.total) - Number(a.total))

  return (
    <div className="wrap">
      <h2 className="section">Wisconsin&apos;s federal delegation</h2>
      <p className="lede">
        Ten members. Every dollar below is a direct PAC contribution (FEC transaction type 24K)
        reported in the 2026 cycle, with memo entries excluded so nothing is counted twice.
        Independent expenditures are tracked separately and are <em>not</em> included — they are
        spending <em>about</em> a candidate, not money <em>to</em> them.
      </p>

      <div className="note">
        <strong>These are giver-side figures and they will not match the FEC candidate page.</strong>{' '}
        We count what the giving committees reported on their Schedule B. The FEC&apos;s
        &ldquo;contributions from other committees&rdquo; line counts what the receiving campaign
        reported on its Schedule A. Those two ledgers never tie exactly — monthly versus quarterly
        filers, amendments, and one-sided itemization all cause drift. Our Van Orden figure is
        $944,307; the FEC candidate page shows $994,742 through July 22, 2026. Neither is an error.
        We show the giver&apos;s ledger because it is the one that tells you <em>who</em> gave — but
        you should know which ledger you are reading, so we say so here instead of burying it.
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
                <div className="eyebrow">PAC money, 2026 cycle</div>
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
