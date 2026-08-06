import Link from 'next/link'
import { db, hrefFor } from '@/lib/db'
import { BillArt } from '@/components/Art'

export const revalidate = 3600

export default async function Bills() {
  const [{ data: bills }, { data: links }, { data: rcs }] = await Promise.all([
    db.from('bill_profile').select('*'),
    db.from('bill_sector').select('bill_key,sector,evidence'),
    db.from('rollcall').select('vote_key,legis_num,iso_date,vote_result,yea,nay,chamber'),
  ])

  const sectorsFor: Record<string, string[]> = {}
  for (const l of links || []) (sectorsFor[l.bill_key] ||= []).push(l.sector)

  const list = (bills || []).slice().sort((a: any, b: any) => {
    const t = Number(b.trail_count || 0) - Number(a.trail_count || 0)
    if (t) return t
    return String(a.bill_type + a.bill_num).localeCompare(String(b.bill_type + b.bill_num))
  })

  // M-07: these four numbers are presented as a breakdown, so they have to add
  // up. They previously did not — 102 + 16 + 23 = 141 against 131 bills —
  // because a bill counted as "matched" could also be counted as "too broad".
  // Too-broad wins: those bills are excluded from scoring whatever else matched.
  const withTrails = list.filter((b: any) => Number(b.trail_count || 0) > 0)
  const broad = list.filter((b: any) => b.is_broad)
  const matched = list.filter((b: any) => !b.is_broad && sectorsFor[b.bill_key]?.length)
  const unmatched = list.filter((b: any) => !b.is_broad && !sectorsFor[b.bill_key]?.length)
  const reconciles = matched.length + broad.length + unmatched.length === list.length
  const votes = (rcs || []).length

  const num = (b: any) => `${String(b.bill_type || '').toUpperCase().replace('HRES', 'H.Res.')
    .replace('HJRES', 'H.J.Res.').replace('HCONRES', 'H.Con.Res.')
    .replace(/^HR$/, 'H.R.').replace(/^S$/, 'S.')} ${b.bill_num}`

  return (
    <div className="wrap">
      <h2 className="section">Bills</h2>
      <p className="lede">
        Every bill a Wisconsin member has taken a recorded position on this Congress —{' '}
        <strong>{list.length}</strong> bills across <strong>{votes}</strong> roll calls. Each page
        carries the Congressional Research Service summary <em>verbatim</em>; no language model
        wrote or edited a word of it.
      </p>

      <div className="grid g4" style={{ marginTop: 4 }}>
        <div className="card"><div className="eyebrow">Bills loaded</div>
          <div className="kpi mono">{list.length}</div>
          <div className="small">from GovInfo BILLSTATUS</div></div>
        <div className="card"><div className="eyebrow">Matched to an industry</div>
          <div className="kpi mono">{matched.length}</div>
          <div className="small">by policy area or subject term</div></div>
        <div className="card"><div className="eyebrow">Too broad to score</div>
          <div className="kpi mono">{broad.length}</div>
          <div className="small">omnibus and CR-type bills, excluded on purpose</div></div>
        <div className="card"><div className="eyebrow">No industry match</div>
          <div className="kpi mono">{unmatched.length}</div>
          <div className="small">shown, not hidden — they produce no trail</div></div>
      </div>

      <p className="tiny" style={{ marginTop: 10, marginBottom: 0 }}>
        {reconciles
          ? `Those three categories are exclusive and add to ${list.length}: a bill is either
             excluded as too broad, matched to at least one industry, or matched to none.`
          : 'These categories do not currently add up, which is a bug — please report it.'}
      </p>

      <div className="note">
        <strong>A bill with no trail is not a bill we ignored.</strong> Three things stop a bill
        producing a money trail, and all three are deliberate: it touches every sector at once (an
        omnibus or continuing resolution), no committee giving to Wisconsin members works in its
        policy area, or the vote was near-unanimous and carries no signal. Every one of those bills
        is still listed here with its record.
      </div>

      {withTrails.length > 0 && (
        <>
          <h2 className="section">Bills that produced a money trail</h2>
          <div className="grid g3">
            {withTrails.slice(0, 12).map((b: any) => (
              <Link key={b.bill_key} href={hrefFor.bill(b.bill_key)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <BillArt size={52} />
                  <div style={{ minWidth: 0 }}>
                    <div className="eyebrow">{num(b)}</div>
                    <h3 className="clamp3" style={{ margin: '2px 0 0', fontSize: 15 }}
                      title={b.title}>{b.title}</h3>
                  </div>
                </div>
                <div className="rule" />
                <div className="stat"><span>Policy area</span><b>{b.policy_area || '—'}</b></div>
                <div className="stat"><span>Trails</span><b>{b.trail_count}</b></div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  {(sectorsFor[b.bill_key] || []).join(' · ') || 'no industry match'}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="section">Every bill in the record</h2>
      <div className="card">
        <table>
          <thead><tr><th>Bill</th><th>Policy area</th><th>Industries matched</th>
            <th className="num">Trails</th></tr></thead>
          <tbody>
            {list.map((b: any) => (
              <tr key={b.bill_key}>
                <td>
                  <Link href={hrefFor.bill(b.bill_key)} className="clamp3"
                    title={b.title}>{b.title}</Link>
                  <div className="tiny">{num(b)}
                    {b.is_broad ? ' · too broad to score' : ''}</div>
                </td>
                <td className="small">{b.policy_area || '—'}</td>
                <td className="small">
                  {(sectorsFor[b.bill_key] || []).length
                    ? (sectorsFor[b.bill_key] || []).map((s, i) => (
                        <span key={s}>{i ? ' · ' : ''}
                          <Link href={hrefFor.sector(s)}>{s}</Link></span>))
                    : '—'}
                </td>
                <td className="num mono">{b.trail_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
