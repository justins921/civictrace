#!/usr/bin/env python3
"""Independent expenditures targeting Wisconsin candidates — a separate ledger, never merged.

Why a separate ledger
---------------------
An independent expenditure is money spent *about* a candidate, not *to* them.
That distinction is real and CivicTrace keeps it: nothing in this table is ever
added to a contribution total, fed into a money trail, or counted in the
reconciliation. Every route to the grand total must still agree, and this is not
one of the routes.

But excluding it from the site entirely was the wrong call. It is the money with
no contribution limit on it, and a reader asking "did money move around this
member" was getting an answer that silently omitted a whole category. So: shown,
labelled, and never summed with anything.

Data quality, which is the actual work here
-------------------------------------------
The FEC's bulk IE file is filer-submitted and not validated. As of August 2026
it contains a filing for **$9,000,000,000 from "Warren Buffet"** against a
candidate named Bettis, and several more like it — the whole-file total comes to
$39 billion, which is roughly twenty times all federal independent spending ever
recorded. Publishing a naive SUM() of this file would put a fabricated number on
a site whose entire premise is that its numbers are checkable.

Two guards, both explicit:
  * amendments (`amndt_ind` A1..An) supersede the original filing they amend,
    so the original is dropped rather than counted twice;
  * any single expenditure above IMPLAUSIBLE is quarantined, not silently
    dropped — it is stored with `quarantined=1` and a reason, so the row is
    still auditable and the count of quarantined rows is publishable.
"""
import csv
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "data"
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
CYCLE = int(os.environ.get("CT_CYCLE", "2026"))
SRC = f"https://www.fec.gov/files/bulk-downloads/{CYCLE}/independent_expenditure_{CYCLE}.csv"

# No independent expenditure against one federal candidate has ever approached
# this. It is a bright line for "this filing is not real", not a judgement about
# whether the spending was large.
IMPLAUSIBLE = 25_000_000.0

