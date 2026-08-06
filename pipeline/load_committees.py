#!/usr/bin/env python3
"""Congressional committee assignments, and which industries each committee has jurisdiction over.

Why this exists
---------------
Right now a trail cannot tell the difference between pharma money to a member of
the Energy & Commerce Health Subcommittee and pharma money to a member with no
jurisdiction over health policy at all. Those are not the same fact, and
publishing them identically is the biggest single source of noise on the site —
87% of trails come back "no signal", and part of that is us asking a question
about members who were never in a position to answer it.

Committee membership is free, CC0, and comes from the same
unitedstates/congress-legislators repo the roster already comes from.

What this does NOT do
---------------------
It does not score anything, and it does not decide that a member on the
committee of jurisdiction is more suspect. It records a fact — this member sits
on the committee that writes bills in this industry — and lets the trail page
print it. Whether that makes a trail more interesting is the reader's call.

The industry mapping below is a rule table like every other classification on
this site: each row carries an ID, and the ID is printed wherever the mapping is
used, so a reader can check our work and tell us it is wrong.
"""
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

import yaml

BASE = Path(__file__).parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
UA = "CivicTrace/0.1 (nonpartisan public-records prototype)"
SRC = "https://unitedstates.github.io/congress-legislators/"
FILES = {"committees-current.yaml": "committees.yaml",
         "committee-membership-current.yaml": "membership.yaml"}

# (rule_id, committee thomas_id prefix, sector). Committee -> the industries it
# writes law for. Deliberately narrow: a committee is listed only where its
# jurisdiction is the industry's primary legislative home, because a mapping
# that says everything is relevant to everything says nothing.
JURISDICTION = [
    ("CJ-01", "HSAG", "Agriculture & Food"),
    ("CJ-02", "SSAF", "Agriculture & Food"),
    ("CJ-03", "HSBA", "Finance & Insurance"),
    ("CJ-04", "SSBK", "Finance & Insurance"),
    ("CJ-05", "HSWM", "Finance & Insurance"),
    ("CJ-06", "SSFI", "Finance & Insurance"),
    ("CJ-07", "HSIF", "Health Care"),
    ("CJ-08", "SSHR", "Health Care"),
    ("CJ-09", "HSIF", "Energy & Utilities"),
    ("CJ-10", "SSEG", "Energy & Utilities"),
    ("CJ-11", "HSII", "Energy & Utilities"),
    ("CJ-12", "HSPW", "Real Estate & Construction"),
    ("CJ-13", "SSEV", "Real Estate & Construction"),
    ("CJ-14", "HSPW", "Transportation"),
    ("CJ-15", "SSCM", "Transportation"),
    ("CJ-16", "HSAS", "Defense & Aerospace"),
    ("CJ-17", "SSAS", "Defense & Aerospace"),
    ("CJ-18", "HSIF", "Tech & Communications"),
    ("CJ-19", "SSCM", "Tech & Communications"),
    ("CJ-20", "HSED", "Labor"),
    ("CJ-21", "SSHR", "Labor"),
    ("CJ-22", "HSJU", "Guns & Public Safety"),
    ("CJ-23", "SSJU", "Guns & Public Safety"),
    ("CJ-24", "HSJU", "Legal"),
    ("CJ-25", "SSJU", "Legal"),
    ("CJ-26", "HSFA", "Foreign Policy"),
    ("CJ-27", "SSFR", "Foreign Policy"),
    ("CJ-28", "HSSM", "Small Business & Retail"),
    ("CJ-29", "SSSB", "Small Business & Retail"),
    ("CJ-30", "HSWM", "Manufacturing"),
    ("CJ-31", "SSFI", "Manufacturing"),
]


