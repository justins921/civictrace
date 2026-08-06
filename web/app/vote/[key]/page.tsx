import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, partyLetter, isYes, hrefFor, safeUrl, CYCLE } from '@/lib/db'
import { CapitolArt } from '@/components/Art'

export const revalidate = 3600

/* Every recorded vote gets a page — not just the ones attached to a bill.
 *
 * 139 of the delegation's 505 roll calls are votes on nominations, amendments
 * and procedural motions. They were in the database and nowhere on the site:
 * they appeared as a row in a member's vote table with a bare label like
 * "S.Amdt. 5378" and nothing to click. Amendments in particular are where narrow
 * industry carve-outs get written, and they split on lines a final passage vote
 * does not, so discarding them was discarding the more interesting half.
 *
 * This page deliberately does not compute a money trail for an amendment. A
 * trail needs a bill's industry classification, and an amendment's subject is
 * not in the roll-call record — inferring it from the parent bill would attach
 * the bill's industries to a vote that may be about something else entirely.
 * The record is published; the inference is not made.
 */

const KIND = (legis: string | null) => {
  const s = (legis || '').trim().toUpperCase()
  if (!s) return 'procedural'
  if (s.startsWith('PN')) return 'nomination'
  if (s.includes('AMDT')) return 'amendment'
  if (/^[A-Z. ]+\d+$/.test(s)) return 'bill'
  return 'procedural'
}

const KIND_NOTE: Record<string, string> = {
  bill: 'This vote is on a bill. Its own page carries the Congressional Research Service summary and any money trails.',
  amendment: 'This is a vote on an amendment. CivicTrace does not compute a money trail for amendments: an amendment’s subject is not in the roll-call record, and borrowing the parent bill’s industry classification would attach industries to a vote that may be about something else.',
  nomination: 'This is a vote on a nomination, not on legislation. There is no bill, no sector classification and no money trail — a nomination is a person, and this site does not build trails about people.',
  procedural: 'This is a procedural vote — adjournment, a quorum call, or a motion on the order of business. It is published because it is part of the record, not because it carries a signal.',
}

export async function generateStaticParams() {
  // The bill-attached votes already have bill pages; prerender the rest, which
  // are the ones that previously had nowhere to go.
  const { data } = await db.from('rollcall').select('vote_key,legis_num').limit(1000)
  return (data || [])
    .filter((r: any) => KIND(r.legis_num) !== 'bill')
    .slice(0, 200)
    .map((r: any) => ({ key: r.vote_key }))
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const { data: rc } = await db.from('rollcall').select('legis_num,vote_desc,iso_date')
    .eq('vote_key', decodeURIComponent(key)).limit(1)
  const r = (rc || [])[0]
  if (!r) return { title: 'Vote — CivicTrace' }
  return {
    title: `${r.legis_num || 'Recorded vote'} — ${r.iso_date || ''} — CivicTrace`,
    description: (r.vote_desc || '').slice(0, 180),
  }
}

