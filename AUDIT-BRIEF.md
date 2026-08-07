# Before you audit — what to know, and what we already know

For Chris, ahead of audit round three. Written 7 August 2026.

Two of your previous rounds found real things fast. This is meant to keep round
three pointed at what's actually unknown, rather than re-finding what we've
already logged.

---

## 1. First, check whether the data is fresh — everything else depends on it

The site and the data refresh on **separate clocks**, and that gap is where
most of round two's findings came from.

- **Code** deploys to Vercel the moment a commit lands on `main`.
- **Data** refreshes when the GitHub Action runs, at 09:00 UTC daily.

So there is always a window where corrected code is serving uncorrected rows.
Round two caught us exactly there: three trails still badged "one-sided
industry money" while the corrections log said none qualified.

**Before reporting a data discrepancy, check the last run:**

```
https://github.com/justins921/civictrace/actions
```

If the most recent run failed or hasn't happened since the last commit, the
data is stale by design and the discrepancy is expected. Say so in the finding
rather than filing it as a bug — that distinction is genuinely useful to us.

**As of this writing the 7 August run failed** on a schema bug (fixed, details
in §5), so anything you see before the next successful run is yesterday's data.

---

## 2. Three things that will look like bugs and are not

**a) A trail's badge won't always match its stored label.**

`trail_full` exposes `display_label`, which re-checks one specific claim — "one
sided industry money" — against the row's own stored figures at read time. If a
row was written under an older rule, the site shows the corrected label and
marks it `label_stale`, and the trail page says so in a box. This is deliberate:
stale data must not be able to display a claim the current rule doesn't support.

If you see a trail page saying "this row was classified before our current rule
and is waiting on tonight's refresh" — that's the guard working, not a defect.
What *would* be a defect is a badge that disagrees with the row's numbers and
says nothing about it.

**b) Empty sections are usually a stated limit, not a failure.**

The site distinguishes "we checked and found nothing" from "we could not check",
and the second one is common:

- Trails with no axis panel — only three industries have a declared two-sided
  axis. The others say so rather than printing a `$0` that reads like a finding.
- Bills with no lobbying — federal lobbying filings have no bill-number field.
  We parse citations out of prose and publish the measured coverage rate.
- Members with no trails — a trail needs four things at once. Falling short is
  the ordinary case, and the page says it isn't a statement about the member.
- Delegates from DC and the territories cannot vote on final passage at all.

If one of these renders as a blank rather than an explanation, that *is* a bug
and we want it.

**c) "89% no signal" is the point, not an error.**

Most money-and-vote overlaps mean nothing, because floor votes are whipped and
usually near-unanimous. A site that made all 665 look meaningful would be lying.
If that number moves a lot between audits, it's worth asking why.

---

## 3. Known limitations — please don't re-file these

These are published on `/methodology` and are true today:

| Limit | Detail |
|---|---|
| **Federal only** | Wisconsin's ten federal members. No state legislature yet. |
| **One cycle** | 2026. Earlier cycles are in the database, published nowhere. |
| **PAC money only in trails** | Direct committee contributions (FEC type 24K). Individual money is published as aggregates but feeds no trail. |
| **Individual money is itemized-only** | The FEC names a contributor only past $200 aggregate. Each member page prints their own share; delegation-wide it's about 53%. |
| **Lobbying covers a minority of filings** | No bill-number field exists in the LDA. The measured coverage rate is on every bill page. |
| **LDA backfill is incomplete** | 55,003 filings for the year, fetched 25 at a time. Issue totals and bill links are a floor and grow between refreshes. |
| **Spending is requests, not awards** | We have FY2026 earmark *requests*. We do not yet have what was actually appropriated or who received it. |
| **No dark money** | 501(c)(4) spending appears in no filing anywhere. Not a gap we can close. |
| **Senate earmarks absent** | No central disclosure file exists; each senator publishes their own. |
| **Giver-side ledger** | We count what committees said they gave (Schedule B), not what campaigns said they received (Schedule A). These never tie exactly, and `/methodology` has a worked example. |

---

## 4. Where the real bugs are likely to be

Ranked by where we're least confident:

1. **Anything counting rows.** Seven instances across four audits of counting a
   database response that was silently capped at 1,000. There's now a build
   check that fails on an unbounded read, but it only covers `web/`. **The
   Python pipeline has no equivalent.** If you want one high-yield place to
   look, look there.
2. **Entity resolution.** We shipped `V000133` where `V000135` was meant, and
   because both IDs have money the page printed a plausible figure under the
   wrong member's name. Any place a person, committee or bill is matched by
   anything other than an exact identifier is worth attacking.
3. **Sums that should agree and are computed twice.** `check_reconciliation.py`
   asserts a dozen of these, but only a dozen. Any figure appearing on two
   pages is worth adding up by hand.
4. **The classifier's edges.** Sector rules are keyword-based and published.
   Silly matches are visible on purpose — the evidence string is printed on
   every bill. If one looks stupid to you it probably is.
5. **Anything that only runs on a clean database.** See below.

## 5. What we just fixed, so you can verify it rather than rediscover it

- **Every committee page returned a 500** for about a day — a query ordered by
  a column that doesn't exist on that view. Fixed, and there's now
  `npm run smoke` that loads one live page of *every* route type with IDs
  pulled from the database.
- **The 7 August refresh died** with "table bill has 17 columns but 18 values
  were supplied". A column was added by a loader that runs *after* the one
  writing to it — invisible on any machine that had run the pipeline before,
  fatal on CI's empty database. Fixed, plus `test_schema.py`, which builds the
  schema from nothing and fails on positional inserts across file boundaries.
  It immediately found a second instance of the same pattern.
- **"Broke from their own party"** appeared on every trail page as fixed text,
  including above 57.5% and 83.5%. Now chosen from the actual number in three
  bands.
- **Bill-number search returned nothing.** `H.R. 131`, `hr131`, `hr 131`,
  `119hr131` all work now.

---

## 6. How to report

The [corrections form](https://civictrace.vercel.app/contact) gives every report
a reference code, and anything we act on gets published permanently in the
[corrections log](https://civictrace.vercel.app/corrections) with what was
wrong and what changed — including the ones we find ourselves. There are
fourteen entries now, six of them ours.

The most useful finding format, in order of value to us:

1. The URL, and the number on it you think is wrong
2. What you think the right number is, and how you got it
3. Whether you checked the last pipeline run first

Something that made round two unusually good: you didn't stop at "this looks
wrong", you said *what the correct behaviour would be* — the three conditions
for calling money one-sided, and the rule that "crossed party" requires under
50%. Both went in as written. More of that.

---

## 7. One thing we'd genuinely like an outside opinion on

We're planning to expand to all fifty states and the federal government, with
local deferred (`SCOPE.md` has the reasoning). That means a schema change to
make jurisdiction a first-class dimension, and one shared ledger shape instead
of five separate subsystems.

If you have a view on that before we cut it, now is the cheap moment. After
three jurisdictions it's a rewrite.
