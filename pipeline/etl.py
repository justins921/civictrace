#!/usr/bin/env python3
"""CivicTrace ETL — loads FEC bulk + congress-legislators into SQLite.
Every row keeps its FEC image number / sub_id so the UI can deep-link to the
original filing. No derived or estimated values are stored in fact tables.
"""
import csv, json, sqlite3, sys, os
from pathlib import Path

D = Path(__file__).parent / "data"
DB = Path(__file__).parent / "civictrace.db"
if DB.exists(): DB.unlink()
con = sqlite3.connect(DB)
c = con.cursor()
csv.field_size_limit(10_000_000)

c.executescript("""
CREATE TABLE member (
  bioguide TEXT PRIMARY KEY, full_name TEXT, first TEXT, last TEXT,
  chamber TEXT, state TEXT, district TEXT, party TEXT,
  term_start TEXT, term_end TEXT, url TEXT, phone TEXT,
  govtrack TEXT, opensecrets TEXT, fec_ids TEXT, lis TEXT, wikipedia TEXT
);
CREATE TABLE candidate (
  cand_id TEXT, cand_name TEXT, party TEXT, election_yr TEXT,
  office_state TEXT, office TEXT, district TEXT, pcc TEXT, cycle INTEGER,
  PRIMARY KEY (cand_id, cycle)
);
CREATE TABLE committee (
  cmte_id TEXT, cycle INTEGER, cmte_name TEXT, treasurer TEXT,
  cmte_dsgn TEXT, cmte_tp TEXT, cmte_pty TEXT, org_tp TEXT,
  connected_org TEXT, cand_id TEXT, PRIMARY KEY (cmte_id, cycle)
);
CREATE TABLE cand_cmte_link (
  cand_id TEXT, cand_election_yr TEXT, fec_election_yr TEXT,
  cmte_id TEXT, cmte_tp TEXT, cmte_dsgn TEXT, cycle INTEGER
);
CREATE TABLE contribution (
  filer_cmte_id TEXT,      -- the PAC / committee making the contribution
  recipient_name TEXT,     -- recipient committee name as filed
  recipient_cmte_id TEXT,  -- OTHER_ID
  cand_id TEXT,            -- benefiting candidate
  transaction_tp TEXT, entity_tp TEXT,
  city TEXT, state TEXT, zip TEXT,
  transaction_dt TEXT, iso_dt TEXT, amount REAL,
  image_num TEXT, file_num TEXT, sub_id TEXT PRIMARY KEY,
  memo_cd TEXT, memo_text TEXT, cycle INTEGER
);
CREATE INDEX ix_contrib_cand ON contribution(cand_id);
CREATE INDEX ix_contrib_filer ON contribution(filer_cmte_id);
CREATE INDEX ix_contrib_dt ON contribution(iso_dt);
CREATE INDEX ix_ccl_cand ON cand_cmte_link(cand_id);
CREATE INDEX ix_cmte_name ON committee(cmte_name);
""")

# ---------- members ----------
leg = json.load(open(D / "legislators-current.json"))
rows = []
for l in leg:
    t = l["terms"][-1]
    ids = l["id"]
    rows.append((ids["bioguide"], l["name"].get("official_full", ""), l["name"].get("first"),
                 l["name"].get("last"), t["type"], t.get("state"), str(t.get("district", "")),
                 t.get("party"), t.get("start"), t.get("end"), t.get("url"), t.get("phone"),
                 str(ids.get("govtrack", "")), ids.get("opensecrets", ""),
                 json.dumps(ids.get("fec", [])), ids.get("lis", ""), l["id"].get("wikipedia", "")))
c.executemany("INSERT OR REPLACE INTO member VALUES (%s)" % ",".join("?" * 17), rows)
print(f"members: {len(rows)}")


def pipe(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            yield line.rstrip("\n").split("|")


def iso(d):
    d = (d or "").strip()
    if len(d) == 8 and d.isdigit():
        return f"{d[4:]}-{d[0:2]}-{d[2:4]}"
    return None


for cycle in (2024, 2026):
    yy = str(cycle)[2:]
    n = 0
    for r in pipe(D / f"cn{yy}_x/cn.txt"):
        if len(r) < 15: continue
        c.execute("INSERT OR REPLACE INTO candidate VALUES (?,?,?,?,?,?,?,?,?)",
                  (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[9], cycle)); n += 1
    print(f"candidates {cycle}: {n}")

    n = 0
    for r in pipe(D / f"cm{yy}_x/cm.txt"):
        if len(r) < 15: continue
        c.execute("INSERT OR REPLACE INTO committee VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (r[0], cycle, r[1], r[2], r[8], r[9], r[10], r[11], r[12], r[14])); n += 1
    print(f"committees {cycle}: {n}")

    n = 0
    for r in pipe(D / f"ccl{yy}_x/ccl.txt"):
        if len(r) < 6: continue
        c.execute("INSERT INTO cand_cmte_link VALUES (?,?,?,?,?,?,?)",
                  (r[0], r[1], r[2], r[3], r[4], r[5], cycle)); n += 1
    print(f"linkages {cycle}: {n}")

    # contributions — restrict to WI-relevant candidates to keep the demo DB small
    wi = {x[0] for x in c.execute(
        "SELECT cand_id FROM candidate WHERE office_state='WI' AND cycle=?", (cycle,))}
    n = 0
    batch = []
    for r in pipe(D / f"pas2{yy}_x/itpas2.txt"):
        if len(r) < 22: continue
        if r[16] not in wi: continue
        try: amt = float(r[14] or 0)
        except ValueError: amt = 0.0
        batch.append((r[0], r[7], r[15], r[16], r[5], r[6], r[8], r[9], r[10],
                      r[13], iso(r[13]), amt, r[4], r[18], r[21], r[19], r[20], cycle))
        n += 1
        if len(batch) >= 5000:
            c.executemany("INSERT OR REPLACE INTO contribution VALUES (%s)" % ",".join("?" * 18), batch)
            batch = []
    if batch:
        c.executemany("INSERT OR REPLACE INTO contribution VALUES (%s)" % ",".join("?" * 18), batch)
    print(f"WI contributions {cycle}: {n}")

con.commit()
print("\n-- sanity --")
for row in c.execute("""
  SELECT ca.cand_name, ca.district, COUNT(*) n, ROUND(SUM(k.amount)) total
  FROM contribution k JOIN candidate ca ON ca.cand_id=k.cand_id AND ca.cycle=k.cycle
  WHERE k.cycle=2024 AND (k.memo_cd IS NULL OR k.memo_cd<>'X')
  GROUP BY ca.cand_id ORDER BY total DESC LIMIT 12"""):
    print(row)
con.close()
