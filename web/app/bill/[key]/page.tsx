import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, labelClass, trailHref, hrefFor, isYes, CYCLE, safeUrl, SITE_URL } from '@/lib/db'
import { BillArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  // Prerender the voted bills; the other ~2,200 render on demand. Building
  // 2,419 static pages for a directory most readers reach through a member page
  // is minutes of build time for pages nobody requested.
  const { data } = await db.from('bill_profile').select('bill_key')
    .eq('has_rollcall', true).limit(220)
  return (data || []).map((b: any) => ({ key: b.bill_key }))
}

/* M: five dynamic route types shipped with no per-page metadata, so every bill,
   trail, committee and sector page carried the site-wide title and description.
   Search results and link previews for 2,419 bill pages were identical strings. */
export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const { data: b } = await db.from('bill').select('title,bill_type,bill_num,policy_area,summary')
    .eq('bill_key', key).maybeSingle()
  if (!b) return { title: 'Bill — CivicTrace' }
  const num = `${String(b.bill_type || '').toUpperCase()} ${b.bill_num}`
  const title = `${num} — ${b.title} — CivicTrace`
  const description = (b.summary || `${num}: ${b.title}. CRS policy area `
    + `${b.policy_area || 'not assigned'}.`).slice(0, 250)
  return {
    title, description,
    alternates: { canonical: `${SITE_URL}/bill/${key}` },
    openGraph: { title, description, url: `${SITE_URL}/bill/${key}` },
  }
}

