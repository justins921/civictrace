import Link from 'next/link'
import { db, money, shortMoney, partyLetter, hrefFor , safeUrl } from '@/lib/db'

export const metadata = {
  title: 'Earmarks — CivicTrace',
  description: "FY2026 Community Project Funding requests, from each member's own required public disclosure.",
}

export const revalidate = 3600

export default async function Earmarks() {
  const [{ data: ears }, { data: agg }, { data: members }] = await Promise.all([
    db.from('earmark').select('*').eq('state', 'WI').order('amount', { ascending: false }),
    db.from('earmark_agg').select('*'),
    db.from('member').select('*').eq('chamber', 'rep').order('district'),
  ])

  const nat = (agg || []).find((a: any) => a.scope === 'national')
  const parties = (agg || []).filter((a: any) => a.scope === 'party')
    .sort((a: any, b: any) => Number(b.total) - Number(a.total))
  const top = (agg || []).filter((a: any) => a.scope === 'top_member')
    .sort((a: any, b: any) => Number(b.total) - Number(a.total))

  const bioSlug: Record<string, string> = {}
  for (const m of members || []) bioSlug[m.bioguide] = m.slug
  const byMember: Record<string, { name: string; district: string; party: string; url: string; slug: string; n: number; total: number }> = {}
  const bySub: Record<string, { n: number; total: number }> = {}
  for (const e of ears || []) {
    const k = e.member_name
    byMember[k] ||= { name: k, district: e.district, party: e.party, url: e.member_url,
                      slug: bioSlug[e.bioguide] || '', n: 0, total: 0 }
    byMember[k].n++; byMember[k].total += Number(e.amount)
    bySub[e.subcommittee] ||= { n: 0, total: 0 }
    bySub[e.subcommittee].n++; bySub[e.subcommittee].total += Number(e.amount)
  }
  const memberRows = Object.values(byMember).sort((a, b) => b.total - a.total)
  const subRows = Object.entries(bySub).sort((a, b) => b[1].total - a[1].total)
  const maxSub = subRows[0]?.[1].total || 1
  const wiTotal = memberRows.reduce((a, m) => a + m.total, 0)
  const requested = new Set(memberRows.map(m => m.name.toLowerCase()))
  const noRequest = (members || []).filter((m: any) =>
    ![...requested].some(r => r.includes(String(m.last_name).toLowerCase())))

  return (
    <div className="wrap">
      <h1 className="section">Earmark audit — FY2026 Community Project Funding</h1>
      <p className="lede">
        Every House member who requested an earmark had to disclose it publicly. This is that
        disclosure file, in full: <strong>{Number(nat?.n || 0).toLocaleString()}</strong> requests
        worth <strong>{money(nat?.total)}</strong> nationally. Wisconsin members filed{' '}
        <strong>{(ears || []).length}</strong> requests worth <strong>{money(wiTotal)}</strong>.
      </p>

      <div className="note">
        <strong>CivicTrace does not call any project &ldquo;pork.&rdquo;</strong> Whether a runway
        repair, a water main or a job-training grant is essential infrastructure or wasteful
        spending is a political judgement, and it is yours to make. What we do is make every request
        countable, comparable and traceable to the member who asked for it. Both parties use the
        process heavily and neither is the outlier — Democrats filed more individual requests,
        Republicans requested more total dollars. The numbers are directly below; check them rather
        than taking our word for it.
      </div>

      <div className="grid g4" style={{ marginTop: 18 }}>
        {parties.map((p: any) => (
          <div className="card" key={p.key}>
            <div className="eyebrow">
              {p.key === 'D' ? 'Democratic' : p.key === 'R' ? 'Republican' : p.key} requests, nationwide
            </div>
            <div className="kpi mono">{shortMoney(p.total)}</div>
            <div className="small">{Number(p.n).toLocaleString()} projects · avg {money(Number(p.total) / Number(p.n))}</div>
          </div>
        ))}
        <div className="card">
          <div className="eyebrow">Wisconsin share</div>
          <div className="kpi mono">{((100 * wiTotal) / Number(nat?.total || 1)).toFixed(2)}%</div>
          <div className="small">of the national request total</div>
        </div>
        <div className="card">
          <div className="eyebrow">Wisconsin average request</div>
          <div className="kpi mono">{shortMoney(wiTotal / Math.max((ears || []).length, 1))}</div>
          <div className="small">across {(ears || []).length} projects</div>
        </div>
      </div>

      <h2 className="section">Wisconsin members</h2>
      <div className="grid g3">
        {memberRows.map(m => (
          <div className="card" key={m.name}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`chip ${partyLetter(m.party)}`}>{partyLetter(m.party)}</span>
              {m.slug ? <Link href={hrefFor.member(m.slug)}>{m.name}</Link> : m.name}
            </h3>
            <div className="small">{m.district}</div>
            <div className="kpi mono" style={{ marginTop: 12 }}>{money(m.total)}</div>
            <div className="small">{m.n} requests · avg {money(m.total / m.n)}</div>
            <div className="bar"><i style={{ width: `${Math.max(3, (100 * m.total) / memberRows[0].total)}%` }} /></div>
            {safeUrl(m.url) && <a className="btn" style={{ marginTop: 14 }} href={safeUrl(m.url)!}
              target="_blank" rel="noopener noreferrer">Member&apos;s own disclosure ↗</a>}
          </div>
        ))}
      </div>

      {noRequest.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{noRequest.length} Wisconsin House members filed no FY2026 requests</h3>
          <p className="small" style={{ margin: '6px 0 0' }}>
            {noRequest.map((m: any) => `${m.full_name} (WI-${String(m.district).padStart(2, '0')})`).join(', ')}{' '}
            do not appear in the House file. Senators are not in this dataset at all — Senate
            Congressionally Directed Spending is published by each senator individually, with no
            central file. That gap is real and we show it rather than papering over it.
          </p>
        </div>
      )}

      <h2 className="section">Where the Wisconsin money was requested</h2>
      <div className="card">
        <table>
          <thead><tr><th>Appropriations subcommittee</th><th className="num">Projects</th>
            <th className="num">Requested</th><th style={{ width: '30%' }}></th></tr></thead>
          <tbody>
            {subRows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num mono">{v.n}</td>
                <td className="num mono">{money(v.total)}</td>
                <td><div className="bar"><i style={{ width: `${Math.max(3, (100 * v.total) / maxSub)}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Every Wisconsin request</h2>
      <div className="card">
        <table>
          <thead><tr><th>Member</th><th>Recipient &amp; project</th><th>Subcommittee</th>
            <th className="num">Requested</th></tr></thead>
          <tbody>
            {(ears || []).map((e: any) => (
              <tr key={e.id}>
                <td><span className={`chip ${partyLetter(e.party)}`}>{partyLetter(e.party)}</span>{' '}
                  {bioSlug[e.bioguide]
                    ? <Link href={hrefFor.member(bioSlug[e.bioguide])}>{e.member_name}</Link>
                    : e.member_name}<div className="tiny">{e.district}</div></td>
                <td><strong>{e.recipient}</strong><div className="small">{e.project}</div></td>
                <td className="small">{e.subcommittee}</td>
                <td className="num mono">{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a className="btn" style={{ marginTop: 14 }} href={safeUrl((ears || [])[0]?.source_url) || undefined}
          target="_blank" rel="noopener noreferrer">
          House Appropriations FY26 consolidated CPF file (XLSX) ↗
        </a>
      </div>

      <h2 className="section">National context — top 10 requesters</h2>
      <div className="card">
        <table>
          <thead><tr><th>Member</th><th className="num">Requested</th></tr></thead>
          <tbody>
            {top.map((r: any) => (
              <tr key={r.key}><td>{r.key}</td><td className="num mono">{money(r.total)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 8 }}>
          Shown so Wisconsin&apos;s numbers can be read against the rest of the House rather than in
          isolation. A member near the top of this list is not doing anything improper — securing
          federal money for a district is a normal part of the job, and the disclosure requirement
          exists so voters can see it.
        </div>
      </div>
    </div>
  )
}
