# CivicTrace — Product Requirements Document v1.0

**Wisconsin first. Federal delegation + state legislature.**

Prepared for Chris and Justin · August 5, 2026
Companion to the working prototype (`civictrace-wisconsin.html`) and the reference implementation in this repo.

---

## 0. Read this part first

Chris's Project Bible is a good document. It has the mission right, the tone right, and the "never claim corruption" rule right. This PRD does not replace it — it takes the vision and answers the questions an engineer has to answer before writing code, plus four things the Bible didn't cover that materially change the plan.

**The four things that change the plan:**

1. **Wisconsin Statute § 11.1304(12) probably blocks the obvious monetization paths.** It says information copied from campaign finance reports on the Ethics Commission site "may not be sold or utilized by any person for any commercial purpose." There is no express journalism exception in the text, no case law construing it, and any Wisconsin elector can petition the Commission to bring a civil action. This has to be resolved by a Wisconsin election lawyer before you charge anyone a dollar or run a single ad.

2. **Wisconsin has no anti-SLAPP statute.** The Uniform Public Expression Protection Act passed the Assembly in February 2026 and died at Senate adjournment in March. That means a politician who sues you meritlessly imposes the full cost of defense on you and you recover nothing when you win. Realistic exposure is $25K–$150K. Form an entity and buy media liability insurance before you publish anything.

3. **Section 230 will not protect your generated claims.** Republishing a filed record is third-party content. A sentence your code generates — "Rep. X voted Yes 47 days after receiving $50,000 from the industry" — is your own speech. No Section 230, and no fair report privilege either, because Wis. Stat. § 895.05(1) expressly excludes "comments or interpolations" added by the publisher. This is the single most important architectural constraint in the project and it is why the money trail is built the way it is below.

4. **The market gap is bigger than you think.** OpenSecrets killed its public API in April 2025 and ran a $1.8M deficit in 2023. FollowTheMoney.org — the only national 50-state campaign finance database — is frozen at 2024 and explicitly unmaintained. Five civic APIs have died in eight years. Wisconsin's incumbent watchdog, the Wisconsin Democracy Campaign, has $1,350 in earned revenue, a decaying Joomla site, and a nonpartisan claim that half the state doesn't accept because of its funder list. **Nobody at all covers Wisconsin local races** — county, municipal, school board, judicial — because the state doesn't hold those records; county and municipal clerks do. That last gap is unoccupied, plausibly outside § 11.1304(12)'s text, and exactly the right size for two people.

**And one thing the prototype proved that's worth internalizing before you build anything else:** of the 200 money-vote overlaps the engine found in Wisconsin's federal delegation, it labeled 190 of them as uninformative — the vote was near-unanimous, or the member just voted with their party. Only 2 were flagged as worth a closer look. That ratio is the product. A tool that manufactures a scandal from every overlap is a partisan tool wearing a lab coat. The credibility of CivicTrace lives in its willingness to say "this one is nothing," over and over, in public.

---

## 1. Mission and non-goals

### Mission
Make the relationship between money, lobbying, and legislation in Wisconsin verifiable by any citizen in under sixty seconds, using only primary government records, with every figure traceable to the filed document it came from.

### What CivicTrace is
A public-records search and timeline engine. It states what was filed, when, by whom, and what happened afterward. It shows the reader the context needed to judge whether a pattern means anything.

### What CivicTrace is not — and these are hard product constraints, not values statements
- **Not an accusation engine.** No generated sentence may assert or imply that a contribution caused a vote. Banned verbs in all generated text: bought, paid off, bribed, rewarded, in exchange for, because of, in return for.
- **Not a scorecard.** No "corruption ranking," no leaderboard of members, no letter grades. Ranking is where nonpartisanship goes to die, because the ranking function encodes your politics whether you meant it to or not.
- **Not an advocacy organization.** CivicTrace takes no position on any bill, ever. This is also a funding requirement — the Institute for Nonprofit News membership standard requires it, and Press Forward excludes 501(c)(4)s.
- **Not dependent on politician cooperation.** Vote Smart's Political Courage Test went from a 72% response rate in 1996 to 20% in 2016 and helped bankrupt them. Never build a feature that requires a politician to answer you.

### Success criteria for v1
| Metric | Target | Why this one |
|---|---|---|
| Time to answer "who funds my rep and how did they vote" | Under 60s from landing page | This is the whole product |
| Share of displayed figures with a working link to the source document | 100% | Non-negotiable; it's the differentiator |
| Corrections issued within 7 days of a valid report | 100% | Legal posture + trust |
| Ratio of "no signal" to "notable" labels shown publicly | Published on the site | Proof of discipline |
| Partisan balance of flagged trails | Within 1.5x of the delegation's party split | A skew here means a bug, not a finding |

---

## 2. Scope

### In scope for v1.0
- **Wisconsin federal delegation** — 2 senators, 8 House members. FEC campaign finance, congressional roll call votes, bills, federal lobbying (LDA), earmark requests.
- **Wisconsin state legislature** — 99 Assembly, 33 Senate. State campaign finance, state bills and roll calls, state lobbying registrations and bills-lobbied.
- **Earmark / appropriations audit** — House Community Project Funding requests, Joint Finance Committee motions for the state budget.
- **Money trail viewer** — the flagship UI, matching the reference design.
- **Full methodology and corrections pages.**

