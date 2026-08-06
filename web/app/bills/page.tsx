import Link from 'next/link'
import { db, fetchAll, countRows, hrefFor } from '@/lib/db'
import { BillArt } from '@/components/Art'

export const metadata = {
  title: 'Bills — CivicTrace',
  description: 'Every bill a Wisconsin member has taken a recorded position on, with the Congressional Research Service summary verbatim.',

}

export const revalidate = 3600

export default async function Bills() {
  // Fetch the voted bills; COUNT the rest. `.limit(3000)` on the full table was
  // the same mistake this codebase has now made four times: PostgREST caps an
  // unbounded select at 1000 rows regardless of what you ask for, so the
  // "signed but never voted" figure was derived from 1,000 of 2,419 bills and
  // printed 791 instead of the truth. Never .length a response you did not bound.
  const [bills, signedOnlyCount, links, rcs] = await Promise.all([
    fetchAll<any>('bill_profile', (q) => q.eq('has_rollcall', true).order('bill_key')),
    countRows('bill_profile', (q) => q.eq('has_rollcall', false).gt('wi_sponsors', 0)),
    fetchAll<any>('bill_sector', (q) => q.order('bill_key'),
      { columns: 'bill_key,sector,evidence' }),
    // 505 roll calls today and rising every week Congress sits. This is the
    // read that would have crossed the ceiling next, and the four figures in
    // the paragraph below it are all derived from `.length`.
    fetchAll<any>('rollcall', (q) => q.order('vote_key'),
      { columns: 'vote_key,legis_num,iso_date,vote_result,yea,nay,chamber' }),
  ])

  const sectorsFor: Record<string, string[]> = {}
  for (const l of links) (sectorsFor[l.bill_key] ||= []).push(l.sector)

  // The bill table now holds every bill a Wisconsin member sponsored or
  // cosponsored — 2,419 of them — not only the 209 that reached a vote. This
  // page is about the voted ones, and saying "every bill they took a recorded
  // position on" over the larger population would be false in the specific way
  // this project keeps catching in itself.
  const signedOnly = signedOnlyCount || 0

  const list = bills.slice().sort((a: any, b: any) => {
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

  // "N bills across M roll calls" read as though every roll call belonged to a
  // bill. It does not: a third of them are confirmation votes on nominations,
  // votes on amendments, and procedural motions to adjourn. Counting those as
  // bill votes inflated the number and made the two figures irreconcilable to
  // anyone who tried. Split them, and say what the remainder is.
  const norm = (v: string) => (v || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  const billLabels = new Set(list.map((b: any) => norm(b.bill_type + b.bill_num)))
  const allRolls = rcs
  const billVotes = allRolls.filter((r: any) => billLabels.has(norm(r.legis_num)))
  const otherVotes = allRolls.length - billVotes.length
  const nominations = allRolls.filter((r: any) =>
    (r.legis_num || '').trim().toUpperCase().startsWith('PN')).length
  const amendments = allRolls.filter((r: any) =>
    (r.legis_num || '').toUpperCase().includes('AMDT')).length

  const num = (b: any) => `${String(b.bill_type || '').toUpperCase().replace('HRES', 'H.Res.')
    .replace('HJRES', 'H.J.Res.').replace('HCONRES', 'H.Con.Res.')
    .replace(/^HR$/, 'H.R.').replace(/^S$/, 'S.')} ${b.bill_num}`

  return (
    <div className="wrap">
      <h1 className="section">Bills</h1>
      <p className="lede">
        Every bill a Wisconsin member has taken a recorded position on this Congress —{' '}
        <strong>{list.length}</strong> bills, decided across{' '}
        <strong>{billVotes.length.toLocaleString()}</strong> roll calls. Each page carries the
        Congressional Research Service summary <em>verbatim</em>; no language model wrote or
        edited a word of it.
      </p>
      {signedOnly > 0 && (
        <p className="small" style={{ marginTop: -6 }}>
          Separately, Wisconsin members put their names on{' '}
          <strong>{signedOnly.toLocaleString()}</strong> more bills that never reached a
          vote — sponsored or cosponsored and left there. Those are on each member&apos;s own page.
          A bill dying without a vote is the ordinary fate of most legislation, and a member&apos;s
          signature on it is a choice nobody whipped.
        </p>
      )}
      {otherVotes > 0 && (
        <p className="small" style={{ marginTop: -6 }}>
          The delegation cast <strong>{allRolls.length.toLocaleString()}</strong> recorded votes in
          total. The other <strong>{otherVotes.toLocaleString()}</strong> were not votes on bills
          — {nominations.toLocaleString()} on nominations, {amendments.toLocaleString()} on
          amendments, and the rest procedural. Each one now has its own page under{' '}
          <Link href="/votes">every recorded vote</Link> — they have no bill page here because
          there is no bill, not because we dropped them.
        </p>
      )}

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
                    <h3 className="clamp3 title3" style={{ margin: '2px 0 0', fontSize: 15 }}
                      title={b.title}>{b.title}</h3>
                  </div>
                </div>
                <div className="rule" />
                <div className="stat"><span>Policy area</span><b>{b.policy_area || '—'}</b></div>
                <div className="stat"><span>Trails</span><b>{b.trail_count}</b></div>
                <div className="tiny card-foot">
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
