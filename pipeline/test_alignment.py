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
            "has_interest_axis": True, "unaligned_dollars": 0.0,
        },
        "context": {"party_line_share_pct": party_share, "minority_share_pct": minority},
    }


print("== C1: the label reads the member's vote")

# The exact case the reviewer described: same bill, same money, opposite votes.
# In a split party, a Yea and a Nay cannot both be the party's majority.
yea = trail.alignment_label(base_trail("Yea", party_share=70.0))
nay = trail.alignment_label(base_trail("Nay", party_share=30.0))
check("a Yea and a Nay with identical money get different labels", yea[0] != nay[0],
      f"both {yea[0]!r}")
check("the rationale names the position", "Yea" in yea[1] and "Nay" in nay[1],
      f"{yea[1][:70]!r} / {nay[1][:70]!r}")

# Direction must matter even when nothing else moves. Flip only the position and
# the party share that mechanically follows from it.
a = trail.alignment_label(base_trail("Yea", party_share=80.0))
b = trail.alignment_label(base_trail("Nay", party_share=20.0))
check("crossing one's own party is distinguished from voting with it", a[0] != b[0],
      f"{a[0]!r} vs {b[0]!r}")
check("the party-minority case is the stronger label",
      "Crossed party" in b[0] and "Crossed party" not in a[0], f"{a[0]!r} / {b[0]!r}")

# Source-level: the function must actually reference the vote. A behavioural test
# can be satisfied by accident; this one cannot.
import inspect
src = inspect.getsource(trail.alignment_label)
check("alignment_label reads t['vote']['position'] in source", 't["vote"]["position"]' in src)

print("\n== C1: a split industry cannot produce the strongest label")
even = trail.alignment_label(base_trail("Nay", party_share=20.0, pole_a=50000.0, pole_b=48000.0))
check("near-even poles are not called one-sided", "one-sided" not in even[0], even[0])
check("the split is stated in the rationale", "no single industry position" in even[1], even[1][:90])

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
