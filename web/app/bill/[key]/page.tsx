import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, labelClass, trailHref, hrefFor, isYes } from '@/lib/db'
import { BillArt } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  const { data } = await db.from('bill').select('bill_key').limit(120)
  return (data || []).map((b: any) => ({ key: b.bill_key }))
}

export default async function Bill({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const { data: b } = await db.from('bill').select('*').eq('bill_key', key).single()
  if (!b) notFound()

  const [{ data: sectors }, { data: trails }, { data: rolls }] = await Promise.all([
    db.from('bill_sector').select('*').eq('bill_key', key),
    db.from('trail_full').select('*').eq('bill_key', key).order('rank'),
    db.from('rollcall').select('*').eq('congress', b.congress),
  ])

  // Roll calls are matched on the legislative number as printed by the chamber.
  // The House Clerk writes "H R 1234"; the Senate LIS writes "H.R. 1234" and
  // "S.J.Res. 163". Stripping only whitespace matched one convention and not the
  // other, so 40 of 131 bill pages rendered a money trail with no roll call
  // beneath it — the vote was in the database the whole time. Normalise both
  // sides down to letters and digits and the question disappears.
  const norm = (v: string) => (v || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  const label = `${b.bill_type}${b.bill_num}`
  const votes = (rolls || []).filter((r: any) => norm(r.legis_num) === norm(label))

  const voteKeys = votes.map((v: any) => v.vote_key)
  const { data: positions } = voteKeys.length
    ? await db.from('vote_position').select('*, member(*)').in('vote_key', voteKeys)
    : { data: [] as any[] }

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
            {b.congressgov_url && <a className="btn" href={b.congressgov_url}
              target="_blank" rel="noopener noreferrer">Congress.gov ↗</a>}
            {b.source_url && <a className="btn" href={b.source_url}
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
                  {v.source_url && <> · <a href={v.source_url} target="_blank" rel="noopener noreferrer">
                    official roll call ↗</a></>}
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

      {(trails || []).length > 0 && (
        <>
          <h2 className="section">Money trails on this bill</h2>
          <div className="grid g3">
            {(trails || []).map((t: any) => (
              <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className={`badge ${labelClass(t.label).badge}`}>{t.label}</span>
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
