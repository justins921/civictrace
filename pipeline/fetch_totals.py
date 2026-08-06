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

Why it never blocks the run
---------------------------
Three rules, learned by having this step hang a refresh for ten minutes:

  * The table is never dropped. It is upserted, so a bad API day leaves
    yesterday's denominators in place instead of deleting them.
  * A row younger than CT_TOTALS_FRESH_HOURS is not re-fetched. These figures
    move when a member files a report — monthly at most — so asking daily
    spends a rate limit for nothing.
  * There is a wall-clock deadline. Past it the script stops asking and reports
    what it has. Missing denominators mean some member pages omit their coverage
    line, which is a downgrade; a stalled pipeline is an outage.

Environment:
  FEC_API_KEY              optional. Without one, DEMO_KEY works but is limited
                           to ~30 requests an hour across every anonymous user
                           on the internet, which is why the deadline exists.
                           Free key: https://api.open.fec.gov/developers/
  CT_TOTALS_DEADLINE       seconds, default 240
  CT_TOTALS_FRESH_HOURS    skip rows fetched more recently than this, default 20
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
DEADLINE = float(os.environ.get("CT_TOTALS_DEADLINE", "240"))
FRESH_FOR = float(os.environ.get("CT_TOTALS_FRESH_HOURS", "20")) * 3600
STARTED = time.time()

# The cache lives on disk, not in SQLite.
#
# etl.py opens every run with `if DB.exists(): DB.unlink()` — the database file
# is deleted and rebuilt from the FEC bulk files. That is the right design for
# derived data and it silently defeated the first version of this script, which
# carefully avoided dropping its own table inside a file that gets deleted
# anyway. Every "keep yesterday's values" rule here was fiction until the cache
# moved out here.
CACHE = BASE / "data" / "candidate_totals.json"


def load_cache():
    if not CACHE.exists():
        return {"totals": {}, "absent": {}}
    try:
        d = json.loads(CACHE.read_text())
        d.setdefault("totals", {}); d.setdefault("absent", {})
        return d
    except Exception as e:
        print(f"  cache unreadable ({e}), starting fresh", file=sys.stderr)
        return {"totals": {}, "absent": {}}


def save_cache(d):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE.with_suffix(".json.part")
    tmp.write_text(json.dumps(d, indent=1, sort_keys=True))
    os.replace(tmp, CACHE)


con = sqlite3.connect(BASE / "civictrace.db")
c = con.cursor()
# `IF NOT EXISTS`, not `DROP`. This file's own docstring says it never drops the
# table — that the on-disk cache exists precisely so a rate-limited run degrades
# to yesterday's figures instead of emptying the coverage lines on ten member
# pages. Two lines below the docstring it dropped the table, at import, before
# any of that logic ran, so a run that fetched nothing published nothing. The
# `INSERT OR REPLACE` below already makes this idempotent; the DROP only ever
# removed the safety net.
c.executescript("""
CREATE TABLE IF NOT EXISTS candidate_totals (
  bioguide TEXT, cand_id TEXT, cycle INTEGER,
  receipts REAL, individual REAL, pac REAL, party REAL, self_funded REAL,
  transfers REAL, disbursements REAL, cash_on_hand REAL,
  coverage_end TEXT, source_url TEXT, fetched_at REAL,
  PRIMARY KEY (bioguide, cand_id, cycle)
);
""")


def out_of_time():
    return time.time() - STARTED > DEADLINE


def get(url, attempts=4):
    for attempt in range(attempts):
        if out_of_time():
            return None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            # 429 means the shared DEMO_KEY bucket is empty, and no amount of
            # retrying inside one run will refill it.
            wait = 30 if e.code == 429 else 2 * (2 ** attempt)
            print(f"  HTTP {e.code}, waiting {wait}s: {url.split('?')[0]}", file=sys.stderr)
            if out_of_time():
                return None
            time.sleep(wait)
        except Exception as e:
            print(f"  {e}, retrying", file=sys.stderr)
            time.sleep(2 * (2 ** attempt))
    return None


