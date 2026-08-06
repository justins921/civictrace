import Link from 'next/link'
import { money, officeLine, labelClass, DOES_NOT_PROVE, hrefFor, CYCLE_LABEL, safeUrl } from '@/lib/db'
import { Gauge } from './Gauge'
import {
  DonorArt, PoolArt, CapitolArt, VoteArt, ClockArt, BillArt,
  ShieldIcon, MegaphoneIcon, DocIcon,
} from './Art'

type Pac = { cmte_id: string; name: string; sector: string; side: string | null; rule_id: string | null; total: number; fec_url: string }
type Sector = { sector: string; evidence: string }

export type Trail = {
  vote_key: string; bioguide: string; cycle: number; bill_key: string | null
  label: string; label_why: string
  sectors: Sector[]; top_pacs: Pac[]
  sector_dollars: number; sector_share_pct: number; total_pac_dollars: number
  /* `larger_pole_dollars` / `smaller_pole_dollars` are what these are. The
     `aligned` / `opposed` names read as aligned with and opposed to the
     member's vote, which is the one thing this project refuses to claim, and
     they are kept only so a page rendered against a database that has not been
     migrated yet still shows a number instead of a blank. */
  larger_pole_dollars?: number | null; smaller_pole_dollars?: number | null
  aligned_side_dollars: number; opposed_side_dollars: number; pac_count: number
  has_interest_axis?: boolean | null; axis_name?: string | null
  larger_pole?: string | null; smaller_pole?: string | null
  unaligned_dollars?: number | null
  adjacent_dollars?: number | null; adjacent_sides?: string | null; bill_side?: string | null
  days_since_last_sector_contribution: number | null
  timing_date: string | null; timing_same_day: boolean
  timing_contributions: { cmte_id: string; name: string; amount: number; date: string; fec_url: string }[]
  party_line_share_pct: number | null; minority_share_pct: number | null
  voted_with_chamber: string; voted_with_party: string; position: string
  full_name: string; slug: string; party: string; chamber: string; district: string | null
  official_url: string | null; fec_cand_id: string | null
  legis_num: string; vote_question: string | null; vote_desc: string | null
  vote_result: string | null; iso_date: string | null; yea: number; nay: number
  vote_source_url: string | null; vote_chamber: string
  bill_title: string | null; bill_summary: string | null; policy_area: string | null
  congressgov_url: string | null; bill_source_url: string | null; sponsor_name: string | null
}

function Step({ n, label, question, art, title, titleHref, sub, amount, amountLabel, tone, footer }: {
  n: number; label: string; question: string; art: React.ReactNode
  title: string; titleHref?: string; sub?: string; amount: string; amountLabel: string
  tone?: 'green' | 'amber' | 'plain'; footer?: React.ReactNode
}) {
  return (
    <div className="step">
      <div className="step-head"><span className="step-num">{n}</span>
        <span className="step-label">{label}</span></div>
      <div className="step-q">{question}</div>
      <div className="step-art">{art}</div>
      <div className="step-title">
        {titleHref ? <Link href={titleHref}>{title}</Link> : title}
      </div>
      {sub && <div className="step-sub">{sub}</div>}
      <div className={`amount-box ${tone === 'amber' ? 'amber' : tone === 'plain' ? 'plain' : ''}`}>
        <div className="v">{amount}</div>
        <div className="l">{amountLabel}</div>
      </div>
      {footer && <div className="tiny" style={{ marginTop: 8, textAlign: 'center' }}>{footer}</div>}
    </div>
  )
}

function SourceCard({ n, kind, who, value, meta, href, label }: {
  n: number; kind: string; who: string; value?: string; meta: string; href?: string | null; label?: string
}) {
  return (
    <div className="srccard">
      <div className="n"><b>{n}</b><span>{kind}</span></div>
      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{who}</div>
      {value && <div style={{ color: 'var(--green)', fontWeight: 900, fontSize: 17, margin: '5px 0' }}>{value}</div>}
      <div className="srcmeta">{meta}</div>
      {href
        ? <a className="btn" href={href} target="_blank" rel="noopener noreferrer">
            <DocIcon size={14} />{label || 'View Source'}</a>
        : <span className="btn" style={{ opacity: .45, borderColor: 'var(--line)', color: 'var(--faint)' }}>
            No direct link</span>}
    </div>
  )
}

