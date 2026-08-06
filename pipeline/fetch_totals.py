#!/usr/bin/env python3
"""Candidate totals from openFEC — so every page can say how much of the money it is showing.

Why this exists
---------------
CivicTrace publishes direct PAC contributions. For Gwen Moore that is ~64% of
her receipts; for Tammy Baldwin it is 4.5%. Presenting both on the same page,
in the same format, with no indication of the difference, implies the two
figures mean the same thing about the two members. They do not, and the money
trail is thinnest exactly where the site's language is strongest.

That is not fixed by loading more data. It is fixed by saying what fraction of
the money each figure covers, on the page where the figure appears. This script
fetches the denominator.

It is a *context* source, not a money source: nothing here feeds a trail, a
sector total, or the reconciliation. It exists so a reader can see that a
$127,264 PAC total sits inside $2.8M of receipts.

Environment: FEC_API_KEY (optional). Without one, DEMO_KEY works but is rate
limited to about 30 requests an hour, which is enough for ten members and not
enough for anything larger. Get a free key at https://api.open.fec.gov/developers/
"""
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent
KEY = os.environ.get("FEC_API_KEY", "DEMO_KEY")
CYCLE = int(os.environ.get("CT_CYCLE", "2026"))
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"

con = sqlite3.connect(BASE / "civictrace.db")
c = con.cursor()
c.executescript("""
DROP TABLE IF EXISTS candidate_totals;
CREATE TABLE candidate_totals (
  bioguide TEXT, cand_id TEXT, cycle INTEGER,
  receipts REAL, individual REAL, pac REAL, party REAL, self_funded REAL,
  transfers REAL, disbursements REAL, cash_on_hand REAL,
  coverage_end TEXT, source_url TEXT,
  PRIMARY KEY (bioguide, cand_id, cycle)
);
""")


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            # 429 means the shared DEMO_KEY bucket is empty. Backing off harder
            # here is the difference between a slow run and a run that publishes
            # a member with no denominator.
            wait = 30 if e.code == 429 else 2 * (2 ** attempt)
            print(f"  HTTP {e.code}, waiting {wait}s: {url.split('?')[0]}", file=sys.stderr)
            time.sleep(wait)
        except Exception as e:
            print(f"  {e}, retrying", file=sys.stderr)
            time.sleep(2 * (2 ** attempt))
    return None


def main():
    rows = c.execute("SELECT bioguide, full_name, fec_ids FROM member WHERE state='WI'").fetchall()
    missing, n = [], 0
    for bioguide, name, raw in rows:
        ids = json.loads(raw) if raw and raw.startswith("[") else []
        got = False
        for cand_id in [i.strip() for i in ids if i.strip()]:
            url = (f"https://api.open.fec.gov/v1/candidate/{cand_id}/totals/"
                   f"?cycle={CYCLE}&api_key={KEY}&per_page=1")
            d = get(url)
            time.sleep(0.8)
            res = (d or {}).get("results") or []
            if not res:
                continue
            t = res[0]
            c.execute("INSERT OR REPLACE INTO candidate_totals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                bioguide, cand_id, CYCLE,
                float(t.get("receipts") or 0),
                float(t.get("individual_contributions") or 0),
                float(t.get("other_political_committee_contributions") or 0),
                float(t.get("political_party_committee_contributions") or 0),
                float(t.get("candidate_contribution") or 0),
                float(t.get("transfers_from_other_authorized_committee") or 0),
                float(t.get("disbursements") or 0),
                float(t.get("last_cash_on_hand_end_period") or 0),
                t.get("coverage_end_date"),
                f"https://www.fec.gov/data/candidate/{cand_id}/?cycle={CYCLE}",
            ))
            got = True
            n += 1
        if not got:
            missing.append(f"{name} ({bioguide})")
    con.commit()

    print(f"candidate totals stored: {n} for {len(rows)} members")
    for r in c.execute("""
            SELECT m.full_name, ct.receipts, ct.pac,
                   ROUND(100.0 * ct.pac / NULLIF(ct.receipts,0), 1)
            FROM candidate_totals ct JOIN member m ON m.bioguide = ct.bioguide
            ORDER BY 4 DESC"""):
        print(f"  {r[0]:24} receipts ${r[1]:>12,.0f}   PAC ${r[2]:>10,.0f}   {r[3]}%")
    con.close()

    # A member with no denominator gets no coverage line, which is a silent
    # downgrade on exactly the page the coverage line exists to qualify. Say so
    # rather than publishing a partial disclosure that looks complete.
    if missing:
        print(f"\nno openFEC totals for {len(missing)} member(s): " + ", ".join(missing),
              file=sys.stderr)
        print("(with DEMO_KEY this is usually rate limiting — set FEC_API_KEY)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
