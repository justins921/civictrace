#!/usr/bin/env python3
"""Load the House FY2026 Community Project Funding (earmark) consolidated file
and repair two known data-linkage gaps.

Earmarks are the honest version of a 'pork audit'. Every request below was
disclosed by the requesting member under House rules — this is not leaked or
inferred data, it is the members' own filings. CivicTrace's job is to make them
countable and comparable, not to call any of them wasteful. Whether a $2M
airport runway is pork or infrastructure is a judgement the reader makes.
"""
import re, sqlite3, openpyxl
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

# name -> bioguide, built from the roster we already loaded
roster = {}
for b, last, first, st, dist in c.execute(
        "SELECT bioguide, last, first, state, district FROM member WHERE chamber='rep'"):
    roster[(last.upper(), st, str(dist))] = b
    roster.setdefault((last.upper(), first.upper()), b)

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
    bio = roster.get((str(last).upper(), st, dnum)) or roster.get((str(last).upper(), str(first).upper()))
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
