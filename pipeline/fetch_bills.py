#!/usr/bin/env python3
"""Pull GovInfo BILLSTATUS XML for every bill that appears in a stored roll call."""
import re, os, sys, json, time, collections, sqlite3, urllib.request, urllib.error, xml.etree.ElementTree as ET
from pathlib import Path

UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
RAW = Path(__file__).parent / "data" / "bills_raw"; RAW.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(Path(__file__).parent / "civictrace.db"); c = con.cursor()

DDL = """
DROP TABLE IF EXISTS bill;
DROP TABLE IF EXISTS bill_sponsor;
CREATE TABLE bill (
  bill_key TEXT PRIMARY KEY, congress INTEGER, bill_type TEXT, bill_num TEXT,
  title TEXT, policy_area TEXT, subjects TEXT, sponsor_name TEXT, sponsor_bioguide TEXT,
  sponsor_party TEXT, sponsor_state TEXT, intro_date TEXT, latest_action TEXT,
  latest_action_date TEXT, summary TEXT, source_url TEXT, congressgov_url TEXT,
  -- Set by load_earmarks.py, which decides what counts as an omnibus. It is
  -- declared here, where the table is created, because it is a column of this
  -- table. It used to be bolted on by an ALTER further down the pipeline, and
  -- fetch_member_bills.py — which runs before that — inserted a value for it.
  -- That worked on every developer machine, where the database persists between
  -- runs and already had the column, and failed on every clean build. CI has
  -- run against a fresh database since day one; this is why the 7 August
  -- refresh died.
  is_broad INTEGER DEFAULT 0
);

-- Sponsorship and cosponsorship, which this script downloaded and discarded for
-- months. A floor vote is whipped, scheduled by leadership, and usually decided
-- before it is cast; 87% of our trails come back "party-line" or
-- "near-unanimous" for that reason. Cosponsorship is none of those things — it
-- is voluntary, individually attributable, dated, and nobody is counting votes
-- on it. It is a better dependent variable than the one the site was built on,
-- and it was sitting in the same XML the whole time.
CREATE TABLE bill_sponsor (
  bill_key TEXT, bioguide TEXT, role TEXT,          -- 'sponsor' | 'cosponsor'
  sponsored_date TEXT, is_original INTEGER, withdrawn_date TEXT,
  full_name TEXT, party TEXT, state TEXT,
  PRIMARY KEY (bill_key, bioguide, role)
);
CREATE INDEX ix_bs_bio ON bill_sponsor(bioguide);
"""

# The House Clerk writes "H R 1234"; the Senate LIS writes "H.R. 1234" and
# "S.J.Res. 181". Normalising away spaces and periods lets one map serve both.
# Getting this wrong is why the Senate produced no trails at all until Aug 2026.
TYPES = {"HR": "hr", "S": "s", "HRES": "hres", "SRES": "sres",
         "HJRES": "hjres", "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres"}

# Above this share of the work list, "GovInfo is running late" stops being a
# credible explanation and something structural has changed.
ABSENT_TOLERANCE = 0.02


NOT_MODIFIED = object()
REVALIDATED = [0]


def fetch_with_retry(url, attempts=4, since=None):
    """Same reasoning as the vote fetcher: a transient network failure must not
    quietly become a missing bill.

    M17: `since` makes this a conditional request. GovInfo republishes
    BILLSTATUS as a bill moves — new actions, new cosponsors, a CRS summary that
    did not exist when we first fetched it. Downloading once and never asking
    again meant a bill page could sit on a summary that had since been written,
    or a cosponsor list from before half the cosponsors signed on."""
    last = None
    headers = {"User-Agent": UA}
    if since:
        headers["If-Modified-Since"] = time.strftime(
            "%a, %d %b %Y %H:%M:%S GMT", time.gmtime(since))
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=45).read()
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return NOT_MODIFIED
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

    n_sponsor = [0]
    unreachable = []   # our problem: transport errors, unparseable XML
    absent = []        # GovInfo's schedule: an authoritative 404
    done = 0
    for key, (congress, bt, bn) in sorted(wanted.items()):
        f = RAW / f"BILLSTATUS-{key}.xml"
        url = f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{bt}/BILLSTATUS-{key}.xml"
        try:
            body = fetch_with_retry(url, since=f.stat().st_mtime if f.exists() else None)
            if body is not NOT_MODIFIED:
                before = f.read_bytes() if f.exists() else None
                tmp = f.with_suffix(f.suffix + ".part")
                tmp.write_bytes(body)
                os.replace(tmp, f)
                if before is not None and before != body:
                    REVALIDATED[0] += 1
                time.sleep(0.4)
        except urllib.error.HTTPError as e:
            if f.exists():
                # We already hold a copy. A failed revalidation degrades the
                # freshness of one bill; it does not lose it, so the run goes on
                # with what we have rather than blocking on GovInfo's uptime.
                print(f"  .. could not revalidate {key} (HTTP {e.code}), using cached copy")
            elif e.code == 404:
                # GovInfo has no BILLSTATUS for this one. That is a fact about
                # their publishing schedule, not a break in our pipeline —
                # GovInfo routinely lags recently-passed bills by days. The
                # version before this said exactly that in a comment and then
                # exited 1 anyway, which would have blocked every refresh
                # indefinitely the first time a roll call cited a bill they had
                # not published yet.
                absent.append(key)
                continue
            else:
                unreachable.append(f"{key} (HTTP {e.code})")
                continue
        except Exception as e:
            if not f.exists():
                unreachable.append(f"{key} ({e})")
                continue
            print(f"  .. could not revalidate {key} ({e}), using cached copy")
        try: b = ET.parse(f).getroot().find("bill")
        except Exception as e:
            unreachable.append(f"{key} (unparseable XML: {e})"); continue
        if b is None:
            unreachable.append(f"{key} (XML has no <bill> element)"); continue
        sp = b.find("sponsors/item")
        sm = b.find("summaries/summary")

        # Sponsors first, then cosponsors. A withdrawn cosponsorship keeps its
        # row and its withdrawal date: a member who signed on and then backed
        # off is a fact about the record, and deleting it would be the kind of
        # quiet tidying this project exists to not do.
        people = []
        if sp is not None:
            people.append((sp, "sponsor", None, None))
        for x in b.findall("cosponsors/item"):
            people.append((x, "cosponsor",
                           1 if (x.findtext("isOriginalCosponsor") or "").strip().lower() == "true" else 0,
                           x.findtext("sponsorshipWithdrawnDate")))
        for el, role, orig, withdrawn in people:
            bio = (el.findtext("bioguideId") or "").strip()
            if not bio:
                continue
            c.execute("INSERT OR REPLACE INTO bill_sponsor VALUES (?,?,?,?,?,?,?,?,?)", (
                key, bio, role,
                (el.findtext("sponsorshipDate") or b.findtext("introducedDate")),
                orig, withdrawn,
                el.findtext("fullName"), el.findtext("party"), el.findtext("state")))
            n_sponsor[0] += 1
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
    print(f"  revalidated and changed since last run: {REVALIDATED[0]}")
    wi = {r[0] for r in c.execute("SELECT bioguide FROM member WHERE state='WI'")}
    wi_n = c.execute("SELECT COUNT(*) FROM bill_sponsor WHERE bioguide IN (%s)"
                     % ",".join("?" * len(wi)), tuple(wi)).fetchone()[0] if wi else 0
    print(f"sponsorship records: {n_sponsor[0]} total, {wi_n} by a Wisconsin member")
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
