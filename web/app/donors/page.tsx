import Link from 'next/link'
import { db, money, hrefFor, fetchAll, countRows, CYCLE, CYCLE_LABEL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const metadata = {
  title: 'Donors — CivicTrace',
  description: 'Every political committee that made a direct contribution to a Wisconsin member of Congress, traced to the filed FEC document.',

}

/* No `revalidate` here on purpose. This route reads `searchParams`, which makes
   it dynamically rendered on every request — there is no static output for a
   revalidation window to apply to, and the export that used to sit here read as
   though the page were cached for an hour when nothing about it ever was. */

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

  const filtered = Boolean(sp.sector || sp.side)

  /* H12. `filteredTotal` used to be read off the sector row — the whole
     sector's money — while the list beside it was also filtered by interest
     side. /donors?sector=energy&side=carbon-intensive%20energy therefore
     printed the entire energy total against a carbon-only list, overstating by
     up to 86%. The filter has two dimensions, so the total has to be computed
     over both of them; there is no pre-aggregated row for that combination and
     inventing one from the closest available row is exactly the mistake.

     Summed over the actual filtered set, paged rather than capped. The widest
     filter here is a few hundred committees. */
  const applyFilter = (qy: any) => {
    let x = qy.eq('cycle', CYCLE).gt('payments_to_wi', 0)
    if (sp.sector) x = x.eq('sector_slug', sp.sector)
    if (sp.side) x = x.eq('interest_side', sp.side)
    return x
  }

  const [{ data: rows, count }, { data: sectors }, { data: recon }, allCount, filteredRows] =
    await Promise.all([
      q,
      // bounds-ok: sector_profile is one row per sector per cycle — the sector
      // vocabulary is a fixed list of about 25 names written by sectors.py.
      db.from('sector_profile').select('*').eq('cycle', CYCLE).gt('total_to_wi', 0)
        .order('total_to_wi', { ascending: false }).limit(500),
      db.from('reconciliation').select('*').single(),
      countRows('committee_profile', (qy: any) =>
        qy.eq('cycle', CYCLE).gt('payments_to_wi', 0)),
      filtered
        ? fetchAll<any>('committee_profile',
            (qy: any) => applyFilter(qy).order('cmte_id'), { columns: 'total_to_wi' })
        : Promise.resolve(null),
    ])

  const list = rows || []
  const total = count || 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const shownSum = list.reduce((a: number, r: any) => a + Number(r.total_to_wi), 0)
  // `cycleTotal` is the whole published cycle; `filteredTotal` is what the current
  // filter actually covers. Printing the first next to a filtered count is how
  // /donors?sector=finance-insurance came to say "64 of them, $5,462,903 in all"
  // — the same shape as the cross-cycle bug this page was rebuilt to fix.
  const cycleTotal = (sectors || []).reduce((a: number, s: any) => a + Number(s.total_to_wi), 0)
  const activeSectorRow = (sectors || []).find((s: any) => s.sector_slug === sp.sector)
  const filteredTotal = filteredRows
    ? filteredRows.reduce((a: number, r: any) => a + Number(r.total_to_wi || 0), 0)
    : null
  const activeSector = activeSectorRow

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
      <h1 className="section">Donors</h1>
      <p className="lede">
        {filtered ? (
          <>
            <strong>{total.toLocaleString()}</strong> committees match this filter
            {filteredTotal !== null && <>, giving <strong>{money(filteredTotal)}</strong></>}{' '}
            in the <strong>{CYCLE_LABEL}</strong>
            {sp.sector && sp.side && activeSectorRow && (
              <> — that is the {sp.side} pole only, out of{' '}
              <strong>{money(activeSectorRow.total_to_wi)}</strong> across all of{' '}
              {activeSectorRow.sector}</>
            )}. Across every industry it is{' '}
            <Link href="/donors">
              {allCount.toLocaleString()} committees
            </Link>{' '}and <strong>{money(cycleTotal)}</strong>. Each name opens that
            committee&apos;s own page: who it gave to, when, and a link to the filed FEC document
            for every payment.
          </>
        ) : (
          <>
            Every political committee that made a direct contribution to a Wisconsin member of
            Congress in the <strong>{CYCLE_LABEL}</strong> —{' '}
            <strong>{total.toLocaleString()}</strong> of them,{' '}
            <strong>{money(cycleTotal)}</strong> in all. Each name opens that committee&apos;s own
            page: who it gave to, when, and a link to the filed FEC document for every payment.
            Earlier cycles are in the database but are not published here yet, and no figure on
            this page mixes them.
          </>
        )}
      </p>

      <div className="note">
        <strong>&ldquo;Donor&rdquo; here means a committee, not a person — and that is our
        choice, not the law&apos;s.</strong> We previously said federal law forbade publishing
        individual contributor data. That was wrong, and it is corrected here and in the{' '}
        <Link href="/corrections">corrections log</Link>. 52 U.S.C. §30111(a)(4) forbids{' '}
        <em>selling</em> contributor names and addresses, or using them to solicit contributions
        or for commercial purposes. 11 CFR 104.15(c) and the FEC&apos;s own guidance both say the
        restriction does not apply to news and opinion websites republishing the data.
      </div>
      <div className="note">
        <strong>So why only committees?</strong> Because &ldquo;we may&rdquo; is not &ldquo;we
        should&rdquo;. A searchable index of private citizens by name, home address, employer and
        political giving is a different product from a record of organised money, and it is the
        one that gets misused. Individual giving <em>is</em> published, in aggregate — by size
        band, occupation, employer above a three-donor floor, and in-state share — on each{' '}
        <Link href="/delegation">member&apos;s own page</Link>. What is not published, and will not
        be, is a lookup-by-name record. A committee&apos;s sector label is assigned by a published
        rule, and the rule ID is printed on every row so you can check our work.
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
        <Link className={`badge ${filtered ? 'b-low' : 'b-some'}`} href="/donors">
          All {allCount.toLocaleString()}
        </Link>
        {sp.side && (
          <Link className="badge b-some" href={qs({ side: undefined, p: undefined })}>
            {sp.side} ✕
          </Link>
        )}
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
          Showing {list.length.toLocaleString()} of {total.toLocaleString()}{' '}
          {filtered ? 'matching ' : ''}committees — {money(shownSum)} on this page
          {filteredTotal !== null ? ` of ${money(filteredTotal)} matching the filter` : ''}.
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
