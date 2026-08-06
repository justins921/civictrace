#!/usr/bin/env python3
"""CivicTrace money-trail engine.

Design rules baked into this module (these are product requirements, not style):
  1. Nothing is asserted about motive. The engine returns facts + context, never
     a causal claim, and never the words "because", "in exchange for", "bought".
  2. Every returned figure carries the source document it came from.
  3. Contradicting evidence is returned in the same payload as supporting
     evidence, with the same structure, so the UI cannot show one without the
     other. The base-rate block is not optional.
     The split comes from `sector_axis`, written by sectors.py, and only for
     sectors where two organised constituencies genuinely lobby against each
     other. A sector with no declared axis reports no split and the UI says so
     — it never prints a $0 that reads like "we checked and found none".
     (This was the C2 gap from the August 2026 review: OPPOSING used to be a
     hand-written one-element set, so every industry but Energy reported zero
     by construction.)
  4. Alignment is a description of overlap, not a score of corruption, and it
     reads the member's vote. What it reads is bounded on purpose:
     `alignment_label()` uses whether the member broke from their own party,
     which is a documented fact about that member's choice. It does NOT decide
     what a bill does to an industry, so it never claims a member voted the way
     their donors wanted — that is not derivable from contributions, an
     industry label and a roll call. test_alignment.py fails if either half of
     that stops being true. (C1 from the same review: the function used to
     ignore position entirely.)
"""
import sqlite3, json
from pathlib import Path

DB = Path(__file__).parent / "civictrace.db"
CLEAN = "(k.memo_cd IS NULL OR k.memo_cd <> 'X')"   # never double-count memo rows
DIRECT = "k.transaction_tp = '24K'"                 # direct contributions only
# Positions that actually count as a vote cast. "Not Voting", "Present" and
# "Paired" are excluded everywhere — as a member's own position and as a
# denominator. Counting them inflates apparent party splits.
CAST = {"Yea", "Nay", "Aye", "No", "Yes"}


def conn():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c


def fec_committee_url(cmte_id):
    return f"https://www.fec.gov/data/committee/{cmte_id}/"


def fec_candidate_url(cand_id):
    return f"https://www.fec.gov/data/candidate/{cand_id}/"


def member_money(c, cand_id, cycle):
    """Every direct PAC contribution to this candidate, with sector labels."""
    return c.execute(f"""
      SELECT k.filer_cmte_id, co.cmte_name, co.connected_org, co.org_tp, co.cmte_dsgn,
             ps.sector, ps.interest_side, ps.rule_id, ps.pole,
             k.iso_dt, k.amount, k.image_num, k.sub_id, k.transaction_tp
      FROM contribution k
      LEFT JOIN committee co ON co.cmte_id = k.filer_cmte_id AND co.cycle = k.cycle
      LEFT JOIN pac_sector ps ON ps.cmte_id = k.filer_cmte_id AND ps.cycle = k.cycle
      WHERE k.cand_id = ? AND k.cycle = ? AND {DIRECT} AND {CLEAN}
      ORDER BY k.iso_dt
    """, (cand_id, cycle)).fetchall()


