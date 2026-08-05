#!/usr/bin/env python3
"""Generate the CivicTrace Wisconsin prototype as one self-contained HTML file.
All data is real and pulled from FEC bulk downloads, the House Clerk, the Senate,
GovInfo BILLSTATUS and unitedstates/congress-legislators. Nothing is invented.
"""
import sqlite3, json, html, datetime
from pathlib import Path
from trail import build_trail, alignment_label, conn

OUT = Path(__file__).parent / "civictrace-wisconsin.html"
BUILT = datetime.date(2026, 8, 5).isoformat()


def cand_for(c, m, cycle=2026):
    want = "S" if m["chamber"] == "sen" else "H"
    for fid in json.loads(m["fec_ids"] or "[]"):
        r = c.execute("SELECT cand_id FROM candidate WHERE cand_id=? AND cycle=? AND office=?",
                      (fid, cycle, want)).fetchone()
        if r: return r["cand_id"]
    return None


def collect():
    c = conn()
    members = c.execute("SELECT * FROM member WHERE state='WI' ORDER BY chamber DESC, CAST(district AS INT)").fetchall()
    people, trails = [], []
    for m in members:
        cid = cand_for(c, m)
        rows = c.execute(f"""
          SELECT ps.sector, ps.interest_side, co.cmte_name, k.filer_cmte_id,
                 ROUND(SUM(k.amount)) amt, COUNT(*) n
          FROM contribution k
          LEFT JOIN committee co ON co.cmte_id=k.filer_cmte_id AND co.cycle=k.cycle
          LEFT JOIN pac_sector ps ON ps.cmte_id=k.filer_cmte_id AND ps.cycle=k.cycle
          WHERE k.cand_id=? AND k.cycle=2026 AND k.transaction_tp='24K'
            AND (k.memo_cd IS NULL OR k.memo_cd<>'X')
          GROUP BY k.filer_cmte_id ORDER BY amt DESC""", (cid,)).fetchall() if cid else []
        total = sum(r["amt"] for r in rows)
        bysec = {}
        for r in rows:
            bysec[r["sector"] or "Unclassified"] = bysec.get(r["sector"] or "Unclassified", 0) + r["amt"]
        nvotes = c.execute("SELECT COUNT(*) n FROM vote_position WHERE bioguide=?",
                           (m["bioguide"],)).fetchone()["n"]
        people.append({
            "bioguide": m["bioguide"], "name": m["full_name"], "party": m["party"],
            "chamber": "U.S. Senate" if m["chamber"] == "sen" else f"U.S. House, WI-{m['district'].zfill(2)}",
            "district": m["district"], "url": m["url"], "cand_id": cid,
            "fec_url": f"https://www.fec.gov/data/candidate/{cid}/" if cid else None,
            "congress_url": f"https://www.congress.gov/member/{m['bioguide']}",
            "total_pac": total, "pac_count": len(rows), "votes_recorded": nvotes,
            "sectors": sorted(bysec.items(), key=lambda kv: -kv[1]),
            "top_pacs": [{"name": r["cmte_name"], "amt": r["amt"], "sector": r["sector"],
                          "side": r["interest_side"], "n": r["n"],
                          "url": f"https://www.fec.gov/data/committee/{r['filer_cmte_id']}/"}
                         for r in rows[:12]],
        })

        for vk in [x["vote_key"] for x in c.execute(
                "SELECT DISTINCT vote_key FROM vote_position WHERE bioguide=?", (m["bioguide"],))]:
            t = build_trail(vk, m["bioguide"], cid, 2026)
            if not t or not t["sectors"]: continue
            if t["money"]["sector_dollars"] <= 0: continue
            lab, why = alignment_label(t)
            t["label"], t["label_why"] = lab, why
            trails.append(t)

    trails.sort(key=lambda t: (t["label"] != "Notable overlap", -t["money"]["sector_dollars"]))
    # ---- earmarks (FY2026 House Community Project Funding requests) ----
    ear_wi = [dict(r) for r in c.execute("""
        SELECT member_name, district, party, subcommittee, recipient, project,
               amount, member_url, source_url, bioguide
        FROM earmark WHERE state='WI' ORDER BY amount DESC""")]
    ear_by_member = [dict(r) for r in c.execute("""
        SELECT member_name, district, party, COUNT(*) n, ROUND(SUM(amount)) total,
               MAX(member_url) member_url
        FROM earmark WHERE state='WI' GROUP BY member_name ORDER BY total DESC""")]
    ear_national = dict(c.execute("""
        SELECT COUNT(*) n, ROUND(SUM(amount)) total FROM earmark""").fetchone())
    ear_by_party = [dict(r) for r in c.execute("""
        SELECT party, COUNT(*) n, ROUND(SUM(amount)) total FROM earmark
        GROUP BY party ORDER BY total DESC""")]
    ear_by_sub = [dict(r) for r in c.execute("""
        SELECT subcommittee, COUNT(*) n, ROUND(SUM(amount)) total FROM earmark
        WHERE state='WI' GROUP BY subcommittee ORDER BY total DESC""")]
    ear_rank = [dict(r) for r in c.execute("""
        SELECT member_name, district, party, ROUND(SUM(amount)) total FROM earmark
        GROUP BY member_name ORDER BY total DESC LIMIT 10""")]

    stats = {
        "contributions": c.execute("SELECT COUNT(*) n FROM contribution").fetchone()["n"],
        "earmarks": ear_national["n"],
        "rollcalls": c.execute("SELECT COUNT(*) n FROM rollcall").fetchone()["n"],
        "positions": c.execute("SELECT COUNT(*) n FROM vote_position").fetchone()["n"],
        "bills": c.execute("SELECT COUNT(*) n FROM bill").fetchone()["n"],
        "committees": c.execute("SELECT COUNT(*) n FROM committee").fetchone()["n"],
        "trails": len(trails),
    }
    c.close()
    return people, trails, stats, {"wi": ear_wi, "by_member": ear_by_member,
        "national": ear_national, "by_party": ear_by_party, "by_sub": ear_by_sub,
        "rank": ear_rank}