### Explicitly out of scope for v1.0
- Any state other than Wisconsin. Resist this hard; the incumbents all died of overextension.
- Individual donor pages. Legal exposure under 52 U.S.C. § 30111(a)(4) and § 11.1304(12), and it adds nothing v1 needs.
- User accounts, saved searches, alerts, premium tiers. Phase 4 at the earliest, and only after the § 11.1304(12) opinion.
- Statements of Economic Interests. Wisconsin notifies the legislator of who examined their filing. Collecting all 132 would land a notification on every legislator in the state before you launch. Use the Wisconsin Democracy Campaign's existing collection and cite them.
- Stock trade tracking. Only one sitting WI member (Tony Wied) filed periodic transaction reports in 2026. Not worth the extraction work yet.
- The Senate EFD scraper. CSRF plus an agreement checkbox is a deliberate anti-automation posture. Leave it.

---

## 3. Data sources — verified as of August 5, 2026

Every source below was tested, not assumed. Difficulty ratings are for ingestion, not for reading.

### Federal

| Source | Access | Auth | Freshness | Difficulty | Notes |
|---|---|---|---|---|---|
| `unitedstates/congress-legislators` | JSON/CSV at `unitedstates.github.io` | none | continuous | **Trivial** | CC0. Your ID crosswalk: bioguide ↔ FEC ↔ ICPSR ↔ OpenSecrets ↔ LIS. **Build every foreign key off `bioguide`.** `theunitedstates.io` is dead — don't use tutorials that reference it. |
| FEC bulk downloads | ZIP at `fec.gov/files/bulk-downloads/{year}/` | none | daily–weekly | **Medium** | `indiv26.zip` is 1.86 GB. `pas226.zip` (PAC→candidate) is 7.5 MB and is what you actually need first. Pipe-delimited, no header — headers at `/data_dictionaries/`. |
| OpenFEC API | `api.open.fec.gov/v1/` | key | nightly | **Medium** | 1,000/hr default; email `APIinfo@fec.gov` for 7,200/hr — **do this before you write the ingest**. Schedule A uses **keyset pagination**, not page numbers; naive `page=N` loops break silently past ~page 100. |
| Congress.gov API | `api.congress.gov/v3/` | key | daily | **Low** | 5,000/hr. Bills, members, cosponsors, text, summaries. |
| House roll call votes | `clerk.house.gov/evs/{year}/roll{NNN}.xml` | none | same-day | **Medium** | Back to 1990. Also now in the Congress.gov API at `/v3/house-vote`. |
| Senate roll call votes | `senate.gov/legislative/LIS/roll_call_votes/vote{CCC}{S}/vote_{CCC}_{S}_{NNNNN}.xml` | none | same-day | **Medium** | **There is no Senate vote endpoint in the Congress.gov API.** You will maintain this scraper permanently. Needs a browser-like user agent. Join on `lis` id, not bioguide. |
| GovInfo BILLSTATUS bulk | `govinfo.gov/bulkdata/BILLSTATUS/{congress}/{type}` | none | daily | **Low** | Full bill XML with CRS summaries and policy areas, no API quota. Use for backfill. |
| Lobbying (LDA) | `lda.gov/api/v1/` | optional | same-day | **Low–Medium** | **The domain moved from `lda.senate.gov` — hardcode `lda.gov`.** 1.98M filings, 1999–present. `page_size` is hard-capped at 25, so a full backfill is ~79,000 requests / ~11 hours keyed. Filter `client_state=WI` first. Legacy SOPR bulk ZIPs are gone; `soprweb.senate.gov` no longer resolves. |
| Earmarks (House CPF) | one consolidated XLSX per fiscal year | none | per-cycle | **High (manual)** | `appropriations.house.gov/.../fy26-house-cpf-consolidated.xlsx` — 5,414 requests, $23.4B, with member, district, party, subcommittee, recipient, project and amount. Senate CDS has **no central file**; each senator posts their own. Treat earmarks as a curated dataset, not a pipeline. |
| USAspending | `api.usaspending.gov/api/v2/` | **none** | daily | **Low** | District rollups work out of the box: Wisconsin FIPS is 55, so districts are `5501`–`5508`. |

### Wisconsin state

| Source | Access | Freshness | Difficulty | Notes |
|---|---|---|---|---|
| **Campaign finance ("Sunshine")** | `campaignfinance.wi.gov` — undocumented tRPC JSON API | same-day | **Easy, but fragile** | **CFIS is dead; `cfis.wi.gov` redirects here.** 13.1M transactions, 10,286 committees, real data from July 2008. Filter params are `dateFrom`/`dateTo` — `startDate`/`endDate` are **silently ignored** and return the unfiltered corpus. The UI's CSV export caps at 100,000 rows; the API doesn't. **No employer field ever** — Wis. Stat. 11.0204 collects occupation only, and only above $200/year. Wrap this in an adapter and monitor for schema drift; it's unversioned and can change without notice. Note the site's `robots.txt` disallows several AI crawler user agents and sets `Content-Signal: ai-train=no` — a civic crawler is permitted, AI training is not. |
| **Lobbying (Eye on Lobbying)** | `lobbying.wi.gov` — Excel exports | semi-annual | **Easy / Medium** | Principals, lobbyists, and expenditures export cleanly back to the 2003 session. **Bills-lobbied with stance (For/Against/Other) is scrape-only** — no export. ⚠️ `robots.txt` is a full `Disallow: /`. That's a policy decision for you two, not a technical one; the ethical move is to ask the Ethics Commission for permission or a data feed in writing first. |
| **Legislature** | `docs.legis.wisconsin.gov` — HTML scrape | live | **Medium–Hard** | No API, no bulk download. Roll calls with per-member positions render in HTML at `/document/votes/{year}/av{NNNN}`. Rosters are HTML only. **Open States does not cover Wisconsin** — `open.pluralpolicy.com/wi/` returns HTTP 500. Don't plan around it. |
| **LegiScan** | API + bulk datasets | weekly | **Easy** | **Licensed CC BY 4.0** — the cleanest licensing of anything on this list. Sessions 2009–2026, JSON/CSV/XML, includes `getRollCall` and `getBillText`. Free tier: 30,000 queries/month. Paid Pull API starts at $1,000/yr for one state; nonprofits get discounted rates. **Use LegiScan for backfill, scrape only for freshness.** |
| **JFC budget motions** | `docs.legis.wisconsin.gov/misc/lfb/jfcmotions/` | per-session | **Medium** | 2019, 2021, 2023, 2025 biennia. The URL path encodes date + agency + motion number, so you can build a motion index by crawling the directory listing alone. Documents are PDFs served without a `.pdf` extension (check magic bytes, not headers) but they have a **text layer** — extraction works, no OCR needed. |
| **Statements of Economic Interests** | manual form ETH-2 + fees | annual | **Out of scope** | Not online. Fees apply. **The Ethics Commission notifies the filer who examined their statement.** |

