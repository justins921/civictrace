import { db, money, CYCLE, CYCLE_LABEL } from '@/lib/db'

export const revalidate = 3600

const SOURCES: [string, string, string][] = [
  ['FEC bulk data downloads', 'https://www.fec.gov/data/browse-data/?tab=bulk-data',
    'Committee-to-candidate contributions (pas2), committee master (cm), candidate master (cn), candidate–committee linkage (ccl). Public domain; attribution required.'],
  ['U.S. House Clerk roll call votes', 'https://clerk.house.gov/Votes',
    'Per-member positions in XML, back to 1990.'],
  ['U.S. Senate roll call votes', 'https://www.senate.gov/legislative/votes_new.htm',
    'Per-member positions in XML. There is no Senate vote endpoint in the Congress.gov API, so this is the only source.'],
  ['GovInfo BILLSTATUS bulk data', 'https://www.govinfo.gov/bulkdata/BILLSTATUS',
    'Bill titles, CRS policy areas, CRS summaries, sponsors and actions.'],
  ['House Appropriations FY2026 CPF file', 'https://appropriations.house.gov/fy26-member-requests/fy26-community-project-funding',
    'Consolidated earmark request spreadsheet — members’ own required disclosures.'],
  ['unitedstates/congress-legislators', 'https://github.com/unitedstates/congress-legislators',
    'Legislator identity and the ID crosswalk between bioguide, FEC, ICPSR, LIS and OpenSecrets. Licensed CC0.'],
]

