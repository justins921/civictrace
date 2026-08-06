#!/usr/bin/env python3
"""Every bill a Wisconsin member sponsored or cosponsored — not just the ones that got a vote.

Why this exists
---------------
fetch_bills.py downloads BILLSTATUS for bills that appear in a stored roll call.
That is the right work list for money trails and the wrong one for
cosponsorship, and cosponsorship is the better question.

A floor vote is scheduled by leadership, whipped by the party, and usually
decided before it is cast — which is why 88% of our trails come back with no
signal, and why all three of our strongest ones turned out to be artifacts.
Cosponsoring is none of those things. It is voluntary, individually
attributable, dated to the day, and nobody is counting votes on it. A member
signs on to hundreds of bills that never reach the floor, and those are the
purest version of the signal precisely because nothing else explains them.

Working from roll-call bills only, we had 80 Wisconsin sponsorship records
across 209 bills. The whole 119th Congress is eight zip files and about 50 MB.

What this deliberately does not do
----------------------------------
It does not score anything. It does not build a cosponsorship trail, rank
members, or attach a label. We have just finished deleting three headline
findings that came from scoring a signal we had not looked at closely enough,
and the lesson from that is not "score a different signal immediately". Load the
record, publish it, read it. Scoring is a later decision made with the data in
front of us.
"""
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

BASE = Path(__file__).parent
RAW = BASE / "data" / "billstatus"
RAW.mkdir(parents=True, exist_ok=True)
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
CONGRESS = int(os.environ.get("CT_CONGRESS", "119"))
TYPES = ["hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres"]


def strip_html(s):
    import re
    return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ").strip()


def fetch_zip(bt):
    """Conditional download. These archives are republished daily and most days
    only a handful of bills inside them have moved."""
    dest = RAW / f"{CONGRESS}-{bt}.zip"
    url = (f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{CONGRESS}/{bt}/"
           f"BILLSTATUS-{CONGRESS}-{bt}.zip")
    headers = {"User-Agent": UA}
    if dest.exists():
        headers["If-Modified-Since"] = time.strftime(
            "%a, %d %b %Y %H:%M:%S GMT", time.gmtime(dest.stat().st_mtime))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=600) as r:
            body = r.read()
        tmp = dest.with_suffix(".zip.part")
        tmp.write_bytes(body)
        os.replace(tmp, dest)
        return dest, True
    except urllib.error.HTTPError as e:
        if e.code == 304 and dest.exists():
            return dest, False
        if dest.exists():
            print(f"  .. could not refresh {bt} (HTTP {e.code}), using cached copy", file=sys.stderr)
            return dest, False
        raise


def main():
    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()

    wi = {r[0] for r in c.execute("SELECT bioguide FROM member WHERE state='WI'")}
    if not wi:
        print("no Wisconsin roster loaded", file=sys.stderr)
        return 1

    # Whatever fetch_bills.py already stored stays. This adds to it.
    known = {r[0] for r in c.execute("SELECT bill_key FROM bill")}

    scanned = matched = added = links = 0
    for bt in TYPES:
        path, changed = fetch_zip(bt)
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if not name.endswith(".xml"):
                    continue
                scanned += 1
                try:
                    b = ET.fromstring(z.read(name)).find("bill")
                except Exception:
                    continue
                if b is None:
                    continue

                sp = b.find("sponsors/item")
                people = []
                if sp is not None:
                    people.append((sp, "sponsor", None, None))
                for x in b.findall("cosponsors/item"):
                    people.append((x, "cosponsor",
                                   1 if (x.findtext("isOriginalCosponsor") or "").strip().lower() == "true" else 0,
                                   x.findtext("sponsorshipWithdrawnDate")))

                mine = [p for p in people if (p[0].findtext("bioguideId") or "").strip() in wi]
                if not mine:
                    continue
                matched += 1

                num = (b.findtext("number") or "").strip()
                key = f"{CONGRESS}{bt}{num}"
                if key not in known:
                    sm = b.find("summaries/summary")
                    subs = sorted({s.findtext("name") for s in b.iter("legislativeSubject")
                                   if s.findtext("name")})
                    c.execute("INSERT OR REPLACE INTO bill VALUES (%s)" % ",".join("?" * 18), (
                        key, CONGRESS, bt, num, b.findtext("title"), b.findtext("policyArea/name"),
                        "; ".join(subs),
                        sp.findtext("fullName") if sp is not None else None,
                        sp.findtext("bioguideId") if sp is not None else None,
                        sp.findtext("party") if sp is not None else None,
                        sp.findtext("state") if sp is not None else None,
                        b.findtext("introducedDate"), b.findtext("latestAction/text"),
                        b.findtext("latestAction/actionDate"),
                        strip_html(sm.findtext("text")) if sm is not None else None,
                        (f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{CONGRESS}/{bt}/"
                         f"BILLSTATUS-{key}.xml"),
                        f"https://www.congress.gov/bill/{CONGRESS}th-congress/"
                        f"{'house-bill' if bt == 'hr' else 'senate-bill' if bt == 's' else bt}/{num}",
                        0,
                    ))
                    known.add(key)
                    added += 1

                for el, role, orig, withdrawn in mine:
                    c.execute("INSERT OR REPLACE INTO bill_sponsor VALUES (?,?,?,?,?,?,?,?,?)", (
                        key, (el.findtext("bioguideId") or "").strip(), role,
                        el.findtext("sponsorshipDate") or b.findtext("introducedDate"),
                        orig, withdrawn,
                        el.findtext("fullName"), el.findtext("party"), el.findtext("state")))
                    links += 1
        print(f"  {bt}: {'refreshed' if changed else 'cached'}")
    con.commit()

    print(f"\nscanned {scanned:,} bills in the {CONGRESS}th Congress")
    print(f"  touched by a Wisconsin member: {matched:,}")
    print(f"  bills newly added to the record: {added:,}")
    print(f"  sponsorship records: {links:,}")
    print("\nby member:")
    for name, role, n in c.execute("""
            SELECT m.full_name, bs.role, COUNT(*)
            FROM bill_sponsor bs JOIN member m ON m.bioguide = bs.bioguide
            GROUP BY 1,2 ORDER BY 1, 2 DESC"""):
        print(f"  {name:24} {role:10} {n:5}")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
