import Link from 'next/link'
import { db, money, hrefFor, ENTITY_LABEL, countRows } from '@/lib/db'

export const metadata = {
  title: 'Search — CivicTrace',
  description: 'Search Wisconsin politicians, contributing committees, bills and sectors.',
}

/* No `revalidate` here on purpose. This route reads `searchParams`, which makes
   it dynamically rendered on every request — there is no static output for a
   revalidation window to apply to, and the export that used to sit here read as
   though the page were cached for an hour when nothing about it ever was. */

const SHOW = 60
const KINDS = ['member', 'committee', 'bill', 'sector'] as const

function linkFor(r: { kind: string; key: string }) {
  if (r.kind === 'member') return hrefFor.member(r.key)
  if (r.kind === 'committee') return hrefFor.committee(r.key)
  if (r.kind === 'bill') return hrefFor.bill(r.key)
  return `/sector/${r.key}`
}

/* `%` and `_` are wildcards to `ilike`, so a search for "50%" matched
   everything containing "50". Escape them, and the backslash that escapes
   them, before they reach the pattern. */
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

export default async function Search({ searchParams }:
  { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams
  const q = (sp.q || '').trim()
  const kind = KINDS.includes(sp.kind as any) ? sp.kind : ''

  /* C4. Every number on this page — the facet counts, "All N", "showing 60 of
     N" — used to be derived by counting an unordered 200-row slice. Searching
     "act" returned 200 arbitrary rows out of 1,268 real matches; because
     PostgREST returned them in physical order and members happen to be stored
     first, the Bill facet rendered "Bill · 0" against 1,071 actual bills, and
     the filter it linked to then showed them. A count of a page is not a count.

     Counts now come from the database. The rows shown come from two bounded
     queries — titles that *start* with the term first, since that is what a
     reader means by a good match, then titles that merely contain it. */
  let results: any[] = []
  const counts: Record<string, number> = {}
  let matched = 0

  if (q.length >= 2) {
    const contains = `%${esc(q)}%`
    const startsWith = `${esc(q)}%`
    const only = (qy: any) => (kind ? qy.eq('kind', kind) : qy)
    /* PostgREST's `or=` is a comma-separated list wrapped in parentheses, so a
       term containing a comma, a quote or a bracket would change the shape of
       the filter rather than be searched for. Those characters are rare in a
       name or a bill number; when one appears we drop to the single-column
       form rather than trying to escape our way out of a grammar. */
    const orPrefix = /["',()\\]/.test(q) ? null : esc(q)

    /* Built as statements rather than one expression so the bound is visibly
       attached to the query it bounds — `npm run check:bounds` reads the chain
       and a `.limit()` applied outside a ternary is a bound it cannot see, and
       should not have to guess at. */
    const tier = (mode: 'prefix' | 'contains') => {
      let x: any = db.from('search_index').select('*')
      if (kind) x = x.eq('kind', kind)
      if (mode === 'prefix') {
        /* The display name — or the identifier under it — starts with what
           they typed. Searching "H.R. 1346" used to surface, first, a
           procedural rule whose 900-word title mentions H.R. 1346 five clauses
           in, because both rows are bills and the tie broke alphabetically. A
           bill's number lives in its subtitle, so a subtitle prefix match is
           the strongest available signal that this is the row they asked for. */
        x = orPrefix
          ? x.or(`title.ilike."${orPrefix}%",subtitle.ilike."${orPrefix}%"`)
          : x.ilike('title', startsWith)
      } else {
        x = x.ilike('search_text', contains).not('title', 'ilike', startsWith)
        if (orPrefix) x = x.not('subtitle', 'ilike', startsWith)
      }
      return x.order('amount', { ascending: false, nullsFirst: false })
              .order('title').limit(SHOW)
    }

    const [totalCount, kindCounts, { data: pre }, { data: rest }] = await Promise.all([
      countRows('search_index', (qy: any) => only(qy).ilike('search_text', contains)),
      Promise.all(KINDS.map(async (k) => [
        k, await countRows('search_index',
          (qy: any) => qy.eq('kind', k).ilike('search_text', contains)),
      ] as const)),
      tier('prefix'),
      tier('contains'),
    ])

    matched = totalCount
    for (const [k, n] of kindCounts) counts[k] = n

    const rank = { member: 0, sector: 1, bill: 2, committee: 3 } as Record<string, number>
    const byRank = (a: any, b: any) =>
      (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || Number(b.amount || 0) - Number(a.amount || 0)
    results = [...(pre || []).sort(byRank), ...(rest || []).sort(byRank)].slice(0, SHOW)
  }

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
              href={`/search?q=${encodeURIComponent(q)}`}>
              All {Object.values(counts).reduce((a, n) => a + n, 0).toLocaleString()}</Link>
            {KINDS.map(k => (
              <Link key={k} className={`badge ${kind === k ? 'b-some' : 'b-low'}`}
                href={`/search?q=${encodeURIComponent(q)}&kind=${k}`}>
                {ENTITY_LABEL[k]} · {counts[k] || 0}
              </Link>
            ))}
          </div>

          <div className="grid g3">
            {results.map(r => (
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

          {matched === 0 && (
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
          {matched > results.length && (
            <div className="card small" style={{ marginTop: 14 }}>
              Showing {results.length} of {matched.toLocaleString()} matches, closest first.
              Narrow the search or filter by type above.
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
