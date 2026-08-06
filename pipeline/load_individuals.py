#!/usr/bin/env python3
"""Individual contributions to Wisconsin members — as aggregates, never as a name index.

Why this exists
---------------
Individual money is $11.9M of the delegation's $21.3M in receipts. CivicTrace
was publishing the $5.5M of committee money and nothing else, and telling
readers that federal law required the omission. It does not: 52 U.S.C.
§30111(a)(4) forbids *selling* contributor data or using it to solicit, and the
FEC's own guidance exempts news and opinion sites from republication limits.
That claim is corrected and this is the other half of the correction.

Why aggregates and not records
------------------------------
Because "we may" is not "we should". A searchable index of private citizens by
name, home address, employer and political giving is a different product from a
record of organised money, and it is the one that gets misused — by campaigns
mining it, by neighbours looking each other up, by anyone building a list. The
public interest is in *what kinds of people and industries* fund a member, and
that survives aggregation completely.

So this script reads 2 GB of names and stores none of them. It emits:

  * employer totals, above a minimum that keeps single donors from being
    identifiable by their employer alone
  * occupation totals, same rule
  * state and in-state/out-of-state splits
  * size bands, which is where the interesting question actually lives:
    small-dollar versus maxed-out

Nothing here feeds a money trail. It is context, like candidate_totals — the
denominator on the page, not a term in any equation.

Streaming, because the file does not fit anywhere
-------------------------------------------------
indiv26.zip is ~2 GB compressed and much larger open. It is never extracted and
never read into memory: zipfile.open() decompresses as a stream and the file is
consumed a line at a time, holding only the running counters. That is the whole
reason this ran as its own project rather than being bolted onto etl.py, which
loads its inputs with readlines().
"""
import csv
import io
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "data"
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
CYCLE = int(os.environ.get("CT_CYCLE", "2026"))
SRC = f"https://www.fec.gov/files/bulk-downloads/{CYCLE}/indiv{str(CYCLE)[-2:]}.zip"

# FEC individual-contribution file layout, in order.
COLS = ("CMTE_ID AMNDT_IND RPT_TP TRANSACTION_PGI IMAGE_NUM TRANSACTION_TP ENTITY_TP NAME "
        "CITY STATE ZIP_CODE EMPLOYER OCCUPATION TRANSACTION_DT TRANSACTION_AMT OTHER_ID "
        "TRAN_ID FILE_NUM MEMO_CD MEMO_TEXT SUB_ID").split()
IDX = {c: i for i, c in enumerate(COLS)}

# 15  a contribution from an individual
# 15E a contribution earmarked through a conduit (ActBlue, WinRed). Excluding
#     these would drop most small-dollar money on both sides, which is the part
#     of the picture people most want to see.
# 15J a memo line splitting a joint fundraising receipt — always paired with a
#     real transaction elsewhere, so counting it double-counts.
KEEP_TYPES = {"15", "15E"}

# A single donor at a one-person employer is identifiable from the employer
# alone. Below this many contributors, an employer or occupation is folded into
# an "all smaller employers" line rather than published.
MIN_DONORS = 3

BANDS = [(0, 200, "under $200"), (200, 1000, "$200–999"), (1000, 2900, "$1,000–2,899"),
         (2900, 10 ** 9, "$2,900 and up (at or near the per-election maximum)")]


def band(amount):
    for lo, hi, name in BANDS:
        if lo <= amount < hi:
            return name
    return BANDS[-1][2]


def norm_org(s):
    """Fold the worst of the free-text noise without inventing categories.

    EMPLOYER and OCCUPATION are typed by whoever filled in the form. 'SELF',
    'SELF-EMPLOYED', 'SELF EMPLOYED' and 'SELF employed' are one thing; so are
    the fourteen spellings of 'NOT EMPLOYED'. Everything else is upper-cased,
    stripped of punctuation runs, and otherwise left exactly as filed — this is
    tidying, not classification, and it is not allowed to become classification
    quietly.
    """
    import re
    s = re.sub(r"\s+", " ", (s or "").strip().upper())
    s = s.strip(" .,-")
    if s in ("", "N/A", "NA", "NONE", "UNKNOWN", "INFO REQUESTED", "REQUESTED",
             "INFORMATION REQUESTED", "BEST EFFORTS", "*"):
        return "(not disclosed)"
    if s.replace("-", " ").replace("_", " ") in ("SELF", "SELF EMPLOYED", "SELFEMPLOYED"):
        return "SELF-EMPLOYED"
    if s.replace("-", " ") in ("NOT EMPLOYED", "UNEMPLOYED", "NO EMPLOYER", "NOT WORKING"):
        return "NOT EMPLOYED"
    if s in ("RETIRED", "RETIRED/NOT EMPLOYED", "RETIREE"):
        return "RETIRED"
    if s in ("HOMEMAKER", "HOME MAKER", "HOUSEWIFE"):
        return "HOMEMAKER"
    return s


