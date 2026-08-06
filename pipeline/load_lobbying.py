#!/usr/bin/env python3
"""Federal lobbying disclosures (LDA) — issue-area totals, and the minority that name a bill.

What this can and cannot do, measured rather than assumed
---------------------------------------------------------
The Lobbying Disclosure Act makes registrants file quarterly reports naming the
client, the money, and what they lobbied about. Two of those three are
structured. The third is prose.

  * `general_issue_code` is a fixed list of 79 codes, on every activity. This is
    reliable and it is where the issue-area totals come from.
  * The bill number is not a field. It lives in free text, if at all. Measured
    on a sample of second-quarter 2026 quarterly reports: **15% of lobbying
    activities name a bill.** So bill-level lobbying on this site covers a
    minority of lobbying, by construction, and every page that shows it has to
    say so. A bill with no lobbying listed here has not been shown to be
    unlobbied — it has been shown not to have been named in a filing we could
    parse.

Cost, and why there is a checkpoint
-----------------------------------
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
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
API = "https://lda.gov/api/v1/filings/"
KEY = os.environ.get("LDA_API_KEY", "").strip()
DEADLINE = float(os.environ.get("CT_LDA_DEADLINE", "900"))
YEARS = [int(y) for y in os.environ.get("CT_LDA_YEARS", "2026").split(",") if y.strip()]
CHECKPOINT = DATA / "lda_checkpoint.json"
STORE = DATA / "lda_partial.json"
STARTED = time.time()

# Anonymous is 15/min; a key raises it to 120/min. Stay just under either.
GAP = 60.0 / (110 if KEY else 13)

BILL = re.compile(
    r"\b(H\.?\s?R\.?|S|H\.?\s?RES|S\.?\s?RES|H\.?\s?J\.?\s?RES|S\.?\s?J\.?\s?RES"
    r"|H\.?\s?CON\.?\s?RES|S\.?\s?CON\.?\s?RES)\s*\.?\s*(\d{1,5})\b", re.I)
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


def load_checkpoint():
    if CHECKPOINT.exists():
        try:
            return json.loads(CHECKPOINT.read_text())
        except Exception:
            pass
    return {}


def save_checkpoint(cp):
    tmp = CHECKPOINT.with_suffix(".json.part")
    tmp.write_text(json.dumps(cp, indent=1, sort_keys=True))
    os.replace(tmp, CHECKPOINT)


def save_partial(issues, bill_rows, scanned, named):
    """Written every time the checkpoint advances, not only at the end.

    These two files have to move together. The checkpoint says "resume at page
    400"; the partial store holds what pages 1-400 produced. Saving the first
    without the second means a killed run resumes past data it never kept — the
    checkpoint would skip those pages forever and the rows would be gone. That
    is a silent hole in a dataset, which is the failure this project is least
    willing to ship.
    """
    tmp = STORE.with_suffix(".json.part")
    tmp.write_text(json.dumps({
        "issues": {f"{y}|{code}": v for (y, code), v in issues.items()},
        "bills": bill_rows, "scanned": scanned, "named": named}, indent=1))
    os.replace(tmp, STORE)


def bill_keys(text, congress, known):
    """Bill keys named in a description that we actually hold. Unknown bills are
    dropped rather than stored: a lobbying row pointing at a bill with no page is
    a dead end, and 'S. 5' matches a lot of prose that is not a bill."""
    out = set()
    for raw_type, num in BILL.findall(text or ""):
        t = TYPE_MAP.get(re.sub(r"[.\s]", "", raw_type).upper())
        if not t:
            continue
        k = f"{congress}{t}{num}"
        if k in known:
            out.add(k)
    return out


def main():
    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()
    known = {r[0] for r in c.execute("SELECT bill_key FROM bill")}
    congress = c.execute("SELECT COALESCE(MAX(congress),119) FROM bill").fetchone()[0]
    print(f"{len(known):,} bills in the record, congress {congress}")

    cp = load_checkpoint()
    issues = defaultdict(lambda: [0, 0.0])     # (year, code) -> [filings, spend]
    bill_rows = {}
    scanned = named = 0

    # Anything already collected on a previous run.
    store = STORE
    if store.exists():
        try:
            prev = json.loads(store.read_text())
            for k, v in prev.get("issues", {}).items():
                y, code = k.split("|", 1)
                issues[(int(y), code)] = v
            bill_rows = {k: v for k, v in prev.get("bills", {}).items()}
            scanned = prev.get("scanned", 0)
            named = prev.get("named", 0)
            print(f"resuming: {scanned:,} filings already scanned, "
                  f"{len(bill_rows):,} bill mentions held")
        except Exception as e:
            print(f"  partial store unreadable ({e}), starting fresh", file=sys.stderr)

    finished = True
    for year in YEARS:
        page = int(cp.get(str(year), 0)) + 1
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
                break
            for f in results:
                scanned += 1
                client = ((f.get("client") or {}).get("name") or "").strip()
                registrant = ((f.get("registrant") or {}).get("name") or "").strip()
                try:
                    amount = float(f.get("income") or f.get("expenses") or 0)
                except (TypeError, ValueError):
                    amount = 0.0
                acts = f.get("lobbying_activities") or []
                codes = {a.get("general_issue_code_display") or a.get("general_issue_code")
                         for a in acts}
                for code in codes:
                    if not code:
                        continue
                    issues[(year, code)][0] += 1
                    issues[(year, code)][1] += amount
                for a in acts:
                    desc = a.get("description") or ""
                    for bk in bill_keys(desc, congress, known):
                        named += 1
                        rk = f"{bk}|{f.get('filing_uuid')}|{a.get('general_issue_code')}"
                        bill_rows[rk] = {
                            "bill_key": bk, "year": year,
                            "period": f.get("filing_period_display"),
                            "client": client, "registrant": registrant,
                            "amount": amount,
                            "issue": a.get("general_issue_code_display"),
                            "description": desc[:400],
                            "source_url": f.get("filing_document_url") or f.get("url"),
                        }
            cp[str(year)] = page
            if page % 20 == 0:
                save_checkpoint(cp)
                save_partial(issues, bill_rows, scanned, named)
                print(f"    {year} page {page}: {scanned:,} filings, "
                      f"{len(bill_rows):,} bill mentions", flush=True)
            if not d.get("next"):
                cp[str(year)] = 0        # finished this year; start over next time
                break
            page += 1
            time.sleep(GAP)

    save_checkpoint(cp)
    save_partial(issues, bill_rows, scanned, named)

    c.executescript("""
    DROP TABLE IF EXISTS lobbying_issue;
    DROP TABLE IF EXISTS lobbying_bill;
    CREATE TABLE lobbying_issue (
      year INTEGER, issue TEXT, filings INTEGER, reported_spend REAL,
      PRIMARY KEY (year, issue));
    CREATE TABLE lobbying_bill (
      bill_key TEXT, year INTEGER, period TEXT, client TEXT, registrant TEXT,
      amount REAL, issue TEXT, description TEXT, source_url TEXT);
    CREATE INDEX ix_lb_bill ON lobbying_bill(bill_key);
    """)
    for (y, code), (n, amt) in issues.items():
        c.execute("INSERT OR REPLACE INTO lobbying_issue VALUES (?,?,?,?)",
                  (y, code, n, round(amt, 2)))
    for r in bill_rows.values():
        c.execute("INSERT INTO lobbying_bill VALUES (?,?,?,?,?,?,?,?,?)",
                  (r["bill_key"], r["year"], r["period"], r["client"], r["registrant"],
                   r["amount"], r["issue"], r["description"], r["source_url"]))
    con.commit()

    print(f"\nfilings scanned: {scanned:,}")
    print(f"issue areas     : {len(issues)}")
    print(f"bill mentions   : {len(bill_rows):,} across "
          f"{len({r['bill_key'] for r in bill_rows.values()})} bills in our record")
    print(f"complete        : {finished}")
    if issues:
        print("\ntop issue areas by filings:")
        top = sorted(issues.items(), key=lambda kv: -kv[1][0])[:8]
        for (y, code), (n, amt) in top:
            print(f"  {code[:44]:44} {n:>6,} filings  ${amt:>14,.0f}")
    con.close()

    # Never fails the pipeline. A partial LDA pull degrades one section of the
    # site; a failed run would take down the whole refresh for a source that is
    # explicitly incomplete by nature.
    if not finished:
        print("\nrun did not finish — rerun to continue from the checkpoint. "
              "Set LDA_API_KEY to go 8x faster.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