---

## 4. Architecture

### Stack recommendation — one option, not three

**Postgres + Python ingest + FastAPI + Next.js on Vercel, with Postgres on Supabase or Neon.**

Why this and not something else:
- **Postgres, not SQLite or a graph DB.** You need real full-text search (`tsvector`), JSON columns for source payloads, and materialized views for the aggregate pages. A graph database sounds right for "relationships" and is wrong — your queries are overwhelmingly "sum contributions by X grouped by Y," which is relational. You can add a graph projection later for the network visualization; you cannot easily un-choose a graph DB.
- **Python for ingest.** Every one of these formats — pipe-delimited FEC, legacy `.xls`, roll call XML, PDF text extraction — has a mature Python library. This is not a place to be clever.
- **Next.js because it gives you server-rendered pages for free**, which matters enormously here: your entire growth model is organic search for "[politician name] campaign finance," and that requires real HTML at a stable URL, not a client-rendered SPA. GovTrack gets 73% of its ~200K monthly visits from organic search. That is the playbook.
- **Vercel + Supabase because a two-person team should not run servers.** Both have free tiers that will carry you through v1 and cost under $50/month at v1 scale.

### Services

```
┌─────────────────────────────────────────────────────────────┐
│  INGEST (Python, scheduled)                                 │
│  one adapter per source, each writing raw payload + parsed  │
│  rows. Every adapter is independently re-runnable and       │
│  idempotent. Raw responses archived to object storage       │
│  before parsing — always.                                   │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  POSTGRES                                                   │
│  facts (immutable, sourced) │ entities │ resolution │       │
│  classification (rule-tagged) │ materialized aggregates     │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  API (FastAPI)  — read-only, cached, public, versioned      │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  WEB (Next.js) — SSR pages, static where possible           │
└─────────────────────────────────────────────────────────────┘
```

### The one architectural rule that matters most

**Archive the raw response before you parse it.** Every adapter writes the untouched bytes to object storage with a fetch timestamp and URL, then parses. When a politician's lawyer asks where a number came from, you produce the government's own file as you received it on the date you received it. This is worth more than any other single engineering decision in the project, and it costs almost nothing.

---

## 5. Data model

Schema is annotated; the reference implementation in `etl.py`, `fetch_votes.py`, `fetch_bills.py` and `load_earmarks.py` is a working SQLite version of this.

### Core principle: facts are immutable and sourced; interpretation is separate and versioned

