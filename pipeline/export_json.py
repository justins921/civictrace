#!/usr/bin/env python3
"""Export the SQLite prototype to Postgres SQL for Supabase.

Two deliberate reductions, both of which are the right production shape anyway:

1. Contributions are aggregated to (candidate, committee, cycle) with the
   individual payments kept in a compact JSONB array. Every payment still keeps
   its FEC image number, so every dollar still deep-links to the filed report —
   we lose nothing that a reader can see, and drop 19,806 rows to ~1,800.

2. Base rates ship precomputed in rollcall_breakdown rather than shipping all
   81,994 national vote positions. The site needs the ratio, not the roster.
"""
import json, math
from pathlib import Path
from trail import build_trail, alignment_label, conn
from build_site import cand_for

OUT = Path(__file__).parent / "sql"
for f in OUT.glob("*.sql"): f.unlink()
OUT.mkdir(exist_ok=True)
c = conn()

WI = [dict(r) for r in c.execute("SELECT * FROM member WHERE state='WI'")]
CAND = {m["bioguide"]: cand_for(c, c.execute("SELECT * FROM member WHERE bioguide=?",
        (m["bioguide"],)).fetchone()) for m in WI}
CANDS = tuple(v for v in CAND.values() if v)
CASTSET = ("Yea", "Nay", "Aye", "No", "Yes")


