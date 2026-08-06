#!/usr/bin/env python3
"""Aggregation-invariant check. Exits non-zero when any published total disagrees.

This is the deploy gate an outside review asked for after finding that the same
cycle's money was reported as $14,360,458 on one page and $5,462,903 on another.
The rule it enforces is simple and absolute: if a figure appears on two pages, it
comes from the same row, and every route to the grand total must land on the same
number.

Run it after every data refresh and before every deploy:

    python check_reconciliation.py

Environment: SUPABASE_URL, SUPABASE_ANON_KEY (read-only; no write token needed).
"""
import json, os, sys, urllib.error, urllib.parse, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://vzvtlwfvncwwtzntndmy.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_ANON_KEY",
                     "sb_publishable_962AMHB-5EccIqag-UyHEQ_hl5Rd4_V")


LABELS = ["Notable overlap", "Some overlap",
          "Party-line vote — low signal", "Near-unanimous vote — no signal"]

# PAGE must stay at or below PostgREST's server-side max-rows, or every page
# after the first silently returns short and the walk below stops early.
PAGE = 1000


def q(path, headers=None, want_range=False):
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Accept-Profile": "civictrace", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode()
        if want_range:
            return json.loads(body) if body.strip() else [], r.headers.get("Content-Range", "")
        return json.loads(body)


def count_of(path):
    """Row count from Postgres, transferring no rows.

    This file previously did `len(q(...))` and `sum(... for x in q(...))` on
    unbounded collections. PostgREST caps those at 1000 rows, so the all-cycle
    sum was computed from 1000 of 1,991 committees: the assertion still passed,
    but on a number that meant nothing, and the figure it would have printed on
    failure was fiction. A check whose evidence is wrong is not a check.
    """
    _, rng = q(path, {"Prefer": "count=exact", "Range": "0-0"}, want_range=True)
    if "/" not in rng:
        raise RuntimeError(f"no row count returned for {path}")
    return int(rng.rsplit("/", 1)[-1])


def sum_all(path, field):
    """Sum a column across every matching row, paging until the source is dry.

    Never sum a PostgREST collection response without bounding it — the whole
    point of this helper is that the bound is explicit and the walk is complete.
    """
    total, offset, expected = 0.0, 0, count_of(path)
    while offset < expected:
        rows, _ = q(path, {"Range": f"{offset}-{offset + PAGE - 1}"}, want_range=True)
        if not rows:
            raise RuntimeError(f"{path}: paging stalled at {offset} of {expected}")
        total += sum(float(x[field]) for x in rows)
        offset += len(rows)
    if offset != expected:
        raise RuntimeError(f"{path}: walked {offset} rows, expected {expected}")
    return round(total, 2)


failures = []


def require(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(f"{name}: {detail}")


def main():
    r = q("reconciliation?select=*")[0]
    cyc = r["cycle"]
    print(f"CivicTrace aggregation invariants — published cycle {cyc}\n")

    routes = {k: r[k] for k in
              ("via_contrib", "via_committee", "via_sector", "via_member", "via_recipient")}
    distinct = {str(v) for v in routes.values()}
    require("every route to the grand total agrees", len(distinct) == 1, json.dumps(routes))
    print(f"         total: {routes['via_contrib']}")

    require("committees giving == committees listed",
            r["committees_giving"] == r["committees_listed"],
            f"{r['committees_giving']} vs {r['committees_listed']}")
    require("members receiving <= members loaded",
            r["members_receiving"] <= r["members_total"],
            f"{r['members_receiving']} vs {r['members_total']}")

    # Sector subtotals must add up to the same grand total, and each sector's own
    # member count must match what its detail page derives.
    secs = q(f"sector_profile?select=sector,sector_slug,total_to_wi,members_supported&cycle=eq.{cyc}")
    ssum = round(sum(float(s["total_to_wi"]) for s in secs), 2)
    require("sector subtotals sum to the grand total",
            f"{ssum:.2f}" == f"{float(r['via_contrib']):.2f}",
            f"{ssum} vs {r['via_contrib']}")

    mism = []
    for s in secs:
        rows = q("sector_members?select=bioguide&cycle=eq.%d&sector_slug=eq.%s"
                 % (cyc, urllib.parse.quote(s["sector_slug"])))
        if len(rows) != s["members_supported"]:
            mism.append(f"{s['sector']}: profile {s['members_supported']} vs detail {len(rows)}")
    require("each sector's member count matches its detail page", not mism, "; ".join(mism[:4]))

    # Nothing published may be scoped to another cycle.
    #
    # This check used to read `isinstance(other, list)`, which PostgREST satisfies
    # for literally any successful response — including an empty one. It passed
    # on every run and asserted nothing. The invariant it was meant to enforce is
    # that other cycles exist in the database but never leak into a figure the
    # published cycle claims, so it has to be stated as two facts, both checkable.
    n_other = count_of(f"committee_profile?select=cmte_id&cycle=neq.{cyc}&payments_to_wi=gt.0")
    require("other cycles are present in the database (otherwise this check is vacuous)",
            n_other > 0, f"{n_other} rows outside cycle {cyc}")

    # If the grand total were being computed across cycles, it would equal the
    # all-cycle sum rather than this cycle's. Prove it does not.
    all_cycles = sum_all("committee_profile?select=total_to_wi&payments_to_wi=gt.0",
                         "total_to_wi")
    this_cycle = round(float(r["via_contrib"]), 2)
    require("the grand total is this cycle only, not every cycle summed",
            f"{all_cycles:.2f}" != f"{this_cycle:.2f}" or not n_other,
            f"cycle {cyc} = {this_cycle}, all cycles = {all_cycles}")

    # And the published cycle's own committee rows must add to it exactly.
    msum = sum_all(f"committee_profile?select=total_to_wi&cycle=eq.{cyc}&payments_to_wi=gt.0",
                   "total_to_wi")
    require("committee rows in the published cycle sum to the grand total",
            f"{msum:.2f}" == f"{this_cycle:.2f}", f"{msum} vs {this_cycle}")

    # The label breakdown on / and /trails is presented as a partition of the
    # trail total. If it stops being one, both pages print a breakdown that does
    # not add up to the number beside it.
    n_trails = count_of(f"money_trail?select=vote_key&cycle=eq.{cyc}")
    per_label = {l: count_of(f"money_trail?select=vote_key&cycle=eq.{cyc}"
                             f"&label=eq.{urllib.parse.quote(l)}") for l in LABELS}
    require("trail labels partition the trail total",
            sum(per_label.values()) == n_trails,
            f"labels sum to {sum(per_label.values())} vs {n_trails} trails: {per_label}")

    print()
    if failures:
        print(f"{len(failures)} INVARIANT(S) BROKEN — do not deploy")
        for f in failures:
            print("  - " + f)
        return 1
    print("all invariants hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
