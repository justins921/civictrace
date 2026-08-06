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

  const [{ data: sectors }, { data: cmtes }, { data: trails }, { data: votes }, { data: ears }] =
    await Promise.all([
      db.from('member_sector_money').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE),
      db.from('member_top_committee').select('*').eq('bioguide', m.bioguide).eq('cycle', CYCLE)
        .order('total', { ascending: false }).limit(25),
      db.from('trail_full').select('*').eq('bioguide', m.bioguide).order('rank').limit(12),
      // Ordered in the database, not in the browser. "The 15 most recent votes"
      // was previously computed by pulling an unordered page of 400 and sorting
      // what came back — correct only for as long as no member exceeded 400 roll
      // calls. The House went from 140 to 283 in one refresh; the next time that
      // cap is crossed the page would have shown 15 arbitrary votes and called
      // them recent, with nothing to notice it by.
      db.from('vote_position').select('*, rollcall!inner(*)').eq('bioguide', m.bioguide)
        .order('iso_date', { referencedTable: 'rollcall', ascending: false }).limit(1200),
      db.from('earmark').select('*').eq('bioguide', m.bioguide).order('amount', { ascending: false }),
    ])

  const secs = (sectors || []).slice().sort((a: any, b: any) => Number(b.total) - Number(a.total))
  const total = secs.reduce((a: number, s: any) => a + Number(s.total), 0)
  const recent = (votes || [])
    .filter((v: any) => v.rollcall?.iso_date)
    .sort((a: any, b: any) => (b.rollcall.iso_date > a.rollcall.iso_date ? 1 : -1))
    .slice(0, 15)
  const earTotal = (ears || []).reduce((a: number, e: any) => a + Number(e.amount), 0)

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
