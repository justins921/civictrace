#!/usr/bin/env python3
"""Load the House FY2026 Community Project Funding (earmark) consolidated file
and repair two known data-linkage gaps.

Earmarks are the honest version of a 'pork audit'. Every request below was
disclosed by the requesting member under House rules — this is not leaked or
inferred data, it is the members' own filings. CivicTrace's job is to make them
countable and comparable, not to call any of them wasteful. Whether a $2M
airport runway is pork or infrastructure is a judgement the reader makes.
"""
import collections
import re, sqlite3, unicodedata, openpyxl
from pathlib import Path

BASE = Path(__file__).parent
con = sqlite3.connect(BASE / "civictrace.db"); c = con.cursor()

c.executescript("""
DROP TABLE IF EXISTS earmark;
CREATE TABLE earmark (
  id INTEGER PRIMARY KEY, fiscal_year INTEGER, last TEXT, first TEXT,
  member_name TEXT, district TEXT, state TEXT, party TEXT, subcommittee TEXT,
  recipient TEXT, project TEXT, address TEXT, amount REAL,
  member_url TEXT, bioguide TEXT, source_url TEXT
);
CREATE INDEX ix_ear_state ON earmark(state);
CREATE INDEX ix_ear_bio ON earmark(bioguide);
""")

SRC = ("https://appropriations.house.gov/sites/evo-subsites/republicans-appropriations."
       "house.gov/files/evo-media-document/fy26-house-cpf-consolidated.xlsx")