export default async function Vote({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await params).key)

  const [{ data: rcRows, error: rcErr }, { data: breakdown }, { data: positions }, { data: members }] =
    await Promise.all([
      db.from('rollcall').select('*').eq('vote_key', key).limit(1),
      db.from('rollcall_breakdown').select('*').eq('vote_key', key),
      db.from('vote_position').select('*').eq('vote_key', key),
      db.from('member').select('bioguide,full_name,slug,party,chamber,district'),
    ])
  if (rcErr) throw new Error(`roll call query failed: ${rcErr.message}`)
  const rc = (rcRows || [])[0]
  if (!rc) notFound()

  const kind = KIND(rc.legis_num)
  const byBio = Object.fromEntries((members || []).map((m: any) => [m.bioguide, m]))
  const wi = (positions || [])
    .map((p: any) => ({ ...p, member: byBio[p.bioguide] }))
    .filter((p: any) => p.member)
    .sort((a: any, b: any) => String(a.member.district || '').localeCompare(String(b.member.district || '')))

  // Party splits come from the published breakdown, which counts the whole
  // chamber — not from the ten Wisconsin rows above.
  const parties: Record<string, Record<string, number>> = {}
  for (const b of breakdown || []) {
    (parties[b.party] ||= {})[b.position] = Number(b.n)
  }
  const cast = (Number(rc.yea) || 0) + (Number(rc.nay) || 0)
  const minority = cast ? Math.round((1000 * Math.min(rc.yea || 0, rc.nay || 0)) / cast) / 10 : 0

  // Only look for a bill when the label actually is one.
  const norm = (v: string) => (v || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  const { data: bills } = kind === 'bill'
    ? await db.from('bill').select('bill_key,title,bill_type,bill_num,policy_area')
    : { data: [] as any[] }
  const bill = (bills || []).find((b: any) => norm(b.bill_type + b.bill_num) === norm(rc.legis_num))

  return (
    <>
      <section className="hero">
        <div className="wrap hero-in">
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Recorded vote · {kind}</div>
            <h1 style={{ fontSize: 'clamp(22px,3.2vw,36px)', textTransform: 'none', marginTop: 6 }}>
              {rc.legis_num || rc.vote_question || 'Recorded vote'}
            </h1>
            <p className="sub">
              {rc.vote_desc || rc.vote_question}
            </p>
            <div className="small" style={{ marginTop: 8 }}>
              {rc.chamber} · roll call {rc.rollnum} · {rc.iso_date || rc.action_date} ·{' '}
              <strong>{rc.vote_result}</strong> {rc.yea}–{rc.nay}
            </div>
          </div>
          <div className="hero-art"><CapitolArt size={92} /></div>
        </div>
      </section>

      <div className="wrap">
        <div className="note" style={{ marginTop: 18 }}>
          <strong>What kind of vote this is.</strong> {KIND_NOTE[kind]}
          {bill && <> <Link href={hrefFor.bill(bill.bill_key)}>Open the bill page →</Link></>}
        </div>

        <h2 className="section">How Wisconsin voted</h2>
        {wi.length === 0 ? (
          <div className="card small">
            No Wisconsin member has a recorded position on this vote. That usually means the vote
            was held in the other chamber.
          </div>
        ) : (
          <div className="card">
            <table>
              <thead><tr><th>Member</th><th>Office</th><th>Position</th></tr></thead>
              <tbody>
                {wi.map((p: any) => (
                  <tr key={p.bioguide}>
                    <td>
                      <span className={`chip ${partyLetter(p.member.party)}`}
                        style={{ marginRight: 8, verticalAlign: -4 }}>
                        {partyLetter(p.member.party)}</span>
                      <Link href={hrefFor.member(p.member.slug)}>{p.member.full_name}</Link>
                    </td>
                    <td className="small">
                      {p.member.chamber === 'sen' ? 'U.S. Senate'
                        : `U.S. House, WI-${String(p.member.district || '').padStart(2, '0')}`}
                    </td>
                    <td className="small">
                      <strong className={isYes(p.position) ? 'vote-Y' : 'vote-N'}>{p.position}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="section">The whole chamber</h2>
        <div className="grid g4">
          <div className="card"><div className="eyebrow">Yea</div>
            <div className="kpi mono">{rc.yea}</div></div>
          <div className="card"><div className="eyebrow">Nay</div>
            <div className="kpi mono">{rc.nay}</div></div>
          <div className="card"><div className="eyebrow">Present / not voting</div>
            <div className="kpi mono">{(rc.present || 0) + (rc.notvoting || 0)}</div></div>
          <div className="card"><div className="eyebrow">Losing side</div>
            <div className="kpi mono">{minority}%</div>
            <div className="small">
              {minority < 10
                ? 'a vote this lopsided carries no signal about any member'
                : 'contested enough to be worth reading'}
            </div></div>
        </div>

        {Object.keys(parties).length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="eyebrow">By party</div>
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>Party</th><th className="num">Yea</th><th className="num">Nay</th>
                <th className="num">Other</th></tr></thead>
              <tbody>
                {Object.entries(parties).map(([party, counts]) => {
                  const yea = Object.entries(counts).filter(([k]) => /^(Yea|Aye|Yes)$/i.test(k))
                    .reduce((a, [, v]) => a + v, 0)
                  const nay = Object.entries(counts).filter(([k]) => /^(Nay|No)$/i.test(k))
                    .reduce((a, [, v]) => a + v, 0)
                  const other = Object.values(counts).reduce((a, v) => a + v, 0) - yea - nay
                  return (
                    <tr key={party}>
                      <td>{party}</td>
                      <td className="num mono">{yea}</td>
                      <td className="num mono">{nay}</td>
                      <td className="num mono">{other}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="section">Source</h2>
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>
            Every figure on this page is parsed from one file, and here it is. Nothing above was
            summarised, inferred or written by a language model.
          </p>
          {safeUrl(rc.source_url) && (
            <a className="btn solid" href={safeUrl(rc.source_url)!}
              target="_blank" rel="noopener noreferrer">
              {rc.chamber === 'Senate' ? 'Senate roll-call XML ↗' : 'House Clerk roll-call XML ↗'}
            </a>
          )}
        </div>
      </div>
    </>
  )
}
