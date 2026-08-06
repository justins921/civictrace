import Link from 'next/link'
import { db, fetchAll } from '@/lib/db'

export const metadata = {
  title: 'Every recorded vote — CivicTrace',
  description: 'All 505 roll calls the Wisconsin delegation took part in — bills, amendments, nominations and procedural motions, each with its own page and its source file.',
}

/* No `revalidate` here on purpose. This route reads `searchParams`, which makes
   it dynamically rendered on every request — there is no static output for a
   revalidation window to apply to, and the export that used to sit here read as
   though the page were cached for an hour when nothing about it ever was. */

const PER_PAGE = 80

const KIND = (legis: string | null) => {
  const s = (legis || '').trim().toUpperCase()
  if (!s) return 'procedural'
  if (s.startsWith('PN')) return 'nomination'
  if (s.includes('AMDT')) return 'amendment'
  if (/^[A-Z. ]+\d+$/.test(s)) return 'bill'
  return 'procedural'
}

const KINDS = ['bill', 'amendment', 'nomination', 'procedural'] as const

export default async function Votes({ searchParams }:
  { searchParams: Promise<{ kind?: string; p?: string }> }) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.p || '1', 10) || 1)

  // Fetched in full because the kind of a vote is derived from its label rather
  // than stored, so it cannot be filtered in the query. `fetchAll` pages past
  // PostgREST's 1000-row ceiling and throws rather than truncating, which
  // replaces the "if this ever crosses 1000" note that used to sit here with
  // something that actually holds when it does.
  const [all, bills] = await Promise.all([
    fetchAll<any>('rollcall', (q) =>
      q.order('iso_date', { ascending: false }).order('vote_key', { ascending: false })),
    // 2,419 bills and growing — this was capped at 1,000, so every vote whose
    // bill sorted past the cap rendered as a bare label with no link to the
    // bill page that exists for it.
    fetchAll<any>('bill', (q) => q.order('bill_key'),
      { columns: 'bill_key,bill_type,bill_num' }),
  ])

  const norm = (v: string) => (v || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  const billFor: Record<string, string> = {}
  for (const b of bills) billFor[norm(b.bill_type + b.bill_num)] = b.bill_key

  const counts: Record<string, number> = {}
  for (const r of all) counts[KIND(r.legis_num)] = (counts[KIND(r.legis_num)] || 0) + 1

  const filtered = sp.kind ? all.filter((r: any) => KIND(r.legis_num) === sp.kind) : all
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const shown = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const qs = (over: Record<string, string | undefined>) => {
    const o: Record<string, string> = {}
    if (sp.kind) o.kind = sp.kind
    for (const [k, v] of Object.entries(over)) { if (v) o[k] = v; else delete o[k] }
    const q = new URLSearchParams(o).toString()
    return q ? `/votes?${q}` : '/votes'
  }

  return (
    <div className="wrap">
      <h1 className="section">Every recorded vote</h1>
      <p className="lede">
        All <strong>{all.length.toLocaleString()}</strong> roll calls a Wisconsin member took part
        in this Congress. Most transparency sites publish the votes attached to bills and drop the
        rest. The rest is <strong>{(all.length - (counts.bill || 0)).toLocaleString()}</strong> of
        these — amendments, nominations and procedural motions — and amendments in particular are
        where narrow carve-outs get written, on splits that a final-passage vote does not show.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 16px' }}>
        <Link className={`badge ${sp.kind ? 'b-low' : 'b-some'}`} href="/votes">
          All {all.length.toLocaleString()}
        </Link>
        {KINDS.map(k => (
          <Link key={k} className={`badge ${sp.kind === k ? 'b-some' : 'b-low'}`}
            href={qs({ kind: k, p: undefined })}>
            {k} · {counts[k] || 0}
          </Link>
        ))}
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Vote</th><th>Question</th><th>Kind</th>
            <th className="mono">Date</th><th className="num">Result</th></tr></thead>
          <tbody>
            {shown.map((r: any) => {
              const kind = KIND(r.legis_num)
              const bk = kind === 'bill' ? billFor[norm(r.legis_num)] : null
              return (
                <tr key={r.vote_key}>
                  <td>
                    <Link href={`/vote/${encodeURIComponent(r.vote_key)}`}>
                      <strong>{r.legis_num || r.vote_question || r.vote_key}</strong>
                    </Link>
                    <div className="tiny">{r.chamber} roll call {r.rollnum}</div>
                  </td>
                  <td className="small clamp2" title={r.vote_desc}>{r.vote_desc || r.vote_question}</td>
                  <td className="small">
                    {kind}
                    {bk && <div className="tiny"><Link href={`/bill/${bk}`}>bill page →</Link></div>}
                  </td>
                  <td className="small mono">{r.iso_date || r.action_date}</td>
                  <td className="num small">{r.vote_result}<div className="tiny mono">{r.yea}–{r.nay}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 10 }}>
          Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
          {sp.kind ? ` ${sp.kind} votes` : ' votes'}.
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