# M14. The House file writes member names in plain ASCII and the roster carries
# them properly, so "Barragán" never matched "Barragan" and 204 of 5,414 earmarks
# were attributed to nobody. Hyphenated surnames, dropped middle names
# ("Marjorie Taylor Greene" filed as "Marjorie Greene") and apostrophes cost the
# rest. Fold everything to a comparable form before keying.
def fold(s):
    """Strip accents, punctuation and case. 'Cherfilus-McCormick' -> 'CHERFILUSMCCORMICK'."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^A-Za-z]", "", s).upper()


# name -> bioguide, built from the roster we already loaded.
#
# Every key here is built only where it identifies exactly one member. The
# previous version asserted that surname+state is "unique in all but a handful
# of states", used it as a fallback, and was wrong: the FY2026 file lists
# 15 requests worth $36,024,633 for David Scott of Georgia's 13th, who is no
# longer in the current roster. Austin Scott of Georgia's 8th is. Both specific
# keys missed, (SCOTT, GA) hit, and $36M landed under the wrong man's name —
# the same failure as V000133, and the comment three lines above it said in
# terms that a wrong attribution is worse than none.
#
# So ambiguity is measured rather than assumed. Collect every candidate for
# every key, then keep only the keys with one candidate. (SCOTT, GA) now has
# two and is simply not a key, so David Scott comes back unattributed, which is
# the truth.
#
# The name variants exist because the appropriations file records names as
# members use them and the roster records them as registered. "Marie Perez" is
# Marie Gluesenkamp Perez; "Marjorie Greene" is Marjorie Taylor Greene. fold()
# strips spaces, so the old `ff.split()[0]` was dead code — there is never a
# space left to split on — and 26 requests for members who *are* in the roster
# went unattributed for want of it.
def variants(name):
    """Folded whole name, plus each token and hyphen-part of it."""
    raw = str(name or "")
    out = {fold(raw)}
    for tok in re.split(r"[\s\-]+", raw):
        if len(tok) > 1:
            out.add(fold(tok))
    return {v for v in out if v}


# There is deliberately no (surname, state) key.
#
# Uniqueness within the roster cannot save it, which is the part that took a
# second attempt to see: David Scott is not in the roster at all, so (SCOTT, GA)
# has exactly one candidate — Austin Scott — and looks perfectly unambiguous
# right up until it hands one man's $36M to another. A key has to be specific
# enough that a member we do not hold *misses* it. Surname plus district, or
# surname plus first name plus state, both are. Surname plus state is not.
candidates = collections.defaultdict(set)
for b, last, first, st, dist in c.execute(
        "SELECT bioguide, last, first, state, district FROM member WHERE chamber='rep'"):
    for lv in variants(last):
        candidates[(lv, st, str(dist))].add(b)
        for fv in variants(first):
            candidates[(lv, fv, st)].add(b)

roster = {k: next(iter(v)) for k, v in candidates.items() if len(v) == 1}
ambiguous = sum(1 for v in candidates.values() if len(v) > 1)
print(f"roster: {len(roster)} unambiguous keys, {ambiguous} dropped as ambiguous")

wb = openpyxl.load_workbook(BASE / "data" / "cpf_fy26.xlsx", read_only=True)
ws = wb[wb.sheetnames[0]]
rows = ws.iter_rows(values_only=True)
next(rows)
n = 0
for r in rows:
    if not r or not r[0]: continue
    last, first, dist, party, sub, recip, proj, addr, amt, url = (list(r) + [None] * 10)[:10]
    dist = (dist or "").strip()
    m = re.match(r"^([A-Z]{2})(\d+|AL)$", dist)
    st, dnum = (m.group(1), m.group(2)) if m else (None, None)
    if dnum and dnum != "AL": dnum = str(int(dnum))
    # Most specific first. Every key that survives is unique by construction,
    # so a miss is a member we do not hold rather than a coin flip.
    bio = None
    for lv in variants(last):
        bio = roster.get((lv, st, dnum))
        if bio:
            break
        for fv in variants(first):
            bio = roster.get((lv, fv, st))
            if bio:
                break
        if bio:
            break
    if isinstance(url, str):
        u = re.search(r'"(https?://[^"]+)"', url)
        url = u.group(1) if u else url
    c.execute("INSERT INTO earmark (fiscal_year,last,first,member_name,district,state,party,"
              "subcommittee,recipient,project,address,amount,member_url,bioguide,source_url) "
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (2026, last, first, f"{first} {last}", dist, st, party, sub, recip, proj, addr,
               float(amt or 0), url, bio, SRC))
    n += 1
print(f"earmark requests loaded: {n}")
print("  matched to a sitting member:",
      c.execute("SELECT COUNT(*) FROM earmark WHERE bioguide IS NOT NULL").fetchone()[0])

# ---- fix 1: Senate roll calls store LIS ids, not bioguide ids ----
lis = {l: b for l, b in c.execute("SELECT lis, bioguide FROM member WHERE lis<>''")}
fixed = 0
for vk, bid in c.execute("""SELECT vote_key, bioguide FROM vote_position
                            WHERE vote_key LIKE 'S%'""").fetchall():
    if bid in lis:
        c.execute("UPDATE vote_position SET bioguide=? WHERE vote_key=? AND bioguide=?",
                  (lis[bid], vk, bid)); fixed += 1
print(f"Senate vote positions relinked to bioguide ids: {fixed}")

# ---- fix 2: flag omnibus / broad bills as unsuitable for sector alignment ----
# An appropriations bill touches every sector, so 'sector share of PAC money' is
# meaningless for it. Flagging is better than silently producing a bad number.
# Idempotent: fetch_bills.py recreates `bill` on a full pipeline run, but this
# script is also runnable on its own and a second run should not die on a column
# it added itself.
if "is_broad" not in {r[1] for r in c.execute("PRAGMA table_info(bill)")}:
    c.execute("ALTER TABLE bill ADD COLUMN is_broad INTEGER DEFAULT 0")
c.execute("""UPDATE bill SET is_broad=1 WHERE
   title LIKE '%Appropriations%' OR title LIKE '%Consolidated%'
   OR title LIKE '%continuing resolution%' OR title LIKE '%Making further%'
   OR title LIKE '%budget%' OR bill_key IN (
     SELECT bill_key FROM bill_sector GROUP BY bill_key HAVING COUNT(*) >= 4)""")
nb = c.execute("SELECT COUNT(*) FROM bill WHERE is_broad=1").fetchone()[0]
print(f"bills flagged as broad/omnibus (excluded from alignment): {nb}")

con.commit()
print("\nWisconsin FY2026 earmark requests by member:")
for r in c.execute("""SELECT member_name, district, party, COUNT(*) n, ROUND(SUM(amount)) total
                      FROM earmark WHERE state='WI' GROUP BY member_name ORDER BY total DESC"""):
    print(" ", r)
con.close()
