#!/usr/bin/env python3
"""Fetch House roll-call XML from the Clerk and Senate roll-call XML, store raw + parsed."""
import time, sqlite3, urllib.request, urllib.error, xml.etree.ElementTree as ET, os, sys
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


MISSES = []      # every URL we could not fetch, so the caller can refuse to publish

# `get` has three outcomes and the caller has to be able to tell them apart.
# Collapsing "the Clerk has no roll 284 because the House has not held it" into
# the same None as "the Clerk timed out four times" is what would let the House
# walk below stop early on an outage and publish a truncated vote record.
ABSENT = object()      # authoritative 404 — this roll call does not exist
FAILED = object()      # we could not reach it; already recorded in MISSES


REVALIDATED = [0]     # how many cached files the server told us to replace


def get(url, cache, attempts=4):
    """Fetch with retries and revalidation. Returns bytes, ABSENT (404), or FAILED.

    The Senate's XML endpoint drops TLS handshakes often enough that a single
    attempt loses a handful of roll calls per run. Three missing votes out of 356
    is under any sane shrink threshold, so it would have published quietly with
    holes in the vote record — the worst possible failure for this site. Retry,
    then fail loudly rather than silently serve less than we had yesterday.

    M17. This used to return the cached bytes the moment the file existed, and
    never ask again. The Clerk and the Senate both amend published roll calls —
    corrected vote positions, corrected totals, corrected bill numbers — so a
    file downloaded once was frozen at whatever it said that day, permanently,
    with no way to notice. The docstring at the top of daily_update.py claims
    this pipeline is "a full rebuild, not a diff" precisely because sources get
    amended after publication, and this function was quietly making that untrue.

    Every cached file is now revalidated with a conditional request. A 304 is
    the common case, costs one round trip and no body, and takes no rate-limit
    sleep — the sleep is for downloads, and a 304 is not one.
    """
    p = RAW / cache
    cached = p.read_bytes() if p.exists() and p.stat().st_size > 0 else None

    headers = {"User-Agent": UA}
    if cached is not None:
        headers["If-Modified-Since"] = time.strftime(
            "%a, %d %b %Y %H:%M:%S GMT", time.gmtime(p.stat().st_mtime))

    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=headers)
            b = urllib.request.urlopen(req, timeout=45).read()
            # Write through a temp file: a half-written XML with a fresh mtime
            # would revalidate as current forever. Same trap as the FEC archives.
            tmp = p.with_suffix(p.suffix + ".part")
            tmp.write_bytes(b)
            os.replace(tmp, p)
            if cached is not None and b != cached:
                REVALIDATED[0] += 1
            time.sleep(0.7)
            return b
        except urllib.error.HTTPError as e:
            if e.code == 304:                 # unchanged since we stored it
                return cached
            if e.code == 404:                 # genuinely not there; not an outage
                return ABSENT
            last = e
        except Exception as e:
            last = e
        if attempt < attempts - 1:
            time.sleep(1.5 * (2 ** attempt))  # 1.5s, 3s, 6s

    # Falling back to a stale copy beats losing the roll call, but only if the
    # run says so — a silent fallback is how "we have every vote" becomes false.
    if cached is not None:
        print(f"  !! could not revalidate, using cached copy: {url}: {last}")
        MISSES.append(f"{url} (served stale)")
        return cached
    print(f"  !! gave up after {attempts} attempts: {url}: {last}")
    MISSES.append(url)
    return FAILED


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


FULL_MONTHS = {"january": "01", "february": "02", "march": "03", "april": "04",
               "may": "05", "june": "06", "july": "07", "august": "08",
               "september": "09", "october": "10", "november": "11", "december": "12"}


def iso_senate(d):
    """"August 5, 2026,  11:40 AM" -> "2026-08-05".

    This function is the whole reason it exists: the Senate branch used to store
    a literal None here, and every Senate roll call shipped with a null date.
    Production only looks right because the column was patched by hand once, in
    SQL, outside this pipeline — so the next refresh would have wiped it again
    and taken every Senate trail's timing block with it. Nothing about the data
    is allowed to depend on a repair no script performs.
    """
    if not d: return None
    parts = d.replace(",", " ").split()
    if len(parts) < 3: return None
    mm = FULL_MONTHS.get(parts[0].strip().lower())
    if not mm: return None
    try:
        return f"{int(parts[2]):04d}-{mm}-{int(parts[1]):02d}"
    except Exception:
        return None