def main():
    cache = load_cache()
    totals, absent = cache["totals"], cache["absent"]

    rows = c.execute("SELECT bioguide, full_name, fec_ids FROM member WHERE state='WI'").fetchall()
    missing, fetched, fresh, stale = [], 0, 0, 0
    for bioguide, name, raw in rows:
        ids = [i.strip() for i in (json.loads(raw) if raw and raw.startswith("[") else []) if i.strip()]
        covered = False
        for cand_id in ids:
            ck = f"{cand_id}:{CYCLE}"
            prev = totals.get(ck)
            if prev and (time.time() - float(prev.get("fetched_at") or 0)) < FRESH_FOR:
                covered = True; fresh += 1
                continue
            gone = absent.get(ck)
            if gone and (time.time() - float(gone)) < FRESH_FOR * 7:
                continue
            if out_of_time():
                if prev:
                    covered = True; stale += 1
                continue

            d = get(f"https://api.open.fec.gov/v1/candidate/{cand_id}/totals/"
                    f"?cycle={CYCLE}&api_key={KEY}&per_page=1")
            res = (d or {}).get("results") or []
            if not res:
                if d is not None:
                    # An answered request with no rows: this candidate ID has no
                    # activity this cycle, and that answer is not going to change.
                    absent[ck] = time.time()
                if prev:
                    covered = True; stale += 1
                continue
            t = res[0]
            totals[ck] = {
                "bioguide": bioguide, "cand_id": cand_id, "cycle": CYCLE,
                "receipts": float(t.get("receipts") or 0),
                "individual": float(t.get("individual_contributions") or 0),
                "pac": float(t.get("other_political_committee_contributions") or 0),
                "party": float(t.get("political_party_committee_contributions") or 0),
                "self_funded": float(t.get("candidate_contribution") or 0),
                "transfers": float(t.get("transfers_from_other_authorized_committee") or 0),
                "disbursements": float(t.get("disbursements") or 0),
                "cash_on_hand": float(t.get("last_cash_on_hand_end_period") or 0),
                "coverage_end": t.get("coverage_end_date"),
                "source_url": f"https://www.fec.gov/data/candidate/{cand_id}/?cycle={CYCLE}",
                "fetched_at": time.time(),
            }
            covered = True; fetched += 1
            time.sleep(0.8)
        if not covered:
            missing.append(f"{name} ({bioguide})")

    save_cache({"totals": totals, "absent": absent})

    # Write the whole cache into SQLite, not just what this run fetched. The
    # table is rebuilt from scratch every run because the database file is, so
    # "only insert what changed" would publish an empty table on a rate-limited
    # day and trip the shrink guard — which is exactly what it did once.
    for rec in totals.values():
        if rec.get("cycle") != CYCLE:
            continue
        c.execute("INSERT OR REPLACE INTO candidate_totals "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (rec["bioguide"], rec["cand_id"], rec["cycle"], rec["receipts"],
                   rec["individual"], rec["pac"], rec["party"], rec["self_funded"],
                   rec["transfers"], rec["disbursements"], rec["cash_on_hand"],
                   rec["coverage_end"], rec["source_url"], rec["fetched_at"]))
    con.commit()

    print(f"candidate totals: {fetched} fetched, {fresh} still fresh, {stale} kept from an "
          f"earlier run, {len(rows)} members"
          + (f"  [{DEADLINE:.0f}s deadline reached]" if out_of_time() else ""))
    for r in c.execute("""
            SELECT m.full_name, ct.receipts, ct.pac,
                   ROUND(100.0 * ct.pac / NULLIF(ct.receipts,0), 1)
            FROM candidate_totals ct JOIN member m ON m.bioguide = ct.bioguide
            WHERE ct.cycle = ? ORDER BY 4 DESC""", (CYCLE,)):
        print(f"  {r[0]:24} receipts ${r[1]:>12,.0f}   PAC ${r[2]:>10,.0f}   {r[3]}%")
    con.close()

    # Soft failure by design. A member with no denominator loses their coverage
    # line — a downgrade, not a wrong number — and blocking the entire refresh
    # over a rate limit on a context source trades a working site for a tidy one.
    if missing:
        print(f"\nno openFEC totals for {len(missing)} member(s): " + ", ".join(missing),
              file=sys.stderr)
        print("their pages omit the coverage line until this succeeds; with DEMO_KEY this is "
              "rate limiting, so set FEC_API_KEY", file=sys.stderr)


if __name__ == "__main__":
    main()
