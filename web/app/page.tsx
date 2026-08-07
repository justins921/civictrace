import Link from 'next/link'
import { db, money, shortMoney, partyLetter, officeLine, labelClass, trailHref, labelCounts, noSignalShare, LABELS, CYCLE } from '@/lib/db'
import { Sleuth, DonorArt, CapitolArt, BillArt } from '@/components/Art'

export const revalidate = 3600

const pct = (n: number, d: number) => {
  if (!d) return '0%'
  const v = (100 * n) / d
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`
}

export default async function Home() {
  // These numbers are the site's headline statistic, and they have to be the
  // same numbers /trails prints. They were not: this page ran
  // `select('label')` unbounded and counted the rows, PostgREST capped the
  // response at 1000 of 1,032, and the truncation landed almost entirely in one
  // bucket — the home page advertised 56 "Some overlap" trails against the real
  // 88, and a total of a suspiciously round 1000. Both pages now call the same
  // helper, so they cannot disagree again without both being wrong together.
  const [{ data: members }, { data: trails }, labels, { data: agg }, { count: rc }] =
    await Promise.all([
      // bounds-ok: Wisconsin's delegation is ten members.
      db.from('member').select('*').order('chamber', { ascending: false }).order('district').limit(50),
      db.from('trail_full').select('*').eq('cycle', CYCLE).order('rank').limit(3),
      labelCounts(),
      // bounds-ok: earmark_agg is pre-aggregated — party rows, one national
      // row, and a top-ten. Twenty rows at the outside.
      db.from('earmark_agg').select('*').limit(200),
      db.from('rollcall').select('*', { count: 'exact', head: true }),
    ])

  const { counts, total } = labels
  const nat = (agg || []).find((a: any) => a.scope === 'national')
  const noSignalPct = noSignalShare(counts, total)

  return (
    <>
      <section className="hero">
        <div className="wrap hero-in">
          <div style={{ flex: 1 }}>
            <h1>Follow the money trail</h1>
            <p className="sub">
              See how campaign money moved, who received it, and how later actions aligned with
              donor interests — every figure linked to the government filing it came from.
            </p>
            <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="btn solid" href="/trails">Open the money trails</Link>
              <Link className="btn" href="/delegation">Browse the delegation</Link>
            </div>
          </div>
          <div className="hero-art"><Sleuth size={104} /></div>
          <div className="speech">
            We follow the public records.<br />You draw the conclusion.
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="grid g4" style={{ marginTop: 24 }}>
          {[
            ['Members traced', String((members || []).length), 'Wisconsin’s federal delegation'],
            ['Roll call votes', String(rc || 0), '119th Congress, both chambers'],
            ['Money trails built', total.toLocaleString(), 'money-and-vote overlaps examined'],
            ['Earmark requests', Number(nat?.n || 0).toLocaleString(), `${shortMoney(nat?.total)} nationally, FY2026`],
          ].map(([k, v, s]) => (
            <div className="card" key={k}>
              <div className="eyebrow">{k}</div>
              <div className="kpi mono">{v}</div>
              <div className="small">{s}</div>
            </div>
          ))}
        </div>

        {/* The honesty panel, on the front page on purpose. */}
        <h2 className="section">What the engine actually concluded</h2>
        <p className="lede">
          This is the number most transparency tools bury. Out of {total.toLocaleString()} money-and-vote
          overlaps in Wisconsin&apos;s delegation, <strong>{noSignalPct}%</strong> turn out to mean
          nothing — the vote was near-unanimous, or the member simply voted with their party. A tool
          that produced a scandal from every one of these would be lying to you.
        </p>
        <div className="grid g3">
          {[...LABELS].reverse().map(l => (
              <div className="card" key={l}>
                <span className={`badge ${labelClass(l).badge}`}>{l}</span>
                <div className="kpi mono" style={{ marginTop: 10 }}>{counts[l] || 0}</div>
                <div className="small">
                  {pct(counts[l] || 0, total)} of all trails
                </div>
              </div>
            ))}
        </div>

        <h2 className="section">
          {(trails || []).length === 1 ? 'The one worth reading first'
            : `The ${(trails || []).length} worth reading first`}
        </h2>
        {(counts[LABELS[0]] || 0) === 0 && (
          <div className="note">
            <strong>Nothing currently carries our strongest label, and we would rather say so than
            promote something to fill the slot.</strong> Until August 6 three trails did. All three
            were wrong: two were votes on amendments, whose subject appears nowhere in the
            roll-call record but which inherit the parent bill&apos;s industry, and the third
            matched an aviation safety bill to railroad and construction money because our
            industry categories were a level too coarse.
            {(counts[LABELS[2]] || 0) === 0 && (
              <> The two <em>one-sided industry money</em> labels are empty for a second and
              narrower reason: calling money one-sided now requires that the industry has a
              declared two-sided axis, that most of its money to that member sits on one pole or
              the other, and that one pole is at least twice the size of the other. Until August 6
              an industry with <em>no</em> axis passed that test automatically, because two zeroes
              compared as a landslide. Nothing in the current data clears the real version.</>
            )}{' '}
            See the <Link href="/corrections">corrections log</Link>.
          </div>
        )}
        <p className="lede">
          These trails ranked highest under our conservative methodology, which weighs the sector&apos;s
          share of the member&apos;s PAC money, how contested the vote was, the timing, and how the
          member&apos;s own party voted. Ranking highest is a reason to read the underlying filings.
          It is not a finding, and it is not a claim that any member departed from their party — the
          party figure is printed on each card below so you can see it for yourself.
        </p>
        <div className="grid g3">
          {(trails || []).map((t: any) => (
            <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <span className={`badge ${labelClass(t.display_label ?? t.label).badge}`}>{t.display_label ?? t.label}</span>
              <h3 className="clamp3" style={{ marginTop: 12 }}
                title={t.bill_title || t.vote_desc}>{t.bill_title || t.vote_desc}</h3>
              <div className="small" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className={`chip ${partyLetter(t.party)}`}>{partyLetter(t.party)}</span>
                {t.full_name} voted <strong>{t.position}</strong> on {t.legis_num}
              </div>
              <div className="rule" />
              <div className="stat"><span>Sector money</span><b>{money(t.sector_dollars)}</b></div>
              <div className="stat"><span>Share of their PAC money</span><b>{t.sector_share_pct}%</b></div>
              <div className="stat"><span>Own party voted the same way</span>
                <b>{t.party_line_share_pct}%</b></div>
            </Link>
          ))}
        </div>

        <h2 className="section">How a trail is built</h2>
        <div className="grid g3">
          {[
            [<DonorArt key="a" sector="Finance" size={62} />, 'Start with a filed contribution',
              'A committee reports giving money to a campaign on FEC Schedule B. We keep the FEC image number so you can open the original filing.'],
            [<CapitolArt key="b" size={62} />, 'Attach the recorded vote',
              'The member’s position comes from the House Clerk or Senate roll call XML. Absences are never counted as positions.'],
            [<BillArt key="c" size={62} />, 'Add the context that changes the meaning',
              'How the chamber voted, how their party voted, and how much money came from the other side of the same industry.'],
          ].map(([art, h, p], i) => (
            <div className="card" key={i}>
              <div className="step-art" style={{ marginBottom: 12 }}>{art}</div>
              <h3>{h as string}</h3>
              <div className="small">{p as string}</div>
            </div>
          ))}
        </div>

        <div className="note" style={{ marginTop: 22 }}>
          <strong>What CivicTrace will never do.</strong> It will never say a contribution caused a
          vote. It will never rank politicians against each other. It will never take a position on
          a bill. Every sector label is produced by a published rule with an ID you can look up, and
          every number on this site links to the government document it came from.
        </div>
      </div>
    </>
  )
}
