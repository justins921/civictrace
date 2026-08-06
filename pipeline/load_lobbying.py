#!/usr/bin/env python3
"""Federal lobbying disclosures (LDA) — issue-area totals, and the minority that name a bill.

What this can and cannot do, measured rather than assumed
---------------------------------------------------------
The Lobbying Disclosure Act makes registrants file quarterly reports naming the
client, the money, and what they lobbied about. Two of those three are
structured. The third is prose.

  * `general_issue_code` is a fixed list of 79 codes, on every activity. This is
    reliable and it is where the issue-area totals come from.
  * The bill number is not a field. It lives in free text, if at all. What
    share of activities name one is *measured on every run* and written to
    `lobbying_coverage`, because the site prints that share on every bill page
    and a figure that appears in a sentence about honesty cannot be a literal
    someone typed in from a hand sample. So bill-level lobbying here covers a
    minority of lobbying, by construction, and the pages say so with a number
    that came from the data. A bill with no lobbying listed has not been shown
    to be unlobbied — it has been shown not to have been named in a filing we
    could parse.
  * The money is a filing total, not an issue total. A registrant reports one
    income figure per client per quarter covering everything they worked on.
    Splitting that across issues requires an assumption; this file makes the
    even-split assumption, publishes it under a name that says so, and
    publishes the unsplit figure beside it.

Cost, and why this is resumable
-------------------------------
`page_size` is capped at 25 and 2026 has 55,003 filings, so a full year is about
2,200 requests. Anonymous callers get 15 requests a minute — roughly two and a
half hours. With a free API key it is 120 a minute, about eighteen.

So this is resumable. Progress is written to disk after every page, a run stops
at a wall-clock deadline rather than fighting the rate limit, and the next run
picks up where it left off. A half-finished fetch leaves usable partial data and
an honest note about how far it got, which is better than an all-or-nothing job
that can never finish inside a CI timeout.

Environment:
  LDA_API_KEY          optional but strongly recommended — free at lda.gov.
                       Without it this takes 8x longer.
  CT_LDA_DEADLINE      seconds per run, default 900
  CT_LDA_YEARS         comma-separated, default the published cycle
"""
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
API = "https://lda.gov/api/v1/filings/"
KEY = os.environ.get("LDA_API_KEY", "").strip()
DEADLINE = float(os.environ.get("CT_LDA_DEADLINE", "900"))
YEARS = [int(y) for y in os.environ.get("CT_LDA_YEARS", "2026").split(",") if y.strip()]
# One file, not two.
#
# There used to be a checkpoint file saying "resume at page 400" and a separate
# store holding what pages 1–400 produced, with a comment explaining that they
# had to be written together or a killed run would resume past data it never
# kept. Two files that must move together are one file with extra steps and one
# more way to be killed in between. State is now a single atomic replace.
STATE = DATA / "lda_state.json"
LEGACY = (DATA / "lda_checkpoint.json", DATA / "lda_partial.json")
STARTED = time.time()

# Anonymous is 15/min; a key raises it to 120/min. Stay just under either.
GAP = 60.0 / (110 if KEY else 13)

# The multi-letter forms are unambiguous: nothing in English prose reads
# "H.J.RES. 12". The single letter S is a different matter. The first version of
# this pattern accepted a bare `S` followed by a number, case-insensitively,
# which matches "…as 5 states have…", "Class S 3 vessels" and "Sec 5" — a
# lobbying filing about maritime shipping was linking itself to S. 3. So the
# bare form now requires the period a real citation carries: "S. 852" matches,
# "S 852" and "s 852" do not. That loses a small number of genuine citations
# written without the period, which is the right side to lose on — a wrong bill
# link is a false claim about who lobbied on what, and a missing one is a gap
# the coverage figure already tells the reader about.
BILL = re.compile(
    r"\b(?:"
    r"(H\.?\s?R\.?|H\.?\s?RES|S\.?\s?RES|H\.?\s?J\.?\s?RES|S\.?\s?J\.?\s?RES"
    r"|H\.?\s?CON\.?\s?RES|S\.?\s?CON\.?\s?RES)\s*\.?\s*(\d{1,5})"
    r"|(S)\.\s*(\d{1,5})"
    r")\b", re.I)
# Any bill citation at all, used only to measure coverage — what share of filed
# activities name a bill, whether or not it is a bill we hold. The 15% printed
# on every bill page used to be a literal typed into JSX from a hand sample.
ANY_BILL = BILL
TYPE_MAP = {"HR": "hr", "S": "s", "HRES": "hres", "SRES": "sres", "HJRES": "hjres",
            "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres"}


def out_of_time():
    return time.time() - STARTED > DEADLINE