RUN_OUT = 15     # consecutive authoritative 404s that mean "the House stopped here"
CEILING = 2000   # runaway guard only; the House has never come close in one year


def house(year, lo=1, hi=None):
    """Walk the Clerk's roll calls until the record actually ends.

    This used to stop at a hardcoded 140. The House held 283 roll calls in 2026,
    so the site was publishing 140 of them and reporting success — half the
    House vote record simply absent, with nothing anywhere saying so. A cap
    written as a convenience during the prototype became a silent data loss the
    moment the House kept voting.

    The stop condition is now the Clerk's own 404s, and only 404s: `RUN_OUT` of
    them in a row. A transient failure is never a stop signal — it goes in
    MISSES and the run refuses to publish at the end.
    """
    n = 0
    misses_at_start = len(MISSES)
    consecutive_absent = 0
    highest = 0
    r = lo - 1
    while True:
        r += 1
        if hi is not None and r > hi: break
        if r > CEILING:
            raise RuntimeError(f"House {year}: walked past roll {CEILING} without "
                               f"{RUN_OUT} consecutive 404s — the Clerk's URL scheme "
                               f"probably changed; refusing to guess")
        b = get(f"https://clerk.house.gov/evs/{year}/roll{r:03d}.xml", f"h{year}_{r:03d}.xml")
        if b is ABSENT:
            consecutive_absent += 1
            if hi is None and consecutive_absent >= RUN_OUT: break
            continue
        if b is FAILED:
            # Do not let an outage end the walk. Keep going; the non-zero exit
            # at the bottom of this file stops the publish.
            consecutive_absent = 0
            continue
        consecutive_absent = 0
        highest = r
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
    lost = len(MISSES) - misses_at_start
    print(f"House {year}: {n} roll calls, highest roll {highest}"
          + (f", {lost} UNREACHABLE" if lost else ""))


def senate(congress, session):
    b = get(f"https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml",
            f"smenu_{congress}_{session}.xml")
    if not isinstance(b, bytes): return
    root = ET.fromstring(b)
    nums = [txt(v, "vote_number") for v in root.iter("vote")]
    n = 0
    for num in nums:
        if not num: continue
        vb = get(f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{int(num):05d}.xml",
                 f"s{congress}_{session}_{int(num):05d}.xml")
        if not isinstance(vb, bytes): continue
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
            txt(vr, "vote_result"), txt(vr, "vote_date"), iso_senate(txt(vr, "vote_date")),
            sc("yeas"), sc("nays"), sc("present"), sc("absent"),
            f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{int(num):05d}.xml"))
        for m in vr.iter("member"):
            c.execute("INSERT INTO vote_position VALUES (?,?,?,?,?,?)", (
                key, txt(m, "lis_member_id"), txt(m, "member_full"),
                txt(m, "party"), txt(m, "state"), txt(m, "vote_cast")))
        n += 1
    print(f"Senate {congress}-{session}: {n} roll calls")


if __name__ == "__main__":
    house(2026, 1, int(sys.argv[1]) if len(sys.argv) > 1 else None)
    senate(119, 2)
    con.commit()
    print(c.execute("SELECT COUNT(*) FROM rollcall").fetchone(),
          c.execute("SELECT COUNT(*) FROM vote_position").fetchone())
    print(f"revalidated and changed since last run: {REVALIDATED[0]}")
    con.close()
    if MISSES:
        # Exit non-zero so the refresh aborts before publishing. A vote record
        # with holes in it is worse than yesterday's complete one.
        print(f"\n{len(MISSES)} roll call(s) could not be fetched:", file=sys.stderr)
        for u in MISSES[:10]:
            print("  " + u, file=sys.stderr)
        sys.exit(1)
