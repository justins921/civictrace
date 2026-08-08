import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, officeLine, labelClass, trailHref, hrefFor, sectorSlug, fetchAll, CYCLE, CYCLE_LABEL, SITE_URL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  // bounds-ok: one row per sector per cycle; the vocabulary is ~25 names.
  const { data } = await db.from('sector_profile').select('sector_slug')
    .eq('cycle', CYCLE).gt('total_to_wi', 0).limit(500)
  return (data || []).map((s: any) => ({ slug: s.sector_slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: s } = await db.from('sector_profile')
    .select('sector,committees,members_supported,total_to_wi')
    .eq('sector_slug', slug).eq('cycle', CYCLE).maybeSingle()
  if (!s) return { title: 'Industry — CivicTrace' }
  const title = `${s.sector} — CivicTrace`
  const description =
    `${s.committees} ${s.sector} committees gave to ${s.members_supported} Wisconsin members of `
    + `Congress in the ${CYCLE_LABEL}. Every committee, every recipient, and the published rule `
    + `that put each one in this industry.`
  return {
    title, description,
    alternates: { canonical: `${SITE_URL}/sector/${slug}` },
    openGraph: { title, description, url: `${SITE_URL}/sector/${slug}` },
  }
}

export default async function Sector({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: prof } = await db.from('sector_profile').select('*')
    .eq('sector_slug', slug).eq('cycle', CYCLE).single()
  if (!prof) notFound()
  const sector = prof.sector

  const [{ data: cmtes }, allCmtes, { data: recips }, bills,
         { data: trailsRaw, count: trailCount, error: trailErr }] = await Promise.all([
    // The 40 shown in the table.
    db.from('committee_profile').select('*').eq('sector', sector).eq('cycle', CYCLE)
      .gt('payments_to_wi', 0)
      .order('total_to_wi', { ascending: false }).order('cmte_id', { ascending: true }).limit(40),
    /* Every committee in the sector, for the interest-side split below.
       That split used to be summed over the 40-row display slice and printed
       as the sector's own breakdown: Finance & Insurance rendered $794,000
       against a header of $872,000, and Trade / Membership was short by 53%.
       The note nine lines down already says the member list must never be
       derived from the capped committee list — the fix was applied to the
       members table and not to the side table beside it.

       It passes `check:bounds` either way, because `.limit(40)` *is* a bound.
       The check verifies the fetch is bounded; it cannot know the arithmetic
       is over the wrong set. `/industries` computes this same quantity from
       the full set and has always disagreed with this page. */
    fetchAll<any>('committee_profile',
      (q: any) => q.eq('sector', sector).eq('cycle', CYCLE).gt('payments_to_wi', 0)
        .order('cmte_id'), { columns: 'interest_side,total_to_wi' }),
    // bounds-ok: at most one row per Wisconsin member.
    db.from('sector_members').select('*').eq('sector_slug', slug).eq('cycle', CYCLE)
      .order('total', { ascending: false }).order('bioguide', { ascending: true }).limit(100),
    // Every bill matched to this sector. 228 rows across all sectors today, but
    // it grows with the bill table and one sector could plausibly hold a page
    // of them on its own, so it pages rather than assuming.
    fetchAll<any>('bill_sector',
      (q: any) => q.eq('sector', sector).order('bill_key'), { columns: '*, bill(*)' }),
    // Same fix as /committee: matched in the database over every trail, not
    // searched in JS inside an arbitrary 300-row window.
    db.from('trail_full').select('*', { count: 'exact' })
            // See the note on /committee: a jsonb `cs` filter needs a JSON string.
      .contains('sectors', JSON.stringify([{ sector }]))
      .eq('cycle', CYCLE).order('rank').limit(9),
  ])

  // Read from the canonical per-sector member view, never derived from the
  // committee list above: that list is capped at 40 rows for display, and
  // deriving members from it under-counted every sector with more committees.
  const members = (recips || []).map((r: any) => ({ ...r, total: Number(r.total) }))
  const maxMember = members[0]?.total || 1

  if (trailErr) throw new Error(`sector trails query failed: ${trailErr.message}`)
  const trails = trailsRaw || []
  const trailTotal = trailCount || 0

  const sides: Record<string, number> = {}
  for (const c of allCmtes) {
    const k = c.interest_side || 'unspecified'
    sides[k] = (sides[k] || 0) + Number(c.total_to_wi)
  }
  const sideRows = Object.entries(sides).sort((a, b) => b[1] - a[1])
  // These are a breakdown of the header figure, so they have to add to it.
  const sideSum = sideRows.reduce((a, [, v]) => a + v, 0)
  const sidesReconcile = Math.abs(sideSum - Number(prof.total_to_wi)) < 0.5

  return (
    <div className="wrap">
      <div className="card" style={{ marginTop: 22, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="step-art" style={{ margin: 0, flex: 'none', minHeight: 0 }}>
          <DonorArt sector={sector} size={70} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="eyebrow">Sector</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(22px,4.6vw,32px)', letterSpacing: '-.8px',
            color: 'var(--navy)' }}>{sector}</h1>
          <div className="small" style={{ marginTop: 6 }}>
            {prof.committees} committees gave in the {CYCLE_LABEL} ·{' '}
            {members.length} Wisconsin member{members.length === 1 ? '' : 's'} received money from it
          </div>
        </div>
        <div style={{ flex: 'none', minWidth: 0 }}>
          <div className="eyebrow">Given to Wisconsin members</div>
          <div className="kpi mono">{money(prof.total_to_wi)}</div>
          <div className="small">{CYCLE_LABEL}, giver-side ledger</div>
        </div>
      </div>

      {sideRows.length > 1 && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>Committees in one sector do not want the same thing.</strong> A utility PAC and an
          environmental PAC both classify as Energy, and they are usually on opposite sides of the
          same bill. That is why every committee here carries an interest side, and why a trail can
          never show money on one side of an issue without showing the other.
        </div>
      )}

      {sideRows.length > 0 && (
        <>
          <h2 className="section">Money by interest side</h2>
          <div className="card">
            <table>
              <thead><tr><th>Interest side</th><th className="num">To Wisconsin members</th>
                <th style={{ width: '40%' }}></th></tr></thead>
              <tbody>
                {sideRows.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num mono">{money(v)}</td>
                    <td><div className="bar">
                      <i style={{ width: `${Math.max(3, (100 * v) / sideRows[0][1])}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny card-foot">
              {sidesReconcile
                ? `Every committee in this industry, not only the ones listed below — these add
                   to ${money(sideSum)}, the industry total above.`
                : `These add to ${money(sideSum)}, and the industry total above is
                   ${money(prof.total_to_wi)}. They should match; that they do not is a bug, and
                   we would rather show you the discrepancy than the smaller number on its own.`}
            </div>
          </div>
        </>
      )}

      <h2 className="section">Which Wisconsin members received this sector&apos;s money</h2>
      <div className="card">
        <table>
          <thead><tr><th>Member</th><th>Office</th><th className="num">Payments</th>
            <th className="num">Total</th><th style={{ width: '25%' }}></th></tr></thead>
          <tbody>
            {members.map((m: any) => (
              <tr key={m.bioguide}>
                <td><span className={`chip ${partyLetter(m.party)}`}>{partyLetter(m.party)}</span>{' '}
                  <Link href={hrefFor.member(m.slug)}>{m.full_name}</Link></td>
                <td className="small">{officeLine(m)}</td>
                <td className="num mono">{m.n_payments}</td>
                <td className="num mono">{money(m.total)}</td>
                <td><div className="bar">
                  <i style={{ width: `${Math.max(3, (100 * m.total) / maxMember)}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Committees in this sector</h2>
      <div className="card">
        <table>
          <thead><tr><th>Committee</th><th>Interest side</th><th>Rule</th>
            <th className="num">To Wisconsin</th></tr></thead>
          <tbody>
            {(cmtes || []).map((c: any) => (
              <tr key={c.cmte_id + c.cycle}>
                <td><Link href={hrefFor.committee(c.cmte_id)}>{c.cmte_name}</Link></td>
                <td className="small">{c.interest_side || '—'}</td>
                <td className="small mono">{c.rule_id || '—'}</td>
                <td className="num mono">{money(c.total_to_wi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(cmtes || []).length >= 40 && (
          <p className="tiny" style={{ marginTop: 10, marginBottom: 0 }}>
            Showing the 40 largest by total given to Wisconsin members.
          </p>
        )}
      </div>

      {(bills || []).length > 0 && (
        <>
          <h2 className="section">Bills matched to this sector</h2>
          <div className="card">
            <table>
              <thead><tr><th>Bill</th><th>Policy area</th><th>Why it matched</th></tr></thead>
              <tbody>
                {(bills || []).filter((x: any) => x.bill).map((x: any) => (
                  <tr key={x.bill_key}>
                    <td><Link href={hrefFor.bill(x.bill_key)}>{x.bill.title}</Link>
                      <div className="tiny">{x.bill.bill_type?.toUpperCase()} {x.bill.bill_num}</div></td>
                    <td className="small">{x.bill.policy_area || '—'}</td>
                    <td className="small">{x.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {trails.length > 0 && (
        <>
          <h2 className="section">Money trails in this sector</h2>
          {trailTotal > trails.length && (
            <p className="lede small">
              Showing {trails.length} of <strong>{trailTotal.toLocaleString()}</strong> trails in
              this sector; the rest are on <Link href="/trails">the trails page</Link>.
            </p>
          )}
          <div className="grid g3">
            {trails.map((t: any) => (
              <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className={`badge ${labelClass(t.display_label ?? t.label).badge}`}>{t.display_label ?? t.label}</span>
                <h3 className="clamp3" style={{ marginTop: 10, fontSize: 15.5 }}
                  title={t.bill_title || t.vote_desc}>{t.bill_title || t.vote_desc}</h3>
                <div className="small">
                  <span className={`chip ${partyLetter(t.party)}`}>{partyLetter(t.party)}</span>{' '}
                  {t.full_name} voted <strong>{t.position}</strong>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
