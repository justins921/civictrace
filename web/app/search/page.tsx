import Link from 'next/link'
import { db, money, hrefFor, ENTITY_LABEL } from '@/lib/db'

export const revalidate = 600

const KINDS = ['member', 'committee', 'bill', 'sector'] as const

function linkFor(r: { kind: string; key: string }) {
  if (r.kind === 'member') return hrefFor.member(r.key)
  if (r.kind === 'committee') return hrefFor.committee(r.key)
  if (r.kind === 'bill') return hrefFor.bill(r.key)
  return `/sector/${r.key}`
}

export default async function Search({ searchParams }:
  { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams
  const q = (sp.q || '').trim()
  const kind = KINDS.includes(sp.kind as any) ? sp.kind : ''

  let results: any[] = []
  if (q.length >= 2) {
    let qy = db.from('search_index').select('*').ilike('title', `%${q}%`).limit(200)
    if (kind) qy = qy.eq('kind', kind)
    const { data } = await qy
    results = data || []
    const rank = { member: 0, sector: 1, bill: 2, committee: 3 } as Record<string, number>
    results.sort((a, b) => {
      const ax = a.title.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1
      const bx = b.title.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1
      return ax - bx || (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) ||
        Number(b.amount || 0) - Number(a.amount || 0)
    })
  }

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.kind] = (counts[r.kind] || 0) + 1

  return (
    <div className="wrap">
      <h1 className="section">Search</h1>
      <p className="lede">
        Politicians, contributing committees, bills and sectors. Every result opens a page built
        from primary records, with links back to the original filing.
      </p>

      <form action="/search" method="get" className="card">
        <label className="eyebrow" htmlFor="q">Search CivicTrace</label>
        <div style={{ marginTop: 8 }}>
          <input id="q" name="q" type="search" defaultValue={q}
            placeholder="Politician, committee, bill or sector…" autoFocus />
        </div>
        {kind && <input type="hidden" name="kind" value={kind} />}
        <button className="btn solid" style={{ marginTop: 12 }} type="submit">Search</button>
      </form>

      {q.length >= 2 && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0' }}>
            <Link className={`badge ${kind ? 'b-low' : 'b-some'}`}
              href={`/search?q=${encodeURIComponent(q)}`}>All {results.length}</Link>
            {KINDS.map(k => (
              <Link key={k} className={`badge ${kind === k ? 'b-some' : 'b-low'}`}
                href={`/search?q=${encodeURIComponent(q)}&kind=${k}`}>
                {ENTITY_LABEL[k]} · {counts[k] || 0}
              </Link>
            ))}
          </div>

          <div className="grid g3">
            {results.slice(0, 60).map(r => (
              <Link key={r.kind + r.key} href={linkFor(r)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className="badge b-low">{ENTITY_LABEL[r.kind]}</span>
                <h3 className="clamp3" style={{ marginTop: 10, fontSize: 15.5 }}
                  title={r.title}>{r.title}</h3>
                <div className="small">{r.subtitle}</div>
                {r.amount != null && Number(r.amount) > 0 && (
                  <>
                    <div className="rule" />
                    <div className="stat"><span>To Wisconsin members</span>
                      <b>{money(r.amount)}</b></div>
                  </>
                )}
              </Link>
            ))}
          </div>

          {results.length === 0 && (
            <div className="card">
              <h3>Nothing matched &ldquo;{q}&rdquo;</h3>
              <p className="small" style={{ marginBottom: 0 }}>
                This prototype covers Wisconsin&apos;s ten federal members and the committees, bills
                and sectors connected to them. State legislators, state committees and local races
                are not loaded yet — that is a known gap, listed on the{' '}
                <Link href="/methodology">methodology page</Link>, not a search failure.
              </p>
            </div>
          )}
          {results.length > 60 && (
            <div className="card small" style={{ marginTop: 14 }}>
              Showing 60 of {results.length} matches. Narrow the search or filter by type above.
            </div>
          )}
        </>
      )}

      {q.length < 2 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Try one of these</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {['Baldwin', 'Van Orden', 'Realtors', 'Energy', 'ROTOR', 'Northwestern Mutual']
              .map(x => (
                <Link key={x} className="badge b-some" href={`/search?q=${encodeURIComponent(x)}`}>{x}</Link>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
