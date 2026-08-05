# CivicTrace — Wisconsin prototype

Nonpartisan public-records platform. Campaign finance, roll-call votes, bills and
earmarks for Wisconsin's ten federal members, traced to the original filing.

Live: https://civictrace.vercel.app

## What's in here

    web/                        Next.js 15 App Router site, deployed on Vercel
    pipeline/                   Python ETL and the daily refresh job
    .github/workflows/daily.yml scheduled refresh, ready to run once this is a repo
    pipeline/CivicTrace-PRD-v1.md   the engineering PRD
    pipeline/README-daily.md        how the refresh works and how to schedule it

## First two things to do with this zip

**1. Push it to GitHub.** It fixes three things at once:

* the daily refresh starts working — `.github/workflows/daily.yml` runs it free,
  on schedule, with logs; add the three secrets listed in that file
* the Vercel deployment stops being a bootstrap. Connect the repo to the existing
  project, then clear the custom Install Command and delete the `preinstall`
  script from `web/package.json`
* you get history, which a project whose whole claim is "check our work" needs

**2. Set `NEXT_PUBLIC_CONTACT_EMAIL` in Vercel.** Until it is set, /contact and
/corrections render a banner saying the site is not launch-ready. That is
deliberate — do not promote the site before it is set.

## Running the site locally

    cd web
    npm install
    npm run dev          # http://localhost:3000

It reads Supabase over the public key with SELECT-only RLS, so it runs with no
secrets at all.

## The rules this codebase enforces

These are product requirements, not style preferences, and most of them cost us
findings we could otherwise have shown:

1. **Absence is not a position.** "Not Voting" and "Present" are excluded as a
   member's position and from every denominator. Counting them once produced a
   trail claiming a member's party was split 27% on a bill that passed 350–5.
2. **Omnibus bills produce nothing.** A bill touching every sector cannot support
   a sector-alignment reading, so the engine refuses to compute one.
3. **Near-unanimous votes carry no signal**, and are labelled that way rather than
   dropped, so a reader can see how often that is the answer.
4. **Ledger sides are never mixed silently.** We publish giver-side figures (FEC
   Schedule B); the FEC candidate page shows recipient-side (Schedule A). They
   never tie. The site says so, with a worked example.
5. **Opposing money always ships with aligned money.** A trail showing one side of
   an issue is an argument, not a record.
6. **Every classification carries a rule ID**, printed on the page.
7. **No causal verbs.** Not "because", not "in exchange for", not "bought".
8. **Every correction is published**, including the ones we found ourselves.

## Known gaps, on the record

* Lobbying (LDA) filings are not loaded — hence no Lobbyists nav item.
* State legislature and state campaign finance are not loaded. Read Wis. Stat.
  § 11.1304(12) before building anything paid on top of state records.
* About 45% of committee money classifies as "Trade / Membership" or
  "Unclassified" rather than a named industry. Logged on /corrections.
* Independent expenditures are excluded from the money figures — that is spending
  *about* a candidate, not money *to* them.
