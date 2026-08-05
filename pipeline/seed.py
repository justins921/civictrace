import json, os, sys, urllib.request
from pathlib import Path
URL="https://vzvtlwfvncwwtzntndmy.supabase.co/rest/v1"
KEY="sb_publishable_962AMHB-5EccIqag-UyHEQ_hl5Rd4_V"
ORDER=["01_member.member","02_committee.committee","03_bill.bill","04_bill_sector.bill_sector",
 "05_rollcall.rollcall","06_breakdown.rollcall_breakdown","07_position.vote_position",
 "08_support.pac_support","09_earmark.earmark","09b_earmark_agg.earmark_agg","10_trail.money_trail"]
def post(table, rows):
    body=json.dumps(rows).encode()
    req=urllib.request.Request(f"{URL}/{table}", data=body, method="POST", headers={
        "apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json",
        "Content-Profile":"civictrace","Prefer":"return=minimal,resolution=ignore-duplicates"})
    try:
        urllib.request.urlopen(req, timeout=120); return None
    except urllib.error.HTTPError as e:
        return f"{e.code} {e.read()[:400].decode(errors='replace')}"
for stem in ORDER:
    table=stem.split(".",1)[1]
    rows=json.loads((Path("sql")/f"{stem}.json").read_text())
    B=200 if table in ("pac_support","money_trail","bill") else 500
    bad=0
    for i in range(0,len(rows),B):
        err=post(table, rows[i:i+B])
        if err: bad+=1; print(f"  !! {table} batch {i}: {err}")
    print(f"{table}: {len(rows)} rows{' OK' if not bad else f' ({bad} failed batches)'}")
