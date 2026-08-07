import Link from 'next/link'
import { db, money, partyLetter, labelClass, trailHref, LABELS, isYes, hrefFor, labelCounts, noSignalShare, CYCLE } from '@/lib/db'
import { Gauge } from '@/components/Gauge'

export const metadata = {
  title: 'Money trails — CivicTrace',
  description: "Member-vote pairs where a bill's industry overlaps with PAC money the member received. Not an allegation.",
}

const PER_PAGE = 60

/* No `revalidate` here on purpose. This route reads `searchParams`, which makes
   it dynamically rendered on every request — there is no static output for a
   revalidation window to apply to, and the export that used to sit here read as
   though the page were cached for an hour when nothing about it ever was. */

const pc = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')

export default async function Trails({ searchParams }:
  { searchParams: Promise<{ label?: string; member?: string; p?: string }> }) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.p || '1', 10) || 1)

  // C-05: this said "All 591" and rendered 60, with nothing to click. Every one
  // of the 591 is now reachable. `rank` is unique per trail, so the sort is
  // stable across pages — an unstable sort silently drops and repeats rows when
  // you page through it.
  let qy = db.from('trail_full').select('*', { count: 'exact' }).eq('cycle', CYCLE).order('rank')
  if (sp.label) qy = qy.eq('display_label', sp.label)
  if (sp.member) qy = qy.eq('slug', sp.member)
  qy = qy.range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

  const [{ data: trails, count: matched }, labels, { data: sym }, { data: members }] =
    await Promise.all([
    qy,
    labelCounts(),   // shared with the home page — see lib/db.ts
    // bounds-ok: one row per (label, party) — at most a dozen.
    db.from('label_symmetry').select('*').limit(100),
    // bounds-ok: Wisconsin's delegation is ten members.
    db.from('member').select('slug,full_name,party').order('full_name').limit(50),
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

  const { counts, total, partitions: labelsPartition } = labels
  const labelled = Object.values(counts).reduce((a, n) => a + n, 0)

  // C1. This headline figure was computed on LABELS[2] + LABELS[3] and printed
  // 61%. LABELS[2] is "Contested vote, industry money present" — a contested
  // vote with industry money on it is precisely the case that *does* carry
  // signal, and counting it as noise understated the site's own honesty
  // statistic by 28 points. The two no-signal states are the last two:
  // party-line, and near-unanimous. It is defined here, once, and both this
  // page and every member page read it, because the same number was previously
  // being written out by hand in three places and disagreed in all three.
  const noSignalPct = noSignalShare(counts, total)

  const byParty: Record<string, number> = {}
  for (const s of sym || []) byParty[s.party] = (byParty[s.party] || 0) + Number(s.n)
  const R = byParty['Republican'] || 0, D = byParty['Democrat'] || 0

  // Delegation composition is counted from the data, never hardcoded, so the
  // comparison cannot drift out of date when a seat changes hands.
  const delR = (members || []).filter((m: any) => m.party === 'Republican').length
  const delD = (members || []).filter((m: any) => m.party === 'Democrat').length

  return (
    <div className="wrap">
      <h1 className="section">Money trails</h1>
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
              {noSignalPct}% of overlaps carry no usable signal
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
              <span className={`badge ${labelClass(t.display_label ?? t.label).badge}`}>{t.display_label ?? t.label}</span>
              <Gauge angle={labelClass(t.display_label ?? t.label).angle} size={62} />
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
