import Link from 'next/link'
import { db, money, hrefFor, CYCLE, CYCLE_LABEL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const revalidate = 3600

const PAGE = 100

export default async function Donors({ searchParams }:
  { searchParams: Promise<{ sector?: string; side?: string; p?: string }> }) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.p || '1', 10) || 1)

  // Listing key is "made at least one payment this cycle", not "nets positive":
  // FEC filings carry refunds as negative amounts, so a committee that gave and
  // was refunded nets to zero or below. Eleven of those exist in this cycle and
  // they are real records, so they are listed rather than quietly dropped.
  let q = db.from('committee_profile').select('*', { count: 'exact' })
    .eq('cycle', CYCLE).gt('payments_to_wi', 0)
  if (sp.sector) q = q.eq('sector_slug', sp.sector)
  if (sp.side) q = q.eq('interest_side', sp.side)
  q = q.order('total_to_wi', { ascending: false })
       .order('cmte_id', { ascending: true })   // deterministic tie-break (M-05)
       .range((page - 1) * PAGE, page * PAGE - 1)

  const [{ data: rows, count }, { data: sectors }, { data: recon }] = await Promise.all([
    q,
    db.from('sector_profile').select('*').eq('cycle', CYCLE).gt('total_to_wi', 0)
      .order('total_to_wi', { ascending: false }),
    db.from('reconciliation').select('*').single(),
  ])

  const list = rows || []
  const total = count || 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const shownSum = list.reduce((a: number, r: any) => a + Number(r.total_to_wi), 0)
  const grand = (sectors || []).reduce((a: number, s: any) => a + Number(s.total_to_wi), 0)
  const activeSector = (sectors || []).find((s: any) => s.sector_slug === sp.sector)

  const qs = (over: Record<string, string | undefined>) => {
    const o: Record<string, string> = {}
    if (sp.sector) o.sector = sp.sector
    if (sp.side) o.side = sp.side
    for (const [k, v] of Object.entries(over)) { if (v) o[k] = v; else delete o[k] }
    const s = new URLSearchParams(o).toString()
    return s ? `/donors?${s}` : '/donors'
  }

  return (
    <div className="wrap">
      <h2 className="section">Donors</h2>
      <p className="lede">
        Every political committee that made a direct contribution to a Wisconsin member of
        Congress in the <strong>{CYCLE_LABEL}</strong> — <strong>{total.toLocaleString()}</strong>{' '}
        of them, <strong>{money(grand)}</strong> in all. Each name opens that committee&apos;s own
        page: who it gave to, when, and a link to the filed FEC document for every payment.
        Earlier cycles are in the database but are not published here yet, and no figure on this
        page mixes them.
      </p>

      <div className="note">
        <strong>&ldquo;Donor&rdquo; here means a committee, not a person.</strong> Federal law
        forbids using FEC contributor names and addresses to solicit contributions or for
        commercial purposes (52 U.S.C. §30111(a)(4)), so CivicTrace publishes committee-level
        giving only — no individual donors, ever. A committee&apos;s sector label is assigned by a
        published rule, and the rule ID is printed on every row so you can check our work.
      </div>

      {recon && Number(recon.committees_net_refunded) > 0 && (
        <div className="note">
          <strong>Some totals are zero or negative, and that is the filing, not a bug.</strong>{' '}
          The FEC records a refunded contribution as a negative amount.{' '}
          <strong>{Number(recon.committees_net_refunded)}</strong> committees this cycle gave and
          were refunded in whole or in part, so their net is zero or below. They are listed rather
          than hidden — money given and returned is part of the record.
        </div>
      )}

      <h2 className="section">Browse by industry</h2>
      <div className="grid g4">
        {(sectors || []).slice(0, 12).map((s: any) => (
          <Link key={s.sector_slug} href={hrefFor.sector(s.sector)} className="card"
            style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <DonorArt sector={s.sector} size={52} />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 14.5 }}>{s.sector}</h3>
                <div className="tiny">{s.committees} committees</div>
                <div className="mono small" style={{ marginTop: 2 }}>{money(s.total_to_wi)}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <h2 className="section">
        {activeSector ? `${activeSector.sector} committees` : 'Every contributing committee'}
      </h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 14px' }}>
        <Link className={`badge ${sp.sector || sp.side ? 'b-low' : 'b-some'}`} href="/donors">
          All {total.toLocaleString()}
        </Link>
        {(sectors || []).slice(0, 10).map((s: any) => (
          <Link key={s.sector_slug} className={`badge ${sp.sector === s.sector_slug ? 'b-some' : 'b-low'}`}
            href={qs({ sector: s.sector_slug, p: undefined })}>{s.sector}</Link>
        ))}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Committee</th><th>Industry</th><th>Interest side</th><th>Rule</th>
              <th className="num">Members</th><th className="num">To Wisconsin</th></tr>
          </thead>
          <tbody>
            {list.map((c: any) => (
              <tr key={c.cmte_id + c.cycle}>
                <td>
                  <Link href={hrefFor.committee(c.cmte_id)}>{c.cmte_name}</Link>
                  {c.connected_org && <div className="tiny">{c.connected_org}</div>}
                </td>
                <td className="small">
                  {c.sector ? <Link href={hrefFor.sector(c.sector)}>{c.sector}</Link> : 'Unclassified'}
                </td>
                <td className="small">{c.interest_side || '—'}</td>
                <td className="small mono">{c.rule_id || '—'}</td>
                <td className="num mono">{c.members_supported}</td>
                <td className="num mono">{money(c.total_to_wi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 10 }}>
          Showing {list.length.toLocaleString()} of {total.toLocaleString()} committees
          ({money(shownSum)} of {money(grand)} on this page).
        </div>
        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {page > 1 && <Link className="btn" href={qs({ p: String(page - 1) })}>← Previous</Link>}
            <span className="small" style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
            {page < pages && <Link className="btn" href={qs({ p: String(page + 1) })}>Next →</Link>}
          </div>
        )}
      </div>
    </div>
  )
}