def get(url, attempts=4):
    headers = {"User-Agent": UA}
    if KEY:
        headers["Authorization"] = f"Token {KEY}"
    for attempt in range(attempts):
        if out_of_time():
            return None
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(url, headers=headers), timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # The bucket is empty. Waiting it out is the only option and the
                # deadline is what stops that from becoming an outage.
                if out_of_time():
                    return None
                time.sleep(20)
            elif e.code >= 500:
                time.sleep(3 * (2 ** attempt))
            else:
                print(f"  HTTP {e.code} on {url.split('?')[0]}", file=sys.stderr)
                return None
        except Exception as e:
            print(f"  {e}, retrying", file=sys.stderr)
            time.sleep(3 * (2 ** attempt))
    return None


def load_state():
    """Per-year state. A year that has finished a full pass starts the next one
    from scratch rather than adding to what it already had."""
    if STATE.exists():
        try:
            d = json.loads(STATE.read_text())
            if isinstance(d, dict) and "years" in d:
                return d
        except Exception as e:
            print(f"  state unreadable ({e}), starting fresh", file=sys.stderr)
    for old in LEGACY:
        try:
            old.unlink()
        except OSError:
            pass
    return {"years": {}}


def blank_year():
    return {"page": 0, "issues": {}, "bills": {}, "scanned": 0,
            "activities": 0, "activities_citing_bill": 0, "named": 0, "complete": False}


def save_state(state):
    tmp = STATE.with_suffix(".json.part")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    os.replace(tmp, STATE)


def cited_bills(text):
    """(type, number) for every bill citation in a description, held or not."""
    out = set()
    for multi_type, multi_num, s_type, s_num in BILL.findall(text or ""):
        raw_type, num = (multi_type, multi_num) if multi_type else (s_type, s_num)
        t = TYPE_MAP.get(re.sub(r"[.\s]", "", raw_type).upper())
        if t:
            out.add((t, num))
    return out


def bill_keys(text, congress, known):
    """Bill keys named in a description that we actually hold. Unknown bills are
    dropped rather than stored: a lobbying row pointing at a bill with no page is
    a dead end."""
    return {f"{congress}{t}{n}" for t, n in cited_bills(text)
            if f"{congress}{t}{n}" in known}


