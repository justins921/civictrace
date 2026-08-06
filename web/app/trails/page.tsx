import Link from 'next/link'
import { db, money, partyLetter, labelClass, trailHref, LABELS, isYes, hrefFor } from '@/lib/db'
import { Gauge } from '@/components/Gauge'

const PER_PAGE = 60

export const revalidate = 3600

const pc = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')

export default async function Trails({ searchParams }:
  { searchParams: Promise<{ label?: string; member?: string; p?: string }> }) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.p || '1', 10) || 1)

  // C-05: this said "All 591" and rendered 60, with nothing to click. Every one
  // of the 591 is now reachable. `rank` is unique per trail, so the sort is
  // stable across pages — an unstable sort silently drops and repeats rows when
  // you page through it.
  let qy = db.from('trail_full').select('*', { count: 'exact' }).order('rank')
  if (sp.label) qy = qy.eq('label', sp.label)
  if (sp.member) qy = qy.eq('slug', sp.member)
  qy = qy.range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

  // Label counts come back as counts, not as rows to be counted here.
  //
  // This used to be `select('label')` over the whole table, tallied in JS. That
  // is fine until the table passes PostgREST's 1000-row ceiling, which it did
  // the moment the House vote backfill landed: the lede read "1000 member-vote
  // pairs" while the pagination directly below it read "1,032 trails", and the
  // label percentages were computed from a truncated sample presented as the
  // whole. Same defect as the cross-cycle total — a figure that is only correct
  // while the data stays small.
  const [{ data: trails, count: matched }, labelCounts, { count: grandTotal },
         { data: sym }, { data: members }] = await Promise.all([
    qy,
    Promise.all(LABELS.map(async (l: string) => {
      const { count } = await db.from('money_trail')
        .select('label', { count: 'exact', head: true }).eq('label', l)
      return [l, count || 0] as const
    })),
    db.from('money_trail').select('label', { count: 'exact', head: true }),
    db.from('label_symmetry').select('*'),
    db.from('member').select('slug,full_name,party').order('full_name'),
  ])

  const shown = (trails || []).length
  const totalMatched = matched || 0
  const pages = Math.max(1, Math.ceil(totalMatched / PER_PAGE))
  const qs = (over: Record<string, string | undefined>) => {
    const o: Record<string, string> = {}
    if (sp.label) o.label = sp.label
    if (sp.member) o.member = sp.member
    for (const [k, v] of Object.entries(over)) { if (v) o[k] = v; else delete o[k] }
    const q = new URLSearchParams(o).toString()
    return q ? `/trails?${q}` : '/trails'
  }

  const counts: Record<string, number> = Object.fromEntries(labelCounts)
  const total = grandTotal || 0
  // If the labels ever stop partitioning the table, the breakdown below is
  // describing something other than the total printed beside it.
  const labelled = labelCounts.reduce((a, [, n]) => a + n, 0)
  const labelsPartition = labelled === total

  const byParty: Record<string, number> = {}
  for (const s of sym || []) byParty[s.party] = (byParty[s.party] || 0) + Number(s.n)
  const R = byParty['Republican'] || 0, D = byParty['Democrat'] || 0

  // Delegation composition is counted from the data, never hardcoded, so the
  // comparison cannot drift out of date when a seat changes hands.
  const delR = (members || []).filter((m: any) => m.party === 'Republican').length
  const delD = (members || []).filter((m: any) => m.party === 'Democrat').length

  return (
    <div className="wrap">
      <h2 className="section">Money trails</h2>
      <p className="lede">
        {total.toLocaleString()} member-vote pairs where a bill&apos;s sector overlaps with PAC
        money the member received. A trail appearing here is <strong>not</strong> an allegation.
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <Gauge angle={-66} size={120} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="eyebrow">What the engine actually concluded</div>
            <div className="verdict v-none" style={{ fontSize: 19 }}>
              {Math.round((100 * ((counts[LABELS[2]] || 0) + (counts[LABELS[3]] || 0))) / (total || 1))}%
              {' '}of overlaps carry no usable signal
            </div>
            <div className="small">
              Read that number carefully, because it is the whole point. Most of the time, money and
              a vote line up for the boring reason: the member voted with their party, or the vote
              wasn&apos;t close. Saying so out loud, repeatedly, is what makes the remaining few
              worth anyone&apos;s attention.
            </div>
          </div>
        </div>
        <div className="rule" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className={`badge ${sp.label ? 'b-low' : 'b-some'}`} href="/trails">All {total.toLocaleString()}</Link>
          {LABELS.map(l => (
            <Link key={l} href={qs({ label: l, member: undefined, p: undefined })}
              className={`badge ${sp.label === l ? 'b-some' : labelClass(l).badge}`}>
              {l} · {counts[l] || 0}
            </Link>
          ))}
        </div>
        {!labelsPartition && (
          <p className="tiny" style={{ marginTop: 8, marginBottom: 0, color: '#b23c45' }}>
            These label counts add to {labelled.toLocaleString()}, not {total.toLocaleString()}.
            That is a bug in our classification, not a finding — please{' '}
            <Link href="/contact">report it</Link>.
          </p>
        )}
        <div className="rule" />
        <div className="eyebrow">Partisan symmetry check — published on purpose</div>
        <div className="small" style={{ marginTop: 6 }}>
          Republicans account for <strong>{pc(R, R + D)}</strong> of the identified trails and{' '}
          <strong>{pc(delR, delR + delD)}</strong> of Wisconsin&apos;s congressional delegation.
          Democrats account for <strong>{pc(D, R + D)}</strong> of the trails and{' '}
          <strong>{pc(delD, delR + delD)}</strong> of the delegation.
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          We publish this because a ruleset can be biased without anyone intending it, and the share
          of trails by party is the cheapest way for a reader to check. These figures are close, but
          we are not claiming they should match exactly — a larger delegation caucus will naturally
          produce more trails, and members cast different numbers of votes. What we watch for is a
          <em> large</em> gap, which would indicate a bug in our classification rules rather than a
          finding about politicians. If you spot one, please <Link href="/contact">tell us</Link>.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0' }}>
        {(members || []).map((m: any) => (
          <Link key={m.slug} href={qs({ member: m.slug, label: undefined, p: undefined })}
            className={`badge ${sp.member === m.slug ? 'b-some' : 'b-low'}`}>
            <span className={`chip ${partyLetter(m.party)}`}
              style={{ width: 15, height: 15, fontSize: 9, marginRight: 5, verticalAlign: -2 }}>
              {partyLetter(m.party)}</span>
            {m.full_name}
          </Link>
        ))}
      </div>

      <div className="grid g3">
        {(trails || []).map((t: any) => (
          <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
            style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
              <span className={`badge ${labelClass(t.label).badge}`}>{t.label}</span>
              <Gauge angle={labelClass(t.label).angle} size={62} />
            </div>
            <h3 className="clamp3" style={{ marginTop: 8, fontSize: 15.5 }}
              title={t.bill_title || t.vote_desc}>{t.bill_title || t.vote_desc}</h3>
            <div className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`chip ${partyLetter(t.party)}`}>{partyLetter(t.party)}</span>
              {t.full_name} voted{' '}
              <strong className={isYes(t.position) ? 'vote-Y' : 'vote-N'}>{t.position}</strong>
            </div>
            <div className="rule" />
            <div className="stat">
              <span className="clamp2">{(t.sectors || []).map((s: any) => s.sector).join(', ')}</span>
              <b>{money(t.sector_dollars)}</b></div>
            <div className="stat"><span>Share of their PAC money</span><b>{t.sector_share_pct}%</b></div>
            <div className="stat"><span>Own party voted the same</span>
              <b>{t.party_line_share_pct ?? '—'}%</b></div>
          </Link>
        ))}
      </div>
      {shown === 0 && <div className="card small">No trails match that filter.</div>}

      {shown > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="small">
            Showing <strong>{((page - 1) * PER_PAGE + 1).toLocaleString()}</strong>–
            <strong>{((page - 1) * PER_PAGE + shown).toLocaleString()}</strong> of{' '}
            <strong>{totalMatched.toLocaleString()}</strong>
            {sp.label || sp.member ? ' matching trails' : ' trails'} · page {page} of {pages}
          </div>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap',
              alignItems: 'center' }}>
              {page > 1 && <Link className="btn" href={qs({ p: page === 2 ? undefined : String(page - 1) })}>
                ← Previous</Link>}
              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === pages || Math.abs(n - page) <= 2)
                .map((n, i, arr) => (
                  <span key={n}>
                    {i > 0 && arr[i - 1] !== n - 1 && <span className="small" style={{ padding: '0 4px' }}>…</span>}
                    <Link className={`badge ${n === page ? 'b-some' : 'b-low'}`}
                      href={qs({ p: n === 1 ? undefined : String(n) })}
                      aria-current={n === page ? 'page' : undefined}>{n}</Link>
                  </span>
                ))}
              {page < pages && <Link className="btn" href={qs({ p: String(page + 1) })}>Next →</Link>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