export default async function Bill({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const { data: b } = await db.from('bill').select('*').eq('bill_key', key).single()
  if (!b) notFound()

  const label = `${b.bill_type}${b.bill_num}`
  const normKey = (v: string) => (v || '').replace(/[^a-z0-9]/gi, '').toUpperCase()

  const [{ data: sectors }, { data: trails }, { data: rolls }, { data: lobbying },
         { data: coverage }] =
    await Promise.all([
    // bounds-ok: one row per sector matched to this bill — at most a handful.
    db.from('bill_sector').select('*').eq('bill_key', key).limit(100),
    // bounds-ok: one trail per Wisconsin member per roll call on this bill.
    db.from('trail_full').select('*').eq('bill_key', key).eq('cycle', CYCLE)
      .order('rank').limit(500),
    /* Roll calls used to be fetched for the entire Congress — 505 rows today,
       capped at 1000 tomorrow — and filtered down to this bill's two or three
       in JavaScript. Postgres can do the matching: the legislative number is
       written "H R 1234" by the House Clerk and "H.R. 1234" by the Senate, so
       match on the number and filter the punctuation variants from the handful
       that come back rather than from all of them. */
    db.from('rollcall').select('*').eq('congress', b.congress)
      .ilike('legis_num', `%${b.bill_num}`).limit(200),
    db.from('lobbying_bill').select('*').eq('bill_key', key)
      .order('amount', { ascending: false }).limit(40),
    // bounds-ok: one row per year of lobbying loaded.
    db.from('lobbying_coverage').select('*').order('year', { ascending: false }).limit(20),
  ])

  // One filing can name the same bill under several issue codes; collapse to
  // one row per client so the list is a list of interests, not of paperwork.
  const lobbyByClient = new Map<string, any>()
  for (const l of lobbying || []) {
    const k = `${l.client}|${l.registrant}`
    const prev = lobbyByClient.get(k)
    if (!prev || Number(l.amount) > Number(prev.amount)) lobbyByClient.set(k, l)
  }
  const lobbyists = [...lobbyByClient.values()]

  // Roll calls are matched on the legislative number as printed by the chamber.
  // The House Clerk writes "H R 1234"; the Senate LIS writes "H.R. 1234" and
  // "S.J.Res. 163". Stripping only whitespace matched one convention and not the
  // other, so 40 of 131 bill pages rendered a money trail with no roll call
  // beneath it — the vote was in the database the whole time. Normalise both
  // sides down to letters and digits and the question disappears.
  const votes = (rolls || []).filter((r: any) => normKey(r.legis_num) === normKey(label))

  const voteKeys = votes.map((v: any) => v.vote_key)
  // bounds-ok: ten Wisconsin members across a handful of roll calls on one bill.
  const { data: positions } = voteKeys.length
    ? await db.from('vote_position').select('*, member(*)').in('vote_key', voteKeys).limit(1000)
    : { data: [] as any[] }

  /* H3 / the 15%. This figure is the honesty caveat on the whole lobbying
     section, and it was a string literal transcribed from a hand sample of one
     quarter. It is now measured on every pipeline run over every activity the
     loader read, and it moves as the backfill fills in. */
  const cov = (coverage || [])[0]
  const covPct = cov && Number(cov.activities) > 0
    ? Math.round((100 * Number(cov.activities_citing_bill)) / Number(cov.activities))
    : null

  return (
    <div className="wrap">
      <div className="card" style={{ marginTop: 22, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="step-art" style={{ margin: 0, flex: 'none', minHeight: 0 }}>
          <BillArt size={68} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="eyebrow">{label} · {b.congress}th Congress</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(21px,4.4vw,30px)', letterSpacing: '-.6px',
            color: 'var(--navy)' }}>{b.title}</h1>
          <div className="small" style={{ marginTop: 6 }}>
            {b.policy_area ? <>CRS policy area: <strong>{b.policy_area}</strong> · </> : null}
            Introduced {b.intro_date || 'n/a'}
            {b.sponsor_name ? <> · Sponsored by {b.sponsor_name}</> : null}
          </div>
          <div style={{ marginTop: 10 }}>
            {(sectors || []).map((s: any) => (
              <Link key={s.sector} className="badge b-some" style={{ marginRight: 6 }}
                href={hrefFor.sector(s.sector)}>{s.sector}</Link>
            ))}
            {b.is_broad && <span className="badge b-low">Omnibus / appropriations</span>}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {safeUrl(b.congressgov_url) && <a className="btn" href={safeUrl(b.congressgov_url)!}
              target="_blank" rel="noopener noreferrer">Congress.gov ↗</a>}
            {safeUrl(b.source_url) && <a className="btn" href={safeUrl(b.source_url)!}
              target="_blank" rel="noopener noreferrer">GovInfo BILLSTATUS XML ↗</a>}
          </div>
        </div>
      </div>

      {b.is_broad && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>This bill is excluded from alignment analysis.</strong> Omnibus and appropriations
          bills touch every sector at once, so a figure like &ldquo;sector share of PAC money&rdquo;
          would be arithmetically real and substantively meaningless. We would rather refuse to
          compute it than publish a number that looks precise and is not.
        </div>
      )}

      {b.summary && (
        <>
          <h2 className="section">Summary</h2>
          <div className="card">
            <p className="small" style={{ marginTop: 0 }}>{b.summary}</p>
            <p className="tiny" style={{ marginBottom: 0 }}>
              This summary is written by the Congressional Research Service and reproduced verbatim.
              It is not our characterisation of the bill, and no language model wrote or edited it.
            </p>
          </div>
        </>
      )}

      {(sectors || []).length > 0 && (
        <>
          <h2 className="section">Why this bill was matched to these sectors</h2>
          <div className="card">
            <table>
              <thead><tr><th>Sector</th><th>Matching evidence</th></tr></thead>
              <tbody>
                {(sectors || []).map((s: any) => (
                  <tr key={s.sector}>
                    <td><Link href={hrefFor.sector(s.sector)}>{s.sector}</Link></td>
                    <td className="small">{s.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tiny" style={{ marginTop: 10, marginBottom: 0 }}>
              Matching runs on the CRS policy area first, then on published keyword rules against
              the title and summary. Keyword matching is blunt by nature, which is why the evidence
              is shown rather than hidden — if a match looks silly to you, it probably is, and we{' '}
              <Link href="/contact">want to hear about it</Link>.
            </p>
          </div>
        </>
      )}

      {votes.length > 0 && (
        <>
          <h2 className="section">Roll call votes</h2>
          {votes.map((v: any) => {
            const wi = (positions || []).filter((p: any) => p.vote_key === v.vote_key)
            return (
              <div className="card" key={v.vote_key} style={{ marginBottom: 14 }}>
                <h3>{v.vote_question}</h3>
                <div className="small">
                  {v.chamber} · {v.iso_date} · <strong>{v.vote_result}</strong> {v.yea}–{v.nay}
                  {v.notvoting ? ` · ${v.notvoting} not voting` : ''}
                  {safeUrl(v.source_url) && <> · <a href={safeUrl(v.source_url)!}
                    target="_blank" rel="noopener noreferrer">official roll call ↗</a></>}
                </div>
                {wi.length > 0 && (
                  <table style={{ marginTop: 10 }}>
                    <thead><tr><th>Wisconsin member</th><th>Position</th></tr></thead>
                    <tbody>
                      {wi.sort((a: any, b: any) =>
                        String(a.member?.district || '').localeCompare(String(b.member?.district || '')))
                        .map((p: any) => (
                        <tr key={p.bioguide}>
                          <td><span className={`chip ${partyLetter(p.party)}`}>{partyLetter(p.party)}</span>{' '}
                            {p.member?.slug
                              ? <Link href={hrefFor.member(p.member.slug)}>{p.member.full_name}</Link>
                              : p.name_raw}</td>
                          <td className={p.is_cast ? (isYes(p.position) ? 'vote-Y' : 'vote-N') : 'small'}>
                            {p.position}
                            {!p.is_cast && <div className="tiny">not counted as a position</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* H3. This whole block used to sit inside `trails.length > 0`, so
          lobbying only appeared on a bill that had also produced a money trail
          — 69 bills out of 953. The other 884 showed nothing, including the
          caveat explaining that nothing is not the same as none. Lobbying and
          money trails are unrelated facts about a bill and neither gates the
          other. */}
      {lobbyists.length > 0 && (
        <>
          <h2 className="section">Who reported lobbying on this bill</h2>
          <p className="lede small">
            From quarterly Lobbying Disclosure Act filings. The dollar figure is the{' '}
            <em>whole filing</em> — a registrant&apos;s total income from that client for the
            quarter, across every issue they worked on. It is not what was spent on this bill,
            and no such figure exists in the public record.
          </p>
          <div className="card">
            <table>
              <thead><tr><th>Client</th><th>Lobbying firm</th><th>Issue</th>
                <th className="num">Filing total</th></tr></thead>
              <tbody>
                {lobbyists.map((l: any, i: number) => (
                  <tr key={i}>
                    <td><strong>{l.client}</strong>
                      <div className="tiny clamp2">{l.description}</div></td>
                    <td className="small">{l.registrant === l.client
                      ? 'in-house' : l.registrant}</td>
                    <td className="small">{l.issue}</td>
                    <td className="num mono">
                      {Number(l.amount) > 0 ? money(l.amount) : '—'}
                      <div className="tiny">
                        {l.period} {l.year}
                        {Number(l.issue_count) > 1 && <> · covers {l.issue_count} issues</>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny card-foot">
              {safeUrl(lobbyists[0]?.source_url) && (
                <a href={safeUrl(lobbyists[0].source_url)!} target="_blank"
                  rel="noopener noreferrer">Read one of these filings ↗</a>
              )}
            </div>
          </div>
        </>
      )}

      <div className="note">
        <strong>Lobbying coverage on this site is partial, and not in a way we can fix.</strong>{' '}
        The Lobbying Disclosure Act has no field for a bill number — registrants describe their
        work in prose.{' '}
        {covPct !== null ? (
          <>Of the <strong>{Number(cov.activities).toLocaleString()}</strong> lobbying activities
          we have read so far, <strong>{covPct}%</strong> name a bill at all — measured on our own
          data, on every refresh, not sampled by hand.{' '}
          {!cov.complete && <>That backfill is still running, so this figure and the list above
          both grow between refreshes.{' '}</>}</>
        ) : (
          <>We have not yet measured what share of activities name a bill; until we have, treat
          the list above as a floor of unknown depth.{' '}</>
        )}
        So an empty list means no filing we could parse named this bill. It does not mean nobody
        lobbied on it, and it should never be read that way.
      </div>

      {(trails || []).length > 0 && (
        <>
          <h2 className="section">Money trails on this bill</h2>
          <div className="grid g3">
            {(trails || []).map((t: any) => (
              <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className={`badge ${labelClass(t.display_label ?? t.label).badge}`}>{t.display_label ?? t.label}</span>
                <h3 style={{ marginTop: 10, fontSize: 15.5 }}>
                  <span className={`chip ${partyLetter(t.party)}`}>{partyLetter(t.party)}</span>{' '}
                  {t.full_name}
                </h3>
                <div className="small">Voted <strong>{t.position}</strong> · {t.iso_date}</div>
                <div className="rule" />
                <div className="stat"><span>Sector money</span><b>{money(t.sector_dollars)}</b></div>
                <div className="stat"><span>Own party voted the same</span>
                  <b>{t.party_line_share_pct ?? '—'}%</b></div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 18, borderLeft: '4px solid var(--blue2)' }}>
        <div className="eyebrow" style={{ color: 'var(--blue)' }}>Latest action on record</div>
        <p className="small" style={{ margin: '6px 0 0' }}>
          {b.latest_action || 'No action recorded.'}
          {b.latest_action_date ? ` (${b.latest_action_date})` : ''}
        </p>
      </div>
    </div>
  )
}
