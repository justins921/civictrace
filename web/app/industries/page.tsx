import Link from 'next/link'
import { db, money, hrefFor, fetchAll, CYCLE, CYCLE_LABEL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const metadata = {
  title: 'Industries — CivicTrace',
  description: "PAC giving to Wisconsin's federal delegation, grouped by industry under published classification rules.",
}

export const revalidate = 3600

export default async function Industries() {
  /* The committee read was at 83% of PostgREST's 1000-row cap when this was
     last measured — every interest-side subtotal on this page was one busy
     quarter away from being computed on a truncated set, with no error and no
     visible change except that the numbers would be smaller. It pages now. */
  const [{ data: sectors }, cmtes, bills] = await Promise.all([
    // bounds-ok: one row per sector per cycle; the vocabulary is ~25 names.
    db.from('sector_profile').select('*').eq('cycle', CYCLE)
      .order('total_to_wi', { ascending: false }).order('sector', { ascending: true })
      .limit(500),
    fetchAll<any>('committee_profile',
      (q) => q.eq('cycle', CYCLE).gt('payments_to_wi', 0).order('cmte_id'),
      { columns: 'sector,interest_side,total_to_wi' }),
    fetchAll<any>('bill_sector', (q) => q.order('bill_key'), { columns: 'sector,bill_key' }),
  ])

  const sides: Record<string, Record<string, number>> = {}
  for (const c of cmtes) {
    const s = c.sector || 'Unclassified'
    const k = c.interest_side || 'unspecified'
    ;(sides[s] ||= {})[k] = (sides[s]?.[k] || 0) + Number(c.total_to_wi)
  }
  const billCount: Record<string, number> = {}
  for (const b of bills) billCount[b.sector] = (billCount[b.sector] || 0) + 1

  const list = (sectors || []).filter((s: any) => Number(s.total_to_wi) > 0)
  const grand = list.reduce((a: number, s: any) => a + Number(s.total_to_wi), 0)
  const max = Number(list[0]?.total_to_wi || 1)

  return (
    <div className="wrap">
      <h1 className="section">Industries</h1>
      <p className="lede">
        Every committee that gave to a Wisconsin member is assigned to one industry by a published,
        rule-based classifier — <strong>{list.length}</strong> industries covering{' '}
        <strong>{money(grand)}</strong> in the <strong>{CYCLE_LABEL}</strong>. Open one to see which committees are in
        it, which members took its money, and which bills matched it.
      </p>

      <div className="note">
        <strong>An industry is not a team.</strong> A utility PAC and an environmental PAC both land
        in Energy &amp; Utilities and are usually on opposite sides of the same bill. That is why
        every committee carries an <em>interest side</em>, shown below and on each industry page, and
        why no trail on this site can show money on one side of a question without also showing what
        the other side gave. If an industry&apos;s money is split, the split is the story.
      </div>

      <div className="grid g3" style={{ marginTop: 18 }}>
        {list.map((s: any) => {
          const bySide = Object.entries(sides[s.sector] || {}).sort((a, b) => b[1] - a[1])
          return (
            <Link key={s.sector_slug} href={hrefFor.sector(s.sector)} className="card"
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <DonorArt sector={s.sector} size={64} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{s.sector}</h3>
                  <div className="tiny">
                    {s.committees} committees · {s.members_supported} Wisconsin members
                    {billCount[s.sector] ? ` · ${billCount[s.sector]} bills matched` : ''}
                  </div>
                </div>
              </div>
              <div className="kpi mono" style={{ marginTop: 12 }}>{money(s.total_to_wi)}</div>
              <div className="bar">
                <i style={{ width: `${Math.max(3, (100 * Number(s.total_to_wi)) / max)}%` }} />
              </div>
              {bySide.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {bySide.slice(0, 3).map(([k, v]) => (
                    <div key={k} className="stat"><span>{k}</span><b>{money(v)}</b></div>
                  ))}
                  {bySide.length > 3 && (
                    <div className="tiny" style={{ marginTop: 4 }}>
                      +{bySide.length - 3} more interest sides
                    </div>
                  )}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
