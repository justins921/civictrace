# CivicTrace — scope, and the schema that has to hold it

**Decided 7 August 2026.** Wisconsin first, completely. Then every US state and
the federal government. Local is a goal, not a commitment, and this document
says why that distinction is load-bearing rather than a hedge.

Written for Justin and Chris. If you are reading this in a year to work out why
something is shaped the way it is, the answers are here.

---

## 1. What "done" means, per jurisdiction

A jurisdiction is covered when four things are loaded and linked:

| | Federal | State | Local |
|---|---|---|---|
| **Donations** — who gave to whom | FEC | 50 state agencies | thousands of clerks |
| **Lobbying** — who was paid to influence what | LDA (lda.gov) | ~40 states, wildly uneven | almost nowhere |
| **Voting** — who took which position | House Clerk / Senate XML | Open States | rarely recorded |
| **Spending** — where the money went | USAspending.gov | ~45 checkbook sites | procurement portals |

Wisconsin federal is roughly three-quarters done today: donations, voting and
lobbying are in, spending is only earmark *requests* rather than awards.

**Local is deferred, and the reason is arithmetic, not appetite.** There are
roughly half a million elected officials in the United States. Almost none of
them file machine-readable disclosures, most local campaign finance is paper,
and there is no Open States equivalent for city councils. Committing to local
means committing to a scraper per county forever. We will do local where a
particular place publishes real data and there is a reason to care — Milwaukee
County, say — and we will not promise it as coverage.

---

## 2. The jurisdiction model

Everything gets a jurisdiction. Not a filter — a dimension, present in every
key, so nothing can silently collide when the second jurisdiction lands.

```
jurisdiction:  us | us-wi | us-tx | us-pr | us-wi-milwaukee
```

Lowercase, hyphenated, ISO-3166-2 underneath. `us` is the federal government,
not "all of America" — that distinction matters the first time we publish a
national total.

### Keys that have to change

| Today | Problem | Becomes |
|---|---|---|
| `bill_key = '119hr131'` | WI AB 131 and TX HB 131 collide | `us/119/hr131`, `us-wi/2025/ab131` |
| `vote_key = 'H2026-164'` | same shape in every state | `us/H2026-164` |
| `member.bioguide` as PK | state legislators have no bioguide | `person_id`, with `(source, source_id)` alongside |
| `cycle = 2026` | NJ and VA run odd years; four-year senate terms | `cycle` scoped to jurisdiction, and `published_cycle()` takes one |
| `state = 'WI'` in queries | it is the whole dataset today | a filter on `jurisdiction`, everywhere |

`bioguide` does not go away — it stays as one of possibly several external IDs
on a person, which is also how we will eventually match a state legislator who
runs for Congress to their own earlier record.

---

## 3. One ledger, not four subsystems

Donations, outside spending, contracts, lobbying payments and votes are five
different tables today with five different grains. Every new jurisdiction
multiplies against all five. They are all the same skeleton:

```
ledger(
  ledger_id,
  jurisdiction,      -- us | us-wi | ...
  kind,              -- contribution | independent_expenditure | award |
                     -- lobbying_payment | earmark_request | vote
  occurred_on,       -- date
  actor_id,          -- who acted: donor committee, agency, lobbying client, member
  target_id,         -- who or what was acted on: candidate, vendor, bill
  amount,            -- null for votes
  position,          -- null for money
  source_id,         -- the filing's own identifier (FEC sub_id, award id, ...)
  source_url,        -- the document
  detail             -- jsonb, source-shaped, never read by a page
)
```

**Loaders keep their current shape.** They write source-shaped staging tables
exactly as they do now — `contribution`, `vote_position`, `lobbying_bill`.
The export projects those into `ledger`. The site reads views over `ledger`.

That layering is the point. Adding Texas is writing a *mapper* from Texas's
format into the ledger. It is not a new subsystem, it does not touch the site,
and it cannot break Wisconsin.

Everything the site shows today — trails, member pages, industry pages,
reconciliation — becomes a view. `money_trail` stays a materialised table
because it is expensive to compute; it just gains a jurisdiction.

---

## 4. Migration order

Each phase leaves the site working. None of them is a big bang.

**Phase 0 — jurisdiction column.** Add `jurisdiction` to every table, default
`'us'`. Namespace the keys. Update every query. Nothing changes on the site.
*This is the phase that gets more expensive every week it waits.*

**Phase 1 — the ledger.** Create the table, project the existing five sources
into it, rebuild the site's aggregate views on top. Reconciliation asserts the
ledger and the staging tables agree, so a projection bug fails the run.

