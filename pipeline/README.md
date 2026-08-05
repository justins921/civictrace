# CivicTrace — Wisconsin prototype

Working reference implementation for the CivicTrace v1.0 PRD. Everything here runs
against live government data; no figure in this repo is invented or estimated.

## Run it

```bash
pip install openpyxl
python3 etl.py            # FEC bulk + congress-legislators -> SQLite
python3 fetch_votes.py    # House Clerk + Senate roll call XML  (~8 min, polite delays)
python3 fetch_bills.py    # GovInfo BILLSTATUS XML
python3 sectors.py        # classification ruleset
python3 load_earmarks.py  # House FY26 CPF earmarks + data fixes
python3 build_site.py     # -> civictrace-wisconsin.html
```

`data/` holds the raw source files exactly as downloaded. Keep them — the archive
IS the evidence.

## Read the code in this order

1. `sectors.py` — the classification ruleset. Every rule has an ID.
2. `trail.py` — the money-trail engine. The header comment states the four rules
   the whole project depends on.
3. `build_site.py` — the UI, including every mandatory disclaimer.

## Sources

FEC bulk downloads · US House Clerk EVS · US Senate LIS · GovInfo BILLSTATUS ·
unitedstates/congress-legislators (CC0) · House Appropriations FY26 CPF file

FEC contributor names and addresses may not be sold or used to solicit
contributions (52 U.S.C. §30111(a)(4)). This prototype shows committee-level
contributions only.