```sql
-- ===== SOURCE PROVENANCE — every fact points here =====
CREATE TABLE source_document (
  id              BIGSERIAL PRIMARY KEY,
  source_system   TEXT NOT NULL,      -- 'fec_bulk' | 'wi_sunshine' | 'house_clerk' | ...
  source_url      TEXT NOT NULL,
  document_ref    TEXT,               -- FEC image number, roll call number, filing id
  fetched_at      TIMESTAMPTZ NOT NULL,
  content_hash    TEXT NOT NULL,
  raw_object_key  TEXT NOT NULL,      -- object storage key for the untouched bytes
  UNIQUE (source_system, content_hash)
);

-- ===== ENTITIES =====
CREATE TABLE person (
  id            BIGSERIAL PRIMARY KEY,
  bioguide_id   TEXT UNIQUE,          -- federal primary key
  wi_person_id  TEXT UNIQUE,          -- state legislators
  full_name     TEXT NOT NULL,
  first_name    TEXT, last_name TEXT,
  external_ids  JSONB NOT NULL DEFAULT '{}'  -- fec[], icpsr, lis, opensecrets, legiscan
);

CREATE TABLE office_term (
  id          BIGSERIAL PRIMARY KEY,
  person_id   BIGINT REFERENCES person(id),
  level       TEXT NOT NULL,          -- 'federal' | 'state'
  chamber     TEXT NOT NULL,          -- 'house' | 'senate' | 'assembly'
  state       CHAR(2) NOT NULL,
  district    TEXT,
  party       TEXT,
  start_date  DATE, end_date DATE
);
-- District boundaries change. Version them by cycle — Wisconsin's congressional
-- map is under appeal at the state Supreme Court targeting 2028.

CREATE TABLE committee (          -- PACs, party committees, candidate committees
  id             BIGSERIAL PRIMARY KEY,
  jurisdiction   TEXT NOT NULL,       -- 'federal' | 'WI'
  external_id    TEXT NOT NULL,       -- FEC cmte_id or WI committee id
  cycle          INT,
  name           TEXT NOT NULL,
  committee_type TEXT, designation TEXT, org_type TEXT,
  connected_org  TEXT,
  candidate_ext_id TEXT,
  UNIQUE (jurisdiction, external_id, cycle)
);

CREATE TABLE organization (       -- corporations, unions, trade associations
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, canonical_name TEXT, notes TEXT
);

-- ===== FACTS (immutable) =====
CREATE TABLE contribution (
  id                 BIGSERIAL PRIMARY KEY,
  source_document_id BIGINT NOT NULL REFERENCES source_document(id),
  jurisdiction       TEXT NOT NULL,
  filer_committee_id BIGINT REFERENCES committee(id),   -- who gave
  recipient_committee_id BIGINT REFERENCES committee(id),
  recipient_person_id    BIGINT REFERENCES person(id),
  contributor_name   TEXT,            -- individual contributions: name only, no address
  occupation         TEXT,
  employer           TEXT,            -- federal only; Wisconsin does not collect it
  transaction_type   TEXT NOT NULL,   -- FEC 24K/24E/24A/24C, or WI equivalent
  is_memo            BOOLEAN NOT NULL DEFAULT FALSE,
  amount             NUMERIC(14,2) NOT NULL,
  transaction_date   DATE,
  ledger_side        TEXT NOT NULL,   -- 'giver' (Sch B) | 'recipient' (Sch A)
  external_txn_id    TEXT UNIQUE,     -- FEC sub_id
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ledger_side is not optional. See §7.3 — giver-side and recipient-side ledgers
-- never reconcile, and mixing them silently is a credibility-ending bug.

CREATE TABLE bill (
  id BIGSERIAL PRIMARY KEY, source_document_id BIGINT REFERENCES source_document(id),
  jurisdiction TEXT NOT NULL, session TEXT NOT NULL,
  bill_type TEXT, bill_number TEXT, title TEXT, policy_area TEXT,
  summary TEXT, sponsor_person_id BIGINT REFERENCES person(id),
  introduced_date DATE, latest_action TEXT, latest_action_date DATE,
  is_broad BOOLEAN NOT NULL DEFAULT FALSE,   -- omnibus/appropriations; see §7.2
  official_url TEXT,
  UNIQUE (jurisdiction, session, bill_type, bill_number)
);

CREATE TABLE roll_call (
  id BIGSERIAL PRIMARY KEY, source_document_id BIGINT REFERENCES source_document(id),
  jurisdiction TEXT NOT NULL, chamber TEXT NOT NULL, session TEXT,
  vote_number INT, bill_id BIGINT REFERENCES bill(id),
  question TEXT, description TEXT, result TEXT, vote_date DATE,
  yea INT, nay INT, present INT, not_voting INT
);

CREATE TABLE vote_position (
  roll_call_id BIGINT REFERENCES roll_call(id),
  person_id    BIGINT REFERENCES person(id),
  position     TEXT NOT NULL,          -- 'Yea'|'Nay'|'Present'|'Not Voting'
  is_cast      BOOLEAN NOT NULL,       -- FALSE for Present/Not Voting/Paired
  PRIMARY KEY (roll_call_id, person_id)
);
-- is_cast is computed on ingest and used in EVERY denominator. Counting an
-- absence as a position manufactures fake party splits. See §7.1.

CREATE TABLE lobbying_filing (
  id BIGSERIAL PRIMARY KEY, source_document_id BIGINT REFERENCES source_document(id),
  jurisdiction TEXT NOT NULL, registrant TEXT, client TEXT,
  period TEXT, amount NUMERIC(14,2), issue_codes TEXT[], specific_issues TEXT
);

CREATE TABLE lobbying_bill_link (
  lobbying_filing_id BIGINT REFERENCES lobbying_filing(id),
  bill_id            BIGINT REFERENCES bill(id),
  stance             TEXT,             -- WI publishes For/Against/Other; LDA does not
  extraction_method  TEXT NOT NULL,    -- 'reported' | 'regex' | 'llm'
  confidence         REAL
);
-- Federal LDA puts bill numbers in free text only, inconsistently formatted.
-- Anything not 'reported' MUST be labelled as extracted in the UI. Never present
-- a regex or LLM guess as an authoritative link.

CREATE TABLE earmark_request (
  id BIGSERIAL PRIMARY KEY, source_document_id BIGINT REFERENCES source_document(id),
  fiscal_year INT, person_id BIGINT REFERENCES person(id),
  state CHAR(2), district TEXT, subcommittee TEXT,
  recipient TEXT, project TEXT, address TEXT, amount NUMERIC(14,2),
  member_disclosure_url TEXT
);

-- ===== CLASSIFICATION (versioned, auditable, separate from facts) =====
CREATE TABLE classification_rule (
  id TEXT PRIMARY KEY,                 -- 'E03', 'BT01'
  ruleset_version TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'committee_sector' | 'bill_sector'
  sector TEXT NOT NULL,
  interest_side TEXT,                  -- 'oil & gas' vs 'clean energy / environment'
  pattern TEXT NOT NULL,
  effective_from DATE NOT NULL
);

CREATE TABLE committee_sector (
  committee_id BIGINT REFERENCES committee(id),
  sector TEXT NOT NULL, interest_side TEXT,
  rule_id TEXT REFERENCES classification_rule(id),
  PRIMARY KEY (committee_id, sector)
);

CREATE TABLE bill_sector (
  bill_id BIGINT REFERENCES bill(id),
  sector TEXT NOT NULL, evidence TEXT NOT NULL,
  rule_id TEXT REFERENCES classification_rule(id),
  PRIMARY KEY (bill_id, sector)
);

-- ===== CORRECTIONS (public, permanent) =====
CREATE TABLE correction (
  id BIGSERIAL PRIMARY KEY, reported_at TIMESTAMPTZ NOT NULL,
  reporter_type TEXT,                  -- 'public'|'subject'|'internal'
  affected_url TEXT, description TEXT NOT NULL,
  resolution TEXT, resolved_at TIMESTAMPTZ, published BOOLEAN DEFAULT TRUE
);
```