def download():
    dest = DATA / f"indiv{str(CYCLE)[-2:]}.zip"
    part = dest.with_suffix(".zip.part")
    # A background fetch may have already put the bytes here.
    if part.exists() and not dest.exists():
        try:
            zipfile.ZipFile(part).namelist()
            os.replace(part, dest)
            print(f"  using the pre-fetched archive ({dest.stat().st_size/1e9:.2f} GB)")
            return dest
        except zipfile.BadZipFile:
            pass  # still downloading, or truncated — fetch it properly below

    headers = {"User-Agent": UA}
    if dest.exists():
        headers["If-Modified-Since"] = time.strftime(
            "%a, %d %b %Y %H:%M:%S GMT", time.gmtime(dest.stat().st_mtime))
    try:
        req = urllib.request.Request(SRC, headers=headers)
        with urllib.request.urlopen(req, timeout=1800) as r, open(part, "wb") as out:
            # Copy in chunks: this is 2 GB and r.read() would hold all of it.
            while True:
                chunk = r.read(1 << 22)
                if not chunk:
                    break
                out.write(chunk)
        os.replace(part, dest)
        print(f"  downloaded {dest.stat().st_size/1e9:.2f} GB")
    except urllib.error.HTTPError as e:
        if e.code == 304 and dest.exists():
            print("  archive unchanged since last run")
        elif dest.exists():
            print(f"  could not refresh (HTTP {e.code}), using cached copy", file=sys.stderr)
        else:
            raise
    return dest