export default async function Methodology() {
  // Every count here is the count the corresponding page shows, read from the
  // same reconciliation view the deploy check reads. This block previously
  // counted committee rows across all cycles (1,991) while /donors listed the
  // published cycle (1,972), and a reader had no way to tell which was wrong.
  const [{ count: members }, { count: rcs }, { count: pos }, { count: bills },
    { count: ears }, { count: trails }, { data: recon }] = await Promise.all([
      db.from('member').select('*', { count: 'exact', head: true }),
      db.from('rollcall').select('*', { count: 'exact', head: true }),
      db.from('vote_position').select('*', { count: 'exact', head: true }),
      db.from('bill').select('*', { count: 'exact', head: true }),
      db.from('earmark').select('*', { count: 'exact', head: true }),
      db.from('money_trail').select('*', { count: 'exact', head: true }),
      db.from('reconciliation').select('*').single(),
    ])
  const cmtes = Number(recon?.committees_listed ?? 0)
  const support = Number(recon?.committees_giving ?? 0)

  const rows: [string, number | string | null, string][] = [
    ['Members', members, 'Wisconsin’s federal delegation'],
    ['Contributing committees', cmtes, `every committee that made at least one direct contribution to a Wisconsin member in the ${CYCLE_LABEL} — the same set /donors lists`],
    ['Contributed this cycle', recon ? money(recon.via_contrib) : null, `${CYCLE_LABEL}, giver-side ledger, net of refunds — this figure is asserted identical on the donors, industries, member and committee pages, and a deploy fails if they disagree`],
    ['Roll calls', rcs, '119th Congress, House and Senate'],
    ['Wisconsin vote positions', pos, 'plus precomputed chamber and party base rates for every roll call'],
    ['Bills', bills, 'with CRS summaries and policy areas'],
    ['Wisconsin earmark requests', ears, 'FY2026 Community Project Funding'],
    ['Money trails', trails, 'member-vote pairs examined'],
  ]

  return (
    <div className="wrap">
      <h2 className="section">Methodology</h2>
      <p className="lede">
        Everything below is published so that anyone can reproduce our numbers or prove them wrong.
        Reproducibility is not a nicety here — it is the only reason to trust a site like this.
      </p>

      <div className="card">
        <div className="eyebrow">What is loaded</div>
        {/* A definition list, not a table: label / count / note is not tabular data
            that needs column alignment, and forcing it into a table made the label
            column collapse on a phone. This stacks instead of scrolling sideways. */}
        <dl className="deflist">
          {rows.map(([k, v, note]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num mono">{typeof v === 'string' ? v : (v || 0).toLocaleString()}</dd>
              <dd className="small">{note}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2 className="section">Counting rules</h2>
      <div className="grid g2">
        <div className="card">
          <h3>Money</h3>
          <ul className="small">
            <li>Only FEC transaction type <code>24K</code> — a direct contribution from a committee
              to a candidate&apos;s committee, as reported by the <strong>giving</strong> committee
              on Schedule B. Independent expenditures (<code>24E</code>/<code>24A</code>) are
              excluded: that is spending <em>about</em> a candidate, not money <em>to</em> them.</li>
            <li>Rows flagged <code>MEMO_CD = &lsquo;X&rsquo;</code> are excluded. They restate money
              counted elsewhere, and including them is the single most common way campaign finance
              totals get inflated.</li>
            <li><strong>Our totals do not reconcile to the FEC candidate page, and that is
              expected.</strong> The candidate page reports Schedule A line 11(c) — what the campaign
              said it received. We report Schedule B — what the PACs said they gave. Filing-frequency
              mismatches, amendments and one-sided itemization guarantee a gap. Example: our figure
              for Derrick Van Orden is $944,307; the FEC candidate page shows $994,742 through
              July 22, 2026.</li>
            <li>Every payment keeps its FEC <code>SUB_ID</code> and image number, so any figure can
              be traced back to the filed report.</li>
          </ul>
        </div>
        <div className="card">
          <h3>Votes</h3>
          <ul className="small">
            <li>Positions recorded as <code>Not Voting</code>, <code>Present</code> or{' '}
              <code>Paired</code> are excluded — both as a member&apos;s own position and from every
              denominator. An absence is not a position, and counting it as one manufactures fake
              party splits. (Our first build had this bug; it produced a trail claiming a member&apos;s
              party was split 27% on a bill that passed 350–5.)</li>
            <li>Votes where fewer than 10% of members took the losing side are labeled
              <em> no signal</em> and excluded from overlap analysis. A lopsided vote tells you
              nothing about any individual member.</li>
            <li>Bills flagged as omnibus or appropriations — which touch every sector at once — are
              excluded from overlap analysis entirely. We would rather refuse to compute a number
              than publish one that looks precise and isn&apos;t.</li>
          </ul>
        </div>
      </div>

      <h2 className="section">Classification</h2>
      <div className="card">
        <ul className="small">
          <li>Sector labels come from published keyword rules. Every label records the rule ID that
            produced it, and that ID is shown on every trail. &ldquo;Why is this PAC labeled
            Energy?&rdquo; has a literal answer.</li>
          <li>Where no industry rule matches, the committee is labeled by its FEC structural code —
            leadership PAC, party committee, corporate, trade association — so &ldquo;Unclassified&rdquo;
            means genuinely unknown rather than merely not-an-industry.</li>
          <li>Every committee also carries an <em>interest side</em>. A utility PAC and an
            environmental PAC are both &ldquo;Energy&rdquo; but they are not on the same side of a
            bill. Recording the side is what lets every trail show the opposing money next to the
            the industry total, which it always does.</li>
          <li>Bill sectors come from the CRS policy area first, then title and summary keyword rules.
            The matching evidence is displayed on every trail, so a silly keyword match is visible
            rather than hidden.</li>
          <li>No machine-learned or opaque classification is used for anything a reader sees. No
            number on this site is generated by a language model.</li>
        </ul>
      </div>

      <h2 className="section">What this site will never do</h2>
      <div className="card">
        <ul className="small">
          <li>It will never state or imply that a contribution caused a vote. The words
            &ldquo;bought&rdquo;, &ldquo;paid off&rdquo;, &ldquo;in exchange for&rdquo; and
            &ldquo;because of&rdquo; do not appear in any generated text, and a test fails the build
            if they do.</li>
          <li>It will never rank politicians against each other. A ranking function encodes the
            author&apos;s politics whether they meant it to or not.</li>
          <li>It will never take a position on a bill.</li>
          <li>It will never show one interest side of an industry without the other.</li>
        </ul>
      </div>

      <h2 className="section" id="sources">Sources</h2>
      <div className="grid g2">
        {SOURCES.map(([name, url, note]) => (
          <div className="card" key={name}>
            <h3><a href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a></h3>
            <div className="small">{note}</div>
          </div>
        ))}
      </div>

      <h2 className="section">Known gaps — stated, not hidden</h2>
      <div className="card">
        <ul className="small">
          <li>Wisconsin <strong>state</strong> legislature, state campaign finance and state
            lobbying are not yet loaded. Federal only for now.</li>
          <li>Senate Congressionally Directed Spending has no central disclosure file; each senator
            publishes their own. Wisconsin&apos;s senators are therefore absent from the earmark audit.</li>
          <li>Federal lobbying filings name bills only in free text, inconsistently formatted. We
            have not yet linked lobbying to bills, and when we do, extracted links will be labeled
            as extracted rather than presented as authoritative.</li>
          <li>Individual (non-committee) contributions are not published here. FEC rules restrict the
            use of contributor names and addresses, and the feature adds nothing this version needs.</li>
          <li>Wisconsin does not collect donor employer information at all — only occupation, and
            only above $200 per year. No ingestion method recovers it.</li>
        </ul>
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        <strong>Found something wrong?</strong> We would rather hear it than not. Every correction
        is published permanently with the date reported, what was wrong and what changed —
        including the ones we catch ourselves. Two are already in the log: our first data pass
        reconciled the wrong side of the FEC ledger, and an early build counted absences as votes.
        Neither was quietly patched.
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn solid" href="/corrections">Read the corrections log</a>
          <a className="btn" href="/contact">Report a problem</a>
        </div>
      </div>

    </div>
  )
}
