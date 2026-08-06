#!/usr/bin/env python3
"""CivicTrace daily refresh.

Runs unattended once a day. Rebuilds the whole dataset from the primary sources
and replaces the published tables in one pass, then records the outcome in
civictrace.data_run so the site footer can show when the data was last good —
and say so in red when it is not.

Design decisions worth knowing before you change this:

  * It is a full rebuild, not a diff. Roll-call XML, bill status and FEC bulk
    files are all amended after publication; an append-only updater silently
    keeps the superseded version. A rebuild is a few minutes of compute and it
    cannot drift.
  * Large source files are only re-downloaded when the server says they changed
    (If-Modified-Since). FEC bulk files move roughly weekly, so most days this
    step is a handful of HEAD requests.
  * Writes go through civictrace.ingest(), a token-gated function that can only
    touch the fact tables. This container never holds a service_role key.
  * Every stage is wrapped: on any failure the run is marked failed with the
    traceback, the previously published data is left alone, and the site says
    the refresh is stale rather than pretending otherwise.

Environment:
  SUPABASE_URL      https://<project>.supabase.co
  SUPABASE_ANON_KEY publishable key
  CT_INGEST_TOKEN   the write token (civictrace.set_ingest_token)
  CT_SOURCE         optional label for the run log, default "daily cron"
"""
import json, os, shutil, subprocess, sys, time, traceback, zipfile
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SQLD = HERE / "sql"
UA = "CivicTrace/1.0 (nonpartisan public-records project; justin.sobojinski@gmail.com)"

URL = os.environ.get("SUPABASE_URL", "https://vzvtlwfvncwwtzntndmy.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_ANON_KEY", "")
TOKEN = os.environ.get("CT_INGEST_TOKEN", "")
SOURCE = os.environ.get("CT_SOURCE", "daily cron")
# etl.py loads both cycles: the published one and the prior one, which the site
# keeps out of its aggregates but still shows on committee pages under its own
# heading. Downloading only the published cycle is what broke the first hosted
# run — the container I built this in still had the 2024 files lying around from
# an earlier manual extract, so the missing download never showed up locally.
CYCLE = int(os.environ.get("CT_CYCLE", "2026"))
CYCLES = sorted({int(c) for c in os.environ.get("CT_CYCLES", "2024,2026").split(",") if c.strip()}
                | {CYCLE})

# stem -> the file the loader actually opens inside the archive. Checking that
# the directory is merely non-empty is what let a bad extract through: the run
# failed three steps later with FileNotFoundError on cn24_x/cn.txt.
FEC_MEMBERS = {"cn": "cn.txt", "cm": "cm.txt", "ccl": "ccl.txt", "pas2": "itpas2.txt"}
FEC_STEMS = tuple(FEC_MEMBERS)
LEGIS = "https://unitedstates.github.io/congress-legislators/legislators-current.json"


def log(msg):
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


# ----------------------------------------------------------------- transport

