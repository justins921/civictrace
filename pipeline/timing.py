#!/usr/bin/env python3
"""Recompute the timing figure with its own provenance.

The old field said "0 days" and left the reader to assume the contribution came
first. Two problems with that:

  1. FEC filings carry a calendar date, not a timestamp. On a same-day figure
     the records do not establish which event happened first, and we should not
     let the layout imply an order the data cannot support.
  2. The gap was computed from the most recent contribution by ANY committee in
     the sector, which is often not the committee shown as the headline donor.
     A timing claim has to name the specific filing it came from.

So we now emit the date, every sector contribution on that date, and a flag for
whether the vote and the contribution share a calendar date.
"""
import json, sqlite3
from datetime import date
from pathlib import Path
from trail import conn, CLEAN, DIRECT, CAST
from build_site import cand_for

c = conn()
out = []

for m in c.execute("SELECT * FROM member WHERE state='WI'").fetchall():
    cid = cand_for(c, m)
    if not cid:
        continue
    for row in c.execute(
            "SELECT DISTINCT vote_key FROM vote_position WHERE bioguide=?", (m["bioguide"],)):
        vk = row["vote_key"]
        rc = c.execute("SELECT * FROM rollcall WHERE vote_key=?", (vk,)).fetchone()
        pos = c.execute("SELECT * FROM vote_position WHERE vote_key=? AND bioguide=?",
                        (vk, m["bioguide"])).fetchone()
        if not rc or not pos or (pos["position"] or "").strip() not in CAST:
            continue
        from fetch_bills import parse_legis
        p = parse_legis(rc["legis_num"])
        if not p:
            continue
        bill = c.execute("SELECT * FROM bill WHERE bill_key=?",
                         (f"{rc['congress']}{p[0]}{p[1]}",)).fetchone()
        if not bill or bill["is_broad"]:
            continue
        sectors = [r["sector"] for r in c.execute(
            "SELECT sector FROM bill_sector WHERE bill_key=?", (bill["bill_key"],))]
        if not sectors:
            continue

        rows = c.execute(f"""
          SELECT k.filer_cmte_id, co.cmte_name, ps.sector, k.iso_dt, k.amount, k.image_num
          FROM contribution k
          LEFT JOIN committee co ON co.cmte_id=k.filer_cmte_id AND co.cycle=k.cycle
          LEFT JOIN pac_sector ps ON ps.cmte_id=k.filer_cmte_id AND ps.cycle=k.cycle
          WHERE k.cand_id=? AND k.cycle=2026 AND {DIRECT} AND {CLEAN}
        """, (cid,)).fetchall()
        in_sector = [r for r in rows if r["sector"] in sectors]
        if not in_sector or sum(r["amount"] for r in in_sector) <= 0:
            continue

        vote_day = rc["iso_date"]
        prior = [r for r in in_sector if r["iso_dt"] and vote_day and r["iso_dt"] <= vote_day]
        if not prior:
            out.append({"vote_key": vk, "bioguide": m["bioguide"], "cycle": 2026,
                        "timing_date": None, "timing_same_day": False,
                        "timing_contributions": json.dumps([])})
            continue

        last_day = max(r["iso_dt"] for r in prior)
        on_that_day = [r for r in prior if r["iso_dt"] == last_day]
        gap = (date.fromisoformat(vote_day) - date.fromisoformat(last_day)).days

        out.append({
            "vote_key": vk, "bioguide": m["bioguide"], "cycle": 2026,
            "timing_date": last_day,
            "timing_same_day": gap == 0,
            "timing_contributions": json.dumps([{
                "cmte_id": r["filer_cmte_id"], "name": r["cmte_name"],
                "amount": r["amount"], "date": r["iso_dt"],
                "fec_url": f"https://www.fec.gov/data/committee/{r['filer_cmte_id']}/",
            } for r in sorted(on_that_day, key=lambda r: -r["amount"])]),
        })

Path("sql").mkdir(exist_ok=True)
Path("sql/11_timing.money_trail.json").write_text(json.dumps(out, separators=(",", ":")))
same = sum(1 for o in out if o["timing_same_day"])
multi = sum(1 for o in out if len(json.loads(o["timing_contributions"])) > 1)
print(f"trails: {len(out)}")
print(f"  same calendar date as the vote: {same}")
print(f"  timing date has more than one sector contribution: {multi}")
print(f"  no dated prior contribution: {sum(1 for o in out if not o['timing_date'])}")