PEOPLE, TRAILS, STATS, EAR = collect()
print("people:", len(PEOPLE), "trails:", len(TRAILS), "earmarks WI:", len(EAR["wi"]), STATS)

def slim(t):
    """Trim the payload for the single-file demo. The server API returns the full
    object; this only affects what gets baked into the static HTML."""
    t = json.loads(json.dumps(t))
    t["bill"] = {k: (v[:600] if k == "summary" and isinstance(v, str) else v)
                 for k, v in t["bill"].items() if k in
                 ("bill_key", "title", "summary", "policy_area", "congressgov_url",
                  "source_url", "sponsor_name", "latest_action")}
    t["money"]["pacs"] = [dict(p, payments=p["payments"][:4]) for p in t["money"]["pacs"][:10]]
    return t


payload = json.dumps({"people": PEOPLE, "trails": [slim(t) for t in TRAILS[:200]],
                      "earmarks": EAR, "stats": STATS, "built": BUILT}, separators=(",", ":"))

CSS = """
:root{--bg:#0b0f14;--panel:#121821;--panel2:#0f151d;--line:#1e2a38;--ink:#e8eef6;--dim:#8fa3b8;
--acc:#4da3ff;--good:#3ddc97;--warn:#ffc857;--bad:#ff6b6b;--chipR:#ff6b6b;--chipD:#4da3ff;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
header{border-bottom:1px solid var(--line);background:linear-gradient(180deg,#101722,#0b0f14);padding:26px 22px}
.wrap{max-width:1180px;margin:0 auto}
.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px;letter-spacing:-.02em}
.logo{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#4da3ff,#3ddc97);display:grid;place-items:center;color:#08111c;font-weight:900}
.tag{color:var(--dim);font-size:13.5px;margin-top:6px}
nav{display:flex;gap:6px;margin-top:18px;flex-wrap:wrap}
nav button{background:var(--panel);border:1px solid var(--line);color:var(--dim);padding:8px 14px;border-radius:999px;cursor:pointer;font-size:13.5px;font-weight:600}
nav button.on{background:var(--acc);border-color:var(--acc);color:#06101c}
main{max-width:1180px;margin:0 auto;padding:24px 22px 80px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
.grid{display:grid;gap:14px}
.g3{grid-template-columns:repeat(auto-fill,minmax(310px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
h2{font-size:20px;margin:22px 0 12px;letter-spacing:-.01em}
h3{font-size:16px;margin:0 0 6px}
.small{font-size:12.5px;color:var(--dim)}
.mono{font-variant-numeric:tabular-nums}
.chip{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;border:1px solid}
.R{color:var(--chipR);border-color:#4a2229;background:#2a1418}.D{color:var(--chipD);border-color:#1d3550;background:#0f1e2e}
.I{color:var(--warn);border-color:#4a3c1c;background:#2a2413}
.kpi{font-size:26px;font-weight:800;letter-spacing:-.02em}
.bar{height:7px;border-radius:4px;background:#18222e;overflow:hidden;margin-top:5px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,#4da3ff,#3ddc97)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
input[type=search]{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);padding:12px 14px;border-radius:10px;font-size:15px}
.flow{display:flex;gap:0;overflow-x:auto;padding:4px 0 10px}
.step{min-width:190px;flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px;position:relative;margin-right:22px}
.step:last-child{margin-right:0}
.step:after{content:"";position:absolute;right:-19px;top:50%;width:16px;height:2px;background:var(--line)}
.step:last-child:after{display:none}
.stepnum{width:20px;height:20px;border-radius:50%;background:var(--acc);color:#06101c;font-size:11px;font-weight:900;display:grid;place-items:center;margin-bottom:8px}
.steplab{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:700}
.stepval{font-size:15px;font-weight:700;margin:5px 0 3px;line-height:1.3}
.amt{font-size:19px;font-weight:800;color:var(--good);font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700}
.b-note{background:#2a2413;color:var(--warn);border:1px solid #4a3c1c}
.b-low{background:#131c26;color:var(--dim);border:1px solid var(--line)}
.b-some{background:#12212e;color:var(--acc);border:1px solid #1d3550}
.disc{border-left:3px solid var(--warn);background:#161310;padding:12px 14px;border-radius:0 10px 10px 0;font-size:13px;color:#d8cdb4;margin-top:12px}
details>summary{cursor:pointer;color:var(--acc);font-size:13px;font-weight:600;padding:6px 0}
.src{font-size:11.5px;color:var(--dim);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.two{grid-template-columns:1fr}}
.pill{display:inline-block;background:#131c26;border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:11.5px;color:var(--dim);margin:2px 3px 2px 0}
.hide{display:none}
.vote-Y,.vote-Yea{color:var(--good);font-weight:700}.vote-N,.vote-Nay{color:var(--bad);font-weight:700}
"""