def rpc(fn, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/rpc/{fn}", data=body, method="POST",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "Content-Profile": "civictrace"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                txt = r.read().decode() or "null"
                return json.loads(txt)
        except urllib.error.HTTPError as e:
            detail = e.read()[:500].decode(errors="replace")
            if e.code < 500 or attempt == 3:
                raise RuntimeError(f"{fn} -> {e.code} {detail}")
            time.sleep(2 ** attempt)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def fetch_if_changed(url, dest: Path, force=False):
    """Return True when dest was (re)written. 304 means we already had it."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": UA}
    if dest.exists() and not force:
        stamp = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(dest.stat().st_mtime))
        headers["If-Modified-Since"] = stamp
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=600) as r:
            # Write to a temp file and rename. A crash partway through a direct
            # write leaves a truncated archive carrying a *fresh* mtime, so the
            # next run's If-Modified-Since gets a 304 and the corruption becomes
            # permanent. os.replace is atomic on the same filesystem.
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(r.read())
            os.replace(tmp, dest)
            return True
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return False
        raise


# --------------------------------------------------------------- source pull

def pull_sources():
    got = {}
    got["legislators"] = fetch_if_changed(LEGIS, DATA / "legislators-current.json")
    missing = []
    for cyc in CYCLES:
        yy = str(cyc)[-2:]
        for stem in FEC_STEMS:
            name = f"{stem}{yy}"
            z = DATA / f"{name}.zip"
            changed = fetch_if_changed(
                f"https://www.fec.gov/files/bulk-downloads/{cyc}/{name}.zip", z)
            out = DATA / f"{name}_x"
            if changed or not out.exists():
                if out.exists():
                    shutil.rmtree(out)
                out.mkdir(parents=True)
                with zipfile.ZipFile(z) as zf:
                    zf.extractall(out)
            got[name] = changed
            # Assert the exact member the loader will open, not just that the
            # directory has something in it.
            want = out / FEC_MEMBERS[stem]
            if not want.exists() or want.stat().st_size == 0:
                # Re-extract once before giving up. The archive is only fetched
                # when it changes, so a damaged or hand-edited extract directory
                # would otherwise fail this assertion on every run forever, with
                # a perfectly good zip sitting next to it. Self-heal from the
                # archive we already have; only fail if the archive itself is
                # the problem.
                log(f"   {want.name} missing from {out.name}, re-extracting {z.name}")
                shutil.rmtree(out, ignore_errors=True)
                out.mkdir(parents=True)
                with zipfile.ZipFile(z) as zf:
                    zf.extractall(out)
            if not want.exists() or want.stat().st_size == 0:
                found = sorted(p.name for p in out.iterdir())[:6]
                missing.append(f"{want} (archive contains: {found or 'nothing'})")
    if missing:
        raise RuntimeError("FEC archive is missing the file the loader needs: "
                           + "; ".join(missing))
    log("sources: " + ", ".join(f"{k}={'new' if v else 'cached'}" for k, v in got.items()))
    return got


def run(step, *argv):
    log(f"→ {step}")
    r = subprocess.run([sys.executable, *argv], cwd=HERE, capture_output=True, text=True, timeout=5400)
    tail = (r.stdout or "").strip().splitlines()[-4:]
    for line in tail:
        log("   " + line)
    if r.returncode != 0:
        raise RuntimeError(f"{step} failed rc={r.returncode}: {(r.stderr or '')[-1200:]}")


# ---------------------------------------------------------------- publishing

# Order matters: parents before children, so a partial failure never leaves a
# child row pointing at a parent that no longer exists.
# (export stem, table, batch size, replace?)
# replace=False means upsert. Reference tables that foreign keys point at are
# upserted so a refresh never empties them; everything derived is replaced so a
# stale row cannot outlive the inputs it was computed from.
LOAD = [
    ("01_member.member",                 "member",             500, False),
    ("02_committee.committee",           "committee",          400, False),
    ("03_bill.bill",                     "bill",                40, False),
    ("05_rollcall.rollcall",             "rollcall",           180, False),
    ("04_bill_sector.bill_sector",       "bill_sector",        300, True),
    ("06_breakdown.rollcall_breakdown",  "rollcall_breakdown", 800, True),
    ("07_position.vote_position",        "vote_position",      800, True),
    ("08_support.pac_support",           "pac_support",        300, True),
    ("09_earmark.earmark",               "earmark",             60, True),
    ("09b_earmark_agg.earmark_agg",      "earmark_agg",         50, True),
    ("10_trail.money_trail",             "money_trail",         50, True),
]


def published_counts():
    """Row counts currently live, so a refresh can be compared against them."""
    out = {}
    for _, table, _, _ in LOAD:
        req = urllib.request.Request(
            f"{URL}/rest/v1/{table}?select=*&limit=1",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                     "Accept-Profile": "civictrace", "Prefer": "count=exact",
                     "Range": "0-0"})
        # A failed count is unknown, not zero. Defaulting to zero would silently
        # disable the guard below at exactly the moment the network is unreliable.
        with urllib.request.urlopen(req, timeout=60) as r:
            rng = r.headers.get("Content-Range", "")
            if "/" not in rng:
                raise RuntimeError(f"no row count returned for {table}")
            out[table] = int(rng.rsplit("/", 1)[-1])
    return out


def guard_against_shrink(before, rows_by_table, tolerance=0.05):
    """Refuse to publish a refresh that lost a material number of records.

    The roll-call and bill fetchers rebuild their tables from scratch, and the
    Senate's XML endpoint times out often enough that a bad network minute can
    quietly produce a smaller, complete-looking dataset. Publishing that would
    silently drop votes from the site with nothing to notice it by. A shrink
    beyond a few percent is treated as a failed source, not as news.
    """
    # A deliberate change to a classifier legitimately shrinks a derived table,
    # and that must not require turning the guard off. CT_ALLOW_SHRINK names the
    # tables it applies to and why, both are logged with the run, and it only
    # covers the tables named — everything else is still guarded on the same run.
    allowed, reason = set(), ""
    raw = os.environ.get("CT_ALLOW_SHRINK", "").strip()
    if raw:
        tables, _, reason = raw.partition(":")
        allowed = {t.strip() for t in tables.split(",") if t.strip()}
        if not reason.strip():
            raise RuntimeError("CT_ALLOW_SHRINK must be 'table[,table]: why', with a reason")

    shrunk, waived = [], []
    for table, n_new in rows_by_table.items():
        n_old = before.get(table, 0)
        if n_old and n_new < n_old * (1 - tolerance):
            msg = f"{table}: {n_old} published, refresh produced {n_new}"
            (waived if table in allowed else shrunk).append(msg)
    for w in waived:
        log(f"   shrink allowed — {w} — reason: {reason.strip()}")
    if shrunk:
        raise RuntimeError("refresh lost records, refusing to publish — " + "; ".join(shrunk))


def preflight():
    """Check the export before it becomes the site.

    check_reconciliation.py is a good gate aimed at the wrong moment: it queries
    the live API, so it can only ever tell you that the site is already wrong.
    Nothing here can roll back a bad publish, so the only place a gate does any
    good is in front of one. These are the breaks that are checkable without the
    API — dangling references and missing provenance — and every one of them
    would otherwise render as a page with a blank where a fact should be.
    """
    def load(stem):
        return json.loads((SQLD / f"{stem}.json").read_text())

    members = {r["bioguide"] for r in load("01_member.member")}
    bills = {r["bill_key"] for r in load("03_bill.bill")}
    rolls = {r["vote_key"] for r in load("05_rollcall.rollcall")}
    trails = load("10_trail.money_trail")
    timing = {(r["vote_key"], r["bioguide"], r["cycle"]) for r in load("11_timing.money_trail")}

    bad = []

    def check(name, offenders):
        n = len(offenders)
        log(f"   {'ok  ' if not n else 'FAIL'} {name}" + (f" — {n}, e.g. {offenders[:3]}" if n else ""))
        if n:
            bad.append(f"{name}: {n} (e.g. {offenders[:3]})")

    check("every bill_sector row names a bill we loaded",
          sorted({r["bill_key"] for r in load("04_bill_sector.bill_sector")} - bills))
    check("every vote_position row names a roll call we loaded",
          sorted({r["vote_key"] for r in load("07_position.vote_position")} - rolls))
    check("every trail names a roll call we loaded",
          sorted({t["vote_key"] for t in trails} - rolls))
    check("every trail names a member we loaded",
          sorted({t["bioguide"] for t in trails} - members))
    check("every trail carries timing provenance",
          sorted(str(k) for k in
                 {(t["vote_key"], t["bioguide"], t["cycle"]) for t in trails} - timing))

    # A roll call with no date breaks the timing block on every trail that cites
    # it, and it is the exact defect the Senate fetcher shipped for months.
    check("every roll call has an ISO date",
          sorted(r["vote_key"] for r in load("05_rollcall.rollcall") if not r.get("iso_date")))

    # The home page and /trails both print the label breakdown as a partition of
    # the trail total. If it stops being one, they print a breakdown that does
    # not add up to the number beside it — and the two pages already diverged
    # once on exactly this statistic.
    by_label = {}
    for t in trails:
        by_label[t["label"]] = by_label.get(t["label"], 0) + 1
    check("trail labels partition the trail total",
          [] if sum(by_label.values()) == len(trails)
          else [f"labels sum to {sum(by_label.values())} of {len(trails)}"])
    log(f"   labels: {by_label}")

    if bad:
        raise RuntimeError("pre-publish invariants broken, nothing was published — "
                           + "; ".join(bad))
    log(f"   preflight ok: {len(bills)} bills, {len(rolls)} roll calls, {len(trails)} trails")


def publish():
    """Replace every published table, parents first.

    Timing provenance is merged into the money_trail rows here rather than
    PATCHed afterwards. A PATCH pass would need UPDATE rights on the table for
    the API role, and it would leave a window where a trail is live without the
    provenance that qualifies its timing figure. Merging means a trail is never
    published without it.
    """
    timing = {}
    tf = SQLD / "11_timing.money_trail.json"
    if tf.exists():
        for r in json.loads(tf.read_text()):
            timing[(r["vote_key"], r["bioguide"], r["cycle"])] = {
                "timing_date": r["timing_date"],
                "timing_same_day": r["timing_same_day"],
                "timing_contributions": json.loads(r["timing_contributions"]),
            }

    before = published_counts()
    fresh = {table: len(json.loads((SQLD / f"{stem}.json").read_text()))
             for stem, table, _, _ in LOAD}
    guard_against_shrink(before, fresh)

    counts = {}
    for stem, table, batch, replace in LOAD:
        rows = json.loads((SQLD / f"{stem}.json").read_text())
        if table == "money_trail":
            missing = 0
            for r in rows:
                t = timing.get((r["vote_key"], r["bioguide"], r["cycle"]))
                if t is None:
                    missing += 1
                else:
                    r.update(t)
            if missing:
                raise RuntimeError(f"{missing} trails have no timing provenance — refusing to publish")
        total = 0
        for i in range(0, len(rows), batch):
            total += rpc("ingest", {"p_token": TOKEN, "p_table": table,
                                    "p_rows": rows[i:i + batch],
                                    "p_replace": replace and i == 0}) or 0
        counts[table] = total
        log(f"   {table}: {total} rows")
    return counts


# --------------------------------------------------------------------- main

def main():
    if not (KEY and TOKEN):
        print("SUPABASE_ANON_KEY and CT_INGEST_TOKEN must be set", file=sys.stderr)
        return 2
    run_id = rpc("run_start", {"p_token": TOKEN, "p_source": SOURCE})
    log(f"run {run_id} started")
    t0 = time.time()
    try:
        pull_sources()
        run("FEC + legislators -> SQLite", "etl.py")
        run("roll calls", "fetch_votes.py")
        run("bills", "fetch_bills.py")
        # sectors.py before load_earmarks.py, not after. load_earmarks reads
        # bill_sector to decide which bills are too broad to score, and sectors.py
        # DROPs and rebuilds bill_sector — so in the old order `is_broad` was
        # always computed from the previous run's classification, and on a clean
        # database it was computed from nothing at all.
        run("classification", "sectors.py")
        run("earmarks", "load_earmarks.py")
        run("export", "export_json.py")
        run("timing provenance", "timing.py")
        # Gate BEFORE the swap, against the SQLite build, not after it against
        # the live API. The old order published first and checked second, while
        # the comment here claimed a failure left the previous data up. It did
        # not: by the time the check ran, the bad numbers were already the site.
        preflight()
        counts = publish()
        # Second gate, now against what the API actually returns. This one cannot
        # roll anything back — it catches a load that silently dropped rows, and
        # a failure here marks the run failed so the footer stops claiming the
        # data is fresh. Say plainly what it does and does not do.
        run("aggregation invariants (post-publish)", "check_reconciliation.py")
        counts["seconds"] = round(time.time() - t0)
        rpc("run_finish", {"p_token": TOKEN, "p_id": run_id, "p_status": "ok",
                           "p_counts": counts, "p_note": "full rebuild from primary sources",
                           "p_error": None})
        log(f"run {run_id} ok in {counts['seconds']}s")
        return 0
    except Exception:
        err = traceback.format_exc()[-3000:]
        log("FAILED\n" + err)
        try:
            rpc("run_finish", {"p_token": TOKEN, "p_id": run_id, "p_status": "failed",
                               "p_counts": {"seconds": round(time.time() - t0)},
                               "p_note": None, "p_error": err})
        except Exception:
            log("could not record the failure — the site will show the refresh as stale")
        return 1


if __name__ == "__main__":
    sys.exit(main())
