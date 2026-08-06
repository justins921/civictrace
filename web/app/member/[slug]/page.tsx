import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, officeLine, labelClass, trailHref, isYes, hrefFor, CYCLE, CYCLE_LABEL } from '@/lib/db'
import { CapitolArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  const { data } = await db.from('member').select('slug')
  return (data || []).map((m: any) => ({ slug: m.slug }))
}

export default async function Member({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data: m } = await db.from('member').select('*').eq('slug', slug).single()
  if (!m) notFound()

  const [{ data: sectors }, { data: cmtes }, { data: trails }, { data: votes }, { data: ears },
         { data: totalsRows }, { data: ieRows }, { data: assigns },
         { data: sponsored, error: sponsorErr }] =
    await Promise.all([
      db.from('member_sector_money').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE),
      db.from('member_top_committee').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('total', { ascending: false }).limit(25),
      db.from('trail_full').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('rank').limit(12),
      // Ordered in the database, not in the browser. "The 15 most recent votes"
      // was previously computed by pulling an unordered page of 400 and sorting
      // what came back — correct only for as long as no member exceeded 400 roll
      // calls. The House went from 140 to 283 in one refresh; the next time that
      // cap is crossed the page would have shown 15 arbitrary votes and called
      // them recent, with nothing to notice it by.
      db.from('vote_position').select('*, rollcall!inner(*)').eq('bioguide', m.bioguide)
        // NB: PostgREST's server max-rows caps this at 1000 whatever we ask
        // for, so the limit is a ceiling we do not control. What the ordering
        // buys is that the 1000 we get are the newest 1000, so "recent" stays
        // true even when the cap bites. Max today is 283 per member.
        .order('iso_date', { referencedTable: 'rollcall', ascending: false }).limit(1000),
      db.from('earmark').select('*').eq('bioguide', m.bioguide).order('amount', { ascending: false }),
      // Context, never arithmetic. `candidate_totals` is the denominator this
      // page was missing: PAC money is 64% of Gwen Moore's receipts and 4.5% of
      // Tammy Baldwin's, and printing both the same way implied the trail below
      // means the same thing for both members. It does not.
      db.from('candidate_totals').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE),
      db.from('ie_agg').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE),
      db.from('committee_assignment').select('*').eq('bioguide', m.bioguide)
        .not('jurisdiction_sectors', 'is', null),
      db.from('bill_sponsor').select('*, bill(bill_key,title,bill_type,bill_num,policy_area)')
        .eq('bioguide', m.bioguide).order('sponsored_date', { ascending: false }),
    ])

  const secs = (sectors || []).slice().sort((a: any, b: any) => Number(b.total) - Number(a.total))
  const total = secs.reduce((a: number, s: any) => a + Number(s.total), 0)
  const recent = (votes || [])
    .filter((v: any) => v.rollcall?.iso_date)
    .sort((a: any, b: any) => (b.rollcall.iso_date > a.rollcall.iso_date ? 1 : -1))
    .slice(0, 15)
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
            {m.official_url && <a href={m.official_url} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
            <a href={`https://www.congress.gov/member/${m.bioguide}`} target="_blank" rel="noopener noreferrer">Congress.gov ↗</a>
            {m.fec_cand_id && <a href={`https://www.fec.gov/data/candidate/${m.fec_cand_id}/`}
              target="_blank" rel="noopener noreferrer">FEC record ↗</a>}
          </div>
        </div>
        <div style={{ flex: 'none' }}>
          <div className="eyebrow">PAC money, {CYCLE_LABEL}</div>
          <div className="kpi mono">{money(total)}</div>
          <div className="small">{(cmtes || []).length}+ committees · giver-side ledger</div>
        </div>
      </div>

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
          {fecUrl && <> <a href={fecUrl} target="_blank" rel="noopener noreferrer">Check the FEC&apos;s
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
          {(cmtes || []).length > 8 && (
            <div className="tiny card-foot">
              Showing the 8 largest of <strong>{(cmtes || []).length}</strong> committees that gave
              to this member in the {CYCLE_LABEL}. Every one of them is listed on{' '}
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
            {(ears || [])[0]?.member_url && (
              <a className="btn" style={{ marginTop: 12 }} href={(ears || [])[0].member_url}
                target="_blank" rel="noopener noreferrer">Member&apos;s own disclosure page ↗</a>
            )}
          </div>
        </>
      )}

      {cosponsored.length > 0 && (
        <>
          <h2 className="section">Bills this member sponsored or cosponsored</h2>
          <p className="lede">
            <strong>{cosponsored.length}</strong> of the bills in our record, with the date they
            signed on. This is here because it is a better question than the one the rest of this
            page asks. A floor vote is scheduled by leadership, whipped by the party, and usually
            decided before it is cast — 87% of our money trails come back &ldquo;no signal&rdquo;
            partly for that reason. Cosponsoring is voluntary, individually attributable, dated,
            and nobody is counting votes on it.
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
              {cosponsored.length > 25 && <> Showing 25 of {cosponsored.length}.</>}
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
                <td><strong>{v.rollcall.legis_num || '—'}</strong>
                  <div className="tiny">{(v.rollcall.vote_desc || '').slice(0, 70)}</div></td>
                <td className="small">{v.rollcall.vote_question}</td>
                <td className="small mono">{v.rollcall.iso_date}</td>
                <td className="small mono">{v.rollcall.vote_result} {v.rollcall.yea}–{v.rollcall.nay}</td>
                <td className={v.is_cast ? (isYes(v.position) ? 'vote-Y' : 'vote-N') : 'small'}>
                  {v.position}{!v.is_cast && <div className="tiny">not counted as a position</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
