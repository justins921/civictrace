#!/usr/bin/env python3
"""Fetch House roll-call XML from the Clerk and Senate roll-call XML, store raw + parsed."""
import time, sqlite3, urllib.request, xml.etree.ElementTree as ET, os, sys
from pathlib import Path

UA = "CivicTrace/0.1 (nonpartisan public-records prototype; contact: justin.sobojinski@gmail.com)"
RAW = Path(__file__).parent / "data" / "votes_raw"
RAW.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(Path(__file__).parent / "civictrace.db")
c = con.cursor()
c.executescript("""
DROP TABLE IF EXISTS rollcall; DROP TABLE IF EXISTS vote_position;
CREATE TABLE rollcall (
  vote_key TEXT PRIMARY KEY, chamber TEXT, congress INTEGER, session TEXT,
  year INTEGER, rollnum INTEGER, legis_num TEXT, vote_question TEXT,
  vote_desc TEXT, vote_result TEXT, action_date TEXT, iso_date TEXT,
  yea INTEGER, nay INTEGER, present INTEGER, notvoting INTEGER, source_url TEXT
);
CREATE TABLE vote_position (
  vote_key TEXT, bioguide TEXT, name_raw TEXT, party TEXT, state TEXT, position TEXT
);
CREATE INDEX ix_vp_bio ON vote_position(bioguide);
CREATE INDEX ix_vp_key ON vote_position(vote_key);
""")


def get(url, cache):
    p = RAW / cache
    if p.exists() and p.stat().st_size > 0:
        return p.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        b = urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        print(f"  !! {url}: {e}"); return None
    p.write_bytes(b); time.sleep(0.7)
    return b


def txt(el, path, default=""):
    x = el.find(path)
    return (x.text or "").strip() if x is not None and x.text else default


MONTHS = dict(Jan="01", Feb="02", Mar="03", Apr="04", May="05", Jun="06",
              Jul="07", Aug="08", Sep="09", Oct="10", Nov="11", Dec="12")


def iso_house(d):  # "20-Apr-2026"
    try:
        dd, mm, yy = d.split("-")
        return f"{yy}-{MONTHS[mm]}-{int(dd):02d}"
    except Exception:
        return None


def house(year, lo, hi):
    n = 0
    for r in range(lo, hi + 1):
        b = get(f"https://clerk.house.gov/evs/{year}/roll{r:03d}.xml", f"h{year}_{r:03d}.xml")
        if not b: continue
        try: root = ET.fromstring(b)
        except ET.ParseError: continue
        md = root.find("vote-metadata")
        if md is None: continue
        key = f"H{year}-{r}"
        totals = md.find("vote-totals/totals-by-vote")
        def t(tag):
            try: return int(txt(totals, tag, "0") or 0)
            except Exception: return 0
        c.execute("INSERT OR REPLACE INTO rollcall VALUES (%s)" % ",".join("?" * 17), (
            key, "House", int(txt(md, "congress", "0") or 0), txt(md, "session"), year, r,
            txt(md, "legis-num"), txt(md, "vote-question"), txt(md, "vote-desc"),
            txt(md, "vote-result"), txt(md, "action-date"), iso_house(txt(md, "action-date")),
            t("yea-total"), t("nay-total"), t("present-total"), t("not-voting-total"),
            f"https://clerk.house.gov/evs/{year}/roll{r:03d}.xml"))
        for rv in root.iter("recorded-vote"):
            leg = rv.find("legislator")
            if leg is None: continue
            c.execute("INSERT INTO vote_position VALUES (?,?,?,?,?,?)", (
                key, leg.get("name-id"), (leg.text or "").strip(),
                leg.get("party"), leg.get("state"), txt(rv, "vote")))
        n += 1
    print(f"House {year}: {n} roll calls")


def senate(congress, session):
    b = get(f"https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml",
            f"smenu_{congress}_{session}.xml")
    if not b: return
    root = ET.fromstring(b)
    nums = [txt(v, "vote_number") for v in root.iter("vote")]
    n = 0
    for num in nums:
        if not num: continue
        vb = get(f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{int(num):05d}.xml",
                 f"s{congress}_{session}_{int(num):05d}.xml")
        if not vb: continue
        try: vr = ET.fromstring(vb)
        except ET.ParseError: continue
        key = f"S{congress}-{session}-{int(num)}"
        cnt = vr.find("count")
        def sc(tag):
            try: return int(txt(cnt, tag, "0") or 0)
            except Exception: return 0
        c.execute("INSERT OR REPLACE INTO rollcall VALUES (%s)" % ",".join("?" * 17), (
            key, "Senate", congress, str(session), int(txt(vr, "congress_year", "0") or 0), int(num),
            txt(vr, "document/document_name") or txt(vr, "amendment/amendment_number"),
            txt(vr, "question"), txt(vr, "vote_question_text") or txt(vr, "vote_title"),
            txt(vr, "vote_result"), txt(vr, "vote_date"), None,
            sc("yeas"), sc("nays"), sc("present"), sc("absent"),
            f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{int(num):05d}.xml"))
        for m in vr.iter("member"):
            c.execute("INSERT INTO vote_position VALUES (?,?,?,?,?,?)", (
                key, txt(m, "lis_member_id"), txt(m, "member_full"),
                txt(m, "party"), txt(m, "state"), txt(m, "vote_cast")))
        n += 1
    print(f"Senate {congress}-{session}: {n} roll calls")


if __name__ == "__main__":
    house(2026, 1, int(sys.argv[1]) if len(sys.argv) > 1 else 140)
    senate(119, 2)
    con.commit()
    print(c.execute("SELECT COUNT(*) FROM rollcall").fetchone(),
          c.execute("SELECT COUNT(*) FROM vote_position").fetchone())
    con.close()