export function TrailView({ t }: { t: Trail }) {
  const lc = labelClass(t.label)
  const largerPole = t.larger_pole_dollars ?? t.aligned_side_dollars
  const smallerPole = t.smaller_pole_dollars ?? t.opposed_side_dollars
  const top = t.top_pacs?.[0]
  const days = t.days_since_last_sector_contribution
  const sectorNames = (t.sectors || []).map(s => s.sector).join(', ')

  return (
    <>
      <div className="flow">
        <Step n={1} label="A contributing committee" question="Who gave to this member?"
          art={<DonorArt sector={top?.sector} size={74} />}
          title={top?.name || '—'} titleHref={top ? hrefFor.committee(top.cmte_id) : undefined}
          sub={top ? [top.sector, top.side].filter(Boolean).join(' · ') : undefined}
          amount={money(top?.total)}
          amountLabel={`from this committee alone, ${CYCLE_LABEL} · rule ${top?.rule_id || '—'}`}
          footer={top && <a href={safeUrl(top.fec_url) || '#'} target="_blank" rel="noopener noreferrer">FEC committee ↗</a>} />

        <Step n={2} label="Sector contributors" question="Who else in that sector gave?"
          art={<PoolArt size={74} />}
          title={sectorNames || '—'}
          sub={`${t.pac_count} committee${t.pac_count === 1 ? '' : 's'} in this sector, combined \u2014 `
            + `a different figure from step 1, which is one committee's own total`}
          amount={money(t.sector_dollars)}
          amountLabel={`${t.sector_share_pct}% of this member's PAC money`}
          footer={<span>{(t.sectors || []).map(x => (
            <Link key={x.sector} href={hrefFor.sector(x.sector)}
              style={{ marginRight: 6 }}>{x.sector} ↗</Link>))}</span>} />

        <Step n={3} label="The politician" question="Who received the money?"
          art={<CapitolArt size={74} />}
          title={t.full_name} titleHref={hrefFor.member(t.slug)} sub={officeLine(t)}
          amount={money(t.total_pac_dollars)} amountLabel={`total PAC receipts, ${CYCLE_LABEL}`}
          footer={t.fec_cand_id && <a href={`https://www.fec.gov/data/candidate/${t.fec_cand_id}/`}
            target="_blank" rel="noopener noreferrer">FEC candidate ↗</a>} />

        <Step n={4} label="The action" question="What did they do?"
          art={<VoteArt position={t.position} size={74} />}
          title={`${t.legis_num} — ${t.position}`}
          sub={t.vote_question || undefined}
          tone="plain"
          amount={`${t.vote_result} ${t.yea}–${t.nay}`} amountLabel={t.iso_date || ''}
          footer={t.vote_source_url && <a href={safeUrl(t.vote_source_url) || '#'} target="_blank" rel="noopener noreferrer">
            Roll call record ↗</a>} />

        <Step n={5} label="The timing" question="How close together were they?"
          art={<ClockArt size={74} />}
          title={
            !t.timing_date ? 'No dated prior contribution'
            : t.timing_same_day ? 'Same calendar date'
            : `${days} day${days === 1 ? '' : 's'} apart`}
          sub={
            !t.timing_date
              ? 'from this sector, on or before the day of the vote'
              : t.timing_same_day
                ? 'Records do not establish the time of day or which came first'
                : `Vote on ${t.iso_date}; most recent sector contribution ${t.timing_date}`}
          tone="amber"
          amount={!t.timing_date ? '—' : t.timing_same_day ? 'same day' : `${days}d`}
          amountLabel={t.timing_date ? `measured from ${t.timing_date}` : 'not computable'}
          footer={<span>proximity is not an agreement</span>} />

        <Step n={6} label="The policy" question="What does the bill do?"
          art={<BillArt size={74} />}
          title={t.bill_title || t.vote_desc || '—'}
          titleHref={t.bill_key ? hrefFor.bill(t.bill_key) : undefined}
          sub={(t.bill_summary || '').slice(0, 150) + ((t.bill_summary || '').length > 150 ? '…' : '')}
          tone="plain"
          amount={t.policy_area || 'Policy area not assigned'} amountLabel="CRS policy area"
          footer={t.congressgov_url && <a href={safeUrl(t.congressgov_url) || '#'} target="_blank" rel="noopener noreferrer">
            Congress.gov ↗</a>} />
      </div>

      {/* ---- gauge / disclaimer / opposing money ---- */}
      <div className="card" style={{ marginTop: 16, borderLeft: '4px solid var(--blue2)' }}>
        <div className="eyebrow" style={{ color: 'var(--blue)' }}>What this page does not prove</div>
        <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {DOES_NOT_PROVE.map(x => <li key={x} style={{ marginBottom: 3 }}>{x}</li>)}
        </ul>
      </div>

      <div className="gauge-row">
        <div className="gauge-cell">
          <Gauge angle={lc.angle} />
          <div>
            {/* C-03: "interest alignment" claimed the committees took a side on
                this bill. Contributions, an industry label and a vote do not
                establish that. This measures sector overlap and says so. */}
            <div className="eyebrow">Sector overlap</div>
            <div className={`verdict ${lc.verdict}`}>{t.label}</div>
            <div className="small">{t.label_why}</div>
            <div className="tiny" style={{ marginTop: 8 }}>
              This label is computed from three things: how much of the member&apos;s PAC money
              came from the bill&apos;s industry, how contested the vote was, and{' '}
              <strong>how this member voted relative to their own party</strong>. It does{' '}
              <strong>not</strong> claim the member voted the way their donors wanted — deciding
              what a bill does to an industry is a judgement call, and CivicTrace does not make
              it. So the strongest label here means the member broke from their own party on a
              contested vote while one side of that industry was funding them. It does not mean
              they voted for that side.
            </div>
          </div>
        </div>
        <div className="gauge-cell">
          <ShieldIcon />
          <div>
            <div className="eyebrow" style={{ color: 'var(--blue)' }}>Important disclaimer</div>
            <div className="small" style={{ marginTop: 6 }}>
              Overlap does not prove causation or improper influence, and it does not establish
              that any committee supported or opposed this bill — we have no position letter,
              lobbying filing or public statement from them about it. Members vote on hundreds of
              bills for many reasons, and PACs give for many reasons: committee assignment,
              district industry, seniority, party leadership.
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              CivicTrace shows documented public records so readers can review the facts themselves.
            </div>
          </div>
        </div>
        <div className="gauge-cell">
          <MegaphoneIcon />
          <div>
            <div className="eyebrow" style={{ color: 'var(--blue)' }}>
              {t.smaller_pole ? `Money from the ${t.smaller_pole} side` : 'Money from the other side'}
            </div>
            <div className="kpi" style={{ fontSize: 26, marginTop: 4 }}>{money(smallerPole)}</div>
            <div className="small">
              {t.has_interest_axis ? (
                <>came from committees on the <strong>{t.smaller_pole || 'opposing'}</strong> pole
                of this industry, against <strong>{money(largerPole)}</strong> from{' '}
                <strong>{t.larger_pole}</strong>
                {t.axis_name ? <> — the {t.axis_name} axis</> : null}. That is our classification of
                each committee, not a statement about this bill.</>
              ) : (
                <>This industry has no two-sided axis in our classifier, so we cannot tell you what
                another side gave. Read this zero as <strong>missing</strong>, not as checked.</>
              )}
            </div>
            {/* The share of the industry's money the poles actually account
                for. Without it, "$90,000 against $5,000" reads as the whole
                picture even when the two together are a seventh of the money —
                which was the case on all three of the trails this site ranked
                highest, and is why the labeller no longer calls that
                one-sided. */}
            {t.has_interest_axis && Number(t.unaligned_dollars) > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                A further <strong>{money(t.unaligned_dollars)}</strong> — {Math.round(
                  (100 * Number(t.unaligned_dollars)) / Math.max(1, Number(t.sector_dollars)))}%
                of this industry&apos;s money to this member — came from committees we could not
                place on either pole. It is neither of the two figures above.
              </div>
            )}
            <div className="tiny" style={{ marginTop: 8 }}>
              {t.has_interest_axis
                ? 'Shown beside the industry total by design. A trail that shows only one side of an industry is an argument, not a record. Three industries currently carry a declared axis — energy, health care and guns — and the others say so here rather than printing a zero that looks like a finding.'
                : 'Not every industry has two organised sides lobbying against each other, and we do not invent one to fill this box. Where an axis exists it is published on the methodology page with the committee list for each pole.'}
            </div>
          </div>
        </div>
      </div>

      {Number(t.adjacent_dollars) > 0 && (
        <div className="note" style={{ marginTop: 16 }}>
          <strong>What this bill&apos;s subject excluded.</strong> This bill is about{' '}
          <strong>{t.bill_side}</strong>, so only committees working in that line of business
          count as its industry money. This member also received{' '}
          <strong>{money(t.adjacent_dollars)}</strong> from the same industry on a different
          line — {t.adjacent_sides?.split('; ').join(', ')} — and it is <em>not</em> in the figure
          above.
          <div className="tiny" style={{ marginTop: 8 }}>
            We separate these because we got it wrong. An aviation safety bill on this site was
            once backed by two freight railroads and four construction PACs, with a same-day
            railroad contribution reading as the strongest finding we had published. A railroad
            has no stake in helicopter transponder rules. The money is still shown — it is real,
            and you may think it matters — but it is not counted as money about this bill.
          </div>
        </div>
      )}

      {/* ---- context + money table ---- */}
      {t.timing_date && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="eyebrow">Which filing the timing figure comes from</div>
          {t.timing_same_day ? (
            <p className="small" style={{ margin: '8px 0 0' }}>
              <strong>The contribution and the vote were reported on the same calendar date
              ({t.timing_date}).</strong> FEC filings record a date, not a time of day, so the
              available records do not establish which event occurred first. Do not read the
              ordering into this figure — it is not there.
            </p>
          ) : (
            <p className="small" style={{ margin: '8px 0 0' }}>
              The gap is measured from the most recent contribution to this member by any committee
              in the bill&apos;s sector on or before the day of the vote
              ({t.timing_date}), to the date of the vote ({t.iso_date}).
              {(t.timing_contributions || []).length > 1 &&
                ' More than one sector contribution shares that date; all of them are listed below.'}
            </p>
          )}
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Committee</th><th>Date filed</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {(t.timing_contributions || []).map(x => (
                <tr key={x.cmte_id + x.date}>
                  <td><Link href={hrefFor.committee(x.cmte_id)}>{x.name}</Link></td>
                  <td className="small mono">{x.date}</td>
                  <td className="num mono">{money(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny" style={{ marginTop: 8, marginBottom: 0 }}>
            This is not necessarily the committee shown in step 1. Step 1 shows the largest
            contributor in the sector; this table shows whichever contribution is nearest in time to
            the vote. They are frequently different committees, and neither fact implies the other.
          </p>
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="eyebrow">Context you need before concluding anything</div>
          <div style={{ marginTop: 10 }}>
            <div className="stat"><span>Voted with</span><b>{t.voted_with_chamber} voting members</b></div>
            <div className="stat"><span>Voted with own party</span>
              <b>{t.voted_with_party}{t.party_line_share_pct != null ? ` (${t.party_line_share_pct}%)` : ''}</b></div>
            <div className="stat"><span>How contested the vote was</span>
              <b>{t.minority_share_pct}% took the losing side</b></div>
            <div className="stat"><span>Sector share of PAC money</span><b>{t.sector_share_pct}%</b></div>
          </div>
          <div className="rule" />
          <div className="eyebrow">Why this bill was matched to this sector</div>
          <div className="small" style={{ marginTop: 6 }}>
            {(t.sectors || []).map(s => (
              <div key={s.sector} style={{ marginBottom: 4 }}>
                <strong><Link href={hrefFor.sector(s.sector)}>{s.sector}</Link></strong> —{' '}
                <span className="tiny">{s.evidence}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Committees in this sector that gave directly</div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Committee</th><th>Side</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(t.top_pacs || []).map(p => (
                <tr key={p.cmte_id}>
                  <td><Link href={hrefFor.committee(p.cmte_id)}>{p.name}</Link>
                    <div className="tiny">rule {p.rule_id || '—'} ·{' '}
                      <a href={safeUrl(p.fec_url) || '#'} target="_blank" rel="noopener noreferrer">FEC ↗</a></div></td>
                  <td className="small">{p.side || '—'}</td>
                  <td className="num mono">{money(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- source documents ---- */}
      <h2 className="section" style={{ fontSize: 20 }}>Source documents</h2>
      <p className="lede small">Every figure above comes from one of these. Nothing on this page is
        estimated, modelled, or inferred.</p>
      <div className="srcgrid">
        <SourceCard n={1} kind="Contribution" who={top?.name || '—'} value={money(top?.total)}
          meta={`FEC FORM 3X · SCHEDULE B\nTYPE 24K · CYCLE ${t.cycle}`} href={safeUrl(top?.fec_url)} />
        <SourceCard n={2} kind="Sector total" who={sectorNames} value={money(t.sector_dollars)}
          meta={`FEC BULK pas2 · ${t.pac_count} COMMITTEES\nMEMO ROWS EXCLUDED`}
          href="https://www.fec.gov/data/browse-data/?tab=bulk-data" />
        <SourceCard n={3} kind="Recipient" who={`${t.full_name} — ${officeLine(t)}`}
          value={money(t.total_pac_dollars)} meta={`FEC CANDIDATE ${t.fec_cand_id || '—'}\n2026 CYCLE`}
          href={t.fec_cand_id ? `https://www.fec.gov/data/candidate/${t.fec_cand_id}/` : null} />
        <SourceCard n={4} kind="Vote" who={`${t.legis_num} — ${t.position}`}
          meta={`${t.vote_chamber === 'House' ? 'U.S. HOUSE ROLL CALL' : 'U.S. SENATE ROLL CALL'}\n${t.iso_date || ''} · ${t.vote_result}`}
          href={safeUrl(t.vote_source_url)} />
        <SourceCard n={5} kind="Bill" who={t.bill_title || '—'}
          meta={`GOVINFO BILLSTATUS XML\n${t.bill_key || ''}`} href={safeUrl(t.bill_source_url)} />
        <SourceCard n={6} kind="Bill summary" who={t.bill_title || '—'}
          meta={`CONGRESS.GOV · CRS SUMMARY\nSPONSOR: ${t.sponsor_name || 'n/a'}`}
          href={safeUrl(t.congressgov_url)} label="Read Bill Summary" />
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <strong>How to read this page.</strong> Two true facts placed next to each other do not
        make a third fact. A contribution and a vote can align because a PAC backed a member who
        already agreed with it — which is ordinary politics, not misconduct. Before you conclude
        anything, read the two numbers in the context panel: if the member's party voted the same
        way and the chamber wasn't close, the money explains nothing that party affiliation doesn't
        explain first.
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className="btn solid" href={`/member/${t.slug}`}>See {t.full_name}'s full record</Link>
        <Link className="btn" href="/trails">All money trails</Link>
        <Link className="btn" href="/methodology">How this was calculated</Link>
      </div>
    </>
  )
}
