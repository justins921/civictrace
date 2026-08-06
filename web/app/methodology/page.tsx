import { db, money, CYCLE, CYCLE_LABEL } from '@/lib/db'

export const metadata = {
  title: 'Methodology — CivicTrace',
  description: 'How CivicTrace classifies committees and bills, what it refuses to claim, and where every figure comes from.',

}

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
    'Legislator identity, standing-committee membership, and the ID crosswalk between bioguide, FEC, ICPSR, LIS and OpenSecrets. Licensed CC0.'],
  ['openFEC API — candidate totals', 'https://api.open.fec.gov/developers/',
    'Total receipts, individual, PAC, party and self-funded money per candidate per cycle. This is the denominator on every member page: it is what tells you whether the committee money we trace is 64% of what a member raised or 4.5% of it. Context only — no trail is computed from it.'],
  ['FEC bulk data — individual contributions (indiv)', 'https://www.fec.gov/data/browse-data/?tab=bulk-data',
    'Itemized contributions from individuals, 29.3 million rows per cycle. Published here only as aggregates — size bands, occupations, employers above a three-donor floor, in-state share — and never as a name index. The file is itemized-only by law: a contributor is named once their giving passes $200 in aggregate, so it holds a majority but not all of a member’s individual money, and each member page states their own share.'],
  ['FEC bulk data — independent expenditures', 'https://www.fec.gov/data/browse-data/?tab=bulk-data',
    'Spending for or against a candidate by outside groups, shown on member pages as a separate ledger and never added to contributions. This file is filer-submitted and unvalidated: it currently contains multi-billion-dollar entries that are plainly not real, so filings above a plausibility ceiling are quarantined and counted rather than published.'],
  ['Senate/House Lobbying Disclosure Act filings (lda.gov API)', 'https://lda.gov/api/',   // lda.senate.gov retired 30 June 2026
    'Quarterly LD-2 filings: client, registrant, income or expenses, and a fixed list of 79 issue codes. Bill numbers are not a field in the LDA — registrants describe their work in prose — so bill-level lobbying here comes from parsing citations out of free text and covers a measured minority of filings.'],
]