**Phase 2 — Wisconsin state.** The first non-federal jurisdiction, chosen
because it is the one we can check by hand. Every hidden federal assumption
surfaces here, on data whose politics we already know.

**Phase 3 — the rest.** Open States gives legislation and votes for every state
and territory from one integration. Money is per-state and is the whole job.

---

## 5. Wisconsin state — source inventory

Verified this session:

- **Lobbying — [Eye on Lobbying](https://lobbying.wi.gov/), WI Ethics Commission.**
  Better than the federal LDA, which is worth saying twice. Principals file a
  **15-day report naming each specific bill or topic they lobbied on**, and a
  semi-annual Statement of Lobbying Activities and Expenditures with total
  dollars, total hours, and the **percentage of time for any bill or topic that
  took 10% or more** of their lobbying effort.
  Federal LDA has no bill field at all — we measured that only a minority of
  filings name one in prose. Wisconsin hands us the link as structured data.

- **Campaign finance — [Wisconsin Campaign Finance / "Sunshine"](https://campaignfinance.wi.gov/),
  WI Ethics Commission.** Covers state candidates, PACs, parties, independent
  expenditure committees, referenda. *Export mechanics unverified* — it is a
  JavaScript application and could not be read programmatically. Someone has to
  open it and find out whether there is a bulk export, a per-committee CSV, or
  only a report viewer. That answer determines whether Phase 2 is two weeks or
  six.

- **Legislation and votes — [Open States bulk data](https://open.pluralpolicy.com/data/).**
  Bills, votes, legislators for every state, DC and territories, as bulk CSV /
  JSON / Postgres dumps. *Licence terms to be confirmed before we depend on it.*
  Wisconsin also publishes its own at docs.legis.wisconsin.gov, which is the
  primary source and the one to cite.

- **State spending — [OpenBook Wisconsin](https://openbook.wi.gov/).** Agency
  vendor payments and employee compensation. *Export mechanics unverified* —
  the site disallows automated fetching, so this needs a human look. Note the
  known criticism that its coverage is partial; if that holds, we publish the
  gap rather than the total.

### What we are not using

**FollowTheMoney** has already normalised all fifty states' campaign finance
and has a free API. Do not build on it. The licence is **CC BY-NC-SA 3.0** —
non-commercial *and* share-alike, which can reach our derived data and forces
anything downstream into the same terms. It is a fine research tool for working
out what a state's data looks like. Anything we publish comes from the state
agency directly, which is also just the rule we already hold: primary
documents, not somebody else's aggregate.

---

## 6. What changes editorially

**Delegates have no floor vote.** DC, Puerto Rico, Guam, the US Virgin Islands,
American Samoa and the Northern Mariana Islands send delegates who vote in
committee but not on final passage. The entire money-versus-vote mechanic does
not apply to six seats. Those pages need a different frame, or they will render
"no trails found" in a way that reads like a finding about the member rather
than a fact about the institution.

**State money is smaller and matters more.** A state representative's whole
campaign might be $80,000. A $5,000 check is a meaningful share of it in a way
$5,000 never is to a US senator. `sector_share_pct` thresholds tuned on federal
data will be wrong at state level and need to be re-derived per jurisdiction,
not carried over.

**"No signal" is a federal artifact.** 89% of our federal trails come back
no-signal because floor votes are whipped and mostly near-unanimous. State
legislatures whip less and record more contested votes. Expect the distribution
to look different, and do not read that difference as state politics being
dirtier — it is the same engine meeting a less pre-decided process.

**Sector rules are federal-committee-shaped.** The PAC classifier matches names
like "AMERICAN BANKERS ASSOCIATION". State committee names look nothing like
that. Rules will need a jurisdiction scope, and `Unclassified` will spike on
the first state until they exist. Publish that share rather than hiding it.

---

## 7. The part that is not code

At jurisdiction three the constraint stops being engineering and becomes people
and money. OpenSecrets runs this kind of operation with around thirty staff and
still does not do state spending; the Sunlight Foundation attempted roughly
this scope and closed in 2020.

The version of this that works is: build the ledger so the scope is
*architecturally* reachable, finish Wisconsin so completely that a reporter
cites it, and use that as the artifact you show funders. Knight, Hewlett and
Democracy Fund all fund civic data infrastructure, and most of that money
cannot go to an LLC — which makes "does a 501(c)(3) belong alongside Sobojinski
Solutions" a question worth putting to an accountant early rather than late.

A working site covering one state end to end is fundable. A roadmap describing
fifty is not.
