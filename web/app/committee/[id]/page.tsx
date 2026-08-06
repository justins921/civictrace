import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, money, partyLetter, officeLine, labelClass, trailHref, hrefFor , CYCLE, CYCLE_LABEL } from '@/lib/db'
import { DonorArt } from '@/components/Art'

export const revalidate = 3600

const ORG_TYPE: Record<string, string> = {
  C: 'Corporation', L: 'Labor organization', M: 'Membership organization',
  T: 'Trade association', V: 'Cooperative', W: 'Corporation without capital stock',
}
const CMTE_TYPE: Record<string, string> = {
  N: 'Non-qualified PAC', Q: 'Qualified PAC', O: 'Independent-expenditure-only (super PAC)',
  V: 'Hybrid PAC (non-qualified)', W: 'Hybrid PAC (qualified)',
  X: 'Party committee (non-qualified)', Y: 'Party committee (qualified)',
  Z: 'National party non-federal account', H: 'House candidate committee',
  S: 'Senate candidate committee', P: 'Presidential candidate committee', D: 'Delegate committee',
}

export default async function Committee({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: rowsRaw } = await db.from('committee_profile').select('*')
    .eq('cmte_id', id).order('cycle', { ascending: false })
  const rows = rowsRaw || []
  if (!rows.length) notFound()
  // The published cycle is the page. Earlier cycles are listed further down under
  // their own heading — never added into the headline figure, which is the defect
  // an outside review found here ($115,000 of 2023-2026 money labelled "2026").
  const c = rows.find((r: any) => Number(r.cycle) === CYCLE) || rows[0]
  const otherCycles = rows.filter((r: any) => Number(r.cycle) !== CYCLE
    && Number(r.payments_to_wi) > 0)

  const [{ data: recips }, { data: pays }, { data: trailsRaw, count: trailCount, error: trailErr }] = await Promise.all([
    db.from('committee_recipients').select('*').eq('filer_cmte_id', id).eq('cycle', CYCLE)
      .order('total', { ascending: false }).order('bioguide', { ascending: true }),
    db.from('committee_payments').select('*').eq('filer_cmte_id', id).eq('cycle', CYCLE),
    // Filtered in the database, not here. This used to pull the top 300 trails
    // by rank and search them in JS for this committee. At 591 trails that was
    // merely lossy; at 1,032 it left 24 of 167 committees rendering no trails
    // section at all — indistinguishable, to a reader, from a committee that
    // has none. jsonb containment does the same match server-side over every
    // row, and `count` gives us the honest total behind the nine we show.
    db.from('trail_full').select('*', { count: 'exact' })
            // JSON.stringify is required, not stylistic: supabase-js serialises a raw
      // array argument as a Postgres array literal, which a jsonb column rejects
      // with "invalid input syntax for type json". The query then returns an
      // error and zero rows, and this page renders no trails section at all —
      // the exact silent blank this change was meant to remove.
      .contains('top_pacs', JSON.stringify([{ cmte_id: id }]))
      .eq('cycle', CYCLE).order('rank').limit(9),
  ])

  // A failed query must not look like an empty result. Both render as "no
  // trails" to a reader, and only one of them is true.
  if (trailErr) throw new Error(`committee trails query failed: ${trailErr.message}`)
  const trails = trailsRaw || []
  const trailTotal = trailCount || 0

  const totalAll = Number(c.total_to_wi || 0)
  const payAll = Number(c.payments_to_wi || 0)
  const allPayments = (pays || []).flatMap((r: any) =>
    (r.payments || []).map((p: any) => ({ ...p, member: r.full_name, slug: r.slug })))
    .sort((a: any, b: any) => (b.d || '').localeCompare(a.d || ''))

  return (
    <div className="wrap">
      <div className="card" style={{ marginTop: 22, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="step-art" style={{ margin: 0, flex: 'none', minHeight: 0 }}>
          <DonorArt sector={c.sector} size={70} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="eyebrow">Contributing committee</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(21px,4.4vw,30px)', letterSpacing: '-.6px',
            color: 'var(--navy)' }}>{c.cmte_name}</h1>
          <div className="small" style={{ marginTop: 6 }}>
            FEC committee <span className="mono">{c.cmte_id}</span>
            {c.cmte_tp && CMTE_TYPE[c.cmte_tp] ? ` · ${CMTE_TYPE[c.cmte_tp]}` : ''}
            {c.org_tp && ORG_TYPE[c.org_tp] ? ` · ${ORG_TYPE[c.org_tp]}` : ''}
            {c.cmte_dsgn === 'D' ? ' · Leadership PAC' : ''}
          </div>
          <div style={{ marginTop: 10 }}>
            <Link className="badge b-some" href={hrefFor.sector(c.sector)}>
              {c.sector || 'Unclassified'}
            </Link>
            {c.interest_side && <span className="pill" style={{ marginLeft: 6 }}>{c.interest_side}</span>}
            {c.rule_id && <span className="pill">classified by rule {c.rule_id}</span>}
          </div>
          <div style={{ marginTop: 12 }}>
            <a className="btn" href={c.fec_url} target="_blank" rel="noopener noreferrer">
              FEC committee record ↗</a>
          </div>
        </div>
        <div style={{ flex: 'none', minWidth: 0 }}>
          <div className="eyebrow">Given to Wisconsin members · {CYCLE_LABEL}</div>
          <div className="kpi mono">{money(totalAll)}</div>
          <div className="small">
            {payAll} payment{payAll === 1 ? '' : 's'} to {(recips || []).length} member
            {(recips || []).length === 1 ? '' : 's'}
          </div>
          {totalAll <= 0 && payAll > 0 && (
            <div className="tiny" style={{ marginTop: 6, color: '#b23c45' }}>
              Net of refunds. The FEC records a refunded contribution as a negative amount.
            </div>
          )}
        </div>
      </div>

      {otherCycles.length > 0 && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>This page covers the {CYCLE_LABEL} only.</strong> This committee also gave in{' '}
          {otherCycles.map((r: any, i: number) => (
            <span key={r.cycle}>
              {i ? ', ' : ''}the {r.cycle} cycle (<span className="mono">{money(r.total_to_wi)}</span>,{' '}
              {r.payments_to_wi} payment{Number(r.payments_to_wi) === 1 ? '' : 's'})
            </span>
          ))}. Those figures are in the database and are deliberately <em>not</em> added into the
          total above. Mixing cycles under one label is the single easiest way to publish a number
          nobody can reproduce, and it is the defect this page was rebuilt to fix.
        </div>
      )}

      <div className="note" style={{ marginTop: 16 }}>
        <strong>What this page is and is not.</strong> Everything below is what this committee
        reported giving, on its own FEC filings. It is not a claim that the committee sought or
        received anything in return, and the presence of a committee on this site is not a
        suggestion of wrongdoing — registering a PAC and contributing to candidates is lawful,
        disclosed activity, which is precisely why the records exist to be read.
        {c.sector && c.sector !== 'Unclassified' && (
          <> The sector label above was produced by our published rule{' '}
          <span className="mono">{c.rule_id || '—'}</span>; if you think it is wrong,{' '}
          <Link href="/contact">tell us</Link>.</>
        )}
      </div>

      <h2 className="section">Wisconsin members this committee supported</h2>
      <div className="card">
        <table>
          <thead><tr><th>Member</th><th>Office</th><th className="num">Payments</th>
            <th className="num">Total</th><th>First → last</th></tr></thead>
          <tbody>
            {(recips || []).map((r: any) => (
              <tr key={r.bioguide + r.cycle}>
                <td>
                  <span className={`chip ${partyLetter(r.party)}`}>{partyLetter(r.party)}</span>{' '}
                  <Link href={hrefFor.member(r.slug)}>{r.full_name}</Link>
                </td>
                <td className="small">{officeLine(r)}</td>
                <td className="num mono">{r.n_payments}</td>
                <td className="num mono">{money(r.total)}</td>
                <td className="small mono">{r.first_date} → {r.last_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(recips || []).length === 0 && (
          <p className="small" style={{ margin: 0 }}>
            No direct contributions to a sitting Wisconsin member in the {CYCLE_LABEL}.
          </p>
        )}
      </div>

      {allPayments.length > 0 && (
        <>
          <h2 className="section">Every payment, as filed</h2>
          <p className="lede small">
            Each row is a single reported contribution. The FEC image number links to the filing
            image itself, so any figure on this site can be checked against the document.
          </p>
          <div className="card">
            <table>
              <thead><tr><th>Date</th><th>Recipient</th><th className="num">Amount</th>
                <th>Filing</th></tr></thead>
              <tbody>
                {allPayments.slice(0, 60).map((p: any, i: number) => (
                  <tr key={i}>
                    <td className="small mono">{p.d || '—'}</td>
                    <td><span className={`chip ${partyLetter(p.party)}`}>{partyLetter(p.party)}</span>{' '}
                      <Link href={hrefFor.member(p.slug)}>{p.member}</Link></td>
                    <td className="num mono">{money(p.a)}</td>
                    <td className="small">
                      {p.i
                        ? <a href={`https://docquery.fec.gov/cgi-bin/fecimg/?${p.i}`}
                            target="_blank" rel="noopener noreferrer">image {p.i} ↗</a>
                        : <span className="tiny">no image number</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allPayments.length > 60 && (
              <p className="tiny" style={{ marginTop: 10, marginBottom: 0 }}>
                Showing the 60 most recent of {allPayments.length} payments.
              </p>
            )}
          </div>
        </>
      )}

      {trails.length > 0 && (
        <>
          <h2 className="section">Money trails where this committee appears</h2>
          <p className="lede small">
            This committee is one of the sector contributors listed on these trails. Appearing here
            is not an allegation — most trails are labelled low or no signal on purpose.
            {trailTotal > trails.length && <> Showing {trails.length} of <strong>{trailTotal.toLocaleString()}</strong>;
            the rest are on <Link href="/trails">the trails page</Link>.</>}
          </p>
          <div className="grid g3">
            {trails.map((t: any) => (
              <Link key={t.vote_key + t.bioguide} href={trailHref(t)} className="card"
                style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <span className={`badge ${labelClass(t.label).badge}`}>{t.label}</span>
                <h3 className="clamp3" style={{ marginTop: 10, fontSize: 15.5 }}
                  title={t.bill_title || t.vote_desc}>{t.bill_title || t.vote_desc}</h3>
                <div className="small">
                  {t.full_name} voted <strong>{t.position}</strong> on {t.legis_num}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