MONTHS = {m: f"{i + 1:02d}" for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


def iso(d):
    """'03-APR-26' -> '2026-04-03'. Returns None rather than guessing."""
    try:
        dd, mm, yy = (d or "").strip().split("-")
        return f"20{int(yy):02d}-{MONTHS[mm.upper()]}-{int(dd):02d}"
    except Exception:
        return None


def download():
    dest = DATA / f"ie_{CYCLE}.csv"
    req = urllib.request.Request(SRC, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(body)
    os.replace(tmp, dest)
    return dest


def main():
    src = download()
    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()
    c.executescript("""
    DROP TABLE IF EXISTS independent_expenditure;
    CREATE TABLE independent_expenditure (
      bioguide TEXT, cand_id TEXT, cycle INTEGER,
      spender_id TEXT, spender_name TEXT,
      support_oppose TEXT, amount REAL, iso_date TEXT, purpose TEXT,
      file_num TEXT, tran_id TEXT, image_num TEXT, amndt_ind TEXT,
      quarantined INTEGER, quarantine_reason TEXT, source_url TEXT);
    CREATE INDEX ix_ie_bio ON independent_expenditure(bioguide);
    """)

    wi = {}
    for bio, raw in c.execute("SELECT bioguide, fec_ids FROM member WHERE state='WI'"):
        for i in (json.loads(raw) if raw and raw.startswith("[") else []):
            if i.strip():
                wi[i.strip()] = bio
    if not wi:
        print("no Wisconsin candidate IDs on the roster — nothing to match", file=sys.stderr)
        return 1

    # Pass 1: find which (file_num) filings have been amended, so the superseded
    # originals can be excluded. `prev_file_num` points at what an amendment
    # replaces.
    superseded = set()
    with open(src, newline="", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            if (r.get("amndt_ind") or "").strip().upper().startswith("A"):
                prev = (r.get("prev_file_num") or "").strip()
                if prev:
                    superseded.add(prev)

    # A 24-hour notice and the periodic report that later covers the same
    # expenditure are two filings of one payment.
    #
    # FEC rules require a 24- or 48-hour report for independent expenditures
    # close to an election, and the same expenditure then appears again on the
    # spender's next quarterly or monthly report. `prev_file_num` does not link
    # them — that field only chains amendments — so the amendment pass above
    # cannot see it, and both copies were being counted. On a contested race
    # near an election that inflates the outside-spending figure on a member's
    # page by the size of the late-campaign spending, which is the part readers
    # care most about.
    #
    # The transaction identity is the spender, the candidate, the date, the
    # amount and the support/oppose flag: two filings describing the same
    # payment agree on all five. `tran_id` would be better but it is not
    # populated consistently across form types in this file, so it is used when
    # both copies have one and the tuple is the fallback rather than the other
    # way round.
    seen = {}
    kept = quarantined = skipped_amended = skipped_dup = 0
    with open(src, newline="", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            bio = wi.get((r.get("cand_id") or "").strip())
            if not bio:
                continue
            if (r.get("file_num") or "").strip() in superseded:
                skipped_amended += 1
                continue
            ident = ((r.get("spe_id") or "").strip(), (r.get("cand_id") or "").strip(),
                     iso(r.get("exp_date")), (r.get("exp_amo") or "").strip(),
                     (r.get("sup_opp") or "").strip().upper(),
                     (r.get("tran_id") or "").strip())
            if ident in seen:
                skipped_dup += 1
                continue
            seen[ident] = True
            try:
                amt = float(r.get("exp_amo") or 0)
            except ValueError:
                amt = 0.0
            q, why = 0, None
            if amt > IMPLAUSIBLE:
                q, why = 1, (f"single expenditure of ${amt:,.0f} exceeds the ${IMPLAUSIBLE:,.0f} "
                             f"plausibility ceiling; filer-submitted and unvalidated")
                quarantined += 1
            else:
                kept += 1
            c.execute("INSERT INTO independent_expenditure VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                bio, r.get("cand_id"), CYCLE,
                r.get("spe_id"), r.get("spe_nam"),
                (r.get("sup_opp") or "").strip().upper(), amt,
                iso(r.get("exp_date")), (r.get("pur") or "")[:300],
                r.get("file_num"), r.get("tran_id"), r.get("image_num"),
                r.get("amndt_ind"), q, why,
                f"https://docquery.fec.gov/cgi-bin/fecimg/?{(r.get('image_num') or '').strip()}"))
    con.commit()

    tot = c.execute("""SELECT support_oppose, COUNT(*), ROUND(SUM(amount),2)
                       FROM independent_expenditure WHERE quarantined=0
                       GROUP BY 1 ORDER BY 3 DESC""").fetchall()
    print(f"independent expenditures targeting WI: {kept} filings kept, "
          f"{skipped_amended} superseded by amendment, {skipped_dup} duplicate reports of the "
          f"same expenditure (24-hour notice and periodic report), {quarantined} quarantined")
    for so, n, amt in tot:
        print(f"  {'supporting' if so == 'S' else 'opposing' if so == 'O' else so or '(blank)':12} "
              f"{n:4} filings   ${amt:,.2f}")
    print()
    for name, n, amt in c.execute("""
            SELECT m.full_name, COUNT(*), ROUND(SUM(ie.amount),2)
            FROM independent_expenditure ie JOIN member m ON m.bioguide = ie.bioguide
            WHERE ie.quarantined=0 GROUP BY 1 ORDER BY 3 DESC"""):
        print(f"  {name:24} {n:4} filings   ${amt:,.2f}")

    if quarantined:
        print(f"\n{quarantined} filing(s) quarantined as implausible:", file=sys.stderr)
        for row in c.execute("""SELECT spender_name, amount, iso_date FROM independent_expenditure
                                WHERE quarantined=1 ORDER BY amount DESC LIMIT 5"""):
            print(f"  ${row[1]:,.0f} from {row[0]!r} on {row[2]}", file=sys.stderr)
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
