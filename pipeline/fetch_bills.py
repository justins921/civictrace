#!/usr/bin/env python3
"""Pull GovInfo BILLSTATUS XML for every bill that appears in a stored roll call."""
import re, time, sqlite3, urllib.request, urllib.error, xml.etree.ElementTree as ET
from pathlib import Path

UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
RAW = Path(__file__).parent / "data" / "bills_raw"; RAW.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(Path(__file__).parent / "civictrace.db"); c = con.cursor()

DDL = """
DROP TABLE IF EXISTS bill;
CREATE TABLE bill (
  bill_key TEXT PRIMARY KEY, congress INTEGER, bill_type TEXT, bill_num TEXT,
  title TEXT, policy_area TEXT, subjects TEXT, sponsor_name TEXT, sponsor_bioguide TEXT,
  sponsor_party TEXT, sponsor_state TEXT, intro_date TEXT, latest_action TEXT,
  latest_action_date TEXT, summary TEXT, source_url TEXT, congressgov_url TEXT
);
"""

# The House Clerk writes "H R 1234"; the Senate LIS writes "H.R. 1234" and
# "S.J.Res. 181". Normalising away spaces and periods lets one map serve both.
# Getting this wrong is why the Senate produced no trails at all until Aug 2026.
TYPES = {"HR": "hr", "S": "s", "HRES": "hres", "SRES": "sres",
         "HJRES": "hjres", "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres"}


def fetch_with_retry(url, attempts=4):
    """Same reasoning as the vote fetcher: a transient network failure must not
    quietly become a missing bill."""
    last = None
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": UA}), timeout=45).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:
            last = e
        if attempt < attempts - 1:
            time.sleep(1.5 * (2 ** attempt))
    raise last


def parse_legis(num):
    s = (num or "").strip().upper()
    if s.startswith("PN"):
        return None                      # a nomination is not a bill
    m = re.match(r"^([A-Z. ]+?)\s*(\d+)$", s)
    if not m: return None
    t = TYPES.get(re.sub(r"[. ]", "", m.group(1)))
    return (t, m.group(2)) if t else None


def strip_html(s):
    return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ").strip()


def main():
    c.executescript(DDL)
    rows = c.execute("SELECT DISTINCT congress, legis_num FROM rollcall WHERE legis_num<>''").fetchall()
    done = 0
    for congress, legis in rows:
        p = parse_legis(legis)
        if not p or not congress: continue
        bt, bn = p
        key = f"{congress}{bt}{bn}"
        f = RAW / f"BILLSTATUS-{key}.xml"
        url = f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{bt}/BILLSTATUS-{key}.xml"
        if not f.exists():
            try:
                f.write_bytes(fetch_with_retry(url))
                time.sleep(0.4)
            except Exception as e:
                print("  !!", key, e); continue
        try: b = ET.parse(f).getroot().find("bill")
        except Exception: continue
        if b is None: continue
        sp = b.find("sponsors/item")
        sm = b.find("summaries/summary")
        subs = sorted({s.findtext("name") for s in b.iter("legislativeSubject") if s.findtext("name")})
        c.execute("INSERT OR REPLACE INTO bill VALUES (%s)" % ",".join("?" * 17), (
            key, congress, bt, bn, b.findtext("title"), b.findtext("policyArea/name"),
            "; ".join(subs), sp.findtext("fullName") if sp is not None else None,
            sp.findtext("bioguideId") if sp is not None else None,
            sp.findtext("party") if sp is not None else None,
            sp.findtext("state") if sp is not None else None,
            b.findtext("introducedDate"), b.findtext("latestAction/text"),
            b.findtext("latestAction/actionDate"),
            strip_html(sm.findtext("text")) if sm is not None else None, url,
            f"https://www.congress.gov/bill/{congress}th-congress/"
            f"{'house-bill' if bt=='hr' else 'senate-bill' if bt=='s' else bt}/{bn}"))
        done += 1
    con.commit()
    print(f"bills stored: {done} / {len(rows)}")
    for r in c.execute("SELECT policy_area, COUNT(*) FROM bill GROUP BY 1 ORDER BY 2 DESC LIMIT 15"):
        print(r)
    con.close()


if __name__ == '__main__':
    main()
