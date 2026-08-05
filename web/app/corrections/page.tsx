import Link from 'next/link'
import { db, CONTACT_EMAIL } from '@/lib/db'

export const revalidate = 600

const CAT_ORDER = ['Contribution data', 'Vote data', 'Timing', 'Methodology', 'Wording', 'Branding']

export default async function Corrections() {
  const { data: rows } = await db.from('correction_log').select('*')
  const list = rows || []
  const byCat: Record<string, number> = {}
  for (const r of list) byCat[r.category || 'Other'] = (byCat[r.category || 'Other'] || 0) + 1
  const internal = list.filter((r: any) => r.reporter_type === 'internal').length
  const external = list.length - internal

  return (
    <div className="wrap">
      <h2 className="section">Corrections</h2>
      <p className="lede">
        Every correction we make is published here permanently: what was wrong, what changed, when,
        and who caught it. Nothing is quietly edited. This page exists so that a reader can check
        whether we fix things — and whether we admit to the ones we found ourselves.
      </p>

      <div className="grid g4">
        <div className="card">
          <div className="eyebrow">Corrections published</div>
          <div className="kpi mono">{list.length}</div>
          <div className="small">since this site was first built</div>
        </div>
        <div className="card">
          <div className="eyebrow">Found by outside review</div>
          <div className="kpi mono">{external}</div>
          <div className="small">reported to us</div>
        </div>
        <div className="card">
          <div className="eyebrow">Found by us</div>
          <div className="kpi mono">{internal}</div>
          <div className="small">published anyway</div>
        </div>
        <div className="card">
          <div className="eyebrow">Still open</div>
          <div className="kpi mono">{list.filter((r: any) => !r.resolved_on).length}</div>
          <div className="small">reported, not yet resolved</div>
        </div>
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <strong>Why we publish the ones nobody would have caught.</strong> Two of the entries below
        are bugs we found in our own review before launch — a vote-counting error and a
        campaign-finance figure compared against the wrong side of the ledger. We could have fixed
        both silently and no reader would have known. A corrections log that only contains
        complaints from other people is not a corrections log; it is a complaints inbox.
      </div>

      <h2 className="section">The log</h2>
      <div className="grid" style={{ gap: 14 }}>
        {list.map((r: any) => (
          <div className="card" key={r.id}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${r.resolved_on ? 'b-some' : 'b-note'}`}>
                {r.resolved_on ? 'Resolved' : 'Open'}
              </span>
              <span className="badge b-low">{r.category || 'Other'}</span>
              <span className="tiny">
                Reported {r.reported_on}
                {r.resolved_on ? ` · resolved ${r.resolved_on}` : ''}
                {r.affected_url ? ` · affected ${r.affected_url}` : ''}
              </span>
            </div>
            <h3 style={{ marginTop: 12 }}>What was wrong</h3>
            <p className="small" style={{ margin: 0 }}>{r.description}</p>
            <h3 style={{ marginTop: 14 }}>What changed</h3>
            <p className="small" style={{ margin: 0 }}>{r.what_changed}</p>
            {r.resolution && (
              <>
                <h3 style={{ marginTop: 14 }}>Outcome</h3>
                <p className="small" style={{ margin: 0 }}>{r.resolution}</p>
              </>
            )}
            <div className="tiny" style={{ marginTop: 12 }}>
              Found by: {r.found_by || (r.reporter_type === 'internal' ? 'Internal review' : 'Reader report')}
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="card small">No corrections have been published yet.</div>
        )}
      </div>

      <h2 className="section">Our corrections policy</h2>
      <div className="grid g2">
        <div className="card">
          <h3>What we commit to</h3>
          <ul className="small">
            <li>We respond to every report, including ones we disagree with.</li>
            <li>We aim to resolve valid data errors within seven days of a report.</li>
            <li>Every correction is published here with the date, the cause and the change.</li>
            <li>We never delete a correction. Superseded entries stay visible.</li>
            <li>If a page is affected, the correction is linked from that page.</li>
            <li>Corrections we find ourselves are published on the same terms as reported ones.</li>
          </ul>
        </div>
        <div className="card">
          <h3>What counts as a correction</h3>
          <ul className="small">
            <li>A figure that does not match the underlying government filing.</li>
            <li>A committee assigned to the wrong sector, or an interest side recorded backwards.</li>
            <li>A missing vote, bill or filing that should be in scope.</li>
            <li>A source link that is broken or points at the wrong document.</li>
            <li>Wording that asserts or implies more than the records support.</li>
            <li>A methodology step that cannot be reproduced from what we publish.</li>
          </ul>
          <div style={{ marginTop: 14 }}>
            <Link className="btn solid" href="/contact">Report something →</Link>
          </div>
        </div>
      </div>

      {!CONTACT_EMAIL && (
        <div className="note" style={{ marginTop: 16, borderLeftColor: '#c2413c', background: '#fdeceb', color: '#7a2b26' }}>
          <strong>Not launch-ready:</strong> no corrections address is configured yet. Set{' '}
          <code>NEXT_PUBLIC_CONTACT_EMAIL</code> before promoting this site publicly — a
          corrections policy with no working way to reach anyone is worse than none at all.
        </div>
      )}
    </div>
  )
}