def main():
    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()

    import json
    cand_ids = set()
    for raw, in c.execute("SELECT fec_ids FROM member WHERE state='WI'"):
        for i in (json.loads(raw) if raw and raw.startswith("[") else []):
            if i.strip():
                cand_ids.add(i.strip())
    if not cand_ids:
        print("no Wisconsin roster loaded", file=sys.stderr)
        return 1

    q = ",".join("?" * len(cand_ids))
    cmte_to_cand = {}
    for cmte, cand in c.execute(
            f"SELECT cmte_id, cand_id FROM cand_cmte_link WHERE cand_id IN ({q})",
            tuple(cand_ids)):
        cmte_to_cand[cmte] = cand
    cand_to_bio = {}
    for bio, raw in c.execute("SELECT bioguide, fec_ids FROM member WHERE state='WI'"):
        for i in (json.loads(raw) if raw and raw.startswith("[") else []):
            cand_to_bio[i.strip()] = bio
    print(f"watching {len(cmte_to_cand)} committees belonging to {len(cand_ids)} candidates")

    src = download()

    by_employer = defaultdict(lambda: [0, 0.0])      # bioguide,employer -> [n, total]
    by_occupation = defaultdict(lambda: [0, 0.0])
    by_state = defaultdict(lambda: [0, 0.0])
    by_band = defaultdict(lambda: [0, 0.0])
    totals = defaultdict(lambda: [0, 0.0])
    seen_types = Counter()
    rows = kept = 0
    t0 = time.time()

    with zipfile.ZipFile(src) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        with z.open(name) as raw:
            stream = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            for line in csv.reader(stream, delimiter="|", quoting=csv.QUOTE_NONE):
                rows += 1
                if rows % 5_000_000 == 0:
                    print(f"    {rows:,} rows in {time.time()-t0:.0f}s, {kept:,} kept", flush=True)
                if len(line) <= IDX["SUB_ID"]:
                    continue
                cand = cmte_to_cand.get(line[IDX["CMTE_ID"]])
                if cand is None:
                    continue
                tp = line[IDX["TRANSACTION_TP"]].strip()
                seen_types[tp] += 1
                if tp not in KEEP_TYPES:
                    continue
                if line[IDX["MEMO_CD"]].strip().upper() == "X":
                    continue      # a memo line restating money counted elsewhere
                try:
                    amt = float(line[IDX["TRANSACTION_AMT"]] or 0)
                except ValueError:
                    continue
                bio = cand_to_bio.get(cand)
                if not bio:
                    continue
                kept += 1
                emp = norm_org(line[IDX["EMPLOYER"]])
                occ = norm_org(line[IDX["OCCUPATION"]])
                st = (line[IDX["STATE"]] or "").strip().upper() or "(none)"
                for d, k in ((by_employer, (bio, emp)), (by_occupation, (bio, occ)),
                             (by_state, (bio, st)), (by_band, (bio, band(amt))),
                             (totals, (bio, "ALL"))):
                    d[k][0] += 1
                    d[k][1] += amt

    print(f"  read {rows:,} rows in {time.time()-t0:.0f}s; {kept:,} were individual "
          f"contributions to a Wisconsin committee")
    print(f"  transaction types seen on those committees: "
          f"{dict(seen_types.most_common(6))}")

    c.executescript("""
    DROP TABLE IF EXISTS individual_agg;
    CREATE TABLE individual_agg (
      bioguide TEXT, cycle INTEGER, dimension TEXT, key TEXT,
      donations INTEGER, total REAL,
      PRIMARY KEY (bioguide, cycle, dimension, key));
    """)

    def store(dimension, data, apply_min):
        """Write one dimension, folding anything below MIN_DONORS into a single
        line. The folded line keeps its money — dropping it would make the
        dimension stop adding up to the total, and a breakdown that does not
        reconcile is how this project has gotten in trouble before."""
        small = defaultdict(lambda: [0, 0.0, 0])
        for (bio, key), (n, amt) in data.items():
            if apply_min and n < MIN_DONORS:
                small[bio][0] += n
                small[bio][1] += amt
                small[bio][2] += 1
                continue
            c.execute("INSERT OR REPLACE INTO individual_agg VALUES (?,?,?,?,?,?)",
                      (bio, CYCLE, dimension, key, n, round(amt, 2)))
        for bio, (n, amt, k) in small.items():
            c.execute("INSERT OR REPLACE INTO individual_agg VALUES (?,?,?,?,?,?)",
                      (bio, CYCLE, dimension,
                       f"(all employers with fewer than {MIN_DONORS} donors — {k:,} of them)"
                       if dimension == "employer" else
                       f"(all occupations with fewer than {MIN_DONORS} donors — {k:,} of them)",
                       n, round(amt, 2)))

    store("employer", by_employer, True)
    store("occupation", by_occupation, True)
    store("state", by_state, False)
    store("size_band", by_band, False)
    store("all", totals, False)
    con.commit()

    print("\nindividual money by member:")
    for name, n, amt in c.execute("""
            SELECT m.full_name, a.donations, a.total
            FROM individual_agg a JOIN member m ON m.bioguide = a.bioguide
            WHERE a.dimension='all' ORDER BY a.total DESC"""):
        print(f"  {name:24} {n:>7,} contributions   ${amt:>12,.0f}")

    # Every dimension must add to the same per-member total, or the page shows a
    # breakdown that does not match the number above it.
    bad = []
    for bio, tot in c.execute("SELECT bioguide, total FROM individual_agg WHERE dimension='all'"):
        for dim, in c.execute("SELECT DISTINCT dimension FROM individual_agg WHERE dimension<>'all'"):
            s = c.execute("SELECT COALESCE(SUM(total),0) FROM individual_agg "
                          "WHERE bioguide=? AND dimension=?", (bio, dim)).fetchone()[0]
            if abs(s - tot) > 0.5:
                bad.append(f"{bio}/{dim}: {s:,.2f} vs {tot:,.2f}")
    print("\n" + ("every dimension reconciles to the member total"
                  if not bad else f"BREAKDOWN DOES NOT RECONCILE: {'; '.join(bad[:5])}"))
    con.close()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