### Entity resolution

The hardest unglamorous problem. "NORTHWESTERN MUTUAL LIFE INSURANCE COMPANY POLITICAL ACTION COMMITTEE (NMPAC)" and "NM PAC" are the same giver. Rules:

1. **Federal is easy** — FEC committee IDs are stable. Use them; do not fuzzy-match what has a real key.
2. **Person resolution goes through bioguide.** Never match legislators by name. `congress-legislators` gives you the crosswalk free; note ICPSR is missing for newer members (Van Orden, Fitzgerald, Tiffany, Wied all lack it), so never make ICPSR a required join key.
3. **Organization clustering is a review queue, not an algorithm.** Propose merges automatically, apply them only after human approval, and log every merge with who approved it and when. An incorrect merge attributes one company's money to another — that is a defamation vector, not a data quality issue.
4. **Never resolve individual donors across records.** Two people named "John Smith" in Milwaukee are two people until proven otherwise, and proving otherwise requires the employer field Wisconsin doesn't collect.

---

## 6. Page specifications

### 6.1 Home
Single search box, a short statement of what the site does, three example searches (a legislator, a company, a bill), and the current data freshness per source. No editorializing, no calls to action, no donation ask above the fold.

### 6.2 Search
One box, typeahead across people, committees, organizations, bills, lobbying principals. Postgres `tsvector` with trigram fallback. Results grouped by type. Every result row shows jurisdiction and date range so the user knows what they're clicking.

### 6.3 Politician profile — the workhorse page
**URL:** `/wi/person/{slug}` — stable forever, because this is your organic search surface.

Sections, in order:
1. **Header** — name, office, party, district, term dates, committee assignments. Links to their official site, FEC page, Congress.gov or WI Legislature page.
2. **Money summary** — total received this cycle, broken out by sector, with a bar for each. **Must display both ledger sides** (see §7.3) or state clearly which one is shown and why.
3. **Top contributors** — committee name, sector label, the rule ID that produced the label, amount, link to the FEC/Sunshine committee record.
4. **Voting record** — recent roll calls with the member's position, the question voted on (not just the bill title — they differ, and conflating them is an error the prototype initially made), the chamber result, and how the member's party split.
5. **Sponsored and cosponsored bills.**
6. **Lobbying activity touching their committees.**
7. **Earmark requests** — from their own disclosure, linked to it.
8. **Timeline** — everything above in one chronological stream. This is the killer feature Chris identified and he's right.
9. **Sources** — a complete list of every source document backing this page.

### 6.4 Money trail viewer — the flagship
This is the component in the reference image. Six steps, left to right, each a card with a value and a source link. The prototype implements this.

**Mandatory elements — the UI must not be able to render the trail without them:**
- Every step carries a link to the underlying filing.
- The **alignment label is conservative and self-explaining.** Four states, in order of how often you'll see them: *Near-unanimous vote — no signal*, *Party-line vote — low signal*, *Some overlap*, *Notable overlap*. Every label ships with a plain-English "why this label" sentence.
- **The base-rate block is not optional and cannot be collapsed by default.** How the chamber voted. How the member's own party voted. What share of the member's PAC money the sector represents.
- **Money from the opposing side of the same sector appears in the same table.** A utility PAC and an environmental PAC are both "Energy." Showing one without the other is the "one-sided editing" that strips the fair report privilege under Wisconsin law.
- **The whole-delegation vote is one click away.**
- The disclaimer is part of the component, not a footer.

### 6.5 Bill page
Summary (CRS text, quoted and attributed, never paraphrased by an LLM), full text link, sponsor and cosponsors, actions timeline, roll calls, affected sectors **with the matching evidence shown**, related lobbying filings **labeled by extraction method**, and — for appropriations bills — the earmark breakdown.

### 6.6 Earmark audit
The prototype's version is close to right. Per fiscal year: national totals, party comparison, per-member Wisconsin breakdown linked to each member's own disclosure page, breakdown by appropriations subcommittee, and a full searchable table of every request.

**The framing is the product here.** CivicTrace never labels a project "pork." Whether a runway repair is infrastructure or waste is the reader's judgement. What the site does is make every request countable, comparable, and traceable to the member who asked for it. State the party numbers honestly in both directions — in FY2026, Democrats filed more requests and Republicans requested more dollars. Say both.

**Also state the gaps.** Three Wisconsin House members filed no FY2026 requests. Senate CDS has no central file at all. Publishing the gap is what separates you from an advocacy site.

### 6.7 Organization / company page
Its PACs, contributions by recipient and cycle, lobbying spending, bills lobbied with stance where the state publishes it, and executives where documented. No inferred relationships without a source.

### 6.8 Methodology
Every counting rule, every classification rule with its ID and pattern, every known gap, and the full source list with access dates. Published, permanent, and versioned.

### 6.9 Corrections
Public log of every correction with date reported, what was wrong, what changed. This is a legal asset — under Wis. Stat. § 895.05(2), a prompt correction is a complete defense to punitive damages for a "newspaper, magazine or periodical," and while it's unsettled whether a website qualifies, having the policy converts your best defense from "maybe" to "probably." It costs nothing.

---

## 7. The editorial engine — the part that makes or breaks this

These are code-level requirements. Each one exists because the prototype got it wrong first and the error was visible.

### 7.1 Absence is not a position
A member recorded as *Not Voting*, *Present*, or *Paired* has taken no position. Exclude them as a subject of any trail, and exclude them from every denominator.

*Why this is in the PRD:* the prototype's first build counted "Not Voting" as a position. It produced a trail claiming Bryan Steil's party was split 27% on a bill that passed 350–5. That is a fabricated controversy generated by a one-line bug, and it would have been the first thing a hostile reader found.