export default async function Methodology() {
  // Every count here is the count the corresponding page shows, read from the
  // same reconciliation view the deploy check reads. This block previously
  // counted committee rows across all cycles (1,991) while /donors listed the
  // published cycle (1,972), and a reader had no way to tell which was wrong.
  const [{ count: members }, { count: rcs }, { count: pos }, { count: bills },
    { count: ears }, { count: trails }, { data: recon }, { data: exampleRows }] = await Promise.all([
      db.from('member').select('*', { count: 'exact', head: true }),
      db.from('rollcall').select('*', { count: 'exact', head: true }),
      db.from('vote_position').select('*', { count: 'exact', head: true }),
      db.from('bill').select('*', { count: 'exact', head: true }),
      db.from('earmark').select('*', { count: 'exact', head: true }),
      db.from('money_trail').select('*', { count: 'exact', head: true }).eq('cycle', CYCLE),
      db.from('reconciliation').select('*').single(),
      // M15: the reconciliation example used to be two numbers typed into the
      // prose. One of them was our own figure, which changes on every refresh,
      // so the paragraph explaining why our totals drift from the FEC's was
      // itself drifting out of date. Read the live one; keep the FEC's as the
      // dated observation it is.
      // bounds-ok: one row per sector for a single member. H4: this said
      // V000133, which is a different member entirely (Ann Wagner of Missouri).
      // The paragraph below names Derrick Van Orden and printed a total that
      // was not his — and because he has money in the table, it printed a
      // plausible wrong number rather than nothing, which is the worse failure.
      db.from('member_sector_money').select('bioguide,total')
        .eq('cycle', CYCLE).eq('bioguide', 'V000135').limit(200),
    ])

  // Summed across sectors: the same member's money split by industry.
  const example = (exampleRows || []).reduce((a: number, r: any) => a + Number(r.total), 0) || null
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
      <h1 className="section">Methodology</h1>
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
              for Derrick Van Orden is <strong>{example ? money(example) : 'not currently loaded'}</strong>{' '}
              (read from the published data as this page rendered); the FEC candidate page showed
              $994,742 through July 22, 2026, the last time we checked it by hand. The second
              number is a dated observation and we date it rather than refresh it silently.</li>
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
          <li>Every committee also carries an <em>interest side</em>, and some industries carry a
            declared <em>axis</em>: two named poles that lobby against each other. Energy is split
            between carbon-intensive energy and climate &amp; conservation, health care between
            payers and providers, and guns between gun rights and gun violence prevention. Where an
            axis exists, every trail shows both poles side by side. Where one does not, the trail
            says so instead of printing a zero.</li>
          <li>An axis is only declared where two organised constituencies genuinely lobby against
            each other and we can name both without making a political judgement. Sides that sit on
            neither pole — nuclear and biofuels in energy, pharma and devices in health care — are
            recorded as unaligned rather than quietly folded into one side.</li>
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
          <li>It will never claim a member voted the way their donors wanted. Deciding what a bill
              does to an industry is a judgement call, and we do not make it — so no label on this
              site means &ldquo;voted with their funders&rdquo;. The strongest label,{' '}
              <em>crossed party, one-sided industry money</em>, means exactly what it says: the
              member broke from their own party on a contested vote while one pole of that industry
              was funding them. Which way they voted is printed next to it; draw your own
              conclusion.</li>
          <li>It will never call money <em>one-sided</em> on the strength of not having looked.
              That phrase requires three things at once: the industry has a declared axis, most of
              its money to that member sits on one pole or the other, and one pole is at least
              twice the size of the other. Where any of those fails, the trail keeps whatever else
              is true about it — a member who broke from their party still gets a label saying so —
              and drops the one-sidedness claim rather than asserting it by default. It previously
              did the opposite: an industry with no axis produced two zeroes, and two zeroes tested
              as &ldquo;one-sided&rdquo;.</li>
          <li>It shows the opposing pole whenever the industry has a declared axis, and says
              plainly when it does not. Three industries currently do. A <code>$0</code> on a
              trail without an axis means <em>not classified</em>, never <em>checked and none
              found</em>, and the page states which of the two it is.</li>
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
          <li><strong>Lobbying is linked to bills, and covers a minority of lobbying by
            construction.</strong> The Lobbying Disclosure Act has no bill-number field; registrants
            describe their work in prose. We parse bill citations out of that prose, and we measure
            what share of filed activities name a bill at all rather than guessing at it — the
            current measurement is printed on every bill page. A bill with no lobbying listed has
            not been shown to be unlobbied. It has been shown not to have been named in a filing we
            could parse. Extracted links are labelled as extracted.</li>
          <li><strong>Individual contributions are published as aggregates, and the legal claim we
            used to make here was wrong.</strong> We previously said FEC rules prevented publishing
            them. 52 U.S.C. §30111(a)(4) forbids <em>selling</em> contributor names and addresses or
            using them to solicit; 11 CFR 104.15(c) and the FEC&apos;s own guidance exempt news and
            opinion sites republishing the data. The restriction we cited does not exist. Publishing
            aggregates rather than a name index is now an editorial choice and is described as one —
            see the <a href="/corrections">corrections log</a>.</li>
          <li>Individual money is <strong>itemized only</strong>. The FEC requires a contributor be
            named once their giving passes $200 in aggregate, so smaller donations appear in a
            member&apos;s reported total and in no public record naming anyone. Each member page
            prints their own itemized share; read a large unitemized remainder as a small-dollar
            base, not as secrecy.</li>
          <li>The lobbying backfill is <strong>incomplete and fills in over successive daily
            runs</strong>. The LDA API pages 25 filings at a time against 55,003 filings for the
            year, so a full pass takes several runs. Issue-area totals and bill links are therefore
            a floor, and both grow between refreshes.</li>
          <li>Wisconsin does not collect donor employer information at the state level — only
            occupation, and only above $200 per year. That is a state-data gap and does not affect
            the federal filings above.</li>
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