def q(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return "NULL" if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else repr(v)
    return "'" + str(v).replace("'", "''") + "'"


FILES = []
JSONCOLS = {"external_ids", "payments", "sectors", "top_pacs"}
def dump(name, table, rows, cols, per=400):
    out = []
    for r in rows:
        d = {}
        for k in cols:
            v = r.get(k)
            if k in JSONCOLS and isinstance(v, str):
                v = json.loads(v)
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                v = None
            d[k] = v
        out.append(d)
    p = OUT / f"{name}.{table}.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    FILES.append(p)
    print(f"{table}: {len(rows)} rows -> {p.stat().st_size/1024:.0f} KB")


members = [{
    "bioguide": m["bioguide"], "full_name": m["full_name"], "first_name": m["first"],
    "last_name": m["last"], "chamber": m["chamber"], "state": m["state"],
    "district": m["district"] or None, "party": m["party"],
    "term_start": m["term_start"], "term_end": m["term_end"],
    "official_url": m["url"], "phone": m["phone"], "fec_cand_id": CAND[m["bioguide"]],
    "slug": (m["full_name"].lower().replace(" ", "-").replace(".", "").replace("'", "")),
    "external_ids": json.dumps({"fec": json.loads(m["fec_ids"] or "[]"), "lis": m["lis"],
                                "opensecrets": m["opensecrets"], "govtrack": m["govtrack"]}),
} for m in WI]

ph = ",".join("?" * len(CANDS))
cmtes = [dict(r) for r in c.execute(f"""
  SELECT DISTINCT co.cmte_id, co.cycle, co.cmte_name, co.cmte_tp, co.cmte_dsgn,
         co.org_tp, co.connected_org, ps.sector, ps.interest_side, ps.rule_id
  FROM contribution k
  JOIN committee co ON co.cmte_id=k.filer_cmte_id AND co.cycle=k.cycle
  LEFT JOIN pac_sector ps ON ps.cmte_id=k.filer_cmte_id AND ps.cycle=k.cycle
  WHERE k.cand_id IN ({ph}) AND k.transaction_tp='24K'
    AND (k.memo_cd IS NULL OR k.memo_cd<>'X')""", CANDS)]
for x in cmtes:
    x["fec_url"] = f"https://www.fec.gov/data/committee/{x['cmte_id']}/"

# ---- aggregated PAC support, payments retained inline so sourcing survives ----
support = {}
for r in c.execute(f"""SELECT filer_cmte_id, cand_id, cycle, iso_dt, amount, image_num, sub_id
    FROM contribution WHERE cand_id IN ({ph}) AND transaction_tp='24K'
      AND (memo_cd IS NULL OR memo_cd<>'X') ORDER BY iso_dt""", CANDS):
    k = (r["filer_cmte_id"], r["cand_id"], r["cycle"])
    d = support.setdefault(k, {"filer_cmte_id": r["filer_cmte_id"], "cand_id": r["cand_id"],
                               "cycle": r["cycle"], "n_payments": 0, "total": 0.0,
                               "first_date": None, "last_date": None, "_p": []})
    d["n_payments"] += 1; d["total"] += r["amount"]
    if r["iso_dt"]:
        d["first_date"] = d["first_date"] or r["iso_dt"]; d["last_date"] = r["iso_dt"]
    d["_p"].append({"d": r["iso_dt"], "a": r["amount"], "i": r["image_num"]})
for d in support.values():
    d["total"] = round(d["total"], 2)
    d["payments"] = json.dumps(d.pop("_p"))

rcs = [dict(r) for r in c.execute("SELECT * FROM rollcall")]
breakdown = [{"vote_key": r["vote_key"], "party": r["party"], "position": r["position"],
              "n": r["n"], "is_cast": r["position"] in CASTSET}
             for r in c.execute("SELECT vote_key,party,position,COUNT(*) n FROM vote_position GROUP BY 1,2,3")]
wipos = [{"vote_key": r["vote_key"], "bioguide": r["bioguide"], "party": r["party"],
          "state": r["state"], "position": r["position"], "is_cast": r["position"] in CASTSET}
         for r in c.execute("SELECT * FROM vote_position WHERE bioguide IN (%s)"
                            % ",".join("?" * len(WI)), tuple(m["bioguide"] for m in WI))]

bills = [dict(r) for r in c.execute("SELECT * FROM bill")]
for b in bills:
    if b["summary"]: b["summary"] = b["summary"][:1800]
bsec = [dict(r) for r in c.execute("SELECT * FROM bill_sector")]

ears = [dict(r) for r in c.execute("""SELECT fiscal_year,last AS last_name,first AS first_name,
    member_name,district,state,party,subcommittee,recipient,project,amount,member_url,bioguide,source_url
    FROM earmark WHERE state='WI'""")]
ear_agg = ([{"scope": "party", "key": r[0], "n": r[1], "total": r[2]} for r in c.execute(
              "SELECT party,COUNT(*),ROUND(SUM(amount)) FROM earmark GROUP BY 1")]
         + [{"scope": "national", "key": "ALL", "n": r[0], "total": r[1]} for r in c.execute(
              "SELECT COUNT(*),ROUND(SUM(amount)) FROM earmark")]
         + [{"scope": "top_member", "key": f"{r[0]} ({r[2]}-{r[1]})", "n": None, "total": r[3]}
            for r in c.execute("""SELECT member_name,district,party,ROUND(SUM(amount)) t FROM earmark
                                  GROUP BY 1 ORDER BY t DESC LIMIT 10""")])

trails = []
for m in WI:
    cid = CAND[m["bioguide"]]
    for vk in [x["vote_key"] for x in c.execute(
            "SELECT DISTINCT vote_key FROM vote_position WHERE bioguide=?", (m["bioguide"],))]:
        t = build_trail(vk, m["bioguide"], cid, 2026)
        if not t or not t["sectors"] or t["money"]["sector_dollars"] <= 0: continue
        lab, why = alignment_label(t)
        trails.append({
            "vote_key": vk, "bioguide": m["bioguide"], "cycle": 2026,
            "bill_key": t["bill"].get("bill_key"), "label": lab, "label_why": why,
            "sectors": json.dumps([dict(s) for s in t["sectors"]]),
            "top_pacs": json.dumps([{k2: p[k2] for k2 in ("cmte_id","name","sector","side","rule_id","total","fec_url")}
                                    for p in t["money"]["pacs"][:8]]),
            "sector_dollars": t["money"]["sector_dollars"],
            "sector_share_pct": t["money"]["sector_share_pct"],
            "total_pac_dollars": t["money"]["total_pac_dollars"],
            "aligned_side_dollars": t["money"]["aligned_side_dollars"],
            "opposed_side_dollars": t["money"]["opposed_side_dollars"],
            "pac_count": t["money"]["pac_count"],
            "days_since_last_sector_contribution": t["money"]["days_since_last_sector_contribution"],
            "party_line_share_pct": t["context"]["party_line_share_pct"],
            "minority_share_pct": t["context"]["minority_share_pct"],
            "voted_with_chamber": t["context"]["voted_with_n_of_chamber"],
            "voted_with_party": t["context"]["voted_with_own_party"],
            "position": t["vote"]["position"],
        })
ORDER = {"Notable overlap": 0, "Some overlap": 1, "Party-line vote — low signal": 2,
         "Near-unanimous vote — no signal": 3}
trails.sort(key=lambda t: (ORDER.get(t["label"], 9), -t["sector_dollars"]))
for i, t in enumerate(trails): t["rank"] = i

dump("01_member", "member", members, ["bioguide","full_name","first_name","last_name","chamber",
     "state","district","party","term_start","term_end","official_url","phone","fec_cand_id","slug","external_ids"])
dump("02_committee", "committee", cmtes, ["cmte_id","cycle","cmte_name","cmte_tp","cmte_dsgn",
     "org_tp","connected_org","sector","interest_side","rule_id","fec_url"], per=450)
dump("03_bill", "bill", bills, ["bill_key","congress","bill_type","bill_num","title","policy_area",
     "subjects","sponsor_name","sponsor_bioguide","sponsor_party","sponsor_state","intro_date",
     "latest_action","latest_action_date","summary","source_url","congressgov_url","is_broad"], per=25)
dump("04_bill_sector", "bill_sector", bsec, ["bill_key","sector","evidence"], per=300)
dump("05_rollcall", "rollcall", rcs, ["vote_key","chamber","congress","session","year","rollnum",
     "legis_num","vote_question","vote_desc","vote_result","action_date","iso_date","yea","nay",
     "present","notvoting","source_url"], per=180)
dump("06_breakdown", "rollcall_breakdown", breakdown, ["vote_key","party","position","n","is_cast"], per=900)
dump("07_position", "vote_position", wipos, ["vote_key","bioguide","party","state","position","is_cast"], per=900)
dump("08_support", "pac_support", list(support.values()), ["filer_cmte_id","cand_id","cycle",
     "n_payments","total","first_date","last_date","payments"], per=350)
dump("09_earmark", "earmark", ears, ["fiscal_year","last_name","first_name","member_name","district",
     "state","party","subcommittee","recipient","project","amount","member_url","bioguide","source_url"], per=60)
dump("09b_earmark_agg", "earmark_agg", ear_agg, ["scope","key","n","total"], per=50)
dump("10_trail", "money_trail", trails, ["vote_key","bioguide","cycle","bill_key","label","label_why",
     "sectors","top_pacs","sector_dollars","sector_share_pct","total_pac_dollars","aligned_side_dollars",
     "opposed_side_dollars","pac_count","days_since_last_sector_contribution","party_line_share_pct",
     "minority_share_pct","voted_with_chamber","voted_with_party","position","rank"], per=90)

tot = sum(p.stat().st_size for p in FILES)
print(f"\n{len(FILES)} files, {tot/1024:.0f} KB total")
(OUT / "MANIFEST.txt").write_text("\n".join(sorted(p.name for p in FILES)))