### 7.2 Refuse to compute what can't be computed
An omnibus appropriations bill touches every sector. "Sector share of PAC money: 27.7%" is a meaningless number when the sector is *all sectors*. Flag broad bills (appropriations, CRs, anything matching 4+ sectors) and exclude them from alignment analysis entirely. Show the earmark breakdown instead — that's where appropriations money is actually traceable.

Similarly: a vote where fewer than 10% of members took the losing side carries no information about any individual member. Label it and move on.

### 7.3 Never mix ledger sides silently
FEC transaction type `24K` is a **Schedule B disbursement reported by the giving PAC**. The FEC candidate page's "contributions from other committees" is **Schedule A line 11(c), reported by the receiving campaign**. These two ledgers never reconcile — different filing frequencies, amendments, one-sided itemization.

The prototype's Van Orden figure is $944,307 (giver-side). The FEC candidate page shows $994,742 through 2026-07-22 (recipient-side). Neither is wrong. A reader who checks and finds a $50K discrepancy you didn't explain will assume you're sloppy or cooking numbers, and they'd be right to.

**Requirement:** every money figure carries its ledger side. Where both exist, show both. Explain the difference in plain language on the page, not in a footnote.

### 7.4 Classification must be auditable, and the rules are public
No opaque or machine-learned classification for anything a user sees. Every sector label stores the rule ID that produced it, and the rules are published. "Why is this PAC labeled Energy?" must have a literal answer.

Where no rule matches, fall back to the FEC's own structural codes — leadership PAC, party committee, corporate, trade association — so "Unclassified" means genuinely unknown rather than merely not-an-industry.

Record `interest_side` within each sector. This is the field that keeps you honest: it's what makes "show the opposing money" possible.

### 7.5 Banned language in generated text
Enforce with a test that fails the build. Banned: *bought, paid off, bribed, rewarded, in exchange for, because of, in return for, corrupt, kickback*. Generated text presents; it does not conclude.

Under *Chapin v. Knight-Ridder*, content "constructed around questions, not conclusions" is protected; language that "affirmatively suggests the author intends or endorses the inference" is not. That case is the line you're drawing.

### 7.6 Partisan symmetry is a monitored metric
Compute the party breakdown of flagged trails on every build. If the engine surfaces 40 Republicans and 4 Democrats out of a delegation that's 6R–2D, that is a bug in your rules or your data, and you find it before a plaintiff's lawyer does. Publish the distribution on the site.

---

## 8. AI usage policy

AI is genuinely useful here and genuinely dangerous. The line:

**Permitted:**
- Summarizing bill text into plain English — **clearly labeled as an AI summary, shown alongside the official CRS summary, never replacing it.**
- Proposing entity merges into a human review queue.
- Extracting bill references from free-text lobbying "specific issues" fields — **stored with `extraction_method='llm'` and displayed as extracted, not authoritative.**
- Internal QA: flagging outliers and probable parse errors for human review.

**Forbidden, permanently:**
- Generating any characterization of a politician, a vote, or a contribution.
- Producing any number a user sees. Numbers come from SQL over sourced facts.
- Classifying anything into a sector without a published rule.
- Writing the alignment label or its explanation. Those are deterministic functions of the data.

The reason is legal, not aesthetic: an LLM-generated inference is unambiguously your own speech. No Section 230, no fair report privilege. Neither OpenAI nor Microsoft asserted a §230 defense in the recent generative-AI defamation cases, which tells you what their lawyers think.

---

## 9. Monetization — the answer to "how do we do this without being hypocrites"

**The recommendation, in order:**

### Launch posture (months 0–12): free, no ads, no paywall, no data sales
Not because you can't monetize but because § 11.1304(12) is unresolved and because credibility compounds. Fund it out of pocket — hosting for v1 is genuinely under $50/month.

**First action item, before anything else: get a Wisconsin election-law opinion on § 11.1304(12).** Specific questions to put to counsel:
- Does an ad-supported free site "utilize" the information for a commercial purpose?
- Does a paid API over WI-derived data violate it?
- Does *Sorrell v. IMS Health* defeat it as applied to a news publisher?
- Does it reach data obtained from a third party (Transparency USA) or from a county clerk rather than the Commission's site?
- **Does it reach local-race records at all,** given the statute's text is tied to reports on the Commission's site and local records are held by county and municipal clerks?

That last question matters more than it looks. If local records sit outside the statute, the local-races strategy has a legal argument on top of the competitive one.

### Revenue stack, in order of what to do first

**1. Individual small donations + INN fiscal sponsorship.** Fastest path to first dollar (1–3 months) and the lowest bias risk of anything available. The Institute for Nonprofit News charges a $250 application fee and $150–$1,500/yr dues, and will act as your 501(c)(3) fiscal sponsor — you skip IRS Form 1023 entirely and unlock NewsMatch dollar-for-dollar matching. Their standards require editorial independence, funding transparency, and no advocacy for specific policy outcomes, which you want anyway.

Rules that make this bulletproof, steal them verbatim from Wisconsin Watch:
- Publish every donor above a threshold.
- **Refuse anonymous donations.**
- Refuse money from candidates, parties, PACs, registered lobbyists, and 501(c)(4)s of any ideology.
- Cap individual gifts so no single donor matters.

**2. Newsroom and academic data access.** Modest prices, fast, and credibility-accretive — every citation is a backlink and a trust signal. Journalists are the single best first customer.

**3. Grants, in year two, once you have a track record.** Be realistic about this:

| Funder | Reality |
|---|---|
| Knight Foundation | No unsolicited proposals, and **no Wisconsin city is in their 26 communities** — you're geographically ineligible for the community program |
| Hewlett | No unsolicited letters of inquiry |
| Democracy Fund | No unsolicited proposals; wants a proven track record and six-figure reach |
| Joyce Foundation | Accepts intros, Great Lakes focus, **but explicitly does not fund "money in politics" or "government accountability"** — you're out of scope |
| **Craig Newmark Philanthropies** | **Accepts unsolicited, rolling. Your single best cold-outreach target.** Wants brevity; over-polished decks slow things down |
| **Press Forward** | Biggest open call in the space, ~$100K over two years, but required ~1 year of operating history. **Build first, apply in year two.** |

**4. Ads — only if needed, GovTrack-style, and only after the § 11.1304(12) opinion.** GovTrack has run AdSense for twenty years with no credibility damage because they publish the policy, visually separate ads, and don't solicit from one side. Their scale (~200K visits/month) yields roughly $500–$2,000/month, which tells you this is a supplement, not a plan.

### Buyers who poison the well — never, at any price
Campaigns, candidates, parties, PACs, registered lobbyists, and advocacy 501(c)(4)s of any ideology. Selling to any of them ends the nonpartisan claim permanently and irreversibly, and it's also where the FEC and Wisconsin solicitation restrictions bite hardest.

### The sharp legal edge worth repeating
**Never use FEC or Wisconsin contributor data to find your own donors.** 52 U.S.C. § 30111(a)(4) prohibits using contributor information to solicit *any* contribution, including charitable ones. Committees salt their filings with fictitious names specifically to catch this. Your donor prospecting and your campaign finance database must never touch.

### The counterintuitive finding
Grant funding *feels* clean and *reads* dirty. The Wisconsin Democracy Campaign's nonpartisan claim is contested almost entirely through its funder list — Tides, New Venture Fund, State Power Fund, Open Society. GovTrack takes ad money and nobody accuses it of anything. If you take grants, take them from ideologically heterogeneous sources and publish every dollar.

---

## 10. Legal and risk

### Before you publish a single page
1. **Form an LLC or nonprofit corporation.** Do not publish as individuals. Wisconsin's lack of an anti-SLAPP statute makes personal exposure real.
2. **Buy media liability insurance.** Roughly $1,500–$5,000/yr for a small publisher; INN membership includes discounted access and legal consultations.
3. **Publish a corrections policy and honor requests within seven days.**
4. **Publish a masthead, an about page, and bylined editorial content** so the fair report privilege argument under § 895.05(1) — which is written for "newspaper... proprietors, publishers, editors, writers, reporters" — is available to you.
5. **Get the § 11.1304(12) opinion.**

### Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| § 11.1304(12) blocks monetization | **High** | High | Legal opinion first; launch free; local-races strategy may sit outside it |
| Defamation suit, no anti-SLAPP backstop | Medium | **Severe** | Entity + insurance + no generated conclusions + corrections policy + base rates always shown |
| Undocumented WI Sunshine API changes without notice | **High** | Medium | Adapter layer, schema-drift monitoring, archived raw responses, CSV fallback |
| Accused of partisan bias | **Certain** | High | Symmetry metric published; open methodology; reproducible; heterogeneous funding; no rankings |
| Bad entity merge attributes money to wrong company | Medium | High | Human-approved merges only, full audit log |
| Two-person team burns out | **High** | High | Wisconsin only. Ruthlessly. Every "let's also add..." is the enemy |
| Sector keyword rules produce a silly match | **Certain** | Low–Medium | Evidence shown on every trail; public rule list; correction queue |

### The precedent worth knowing
No defamation litigation has been found against OpenSecrets, Ballotpedia, FollowTheMoney, GovTrack, or Vote Smart. Decades of publishing sensitive data about powerful people with a clean litigation record. The discipline — republish official records, attribute everything, don't editorialize — demonstrably works.

The cautionary case is *Castro v. Doe*: a congressional candidate sued an anonymous Wikipedia editor for $180 million over a wiki article and subpoenaed to unmask him. The risk lands on individual small operators, not on well-resourced institutions. That is precisely who you two are, which is why steps 1 and 2 above come before step 6.

---

## 11. Milestones

Sized for two people, one of whom is doing this alongside client work.

### Phase 0 — Foundations (weeks 1–2)
- Domain, GitHub org, brand basics
- **Entity formation**
- **Send the § 11.1304(12) question to a Wisconsin election lawyer** (this has the longest lead time — start it in week 1)
- Postgres up on Supabase, repo scaffolded, CI running
- **Deliverable:** a landing page that says what this is, and an email capture

### Phase 1 — Federal Wisconsin (weeks 3–8)
This is what the prototype already covers, so you're partly done.
- `congress-legislators` ingest → person and office_term tables
- FEC bulk `pas2`/`cm`/`cn`/`ccl` ingest → committees and contributions
- House Clerk + Senate roll call ingest → roll_call and vote_position
- GovInfo BILLSTATUS ingest → bills
- Sector classification with published rules
- Politician profile pages, bill pages, search
- Money trail component with the full base-rate block
- Methodology and corrections pages
- **Deliverable: public launch, federal delegation only.** Ten members done properly beats 132 done badly.

### Phase 2 — Earmarks and lobbying (weeks 9–14)
- House CPF XLSX ingest, per fiscal year
- Earmark audit pages
- `lda.gov` ingest filtered to `client_state=WI` (204 filings for one quarter — small enough to prove the pipeline before attempting anything larger)
- Free-text bill extraction, labeled as extracted
- **Deliverable:** the earmark audit, which is the most differentiated thing you have

