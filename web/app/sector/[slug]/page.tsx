import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, officeLine, labelClass, trailHref, hrefFor, sectorSlug , CYCLE, CYCLE_LABEL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  const { data } = await db.from('sector_profile').select('sector_slug')
    .eq('cycle', CYCLE).gt('total_to_wi', 0)
  return (data || []).map((s: any) => ({ slug: s.sector_slug }))
}

export default async function Sector({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: prof } = await db.from('sector_profile').select('*')
    .eq('sector_slug', slug).eq('cycle', CYCLE).single()
  if (!prof) notFound()
  const sector = prof.sector

  const [{ data: cmtes }, { data: recips }, { data: bills }, { data: trailsRaw }] = await Promise.all([
    db.from('committee_profile').select('*').eq('sector', sector).eq('cycle', CYCLE)
      .gt('payments_to_wi', 0)
      .order('total_to_wi', { ascending: false }).order('cmte_id', { ascending: true }).limit(40),
    db.from('sector_members').select('*').eq('sector_slug', slug).eq('cycle', CYCLE)
      .order('total', { ascending: false }).order('bioguide', { ascending: true }),
    db.from('bill_sector').select('*, bill(*)').eq('sector', sector),
    db.from('trail_full').select('*').order('rank').limit(300),
  ])

  // Read from the canonical per-sector member view, never derived from the
  // committee list above: that list is capped at 40 rows for display, and
  // deriving members from it under-counted every sector with more committees.
  const members = (recips || []).map((r: any) => ({ ...r, total: Number(r.total) }))
  const maxMember = members[0]?.total || 1

  const trails = (trailsRaw || []).filter((t: any) =>
    (t.sectors || []).some((s: any) => s.sector === sector)).slice(0, 9)

  const sides: Record<string, number> = {}
  for (const c of cmtes || []) {
    const k = c.interest_side || 'unspecified'
    sides[k] = (sides[k] || 0) + Number(c.total_to_wi)
  }
  const sideRows = Object.entries(sides).sort((a, b) => b[1] - a[1])

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
          <div className="grid g3">
            {trails.map((t: any) => (
              <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className={`badge ${labelClass(t.label).badge}`}>{t.label}</span>
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