def build_trail(vote_key, bioguide, cand_id, cycle):
    """Return one fully-sourced money trail, or None if the member has no
    recorded position on that vote."""
    c = conn()
    rc = c.execute("SELECT * FROM rollcall WHERE vote_key = ?", (vote_key,)).fetchone()
    if not rc: return None
    pos = c.execute("SELECT * FROM vote_position WHERE vote_key = ? AND bioguide = ?",
                    (vote_key, bioguide)).fetchone()
    if not pos: return None
    # A member who did not vote has taken no position. Absence has many innocent
    # explanations (travel, illness, a scheduled pair) and treating it as a
    # position is how a transparency site accidentally invents a story.
    if (pos["position"] or "").strip() not in CAST:
        return None
    mem = c.execute("SELECT * FROM member WHERE bioguide = ?", (bioguide,)).fetchone()
    cand = c.execute("SELECT * FROM candidate WHERE cand_id = ? AND cycle = ?",
                     (cand_id, cycle)).fetchone()

    # bill
    from fetch_bills import parse_legis
    p = parse_legis(rc["legis_num"])
    bill = None
    if p:
        bill = c.execute("SELECT * FROM bill WHERE bill_key = ?",
                         (f"{rc['congress']}{p[0]}{p[1]}",)).fetchone()
    sectors = []
    # A bill that touches every sector (an omnibus, a CR, a full-year
    # appropriations act) cannot support a sector-alignment reading. We refuse to
    # compute one rather than publish a number that looks precise and isn't.
    if bill and not bill["is_broad"]:
        sectors = c.execute("SELECT sector, evidence FROM bill_sector WHERE bill_key = ?",
                            (bill["bill_key"],)).fetchall()
    sector_names = [s["sector"] for s in sectors]

    rows = member_money(c, cand_id, cycle)
    total_all = sum(r["amount"] for r in rows)
    in_sector = [r for r in rows if r["sector"] in sector_names]
    total_sector = sum(r["amount"] for r in in_sector)

    # Split the sector's money across the sector's declared two-sided axis.
    #
    # This used to be a hand-written set containing one string, so every industry
    # except Energy reported $0 opposing money by construction — a zero that could
    # only ever be zero. The poles now come from sector_axis, written by
    # sectors.py, and a sector with no declared axis reports no split at all
    # rather than a fabricated one.
    axes = {r["sector"]: dict(r) for r in c.execute(
        "SELECT * FROM sector_axis WHERE sector IN (%s)"
        % ",".join("?" * len(sector_names)), sector_names).fetchall()} if sector_names else {}

    by_pole = {}
    unaligned = []
    for r in in_sector:
        ax = axes.get(r["sector"])
        if not ax or not r["pole"]:
            unaligned.append(r); continue
        by_pole.setdefault(r["pole"], []).append(r)

    # `a` is simply the larger pole, not "the member's side" — nothing here knows
    # which way a bill cuts, and the naming used to imply that it did.
    poles = sorted(by_pole.items(), key=lambda kv: -sum(x["amount"] for x in kv[1]))
    pole_a = poles[0] if poles else (None, [])
    pole_b = poles[1] if len(poles) > 1 else (None, [])
    has_axis = bool(axes)

    by_pac = {}
    for r in in_sector:
        k = r["filer_cmte_id"]
        d = by_pac.setdefault(k, {"cmte_id": k, "name": r["cmte_name"],
                                  "sector": r["sector"], "side": r["interest_side"],
                                  "rule_id": r["rule_id"], "total": 0.0,
                                  "fec_url": fec_committee_url(k), "payments": []})
        d["total"] += r["amount"]
        d["payments"].append({
            "date": r["iso_dt"], "amount": r["amount"], "image_num": r["image_num"],
            "sub_id": r["sub_id"], "transaction_tp": r["transaction_tp"],
            "source_url": f"https://docquery.fec.gov/cgi-bin/fecimg/?{r['image_num']}"})
    pacs = sorted(by_pac.values(), key=lambda d: -d["total"])

    # ---- base rates: the context that stops a true fact becoming a false story
    tot = c.execute("""SELECT position, COUNT(*) n FROM vote_position
                       WHERE vote_key = ? GROUP BY 1""", (vote_key,)).fetchall()
    chamber_breakdown = {r["position"]: r["n"] for r in tot}
    party_rows = c.execute("""SELECT position, COUNT(*) n FROM vote_position
        WHERE vote_key = ? AND party = ? GROUP BY 1""", (vote_key, pos["party"])).fetchall()
    party_breakdown = {r["position"]: r["n"] for r in party_rows}
    delegation = c.execute("""
        SELECT vp.name_raw, vp.party, vp.state, vp.position, m.full_name, m.district, m.bioguide
        FROM vote_position vp LEFT JOIN member m ON m.bioguide = vp.bioguide
        WHERE vp.vote_key = ? AND vp.state = 'WI' ORDER BY m.district""", (vote_key,)).fetchall()

    same = chamber_breakdown.get(pos["position"], 0)
    total_voting = sum(v for k2, v in chamber_breakdown.items() if k2 in CAST)
    party_same = party_breakdown.get(pos["position"], 0)
    party_total = sum(v for k2, v in party_breakdown.items() if k2 in CAST)
    # How contested was the vote at all? A 350-5 vote carries no information
    # about any individual member regardless of who funded them.
    losing = min(rc["yea"] or 0, rc["nay"] or 0)
    cast_total = (rc["yea"] or 0) + (rc["nay"] or 0)
    minority_share = round(100 * losing / cast_total, 1) if cast_total else 0

    # last contribution from the sector before the vote
    dated = sorted([r for r in in_sector if r["iso_dt"] and rc["iso_date"]
                    and r["iso_dt"] <= rc["iso_date"]], key=lambda r: r["iso_dt"])
    days_since = None
    if dated and rc["iso_date"]:
        from datetime import date
        a = date.fromisoformat(dated[-1]["iso_dt"]); b = date.fromisoformat(rc["iso_date"])
        days_since = (b - a).days

    c.close()
    return {
        "member": {"bioguide": bioguide, "name": mem["full_name"], "party": mem["party"],
                   "state": mem["state"], "district": mem["district"], "chamber": mem["chamber"],
                   "url": mem["url"], "cand_id": cand_id,
                   "fec_url": fec_candidate_url(cand_id),
                   "cmte_name": cand["cand_name"] if cand else None},
        "bill": dict(bill) if bill else {"bill_key": None, "title": rc["vote_desc"],
                                         "congressgov_url": None},
        "vote": {"key": vote_key, "chamber": rc["chamber"], "question": rc["vote_question"],
                 "description": rc["vote_desc"], "result": rc["vote_result"],
                 "date": rc["iso_date"] or rc["action_date"], "legis_num": rc["legis_num"],
                 "position": pos["position"], "yea": rc["yea"], "nay": rc["nay"],
                 "source_url": rc["source_url"]},
        "sectors": [dict(s) for s in sectors],
        "money": {
            "cycle": cycle,
            "total_pac_dollars": round(total_all, 2),
            "sector_dollars": round(total_sector, 2),
            "sector_share_pct": round(100 * total_sector / total_all, 1) if total_all else 0,
            # Kept under the old names because the published schema and the
            # deployed views read them, but they mean what they always actually
            # meant: the larger and smaller pole of the sector's own axis. They
            # were never "aligned with the member's vote".
            "aligned_side_dollars": round(sum(r["amount"] for r in pole_a[1]), 2),
            "opposed_side_dollars": round(sum(r["amount"] for r in pole_b[1]), 2),
            "has_interest_axis": has_axis,
            "axis_name": next(iter(axes.values()))["axis"] if len(axes) == 1 else None,
            "larger_pole": pole_a[0],
            "smaller_pole": pole_b[0],
            "unaligned_dollars": round(sum(r["amount"] for r in unaligned), 2),
            "pac_count": len(pacs),
            "pacs": pacs,
            "days_since_last_sector_contribution": days_since,
        },
        "context": {
            "chamber_breakdown": chamber_breakdown,
            "voted_with_n_of_chamber": f"{same} of {total_voting}",
            "voted_with_own_party": f"{party_same} of {party_total}",
            "party_line_share_pct": round(100 * party_same / party_total, 1) if party_total else None,
            "minority_share_pct": minority_share,
            "wi_delegation": [dict(d) for d in delegation],
        },
        "disclaimer": ("Alignment describes overlap between documented contributions and a "
                       "documented vote. It is not evidence of an agreement, a promise, or "
                       "improper influence. Members vote on hundreds of bills for many reasons, "
                       "and PACs give to members for many reasons including committee assignment, "
                       "district industry, seniority and party leadership."),
    }


