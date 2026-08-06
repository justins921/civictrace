#!/usr/bin/env python3
"""Pull GovInfo BILLSTATUS XML for every bill that appears in a stored roll call."""
import re, sys, json, time, collections, sqlite3, urllib.request, urllib.error, xml.etree.ElementTree as ET
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

# Above this share of the work list, "GovInfo is running late" stops being a
# credible explanation and something structural has changed.
ABSENT_TOLERANCE = 0.02


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

    # Split the work list before touching the network, because the old summary
    # line ("bills stored: 131 / 234") invited exactly one wrong reading and an
    # outside reviewer made it: that 103 bills had failed to download. They had
    # not. Most of the gap was nominations and amendments — roll calls that are
    # not bills and never will be — and the rest was the same bill spelled two
    # ways ("H R 1" and "H.R. 1") collapsing to one key. Report the three
    # populations separately so nobody has to guess again.
    wanted, skipped = {}, []
    for congress, legis in rows:
        p = parse_legis(legis)
        if not p or not congress:
            skipped.append(legis); continue
        wanted[f"{congress}{p[0]}{p[1]}"] = (congress, p[0], p[1])

    unreachable = []   # our problem: transport errors, unparseable XML
    absent = []        # GovInfo's schedule: an authoritative 404
    done = 0
    for key, (congress, bt, bn) in sorted(wanted.items()):
        f = RAW / f"BILLSTATUS-{key}.xml"
        url = f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{bt}/BILLSTATUS-{key}.xml"
        if not f.exists():
            try:
                f.write_bytes(fetch_with_retry(url))
                time.sleep(0.4)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    # GovInfo has no BILLSTATUS for this one. That is a fact
                    # about their publishing schedule, not a break in our
                    # pipeline — GovInfo routinely lags recently-passed bills by
                    # days. The previous version said exactly this in a comment
                    # and then exited 1 anyway, which would have blocked every
                    # refresh indefinitely, with no override, the first time a
                    # roll call cited a bill they had not published yet.
                    absent.append(key)
                else:
                    unreachable.append(f"{key} (HTTP {e.code})")
                continue
            except Exception as e:
                unreachable.append(f"{key} ({e})"); continue
        try: b = ET.parse(f).getroot().find("bill")
        except Exception as e:
            unreachable.append(f"{key} (unparseable XML: {e})"); continue
        if b is None:
            unreachable.append(f"{key} (XML has no <bill> element)"); continue
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
    kinds = collections.Counter(
        "nomination" if (s or "").upper().startswith("PN")
        else "amendment" if "AMDT" in (s or "").upper()
        else "procedural" for s in skipped)
    print(f"bills stored: {done} of {len(wanted)} distinct bills referenced by a roll call")
    print(f"  not bills at all: {len(skipped)} roll-call subjects "
          f"({', '.join(f'{v} {k}' for k, v in kinds.most_common())})")
    for r in c.execute("SELECT policy_area, COUNT(*) FROM bill GROUP BY 1 ORDER BY 2 DESC LIMIT 15"):
        print(r)
    con.close()

    # Two populations, two rules.
    #
    # A bill we could not *fetch* is our problem: the page would render with no
    # title, no summary and no sponsor, so the run stops. A bill GovInfo has not
    # *published* is theirs, and blocking the whole refresh on their release
    # schedule would leave a stale site behind a footer that says nothing is
    # wrong — the failure mode this gate exists to prevent, arrived at from the
    # other direction. Those are recorded and the run continues, but only up to
    # a threshold: past ABSENT_TOLERANCE something has changed at GovInfo and
    # "a few bills are pending" is no longer the right explanation.
    if absent:
        (Path(__file__).parent / "data" / "known_gaps.json").write_text(
            json.dumps({"missing_billstatus": sorted(absent)}, indent=1))
        print(f"\n{len(absent)} bill(s) have no BILLSTATUS published by GovInfo yet "
              f"({100 * len(absent) / max(1, len(wanted)):.1f}% of the work list). "
              f"Recorded in data/known_gaps.json; the refresh continues.")
        for a in sorted(absent)[:10]:
            print("  - " + a)

    share = len(absent) / max(1, len(wanted))
    if share > ABSENT_TOLERANCE:
        print(f"\n{len(absent)} of {len(wanted)} bills ({share:.0%}) have no BILLSTATUS. "
              f"That is past the {ABSENT_TOLERANCE:.0%} threshold — this looks like a change "
              f"at GovInfo, not a publishing lag. Refusing to publish.", file=sys.stderr)
        sys.exit(1)

    if unreachable:
        print(f"\n{len(unreachable)} bill(s) could not be loaded:", file=sys.stderr)
        for u in unreachable:
            print("  - " + u, file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