JS = r"""
const DB = window.__CT__;
const $ = s => document.querySelector(s);
const money = n => "$" + (n||0).toLocaleString("en-US",{maximumFractionDigits:0});
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const partyChip = p => `<span class="chip ${p==="Republican"||p==="R"?"R":p==="Democrat"||p==="D"?"D":"I"}">${esc((p||"")[0]||"?")}</span>`;
const badge = l => l==="Notable overlap"?'b-note':l==="Some overlap"?'b-some':'b-low';

function srcLink(u,t){return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`:esc(t);}

function renderPeople(){
  return `<h2>Wisconsin's federal delegation</h2>
  <p class="small">Ten members. Every dollar below is a direct PAC contribution (FEC transaction type <code>24K</code>) reported in the 2026 cycle, memo entries excluded so nothing is counted twice. Independent expenditures are tracked separately and are <em>not</em> included here — they are not contributions to the member.</p>
  <div class="disc"><strong>These are PAC-side figures and they will not match the FEC candidate page.</strong> We count what the giving committees reported on their Schedule B. The FEC's "contributions from other committees" line on a candidate's page counts what the <em>receiving</em> campaign reported on its Schedule A. Those two ledgers never tie exactly — monthly vs. quarterly filers, amendments, and one-sided itemization all cause drift. Example: our figure for Derrick Van Orden is <span class="mono">$944,307</span>; the FEC candidate page shows <span class="mono">$994,742</span> through 2026-07-22. Neither is an error. We show the giver's ledger because it is the one that tells you <em>who</em> gave, which is the entire point of this site — but you should know which ledger you are reading, so we say it here instead of burying it.</div>
  <div class="grid g3">${DB.people.map(p=>`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div><h3>${partyChip(p.party)} ${esc(p.name)}</h3>
        <div class="small">${esc(p.chamber)}</div></div>
      </div>
      <div style="margin-top:12px"><div class="small">PAC money, 2026 cycle</div>
      <div class="kpi mono">${money(p.total_pac)}</div>
      <div class="small">${p.pac_count} committees · ${p.votes_recorded} recorded votes in this dataset</div></div>
      <div style="margin-top:12px">${p.sectors.slice(0,5).map(([s,v])=>`
        <div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:12.5px">
        <span>${esc(s)}</span><span class="mono small">${money(v)}</span></div>
        <div class="bar"><i style="width:${p.total_pac?Math.max(2,100*v/p.total_pac):0}%"></i></div></div>`).join("")}</div>
      <details><summary>Top committees &amp; sources</summary>
        <table><thead><tr><th>Committee</th><th>Sector</th><th style="text-align:right">Total</th></tr></thead><tbody>
        ${p.top_pacs.map(t=>`<tr><td>${srcLink(t.url,t.name)}</td><td class="small">${esc(t.sector||"—")}${t.side?`<br><span class="pill">${esc(t.side)}</span>`:""}</td><td class="mono" style="text-align:right">${money(t.amt)}</td></tr>`).join("")}
        </tbody></table>
        <div class="small" style="margin-top:8px">${srcLink(p.fec_url,"FEC candidate record")} · ${srcLink(p.congress_url,"Congress.gov profile")} · ${srcLink(p.url,"Official site")}</div>
      </details>
    </div>`).join("")}</div>`;
}

function flow(t){
  const top = t.money.pacs[0];
  const d = t.money.days_since_last_sector_contribution;
  return `<div class="flow">
    <div class="step"><div class="stepnum">1</div><div class="steplab">The donor</div>
      <div class="stepval">${esc(top?top.name:"—")}</div>
      <div class="small">${esc(top?(top.sector+(top.side?" · "+top.side:"")):"")}</div>
      <div class="amt">${money(top?top.total:0)}</div>
      <div class="src">${srcLink(top?top.fec_url:null,"FEC committee")}</div></div>
    <div class="step"><div class="stepnum">2</div><div class="steplab">The sector total</div>
      <div class="stepval">${esc(t.sectors.map(s=>s.sector).join(", "))}</div>
      <div class="small">${t.money.pac_count} committees in this sector gave directly</div>
      <div class="amt">${money(t.money.sector_dollars)}</div>
      <div class="src">${t.money.sector_share_pct}% of all PAC money this cycle</div></div>
    <div class="step"><div class="stepnum">3</div><div class="steplab">The member</div>
      <div class="stepval">${partyChip(t.member.party)} ${esc(t.member.name)}</div>
      <div class="small">${esc(t.member.chamber==="sen"?"U.S. Senate":"U.S. House, WI-"+String(t.member.district).padStart(2,"0"))}</div>
      <div class="amt">${money(t.money.total_pac_dollars)}</div>
      <div class="src">total PAC receipts · ${srcLink(t.member.fec_url,"FEC")}</div></div>
    <div class="step"><div class="stepnum">4</div><div class="steplab">The vote</div>
      <div class="stepval">${esc(t.vote.legis_num)} — <span class="vote-${esc(t.vote.position)}">${esc(t.vote.position)}</span></div>
      <div class="small"><em>${esc(t.vote.question||"")}</em><br>${esc(t.vote.date)} · ${esc(t.vote.result)} ${t.vote.yea}–${t.vote.nay}</div>
      <div class="amt" style="color:var(--warn)">${d==null?"—":d+" days"}</div>
      <div class="src">${d==null?"no dated prior contribution":"after last sector contribution"} · ${srcLink(t.vote.source_url,"roll call XML")}</div></div>
    <div class="step"><div class="stepnum">5</div><div class="steplab">The bill</div>
      <div class="stepval">${esc(t.bill.title||"")}</div>
      <div class="small">${esc((t.bill.summary||"").slice(0,190))}${(t.bill.summary||"").length>190?"…":""}</div>
      <div class="src">${srcLink(t.bill.congressgov_url,"Congress.gov")} ${t.bill.source_url?" · "+srcLink(t.bill.source_url,"GovInfo XML"):""}</div></div>
  </div>`;
}

function renderTrail(t,i){
  const del = t.context.wi_delegation||[];
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:start">
      <div><h3>${esc(t.bill.title||t.vote.description)}</h3>
      <div class="small">${partyChip(t.member.party)} ${esc(t.member.name)} voted <span class="vote-${esc(t.vote.position)}">${esc(t.vote.position)}</span> on ${esc(t.vote.legis_num)} · ${esc(t.vote.date)}</div></div>
      <span class="badge ${badge(t.label)}">${esc(t.label)}</span>
    </div>
    ${flow(t)}
    <div class="small" style="margin-bottom:10px"><strong>Why this label:</strong> ${esc(t.label_why)}</div>
    <div class="two">
      <div><h3 style="font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em">Money in this sector</h3>
        <table><thead><tr><th>Committee</th><th>Side</th><th style="text-align:right">Total</th></tr></thead><tbody>
        ${t.money.pacs.slice(0,10).map(p=>`<tr><td>${srcLink(p.fec_url,p.name)}<div class="src">rule ${esc(p.rule_id||"—")} · ${p.payments.length} payment(s)</div></td><td class="small">${esc(p.side||"—")}</td><td class="mono" style="text-align:right">${money(p.total)}</td></tr>`).join("")}
        </tbody></table>
        <div class="small" style="margin-top:8px">Money from committees on the opposing side of this sector: <strong class="mono">${money(t.money.opposed_side_dollars)}</strong></div>
      </div>
      <div><h3 style="font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em">Context you need before concluding anything</h3>
        <table><tbody>
        <tr><td>Voted with</td><td class="mono">${esc(t.context.voted_with_n_of_chamber)} voting members</td></tr>
        <tr><td>Voted with own party</td><td class="mono">${esc(t.context.voted_with_own_party)} (${t.context.party_line_share_pct??"—"}%)</td></tr>
        <tr><td>Sector share of PAC money</td><td class="mono">${t.money.sector_share_pct}%</td></tr>
        <tr><td>Sector match evidence</td><td class="small">${t.sectors.map(s=>esc(s.evidence)).join("<br>")}</td></tr>
        </tbody></table>
        <details><summary>How the whole Wisconsin delegation voted</summary>
        <table><tbody>${del.map(d=>`<tr><td>${partyChip(d.party)} ${esc(d.full_name||d.name_raw)}</td><td class="small">${d.district?"WI-"+String(d.district).padStart(2,"0"):""}</td><td class="vote-${esc(d.position)}">${esc(d.position)}</td></tr>`).join("")}</tbody></table></details>
      </div>
    </div>
    <div class="disc"><strong>Read this before you draw a conclusion.</strong> ${esc(t.disclaimer)}</div>
  </div>`;
}

function renderTrails(filter){
  const f=(filter||"").toLowerCase();
  const list=DB.trails.filter(t=>!f||JSON.stringify([t.member.name,t.bill.title,t.vote.legis_num,t.sectors.map(s=>s.sector)]).toLowerCase().includes(f));
  const counts=DB.trails.reduce((a,t)=>(a[t.label]=(a[t.label]||0)+1,a),{});
  return `<h2>Money trails</h2>
  <p class="small">${DB.trails.length} member-vote pairs where a bill's sector overlaps with PAC money the member received. A trail appearing here is <strong>not</strong> an allegation.</p>
  <div class="card"><h3 style="font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em">What the engine actually concluded</h3>
  <div class="grid g4" style="margin-top:10px">${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
    <div><span class="badge ${badge(k)}">${esc(k)}</span><div class="kpi mono" style="margin-top:6px">${v}</div></div>`).join("")}</div>
  <p class="small" style="margin-top:12px">Read that distribution carefully, because it is the whole point. Out of ${DB.trails.length} overlaps, the engine rules almost all of them uninformative — either the vote was near-unanimous, or the member simply voted with their party. That is the honest answer most of the time, and a tool that produced a scandal from every one of these would be lying to you.</p></div>
  <input type="search" id="q" placeholder="Filter by member, bill, or sector…" value="${esc(filter||"")}">
  <div style="height:14px"></div>
  ${list.slice(0,40).map(renderTrail).join("")||'<div class="card small">No trails match that filter.</div>'}
  ${list.length>40?`<div class="card small">Showing 40 of ${list.length}. Narrow the filter to see more.</div>`:""}`;
}

function renderEarmarks(){
  const E=DB.earmarks, wiTotal=E.by_member.reduce((a,b)=>a+b.total,0);
  const maxSub=Math.max(...E.by_sub.map(s=>s.total));
  return `<h2>Earmark audit — FY2026 Community Project Funding</h2>
  <p class="small">Every House member who requested an earmark had to disclose it publicly. This is that disclosure file, in full: <strong class="mono">${E.national.n.toLocaleString()}</strong> requests worth <strong class="mono">${money(E.national.total)}</strong> nationally. Wisconsin members filed <strong class="mono">${E.wi.length}</strong> requests worth <strong class="mono">${money(wiTotal)}</strong>.</p>
  <div class="disc"><strong>CivicTrace does not call any project "pork."</strong> Whether a runway repair, a water main or a job-training grant is essential infrastructure or wasteful spending is a political judgement, and it is yours to make. What we do is make every request countable, comparable and traceable to the member who asked for it. The word "earmark" here is descriptive, not pejorative. Both parties use the process heavily and neither is the outlier: Democrats filed more individual requests, Republicans requested more total dollars. The numbers are directly below — check them rather than taking our word for it.</div>
  <div class="grid g4" style="margin-top:14px">
    ${E.by_party.map(p=>`<div class="card"><div class="small">${p.party==="D"?"Democratic":p.party==="R"?"Republican":esc(p.party)} requests, nationwide</div>
      <div class="kpi mono">${money(p.total)}</div><div class="small">${p.n.toLocaleString()} projects</div></div>`).join("")}
  </div>
  <h2>Wisconsin members</h2>
  <div class="grid g3">${E.by_member.map(m=>`
    <div class="card"><h3>${partyChip(m.party==="R"?"Republican":"Democrat")} ${esc(m.member_name)}</h3>
    <div class="small">${esc(m.district)}</div>
    <div class="kpi mono" style="margin-top:10px">${money(m.total)}</div>
    <div class="small">${m.n} requests · avg ${money(m.total/m.n)}</div>
    <div class="bar"><i style="width:${Math.max(2,100*m.total/E.by_member[0].total)}%"></i></div>
    <div class="small" style="margin-top:10px">${srcLink(m.member_url,"Member's own disclosure page")}</div></div>`).join("")}
  </div>
  <div class="card"><h3>Three Wisconsin members filed no FY2026 CPF requests</h3>
  <p class="small">Bryan Steil (WI-01), Glenn Grothman (WI-06) and Tom Tiffany (WI-07) do not appear in the House file. Senators are not in this dataset at all — Senate Congressionally Directed Spending is published by each senator individually, with no central file. That gap is real and we show it rather than papering over it.</p></div>
  <h2>Where the Wisconsin money was requested</h2>
  <div class="card"><table><thead><tr><th>Appropriations subcommittee</th><th style="text-align:right">Projects</th><th style="text-align:right">Requested</th><th style="width:32%"></th></tr></thead><tbody>
  ${E.by_sub.map(s=>`<tr><td>${esc(s.subcommittee)}</td><td class="mono" style="text-align:right">${s.n}</td><td class="mono" style="text-align:right">${money(s.total)}</td><td><div class="bar"><i style="width:${Math.max(2,100*s.total/maxSub)}%"></i></div></td></tr>`).join("")}
  </tbody></table></div>
  <h2>Every Wisconsin request</h2>
  <div class="card"><input type="search" id="eq" placeholder="Filter projects by recipient, member or keyword…"><div style="height:12px"></div>
  <table id="etab"><thead><tr><th>Member</th><th>Recipient &amp; project</th><th>Subcommittee</th><th style="text-align:right">Requested</th></tr></thead><tbody>
  ${E.wi.map(e=>`<tr data-s="${esc((e.member_name+" "+e.recipient+" "+e.project+" "+e.subcommittee).toLowerCase())}">
    <td>${partyChip(e.party==="R"?"Republican":"Democrat")} ${esc(e.member_name)}<div class="src">${esc(e.district)}</div></td>
    <td><strong>${esc(e.recipient)}</strong><div class="small">${esc(e.project)}</div></td>
    <td class="small">${esc(e.subcommittee)}</td>
    <td class="mono" style="text-align:right">${money(e.amount)}</td></tr>`).join("")}
  </tbody></table>
  <div class="small" style="margin-top:10px">Source: ${srcLink(E.wi[0]&&E.wi[0].source_url,"House Appropriations Committee, FY26 consolidated CPF file (XLSX)")}</div></div>
  <h2>National context — top 10 requesters</h2>
  <div class="card"><table><thead><tr><th>Member</th><th>District</th><th style="text-align:right">Requested</th></tr></thead><tbody>
  ${E.rank.map(r=>`<tr><td>${partyChip(r.party==="R"?"Republican":"Democrat")} ${esc(r.member_name)}</td><td class="small">${esc(r.district)}</td><td class="mono" style="text-align:right">${money(r.total)}</td></tr>`).join("")}
  </tbody></table><div class="small" style="margin-top:8px">Shown so Wisconsin's numbers can be read against the rest of the House rather than in isolation.</div></div>`;
}

function renderMethod(){
  return `<h2>Methodology</h2>
  <div class="card"><h3>What is in this prototype</h3>
  <table><tbody>
  <tr><td>PAC contributions loaded</td><td class="mono">${DB.stats.contributions.toLocaleString()}</td><td class="small">FEC bulk <code>pas2</code>, 2024 + 2026 cycles, Wisconsin candidates</td></tr>
  <tr><td>Earmark requests (FY2026 CPF)</td><td class="mono">${DB.stats.earmarks.toLocaleString()}</td><td class="small">House Appropriations consolidated XLSX — members' own disclosures</td></tr>
  <tr><td>Roll calls</td><td class="mono">${DB.stats.rollcalls}</td><td class="small">House Clerk EVS XML + Senate LIS XML, 119th Congress</td></tr>
  <tr><td>Individual vote positions</td><td class="mono">${DB.stats.positions.toLocaleString()}</td><td class="small">every member, not just Wisconsin — needed for base rates</td></tr>
  <tr><td>Bills</td><td class="mono">${DB.stats.bills}</td><td class="small">GovInfo BILLSTATUS XML incl. CRS summaries and policy areas</td></tr>
  <tr><td>Committees</td><td class="mono">${DB.stats.committees.toLocaleString()}</td><td class="small">FEC <code>cm</code> master file</td></tr>
  </tbody></table></div>
  <div class="card"><h3>Counting rules</h3><ul class="small">
  <li>Only FEC transaction type <code>24K</code> — a direct contribution from a committee to a candidate's committee, as reported by the <strong>giving</strong> committee (Schedule B). Independent expenditures (<code>24E</code>/<code>24A</code>) are excluded because they are spending <em>about</em> a candidate, not money <em>to</em> them.</li>
  <li><strong>Our totals do not reconcile to the FEC candidate page, and that is expected.</strong> The candidate page reports Schedule A line 11(c) — what the campaign said it received (receipt codes 15/15E/15K). We report Schedule B — what the PACs said they gave. Filing-frequency mismatches, amendments, and one-sided itemization guarantee a gap. Any production version of this site must display both figures side by side and explain the difference rather than picking one and hoping nobody checks.</li>
  <li>Votes recorded as <code>Not Voting</code>, <code>Present</code> or <code>Paired</code> are excluded — both as a member's own position and from every denominator. An absence is not a position, and counting it as one manufactures fake party splits.</li>
  <li>Votes where fewer than 10% of members took the losing side, and bills flagged as omnibus/appropriations (which touch every sector at once), are excluded from alignment analysis entirely.</li>
  <li>Rows flagged <code>MEMO_CD = 'X'</code> are excluded. They restate money counted elsewhere; including them is the most common way campaign finance totals get inflated.</li>
  <li>Every contribution keeps its FEC <code>SUB_ID</code> and image number, so any figure can be traced back to the filed report.</li>
  <li>Sector labels come from published keyword rules. Every label records the rule ID that produced it. Where no rule matches, the committee is labeled by its FEC structural code (leadership PAC, party committee, corporate, trade) or left Unclassified — never guessed.</li>
  <li>Bill sectors come from the CRS policy area first, then title/summary keyword rules. The matching evidence is shown on every trail.</li>
  </ul></div>
  <div class="card"><h3>What this does not do</h3><ul class="small">
  <li>It never states or implies that a contribution caused a vote.</li>
  <li>It always shows how the member's party voted. A vote where 95% of the party agreed tells you nothing about money, and the label says so.</li>
  <li>It always shows money from the opposing side of the same sector in the same table.</li>
  <li>It does not rank or score members against each other.</li>
  </ul></div>
  <div class="card"><h3>Sources</h3><ul class="small">
  <li>${srcLink("https://www.fec.gov/data/browse-data/?tab=bulk-data","FEC bulk data downloads")} — public domain, attribution required</li>
  <li>${srcLink("https://clerk.house.gov/Votes","U.S. House Clerk roll call votes")}</li>
  <li>${srcLink("https://www.senate.gov/legislative/votes_new.htm","U.S. Senate roll call votes")}</li>
  <li>${srcLink("https://www.govinfo.gov/bulkdata/BILLSTATUS","GovInfo BILLSTATUS bulk data")}</li>
  <li>${srcLink("https://github.com/unitedstates/congress-legislators","unitedstates/congress-legislators")} — CC0</li>
  </ul>
  <div class="disc">FEC contributor names and addresses may not be sold or used to solicit contributions (52 U.S.C. §30111(a)(4)). This prototype shows committee-level contributions only and does not expose individual donor contact information.</div>
  </div>`;
}

const VIEWS={people:renderPeople,trails:()=>renderTrails(""),earmarks:renderEarmarks,method:renderMethod};
function go(v){
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  $("#app").innerHTML=VIEWS[v]();
  const eq=$("#eq");
  if(eq){eq.addEventListener("input",e=>{const v=e.target.value.toLowerCase();
    document.querySelectorAll("#etab tbody tr").forEach(tr=>tr.classList.toggle("hide",v&&!tr.dataset.s.includes(v)));});}
  const q=$("#q");
  if(q){q.addEventListener("input",e=>{const val=e.target.value;$("#app").innerHTML=renderTrails(val);
    const n=$("#q");n.value=val;n.focus();n.setSelectionRange(val.length,val.length);
    n.addEventListener("input",arguments.callee);});}
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>go(b.dataset.v));
go("people");
"""

HTML = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CivicTrace — Wisconsin prototype</title><style>{CSS}</style></head><body>
<header><div class="wrap">
  <div class="brand"><span class="logo">CT</span> CivicTrace <span style="font-weight:400;color:var(--dim);font-size:15px">· Wisconsin</span></div>
  <div class="tag">Follow public records. Draw your own conclusions. — working prototype built {BUILT} from live federal data</div>
  <nav>
    <button data-v="people" class="on">Delegation</button>
    <button data-v="trails">Money trails</button>
    <button data-v="earmarks">Earmark audit</button>
    <button data-v="method">Methodology</button>
  </nav>
</div></header>
<main id="app"></main>
<script>window.__CT__={payload};</script>
<script>{JS}</script>
</body></html>"""

OUT.write_text(HTML, encoding="utf-8")
print("wrote", OUT, f"{OUT.stat().st_size/1024:.0f} KB")