def alignment_label(t):
    """Deliberately conservative, and it reads the member's vote.

    C1, from the August 2026 outside review. The old version computed everything
    from money and from how contested the vote was; `position` never appeared, so
    a Yea and a Nay on the same bill with the same money could receive the same
    label and the same sentence. The label was being quoted as though it
    described the member's choice, and it described the bill's circumstances.

    What direction can honestly buy us is bounded, and the bound is the whole
    design. CivicTrace does not decide what a bill does to an industry — that is
    an editorial judgement the project refuses to make, and without it "voted
    with their donors" is not derivable from the record. So this function does
    not claim it. What the record does support, per member and per vote, is
    whether that member broke from their own party, and that is a directional
    fact about their specific choice rather than about the roll call.

    Two things follow. A member in their party's minority is doing something
    their party's position does not explain, and that is the case where money is
    worth a reader's attention. And when a sector's money is split near-evenly
    across the two poles of its own axis, there is no coherent "what the industry
    wanted" to overlap with at all, so the strongest label is withheld.
    """
    m, ctx = t["money"], t["context"]
    position = t["vote"]["position"]

    if m["sector_dollars"] <= 0:
        return ("No sector money on record",
                "No PAC in this bill's sector gave directly to this member in this cycle.")

    party_share = ctx["party_line_share_pct"]
    share = m["sector_share_pct"]

    if ctx["minority_share_pct"] < 10:
        return ("Near-unanimous vote — no signal",
                f"Only {ctx['minority_share_pct']}% of members voting took the other side. "
                f"A vote this lopsided tells you nothing about any member's funding.")

    unusual = party_share is not None and party_share < 90
    if not unusual:
        return ("Party-line vote — low signal",
                f"{party_share}% of the member's own party voted {position} as well. A vote this "
                f"predictable is explained by party position, not by contributions.")

    # Directional, and about this member: were they in their party's minority?
    crossed = party_share is not None and party_share < 50
    minority_note = (
        f"The member voted {position}, which put them in the minority of their own party "
        f"({party_share}% of it voted the same way)." if crossed else
        f"The member voted {position}, with {party_share}% of their own party.")

    # Is there a coherent industry position to overlap with at all?
    a, b = m["aligned_side_dollars"], m["opposed_side_dollars"]
    lopsided = (a + b) == 0 or a >= 2 * b   # one pole at least 2:1, or no axis to split
    axis_note = ""
    if m.get("smaller_pole"):
        axis_note = (f" Within this industry the money is split: {m['larger_pole']} "
                     f"${a:,.0f} against {m['smaller_pole']} ${b:,.0f}.")
        if not lopsided:
            axis_note += (" Those are close enough that there is no single industry position "
                          "here to line a vote up against.")

    if share >= 10 and crossed and lopsided:
        return ("Crossed party, one-sided industry money",
                f"The bill's sector supplied {share}% of this member's PAC money. "
                f"{minority_note}{axis_note} Worth reading the underlying filings.")

    if share >= 10 and lopsided:
        return ("Contested vote, one-sided industry money",
                f"The bill's sector supplied {share}% of this member's PAC money, and the vote "
                f"split the member's party. {minority_note}{axis_note}")

    return ("Contested vote, industry money present",
            f"Sector money is {share}% of this member's PAC total. {minority_note}{axis_note} "
            f"Review the filings below.")


if __name__ == "__main__":
    c = conn()
    n = 0
    for r in c.execute("""
        SELECT DISTINCT vp.vote_key, vp.bioguide FROM vote_position vp
        JOIN member m ON m.bioguide = vp.bioguide WHERE m.state='WI'"""):
        t = build_trail(r["vote_key"], r["bioguide"], None, 2026)
        n += 1
    print("trail engine importable; WI member-vote pairs:", n)