def fetch(name, dest):
    p = DATA / dest
    req = urllib.request.Request(SRC + name, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    # Same atomic-write rule as the FEC archives: a truncated YAML that parses
    # to a shorter list would silently drop members from committees.
    tmp = p.with_suffix(p.suffix + ".part")
    tmp.write_bytes(body)
    os.replace(tmp, p)
    return yaml.safe_load(p.read_text())


def main():
    committees = fetch("committees-current.yaml", FILES["committees-current.yaml"])
    membership = fetch("committee-membership-current.yaml", FILES["committee-membership-current.yaml"])

    con = sqlite3.connect(BASE / "civictrace.db")
    c = con.cursor()
    c.executescript("""
    DROP TABLE IF EXISTS committee_assignment;
    DROP TABLE IF EXISTS committee_jurisdiction;
    DROP TABLE IF EXISTS cong_committee;
    CREATE TABLE cong_committee (
      thomas_id TEXT PRIMARY KEY, name TEXT, chamber TEXT, jurisdiction TEXT, url TEXT);
    CREATE TABLE committee_assignment (
      bioguide TEXT, thomas_id TEXT, committee_name TEXT, chamber TEXT,
      parent_id TEXT, is_subcommittee INTEGER, title TEXT, rank INTEGER, party TEXT,
      PRIMARY KEY (bioguide, thomas_id));
    CREATE INDEX ix_ca_bio ON committee_assignment(bioguide);
    CREATE TABLE committee_jurisdiction (
      thomas_id TEXT, sector TEXT, rule_id TEXT, PRIMARY KEY (thomas_id, sector));
    """)

    # Parent committees, then subcommittees keyed the way the membership file
    # keys them: parent id concatenated with the subcommittee id.
    names, chambers, parents = {}, {}, {}
    for cm in committees:
        tid = cm.get("thomas_id")
        if not tid:
            continue
        names[tid] = cm.get("name")
        chambers[tid] = cm.get("type")
        c.execute("INSERT OR REPLACE INTO cong_committee VALUES (?,?,?,?,?)",
                  (tid, cm.get("name"), cm.get("type"), cm.get("jurisdiction"), cm.get("url")))
        for sub in cm.get("subcommittees") or []:
            sid = tid + str(sub.get("thomas_id") or "")
            names[sid] = f"{cm.get('name')} — {sub.get('name')}"
            chambers[sid] = cm.get("type")
            parents[sid] = tid

    n = 0
    for tid, members in membership.items():
        for m in members or []:
            bio = m.get("bioguide")
            if not bio:
                continue
            c.execute("INSERT OR REPLACE INTO committee_assignment VALUES (?,?,?,?,?,?,?,?,?)", (
                bio, tid, names.get(tid, tid), chambers.get(tid),
                parents.get(tid), 1 if tid in parents else 0,
                m.get("title"), m.get("rank"), m.get("party")))
            n += 1

    for rule_id, prefix, sector in JURISDICTION:
        # Applies to the full committee and to every one of its subcommittees:
        # a member of the Health Subcommittee is on Energy & Commerce.
        for tid in names:
            if tid == prefix or parents.get(tid) == prefix:
                c.execute("INSERT OR REPLACE INTO committee_jurisdiction VALUES (?,?,?)",
                          (tid, sector, rule_id))
    con.commit()

    wi = [r[0] for r in c.execute("SELECT bioguide FROM member WHERE state='WI'")]
    q = ",".join("?" * len(wi))
    print(f"committees: {len(names)}  assignments: {n}")
    print(f"jurisdiction rules: {len(JURISDICTION)} -> "
          f"{c.execute('SELECT COUNT(*) FROM committee_jurisdiction').fetchone()[0]} committee/sector pairs")
    print("\nWisconsin delegation — committees of jurisdiction:")
    for name, sectors in c.execute(f"""
            SELECT m.full_name, GROUP_CONCAT(DISTINCT cj.sector)
            FROM member m
            JOIN committee_assignment ca ON ca.bioguide = m.bioguide
            JOIN committee_jurisdiction cj ON cj.thomas_id = ca.thomas_id
            WHERE m.bioguide IN ({q}) GROUP BY 1 ORDER BY 1""", wi):
        print(f"  {name:24} {sectors}")

    unplaced = [b for (b,) in c.execute(
        f"SELECT bioguide FROM member WHERE bioguide IN ({q}) "
        f"AND bioguide NOT IN (SELECT bioguide FROM committee_assignment)", wi)]
    con.close()
    if unplaced:
        # A member with no assignments is either genuinely unassigned or a gap in
        # the source. Either way the trail pages must not imply we checked.
        print(f"\nno committee assignments found for: {', '.join(unplaced)}", file=sys.stderr)


if __name__ == "__main__":
    main()
