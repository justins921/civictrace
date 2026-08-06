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
unitedstates/congress-legislators (CC0) · House Appropriations FY26 CPF file ·
openFEC candidate totals · FEC independent expenditure bulk file

### On individual contributor data

This prototype publishes committee-level contributions only. **That is an
editorial choice, not a legal requirement**, and an earlier version of this file
said otherwise.

52 U.S.C. §30111(a)(4) prohibits *selling* contributor names and addresses, and
using them to solicit contributions or for commercial purposes. It does not
prohibit republication. 11 CFR 104.15(c) permits use "in newspapers, magazines,
books or other similar communications", and the FEC's own guidance says
explicitly that news and opinion websites may republish individual contributor
information. *FEC v. Political Contributions Data, Inc.*, 943 F.2d 190 (2d Cir.
1991) read "commercial purposes" narrowly on First Amendment grounds.

We publish committee giving because a searchable index of private citizens by
name, home address, employer and political giving is a different product from a
record of organised money, and it is the one that gets misused. When individual
giving is added it will be aggregated by employer and occupation, not offered as
lookup-by-name.

**Wisconsin state data is a different question and the caution there stands.**
Wis. Stat. §11.1304(12) forbids any commercial use of information copied from
state campaign finance reports, with no media exception and no state analogue to
11 CFR 104.15(c).
