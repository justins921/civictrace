#!/usr/bin/env python3
"""Tests that hold the two engine fixes in place.

The August 2026 review found `alignment_label()` ignoring the member's vote, and
`interest_side` with no opposing pole for any sector but one. Both were fixed by
editing prose first and code second, which is exactly how a fix quietly reverts:
the docstring says the function reads direction, and nothing fails if it stops.

These are the assertions that fail instead. Run in CI before the pipeline:

    python test_alignment.py
"""
import copy
import sys

import trail
from sectors import SECTOR_AXIS, SIDE_POLE

FAILS = []


def check(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def base_trail(position, party_share, minority=40.0, share=25.0,
               pole_a=90000.0, pole_b=5000.0, larger="carbon-intensive energy",
               smaller="climate & conservation"):
    """A trail payload with everything the labeller reads, and nothing it doesn't."""
    return {
        "vote": {"position": position},
        "money": {
            "sector_dollars": 100000.0, "sector_share_pct": share,
            "aligned_side_dollars": pole_a, "opposed_side_dollars": pole_b,
            "larger_pole": larger, "smaller_pole": smaller,
            "has_interest_axis": True,
            "unaligned_dollars": max(0.0, 100000.0 - pole_a - pole_b),
        },
        "context": {"party_line_share_pct": party_share, "minority_share_pct": minority},
    }


print("== C1: the label distinguishes a member who broke from their party")

# H11. These two assertions used to be named for something they did not test.
# "a Yea and a Nay with identical money get different labels" varied the party
# share alongside the position, so a labeller that ignored `position` entirely
# passed it — which is exactly what the labeller does, by design. The thing that
# actually separates those two cases is party divergence, so that is what the
# test is now named for, and the claim about direction is tested separately and
# honestly below.
minority = trail.alignment_label(base_trail("Nay", party_share=30.0))
majority = trail.alignment_label(base_trail("Yea", party_share=70.0))
check("being in your own party's minority is labelled differently from being in its majority",
      minority[0] != majority[0], f"both {minority[0]!r}")
check("the party-minority case is the stronger label",
      "Crossed party" in minority[0] and "Crossed party" not in majority[0],
      f"{majority[0]!r} / {minority[0]!r}")

# What direction genuinely buys, stated as an assertion rather than a hope: the
# position appears in the rationale a reader is shown, and it does *not* change
# the label, because CivicTrace does not decide which way a bill cuts for an
# industry and a label that moved with the vote would be claiming it does.
yea = trail.alignment_label(base_trail("Yea", party_share=30.0))
nay = trail.alignment_label(base_trail("Nay", party_share=30.0))
check("the rationale names the position", "Yea" in yea[1] and "Nay" in nay[1],
      f"{yea[1][:70]!r} / {nay[1][:70]!r}")
check("the rationale changes with the vote", yea[1] != nay[1])
check("the label does not — we never claim they voted with their funders",
      yea[0] == nay[0], f"{yea[0]!r} vs {nay[0]!r}")

# Source-level: the function must actually reference the vote. A behavioural test
# can be satisfied by accident; this one cannot.
import inspect
src = inspect.getsource(trail.alignment_label)
check("alignment_label reads t['vote']['position'] in source", 't["vote"]["position"]' in src)

print("\n== C3: 'one-sided' is only claimed where it was actually checked")
even = trail.alignment_label(base_trail("Nay", party_share=20.0, pole_a=50000.0, pole_b=48000.0))
check("near-even poles are not called one-sided", "one-sided" not in even[0], even[0])
check("the split is stated in the rationale", "no single industry position" in even[1], even[1][:90])

# No axis at all. The old test was `(a + b) == 0 or a >= 2 * b`, so two zeroes
# came out as one-sided and the site's strongest badges were built on it.
no_axis = base_trail("Nay", party_share=20.0, pole_a=0.0, pole_b=0.0,
                     larger=None, smaller=None)
no_axis["money"]["has_interest_axis"] = False
no_axis["money"]["unaligned_dollars"] = 100000.0
r = trail.alignment_label(no_axis)
check("an industry with no declared axis is never called one-sided",
      "one-sided" not in r[0], r[0])
check("but the party divergence survives — it is a separate fact",
      "Crossed party" in r[0], r[0])
check("and the rationale says which of the two is missing",
      "no two-sided axis" in r[1], r[1][:120])

# An axis exists, and the classifier placed almost none of the money on it.
# This is the case all three of the site's top trails were in.
thin = base_trail("Nay", party_share=20.0, pole_a=12000.0, pole_b=1000.0)
thin["money"]["unaligned_dollars"] = 87000.0
r = trail.alignment_label(thin)
check("an axis covering a minority of the money is not enough to claim one-sidedness",
      "one-sided" not in r[0], r[0])
check("the uncovered money is quantified for the reader",
      "$87,000" in r[1] or "87,000" in r[1], r[1][:160])

# And the genuine case still earns the strongest label.
real = trail.alignment_label(base_trail("Nay", party_share=20.0, pole_a=90000.0, pole_b=5000.0))
check("a real, covered, 2:1 split still produces the strongest label",
      real[0] == "Crossed party, one-sided industry money", real[0])

print("\n== the label vocabulary is the same in all three places that hold it")

# The engine emits labels, export_json.py sorts by them, check_reconciliation.py
# asserts they partition the total, and the web app styles them. Four copies of
# one list, in two languages, and nothing has ever compared them. A label added
# in one place and missed in another does not fail anything: it sorts last,
# renders unstyled, and drops out of the partition check — which is how the
# honesty statistic on the front page came to be computed over the wrong two
# labels for weeks.
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def labels_in_python():
    src = (HERE / "export_json.py").read_text()
    body = re.search(r"ORDER = \{(.*?)\}", src, re.S)
    return re.findall(r'"([^"]+)":\s*\d+', body.group(1)) if body else []


def labels_in_typescript():
    """web/lib/db.ts, when this is run from a checkout that has it."""
    for candidate in (HERE.parent / "web" / "lib" / "db.ts",
                      HERE.parent / "ct-app" / "lib" / "db.ts"):
        if candidate.exists():
            body = re.search(r"export const LABELS = \[(.*?)\] as const",
                             candidate.read_text(), re.S)
            return re.findall(r"'([^']+)'", body.group(1)) if body else []
    return None


py = labels_in_python()
ts = labels_in_typescript()
check("export_json.py declares an ordered label list", len(py) >= 5, str(py))
if ts is None:
    print("  skip  web/lib/db.ts not present in this checkout — pipeline-only run")
else:
    check("the pipeline and the web app agree on the labels, in the same order",
          py == ts, f"pipeline {py}\n           web      {ts}")

recon = (HERE / "check_reconciliation.py").read_text()
missing = [l for l in py if l not in recon]
check("the reconciliation check knows every label the engine can emit",
      not missing, str(missing))

print("\n== C1: the cheap-signal guards still fire")
unan = trail.alignment_label(base_trail("Yea", party_share=99.0, minority=4.0))
check("near-unanimous votes are still refused", "Near-unanimous" in unan[0], unan[0])
line = trail.alignment_label(base_trail("Yea", party_share=97.0))
check("party-line votes are still refused", "Party-line" in line[0], line[0])
none = base_trail("Yea", party_share=30.0); none["money"]["sector_dollars"] = 0
check("no sector money is still refused", "No sector money" in trail.alignment_label(none)[0])

print("\n== C2: every declared axis has two poles that are really opposed")
check("at least two sectors declare an axis", len(SECTOR_AXIS) >= 2, len(SECTOR_AXIS))
for sec, cfg in SECTOR_AXIS.items():
    check(f"{sec}: exactly two poles", len(cfg["poles"]) == 2, list(cfg["poles"]))
    check(f"{sec}: no side sits on both poles",
          len({s for v in cfg["poles"].values() for s in v})
          == sum(len(v) for v in cfg["poles"].values()))
    for pole, sides in cfg["poles"].items():
        check(f"{sec}/{pole}: has at least one side", len(sides) >= 1)

print("\n== C2: the guns lumping bug stays fixed")
from sectors import classify_pac
nra = classify_pac("NATIONAL RIFLE ASSOCIATION OF AMERICA POLITICAL VICTORY FUND")
ev = classify_pac("EVERYTOWN FOR GUN SAFETY VICTORY FUND")
gif = classify_pac("GIFFORDS PAC")
check("the NRA and Everytown are not given the same interest side", nra[2] != ev[2],
      f"both {nra[2]!r}")
check("the NRA lands on gun rights", nra[2] == "gun rights", nra)
check("Everytown lands on gun violence prevention", ev[2] == "gun violence prevention", ev)
check("Giffords lands on gun violence prevention", gif[2] == "gun violence prevention", gif)
check("the two guns sides are on opposite poles",
      SIDE_POLE.get(("Guns & Public Safety", nra[2]))
      != SIDE_POLE.get(("Guns & Public Safety", ev[2])))

print(f"\n{len(FAILS)} FAILED: " + "; ".join(FAILS) if FAILS else "\nall alignment tests pass")
sys.exit(1 if FAILS else 0)