### Phase 3 — Wisconsin state (weeks 15–26)
The bigger lift, and the reason to do federal first.
- LegiScan backfill for WI bills, sponsors, roll calls (CC BY 4.0 — clean licensing)
- Wisconsin Sunshine campaign finance adapter, 2008–present
- `docs.legis.wisconsin.gov` scraper for freshness and rosters
- Eye on Lobbying Excel ingest — **after asking the Ethics Commission in writing**, given the robots.txt
- State legislator profiles, 132 members
- JFC motion index and PDF text extraction for the state budget audit
- **Deliverable:** full state coverage — the thing nobody else does well

### Phase 4 — Sustainability (month 7+)
- INN membership and fiscal sponsorship
- Donation infrastructure with published policies
- Public API v1 (**gated on the legal opinion**)
- Journalist and academic access program
- Craig Newmark outreach; Press Forward application once you have a year of history

### The local-races option
After Phase 3, the highest-value next move is **not** a second state. It's Wisconsin local races — county board, city council, school board, judicial. Nobody aggregates them, because the state doesn't hold the records; county, municipal and school clerks do. It's unoccupied, plausibly outside § 11.1304(12), it's where nonpartisanship is genuinely easiest to maintain because local races aren't nationally coded, and it's the right size for two people. It would also make CivicTrace the only place in America where you can look up who funded your school board.

---

## 12. Cost

| Item | v1 monthly | Notes |
|---|---|---|
| Vercel | $0–20 | Free tier likely sufficient at launch |
| Postgres (Supabase/Neon) | $0–25 | Free tier fine for Wisconsin-only |
| Object storage (raw archives) | $5–15 | Grows slowly; worth every cent |
| Domain | ~$2 | |
| **Recurring total** | **$10–60/mo** | |

| One-time / annual | Cost |
|---|---|
| Entity formation | $200–800 |
| **Legal opinion on § 11.1304(12)** | $1,500–4,000 |
| Media liability insurance | $1,500–5,000/yr |
| INN membership | $250 + $150–1,500/yr |
| LegiScan Pull API (1 state), if needed | ~$1,000/yr, nonprofit discount available |

**Honest first-year total: $4,000–12,000**, dominated by legal and insurance. Hosting is a rounding error. Do not let anyone tell you this needs funding to start — it needs a lawyer to start.

---

## 13. Where Justin fits

Chris asked for architecture, stack, database design, UI/UX, AI integration, hosting, performance, security and maintenance. Concretely, for v1:

- **Own the data layer.** Schema, ingest adapters, entity resolution, the source-document archive. This is where the project's credibility physically lives.
- **Own the editorial engine.** §7 is code, not policy. The alignment labels, the base-rate computation, the banned-language test, the symmetry metric.
- **Own the stack decisions and deployment.** Vercel + Supabase + FastAPI. Keep it boring.
- **Own the AI boundary.** §8 exists because the temptation to let an LLM write the interesting sentence will be constant and it is the single fastest way to lose the lawsuit.

**Chris owns:** the taxonomy and classification rules (this is domain work, not engineering, and it's the highest-leverage non-code contribution in the project), the methodology and corrections pages, source discovery, the review queue for entity merges, and — critically — being the person who reads every flagged trail before it ships and asks "would I believe this if it were about someone I like?"

**Both own:** the rule that neither of you ships a generated claim the other hasn't read.

---

## 14. Open questions for the two of you

1. **Is CivicTrace a nonprofit or an LLC?** The INN fiscal-sponsorship path argues nonprofit; GovTrack's twenty-year run argues LLC. Recommendation: **LLC now for speed and liability protection, INN fiscal sponsorship for donations, decide on full 501(c)(3) in year two** once you know whether grants are actually available to you.

2. **Do you scrape `lobbying.wi.gov` given its blanket robots.txt?** Recommendation: **ask the Ethics Commission in writing for permission or a data feed first.** A transparency project that ignores a stated access preference hands its critics a free story, and the ask costs one email.

3. **How much Wisconsin state coverage before you launch?** Recommendation: **none.** Launch federal-only. The state work is where the differentiation is, but shipping ten members with perfect sourcing builds more trust than 142 members with rough edges.

4. **What's the name and domain?** CivicTrace is good. "Follow public records. Draw your own conclusions." is better than "Trace the Facts" — it states the epistemics, which is the whole brand.

5. **Who is the corrections contact, and what's the SLA?** Pick a real person and a real inbox before launch, not after the first complaint.

---

## Appendix A — Reference implementation

The prototype in this repo is a working v0 of Phase 1, built entirely from live federal data on 2026-08-05.

| File | What it does |
|---|---|
| `etl.py` | FEC bulk + `congress-legislators` → SQLite. Note the memo-code and cycle-key handling. |
| `fetch_votes.py` | House Clerk EVS XML + Senate LIS XML → roll calls and per-member positions |
| `fetch_bills.py` | GovInfo BILLSTATUS → bills with CRS summaries and policy areas |
| `sectors.py` | The classification ruleset. Every rule has an ID; every label records it. |
| `load_earmarks.py` | House FY2026 CPF XLSX → earmark requests; also the LIS→bioguide relink and the broad-bill flag |
| `trail.py` | The money-trail engine. §7's rules are implemented here — read the comments. |
| `build_site.py` | Generates the self-contained HTML demo |

**What's loaded:** 23,203 PAC contributions across two cycles, 356 roll calls, 81,994 individual vote positions, 91 bills, 41,259 committees, 5,414 earmark requests.

**Verified:** figures recomputed independently from the raw FEC ZIP and the source XLSX, byte-for-byte match. Ten external claims fact-checked against primary sources; nine verified, one (the ledger-side reconciliation) corrected and now disclosed on the site itself — which is exactly how this is supposed to work.
