import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, officeLine, labelClass, trailHref, isYes, hrefFor, safeUrl, CYCLE, CYCLE_LABEL, labelCounts, noSignalShare, countRows, SITE_URL } from '@/lib/db'
import { CapitolArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  // bounds-ok: Wisconsin's federal delegation is ten people; a fifty-row cap on
  // a body fixed by the Constitution at 8 House seats and 2 Senate seats is not
  // a truncation risk. It is still written down rather than left unbounded.
  const { data } = await db.from('member').select('slug').limit(50)
  return (data || []).map((m: any) => ({ slug: m.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: m } = await db.from('member').select('full_name,chamber,district,party')
    .eq('slug', slug).maybeSingle()
  if (!m) return { title: 'Member — CivicTrace' }
  const title = `${m.full_name} — CivicTrace`
  const description =
    `Campaign money, recorded votes, cosponsorships, earmark requests and independent ` +
    `spending for ${m.full_name} (${m.party}, ${officeLine(m)}), every figure linked to the ` +
    `government filing it came from.`
  return {
    title, description,
    alternates: { canonical: `${SITE_URL}/member/${slug}` },
    openGraph: { title, description, url: `${SITE_URL}/member/${slug}` },
  }
}

export default async function Member({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: m } = await db.from('member').select('*').eq('slug', slug).single()
  if (!m) notFound()

  const [{ data: sectors }, { data: cmtes }, { data: trails }, { data: votes }, { data: ears },
         { data: totalsRows }, { data: ieRows }, { data: assigns },
         { data: sponsored, error: sponsorErr }, { data: indivRows }, labels, cosponsorCount] =
    await Promise.all([
      // bounds-ok: one row per sector this member took money from — the sector
      // vocabulary is a fixed list of ~25 names written by sectors.py.
      db.from('member_sector_money').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .limit(200),
      db.from('member_top_committee').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('total', { ascending: false }).limit(25),
      db.from('trail_full').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('rank').limit(12),
      /* The 15 most recent votes, ordered by the database.
    
         `.order(col, { referencedTable })` sorts rows *inside* an embedded
         resource — it does nothing to the order of the parent rows, so ordering
         `vote_position` by `rollcall.iso_date` sorted a one-element embed 283
         times and returned the parent rows in whatever order PostgREST felt
         like. The comment that used to sit here claimed the opposite, which is
         worse than no comment: it told the next reader the cap was safe.
    
         Query the other way round. `rollcall` is the parent, so its own
         `iso_date` is a top-level column and `order` means what it says; the
         inner join to vote_position filters to this member's votes. */
      db.from('rollcall').select('*, vote_position!inner(*)')
        .eq('vote_position.bioguide', m.bioguide)
        .order('iso_date', { ascending: false }).order('vote_key', { ascending: false })
        .limit(15),
      // bounds-ok: House rules cap earmark requests at 15 per member per year.
      db.from('earmark').select('*').eq('bioguide', m.bioguide)
        .order('amount', { ascending: false }).limit(200),
      // Context, never arithmetic. `candidate_totals` is the denominator this
      // page was missing: PAC money is 64% of Gwen Moore's receipts and 4.5% of
      // Tammy Baldwin's, and printing both the same way implied the trail below
      // means the same thing for both members. It does not.
      // bounds-ok: one row per candidate committee this member has — at most a
      // handful, and every one of them is summed below rather than sampled.
      db.from('candidate_totals').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE).limit(50),
      // bounds-ok: ie_agg is one pre-aggregated row per member per cycle.
      db.from('ie_agg').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE).limit(10),
      // bounds-ok: no member sits on more than a dozen committees.
      db.from('committee_assignment').select('*').eq('bioguide', m.bioguide)
        .not('jurisdiction_sectors', 'is', null).limit(100),
      // The table below shows 25. This asks for 26 so "showing 25 of N" can be
      // written honestly without pulling 2,254 rows to count them — the exact
      // N comes from countRows, running beside this.
      db.from('bill_sponsor').select('*, bill(bill_key,title,bill_type,bill_num,policy_area)')
        .eq('bioguide', m.bioguide).order('sponsored_date', { ascending: false }).limit(26),
      // bounds-ok: individual_agg holds a bounded set of dimension rows per
      // member — one 'all', ~6 size bands, 50-odd states, and the occupation
      // and employer buckets that survived the three-donor floor.
      db.from('individual_agg').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('total', { ascending: false }).limit(1000),
      labelCounts(),
      countRows('bill_sponsor', (q: any) => q.eq('bioguide', m.bioguide)),
    ])

  const secs = (sectors || []).slice().sort((a: any, b: any) => Number(b.total) - Number(a.total))
  const total = secs.reduce((a: number, s: any) => a + Number(s.total), 0)
  // Already the fifteen newest, ordered and limited by Postgres. The embed is
  // this member's single position on each of them.
  const recent = (votes || []).map((r: any) => ({ ...r, pos: (r.vote_position || [])[0] }))
    .filter((r: any) => r.pos)
  const earTotal = (ears || []).reduce((a: number, e: any) => a + Number(e.amount), 0)

  // Sum across committees: a member can have more than one candidate ID.
  const receipts = (totalsRows || []).reduce((a: number, r: any) => a + Number(r.receipts || 0), 0)
  const indiv = (totalsRows || []).reduce((a: number, r: any) => a + Number(r.individual || 0), 0)
  const fecPac = (totalsRows || []).reduce((a: number, r: any) => a + Number(r.pac || 0), 0)
  const covered = receipts > 0 ? (100 * total) / receipts : null
  const fecUrl = (totalsRows || [])[0]?.source_url || null
  const ie = (ieRows || [])[0] || null
  const jurisdiction = Array.from(new Set(
    (assigns || []).flatMap((a: any) => String(a.jurisdiction_sectors || '').split(',')))).filter(Boolean)
  // Third time this pattern has bitten: a failed PostgREST query returns an
  // error and no rows, and a section that renders nothing looks identical to a
  // member who sponsored nothing. This one failed for a week's worth of builds
  // because bill_sponsor had no declared foreign key to bill, so the embed was
  // rejected. Errors are not empty results.
  if (sponsorErr) throw new Error(`sponsorship query failed: ${sponsorErr.message}`)
  const cosponsored = (sponsored || []).filter((r: any) => r.bill)

  // C5. This card printed the number of rows the query returned and called it
  // the number of committees that gave to this member. The query asks for the
  // top 25. Bryan Steil's page therefore said 25 against a real 346 — an
  // eleven-fold understatement of the thing the page exists to show, produced
  // by counting a page size. The count is a sum of per-sector distinct
  // committees, which is already in the response beside it.
  const committeeCount = secs.reduce((a: number, s: any) => a + Number(s.committees || 0), 0)

  // The 87% in the cosponsorship lede was a literal, typed once and never
  // recomputed, against a real 89% that moves every refresh.
  const noSignalPct = noSignalShare(labels.counts, labels.total)

  const indiv_ = (indivRows || [])
  const pick = (dim: string) => indiv_.filter((r: any) => r.dimension === dim)
  const itemized = Number(pick('all')[0]?.total || 0)
  const itemizedN = Number(pick('all')[0]?.donations || 0)
  const homeState = Number(pick('state').find((r: any) => r.key === 'WI')?.total || 0)
  const bands = pick('size_band')
  const occupations = pick('occupation').slice(0, 8)

  return (
    <div className="wrap">
      <div className="card" style={{ marginTop: 22, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="step-art" style={{ margin: 0, flex: 'none' }}><CapitolArt size={78} /></div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: '-1px', color: 'var(--navy)',
            display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`chip ${partyLetter(m.party)}`}>{partyLetter(m.party)}</span>
            {m.full_name}
          </h1>
          <div className="small" style={{ marginTop: 4 }}>
            {officeLine(m)} · {m.party} · term {m.term_start} to {m.term_end}
          </div>
          <div className="link-list" style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {safeUrl(m.official_url) && <a href={safeUrl(m.official_url)!} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
            <a href={`https://www.congress.gov/member/${m.bioguide}`} target="_blank" rel="noopener noreferrer">Congress.gov ↗</a>
            {m.fec_cand_id && <a href={`https://www.fec.gov/data/candidate/${m.fec_cand_id}/`}
              target="_blank" rel="noopener noreferrer">FEC record ↗</a>}
          </div>
        </div>
        <div style={{ flex: 'none' }}>
          <div className="eyebrow">PAC money, {CYCLE_LABEL}</div>
          <div className="kpi mono">{money(total)}</div>
          <div className="small">{committeeCount.toLocaleString()} committees · giver-side ledger</div>
        </div>
      </div>

      {receipts === 0 && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>We could not resolve this member&apos;s FEC filings, so the figures below are
          incomplete rather than low.</strong> A member whose candidate ID we fail to match looks
          identical on this page to a member who genuinely received nothing, and those are not the
          same fact. Please <Link href="/contact">tell us</Link> — this is a bug on our side, not a
          finding about the member.
        </div>
      )}

      {receipts > 0 && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>How much of this member&apos;s money you are looking at:{' '}
          {covered !== null && covered < 1 ? '<1' : Math.round(covered || 0)}%.</strong>{' '}
          They reported <strong>{money(receipts)}</strong> in total receipts this cycle.
          CivicTrace traces the <strong>{money(total)}</strong> that came directly from political
          committees. The largest part of the rest is{' '}
          <strong>{money(indiv)}</strong> from individual contributors, which we do not publish —
          see <Link href="/donors">why</Link>.{' '}
          {covered !== null && covered < 15 && (
            <>Read the trails below with that in mind: for this member the money we can trace is a
            small slice of the money they raised, so the absence of an overlap here is not
            evidence that none exists.</>
          )}
          {safeUrl(fecUrl) && <> <a href={safeUrl(fecUrl)!} target="_blank" rel="noopener noreferrer">Check the FEC&apos;s
            own totals ↗</a></>}
        </div>
      )}

      {ie && (Number(ie.supporting) > 0 || Number(ie.opposing) > 0) && (
        <div className="note">
          <strong>Independent spending is a separate ledger and we never add it to the
          above.</strong> Outside groups reported{' '}
          <strong>{money(ie.supporting)}</strong> supporting and{' '}
          <strong>{money(ie.opposing)}</strong> opposing this member across{' '}
          {Number(ie.filings).toLocaleString()} filings this cycle. That is money spent{' '}
          <em>about</em> a candidate, not money <em>to</em> them — it is subject to no
          contribution limit, and the candidate is legally barred from coordinating it. Two
          different things, shown next to each other, never summed.
          {Number(ie.quarantined) > 0 && (
            <> {Number(ie.quarantined)} further filing(s) were withheld as implausible; the FEC&apos;s
            bulk file is filer-submitted and unvalidated, and currently contains multi-billion-dollar
            entries that are plainly not real.</>
          )}
        </div>
      )}

      {jurisdiction.length > 0 && (
        <div className="note">
          <strong>Committees of jurisdiction:</strong> {jurisdiction.join(' · ')}. Money from an
          industry to a member who writes the laws for it is a different fact from the same money
          to a member with no jurisdiction over it. We record which one this is; whether it
          matters is your call.
        </div>
      )}

      <h2 className="section">Where the money came from</h2>
      <div className="grid g2">
        <div className="card">
          <div className="eyebrow">By sector</div>
          <div style={{ marginTop: 10 }}>
            {secs.map((s: any) => (
              <div key={s.sector} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, gap: 8 }}>
                  <Link href={hrefFor.sector(s.sector)}>{s.sector}</Link>
                  <span className="mono small">{money(s.total)} · {s.committees} cmte</span>
                </div>
                <div className="bar"><i style={{ width: `${total ? Math.max(2, (100 * Number(s.total)) / total) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          {/* Eight, not fourteen. These two cards sit in a stretched row, and a
              fourteen-row table with two-line cells left the sector card beside
              it with ~660px of blank — the same ragged-box problem as before,
              caused by the other half this time. Eight rows lands within a line
              or two of the sector list at every width, and the count below says
              plainly what is not shown. */}
          <div className="eyebrow">Top committees</div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Committee</th><th>Sector</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(cmtes || []).slice(0, 8).map((c: any) => (
                <tr key={c.filer_cmte_id}>
                  <td><Link href={hrefFor.committee(c.filer_cmte_id)}>{c.cmte_name}</Link>
                    <div className="tiny">{c.n_payments} payment{c.n_payments === 1 ? '' : 's'}
                      {c.first_date ? ` · ${c.first_date} → ${c.last_date}` : ''}</div></td>
                  <td className="small">{c.sector
                    ? <Link href={hrefFor.sector(c.sector)}>{c.sector}</Link> : '—'}{c.interest_side ? <><br /><span className="pill">{c.interest_side}</span></> : null}</td>
                  <td className="num mono">{money(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {committeeCount > 8 && (
            <div className="tiny card-foot">
              Showing the 8 largest of <strong>{committeeCount.toLocaleString()}</strong> committees
              that gave to this member in the {CYCLE_LABEL}. Every one of them is listed on{' '}
              <Link href="/donors">the donors page</Link>.
            </div>
          )}
        </div>
      </div>

      {(ears || []).length > 0 && (
        <>
          <h2 className="section">FY2026 earmark requests</h2>
          <p className="lede">
            {(ears || []).length} requests totalling <strong>{money(earTotal)}</strong>, from this
            member&apos;s own required public disclosure. CivicTrace does not call any project
            &ldquo;pork&rdquo; — whether a given project is worthwhile is your judgement.
          </p>
          <div className="card">
            <table>
              <thead><tr><th>Recipient &amp; project</th><th>Subcommittee</th><th className="num">Requested</th></tr></thead>
              <tbody>
                {(ears || []).map((e: any) => (
                  <tr key={e.id}>
                    <td><strong>{e.recipient}</strong><div className="small">{e.project}</div></td>
                    <td className="small">{e.subcommittee}</td>
                    <td className="num mono">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {safeUrl((ears || [])[0]?.member_url) && (
              <a className="btn" style={{ marginTop: 12 }} href={safeUrl((ears || [])[0].member_url)!}
                target="_blank" rel="noopener noreferrer">Member&apos;s own disclosure page ↗</a>
            )}
          </div>
        </>
      )}

      {itemized > 0 && (
        <>
          <h2 className="section">Individual contributors</h2>
          <p className="lede">
            <strong>{money(itemized)}</strong> across{' '}
            <strong>{itemizedN.toLocaleString()}</strong> itemized contributions
            {indiv > 0 && <> — <strong>{Math.round((100 * itemized) / indiv)}%</strong> of the{' '}
            {money(indiv)} in individual money this member reported</>}.
          </p>
          <div className="note">
            <strong>We publish this as aggregates and will not publish it as a name index.</strong>{' '}
            Federal law permits republishing individual contributor records, including names and
            addresses — we checked, and we had it wrong before. But a searchable index of private
            citizens by name, home address, employer and political giving is a different product
            from a record of organised money, and it is the one that gets misused. What matters
            publicly is <em>what kinds of people</em> fund a member, and that survives aggregation
            intact. Employers and occupations with fewer than three donors are grouped rather than
            named, because one donor at a small employer is identifiable from the employer alone.
          </div>
          {indiv > itemized && (
            <div className="note">
              <strong>The missing {money(indiv - itemized)} is not hidden — it is unitemized.</strong>{' '}
              The FEC only requires a contributor be named once their giving passes $200 in
              aggregate, so smaller donations appear in a member&apos;s total but in no public
              record naming anyone. For this member that is{' '}
              <strong>{Math.round((100 * (indiv - itemized)) / indiv)}%</strong> of their
              individual money. Read a large unitemized share as a small-dollar base, not as
              secrecy.
            </div>
          )}
          <div className="grid g2">
            <div className="card">
              <div className="eyebrow">By size of contribution</div>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Band</th><th className="num">Contributions</th>
                  <th className="num">Total</th></tr></thead>
                <tbody>
                  {bands.map((b: any) => (
                    <tr key={b.key}>
                      <td className="small">{b.key}</td>
                      <td className="num mono">{Number(b.donations).toLocaleString()}</td>
                      <td className="num mono">{money(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {homeState > 0 && (
                <div className="tiny card-foot">
                  <strong>{Math.round((100 * homeState) / itemized)}%</strong> of this money came
                  from Wisconsin addresses ({money(homeState)}). The rest came from outside the
                  state the member represents.
                </div>
              )}
            </div>
            <div className="card">
              <div className="eyebrow">By occupation as filed</div>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Occupation</th><th className="num">Donors</th>
                  <th className="num">Gifts</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {occupations.map((o: any) => (
                    <tr key={o.key}>
                      <td className="small clamp2">{o.key}</td>
                      {/* This column was headed "Donors" and printed
                          contributions. Twelve monthly gifts from one person
                          are twelve contributions and one donor, and the two
                          were being used interchangeably — including by the
                          three-donor floor that is supposed to keep a single
                          identifiable person at a named small employer from
                          being published. Both numbers, both labelled. */}
                      <td className="num mono">
                        {o.donors == null ? '—' : Number(o.donors).toLocaleString()}</td>
                      <td className="num mono">{Number(o.donations).toLocaleString()}</td>
                      <td className="num mono">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="tiny card-foot">
                Occupation is typed by the contributor or the campaign, not chosen from a list.
                We fold the obvious spelling variants of &ldquo;retired&rdquo; and
                &ldquo;self-employed&rdquo; together and otherwise leave every entry exactly as
                filed — tidying, not classification.
              </div>
            </div>
          </div>
        </>
      )}

      {cosponsorCount > 0 && (
        <>
          <h2 className="section">Bills this member sponsored or cosponsored</h2>
          <p className="lede">
            <strong>{cosponsorCount.toLocaleString()}</strong> of the bills in our record, with the
            date they signed on. This is here because it is a better question than the one the rest
            of this page asks. A floor vote is scheduled by leadership, whipped by the party, and
            usually decided before it is cast — {noSignalPct}% of our money trails come back
            &ldquo;no signal&rdquo; partly for that reason. Cosponsoring is voluntary, individually
            attributable, dated, and nobody is counting votes on it.
          </p>
          <div className="card">
            <table>
              <thead><tr><th>Bill</th><th>Policy area</th><th>Role</th>
                <th className="mono">Signed on</th></tr></thead>
              <tbody>
                {cosponsored.slice(0, 25).map((r: any) => (
                  <tr key={r.bill_key + r.role}>
                    <td><Link href={hrefFor.bill(r.bill_key)} className="clamp2"
                      title={r.bill.title}>{r.bill.title}</Link></td>
                    <td className="small">{r.bill.policy_area || '—'}</td>
                    <td className="small">
                      {r.role === 'sponsor' ? <strong>sponsor</strong>
                        : r.is_original ? 'original cosponsor' : 'cosponsor'}
                      {r.withdrawn_date && <div className="tiny">withdrawn {r.withdrawn_date}</div>}
                    </td>
                    <td className="small mono">{r.sponsored_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny card-foot">
              From the same GovInfo BILLSTATUS XML as every bill page. A withdrawn cosponsorship
              keeps its row and its date — a member who signed on and then backed off is part of
              the record.
              {cosponsorCount > 25 && <> Showing 25 of {cosponsorCount.toLocaleString()}.</>}
            </div>
          </div>
        </>
      )}

      <h2 className="section">Money trails involving this member</h2>
      <p className="lede">
        Votes where a bill&apos;s sector overlaps with money this member received. Most are labeled
        low-signal on purpose.
      </p>
      {(trails || []).length === 0 && (
        <div className="card">
          <h3>No money trail met the threshold for this member</h3>
          <p className="small" style={{ marginBottom: 0 }}>
            A trail requires all four of: a recorded Yea or Nay, a bill specific enough to belong to
            an industry, a committee in that industry that gave to this member, and a vote that was
            not near-unanimous. Falling short of that is the ordinary case, not a finding — and it is
            not a statement that this member has a cleaner record than one who appears below. Their
            full voting record and every dollar they received are still on this page.
          </p>
        </div>
      )}
      <div className="grid g3">
        {(trails || []).map((t: any) => (
          <Link key={t.vote_key} href={trailHref(t)} className="card"
            style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
            <span className={`badge ${labelClass(t.label).badge}`}>{t.label}</span>
            <h3 className="clamp3" style={{ marginTop: 10, fontSize: 15.5 }}
              title={t.bill_title || t.vote_desc}>{t.bill_title || t.vote_desc}</h3>
            <div className="small">
              Voted <strong className={isYes(t.position) ? 'vote-Y' : 'vote-N'}>{t.position}</strong>
              {' '}on {t.legis_num} · {t.iso_date}
            </div>
            <div className="rule" />
            <div className="stat"><span>Sector money</span><b>{money(t.sector_dollars)}</b></div>
            <div className="stat"><span>Share of PAC money</span><b>{t.sector_share_pct}%</b></div>
          </Link>
        ))}
      </div>

      <h2 className="section">Recent recorded votes</h2>
      <div className="card">
        <table>
          <thead><tr><th>Bill</th><th>Question</th><th>Date</th><th>Result</th><th>Position</th></tr></thead>
          <tbody>
            {recent.map((v: any) => (
              <tr key={v.vote_key}>
                <td>
                  <Link href={`/vote/${encodeURIComponent(v.vote_key)}`}>
                    <strong>{v.legis_num || 'Recorded vote'}</strong></Link>
                  <div className="tiny">{(v.vote_desc || '').slice(0, 70)}</div></td>
                <td className="small">{v.vote_question}</td>
                <td className="small mono">{v.iso_date}</td>
                <td className="small mono">{v.vote_result} {v.yea}–{v.nay}</td>
                <td className={v.pos.is_cast ? (isYes(v.pos.position) ? 'vote-Y' : 'vote-N') : 'small'}>
                  {v.pos.position}
                  {!v.pos.is_cast && <div className="tiny">not counted as a position</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