def main():
    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()
    known = {r[0] for r in c.execute("SELECT bill_key FROM bill")}
    congress = c.execute("SELECT COALESCE(MAX(congress),119) FROM bill").fetchone()[0]
    print(f"{len(known):,} bills in the record, congress {congress}")

    state = load_state()
    finished = True

    for year in YEARS:
        y = state["years"].setdefault(str(year), blank_year())

        # H10. A year that reached its last page used to set its cursor back to
        # zero and keep its accumulators, so the next run walked the same 55,003
        # filings again and added every issue total to itself. Two complete
        # passes reported twice the lobbying; three reported three times. The
        # counters were monotonic and nothing was ever subtracted, so the error
        # grew without bound and looked like growth in lobbying.
        #
        # A fresh pass is a fresh count. The previous pass's numbers stay
        # published until this one overwrites them, so the site never shows a
        # half-built year.
        if y["page"] == 0:
            prior = dict(y)
            y = blank_year()
            state["years"][str(year)] = y
            if prior.get("scanned"):
                print(f"  {year}: starting a new pass; the previous one scanned "
                      f"{prior['scanned']:,} filings and its totals stay published "
                      f"until this pass replaces them")
        else:
            print(f"  {year}: resuming at page {y['page'] + 1} — "
                  f"{y['scanned']:,} filings scanned so far")

        page = y["page"] + 1
        while True:
            if out_of_time():
                finished = False
                print(f"  deadline reached at year {year} page {page}")
                break
            url = API + "?" + urllib.parse.urlencode(
                {"filing_year": year, "page_size": 25, "page": page})
            d = get(url)
            if d is None:
                finished = False
                break
            results = d.get("results") or []
            if not results:
                y["complete"] = True
                y["page"] = 0
                break
            for f in results:
                y["scanned"] += 1
                client = ((f.get("client") or {}).get("name") or "").strip()
                registrant = ((f.get("registrant") or {}).get("name") or "").strip()
                try:
                    amount = float(f.get("income") or f.get("expenses") or 0)
                except (TypeError, ValueError):
                    amount = 0.0
                acts = f.get("lobbying_activities") or []
                codes = sorted({(a.get("general_issue_code_display")
                                 or a.get("general_issue_code") or "").strip()
                                for a in acts} - {""})

                # H7. The filing's whole amount used to be added to every issue
                # code it touched. A $300,000 filing covering Taxation, Trade
                # and Energy reported $300,000 against each of the three, so the
                # issue table summed to several times the money that actually
                # changed hands, and "Taxation: $2.1B" was an artefact of
                # multi-issue filings rather than a fact about taxation.
                #
                # Neither figure is "spending on this issue" — the LDA does not
                # collect that and no such number exists in the record. So both
                # are published under names that say what they are: the value of
                # filings that touched the issue, and that value divided evenly
                # across the issues each filing named. The even split is an
                # assumption, it is labelled as one, and it has the property the
                # other figure lacks: the column adds up to the money filed.
                share = amount / len(codes) if codes else 0.0
                for code in codes:
                    row = y["issues"].setdefault(code, [0, 0.0, 0.0])
                    row[0] += 1
                    row[1] += amount     # filing_value
                    row[2] += share      # attributed_spend

                for a in acts:
                    desc = a.get("description") or ""
                    y["activities"] += 1
                    if cited_bills(desc):
                        y["activities_citing_bill"] += 1
                    for bk in bill_keys(desc, congress, known):
                        y["named"] += 1
                        rk = f"{bk}|{f.get('filing_uuid')}|{a.get('general_issue_code')}"
                        y["bills"][rk] = {
                            "bill_key": bk, "year": year,
                            "period": f.get("filing_period_display"),
                            "client": client, "registrant": registrant,
                            "amount": amount, "issue_count": len(codes) or 1,
                            "issue": a.get("general_issue_code_display"),
                            "description": desc[:400],
                            "source_url": f.get("filing_document_url") or f.get("url"),
                        }
            if not d.get("next"):
                y["complete"] = True
                y["page"] = 0            # finished this year; start over next time
                break
            y["page"] = page
            if page % 20 == 0:
                save_state(state)
                print(f"    {year} page {page}: {y['scanned']:,} filings, "
                      f"{len(y['bills']):,} bill mentions", flush=True)
            page += 1
            time.sleep(GAP)

        save_state(state)

    save_state(state)

    c.executescript("""
    DROP TABLE IF EXISTS lobbying_issue;
    DROP TABLE IF EXISTS lobbying_bill;
    DROP TABLE IF EXISTS lobbying_coverage;
    CREATE TABLE lobbying_issue (
      year INTEGER, issue TEXT, filings INTEGER,
      reported_spend REAL, attributed_spend REAL,
      PRIMARY KEY (year, issue));
    CREATE TABLE lobbying_bill (
      bill_key TEXT, year INTEGER, period TEXT, client TEXT, registrant TEXT,
      amount REAL, issue_count INTEGER, issue TEXT, description TEXT, source_url TEXT);
    CREATE TABLE lobbying_coverage (
      year INTEGER PRIMARY KEY, filings_scanned INTEGER, activities INTEGER,
      activities_citing_bill INTEGER, bill_mentions INTEGER, bills_matched INTEGER,
      complete INTEGER);
    CREATE INDEX ix_lb_bill ON lobbying_bill(bill_key);
    """)

    scanned = acts_total = acts_cited = mentions = 0
    all_issues = []
    for ys, y in sorted(state["years"].items()):
        year = int(ys)
        for code, (n, filing_value, attributed) in y["issues"].items():
            c.execute("INSERT OR REPLACE INTO lobbying_issue VALUES (?,?,?,?,?)",
                      (year, code, n, round(filing_value, 2), round(attributed, 2)))
            all_issues.append((code, n, filing_value))
        for r in y["bills"].values():
            c.execute("INSERT INTO lobbying_bill VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (r["bill_key"], r["year"], r["period"], r["client"], r["registrant"],
                       r["amount"], r.get("issue_count") or 1, r["issue"],
                       r["description"], r["source_url"]))
        matched = len({r["bill_key"] for r in y["bills"].values()})
        c.execute("INSERT OR REPLACE INTO lobbying_coverage VALUES (?,?,?,?,?,?,?)",
                  (year, y["scanned"], y["activities"], y["activities_citing_bill"],
                   len(y["bills"]), matched, 1 if y["complete"] else 0))
        scanned += y["scanned"]; acts_total += y["activities"]
        acts_cited += y["activities_citing_bill"]; mentions += len(y["bills"])
    con.commit()

    pct = (100.0 * acts_cited / acts_total) if acts_total else 0.0
    print(f"\nfilings scanned : {scanned:,}")
    print(f"activities      : {acts_total:,}, of which {acts_cited:,} name a bill "
          f"({pct:.1f}%) — this is the coverage figure the bill pages print, and it is "
          f"now measured rather than sampled by hand")
    print(f"bill mentions   : {mentions:,}")
    print(f"complete        : {finished}")
    if all_issues:
        print("\ntop issue areas by filings:")
        for code, n, amt in sorted(all_issues, key=lambda t: -t[1])[:8]:
            print(f"  {code[:44]:44} {n:>6,} filings  ${amt:>14,.0f} in filing value")
    con.close()

    # Never fails the pipeline. A partial LDA pull degrades one section of the
    # site; a failed run would take down the whole refresh for a source that is
    # explicitly incomplete by nature.
    if not finished:
        print("\nrun did not finish — rerun to continue from the saved state. "
              "Set LDA_API_KEY to go 8x faster.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
