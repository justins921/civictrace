#!/usr/bin/env python3
"""CivicTrace sector classification — deliberately rule-based and auditable.

Every classification stores the exact rule id that produced it, so any user can
ask "why is this PAC labeled Energy & Utilities?" and get a literal answer.
No machine-learned or opaque classification is used for anything a user sees.

`interest_side` is the field that keeps the platform honest: within a sector,
different PACs want opposite outcomes. A utility PAC and an environmental PAC
are both "Energy" but they are not on the same side. Recording the side means
the money trail can show contradicting money with equal prominence, which is
both the legal safe harbour and the actual point of the project.
"""
import re, sqlite3, json
from pathlib import Path

# (rule_id, sector, regex, interest_side)
PAC_RULES = [
    ("E01", "Energy & Utilities", r"\b(WEC ENERGY|ALLIANT ENERGY|XCEL|DTE ENERGY|DUKE ENERGY|EXELON|AMEREN|EDISON|SOUTHERN CO|DOMINION|NEXTERA|ENTERGY|PG&E|CONSUMERS ENERGY|EVERGY|PPL |FIRSTENERGY)\b", "utility"),
    ("E02", "Energy & Utilities", r"\b(EDISON ELECTRIC|RURAL ELECTRIC|ELECTRIC COOPERATIVE|AMERICA'S ELECTRIC)\b", "utility"),
    ("E03", "Energy & Utilities", r"\b(EXXON|CHEVRON|VALERO|MARATHON PETROLEUM|PHILLIPS 66|CONOCO|OCCIDENTAL|HESS|DEVON ENERGY|PIONEER NATURAL|API |AMERICAN PETROLEUM|AMERICAN FUEL|PETROLEUM MARKETERS|INDEPENDENT PETROLEUM)\b", "oil & gas"),
    ("E04", "Energy & Utilities", r"\b(NATURAL GAS|GAS ASSOCIATION|PROPANE|PIPELINE)\b", "oil & gas"),
    ("E05", "Energy & Utilities", r"\b(GROWTH ENERGY|RENEWABLE FUELS|ETHANOL|BIODIESEL|POET |CLEAN FUELS)\b", "biofuels"),
    ("E06", "Energy & Utilities", r"\b(SOLAR|WIND ENERGY|CLEAN ENERGY|RENEWABLE ENERGY|LEAGUE OF CONSERVATION|SIERRA CLUB|ENVIRONMENTAL DEFENS|NRDC)\b", "clean energy / environment"),
    ("E07", "Energy & Utilities", r"\b(COAL|MINING|NATIONAL MINING|HARDROCK|CRITICAL MINERAL)\b", "mining"),
    ("E08", "Energy & Utilities", r"\b(NUCLEAR ENERGY|EXELON NUCLEAR)\b", "nuclear"),

    ("F01", "Finance & Insurance", r"\b(BANKERS ASSOCIATION|BANKERS ASSN|AMERICAN BANKERS|INDEPENDENT COMMUNITY BANKERS|BANK OF AMERICA|JPMORGAN|WELLS FARGO|CITIGROUP|GOLDMAN SACHS|MORGAN STANLEY|US BANCORP|PNC |CAPITAL ONE|CREDIT UNION)\b", "banking"),
    ("F02", "Finance & Insurance", r"\b(NORTHWESTERN MUTUAL|AMERICAN FAMILY|STATE FARM|ALLSTATE|PROGRESSIVE|MET ?LIFE|PRUDENTIAL|AFLAC|NATIONWIDE|INSURANCE|INSURERS|NAIFA|INDEPENDENT INSURANCE AGENTS)\b", "insurance"),
    ("F03", "Finance & Insurance", r"\b(INVESTMENT COMPANY INSTITUTE|SECURITIES INDUSTRY|SIFMA|BLACKROCK|VANGUARD|FIDELITY|CHARLES SCHWAB|MANAGED FUNDS|PRIVATE EQUITY|AMERICAN INVESTMENT COUNCIL|FINANCIAL SERVICES)\b", "investment"),
    ("F04", "Finance & Insurance", r"\b(VISA |MASTERCARD|AMERICAN EXPRESS|PAYPAL|DISCOVER FINANCIAL|ELECTRONIC PAYMENTS|CONSUMER BANKERS)\b", "payments"),

    ("H01", "Health Care", r"\b(AMERICAN MEDICAL|MEDICAL ASSOCIATION|AMERICAN HOSPITAL|HOSPITAL ASSOCIATION|NURSES|AMERICAN COLLEGE OF|ACADEMY OF FAMILY PHYSICIANS|SURGEONS|ANESTHESIOL|RADIOLOG|EMERGENCY PHYSICIANS|DENTAL|OPTOMETRIC|CHIROPRACTIC|PHYSICAL THERAPY)\b", "providers"),
    ("H02", "Health Care", r"\b(PHRMA|PHARMACEUTICAL|MERCK|PFIZER|ELI LILLY|ABBVIE|AMGEN|JOHNSON & JOHNSON|BRISTOL|BIOTECHNOLOGY|BIO PAC|GENENTECH|NOVARTIS|ASTRAZENECA|SANOFI)\b", "pharma"),
    ("H03", "Health Care", r"\b(UNITEDHEALTH|ELEVANCE|ANTHEM|CIGNA|HUMANA|CENTENE|AHIP|BLUE CROSS|HEALTH INSURANCE PLANS|MOLINA)\b", "health insurers"),
    ("H04", "Health Care", r"\b(ADVAMED|MEDICAL DEVICE|MEDTRONIC|BOSTON SCIENTIFIC|BECTON|STRYKER|ZIMMER|ABBOTT LABORATOR|GE HEALTHCARE)\b", "device makers"),
    ("H05", "Health Care", r"\b(PHARMACISTS|CHAIN DRUG|CVS |WALGREEN|NATIONAL COMMUNITY PHARMACISTS|MCKESSON|CARDINAL HEALTH|CENCORA|AMERISOURCE)\b", "pharmacy & distribution"),

    ("A01", "Agriculture & Food", r"\b(FARM BUREAU|FARM CREDIT|FARMERS UNION|NATIONAL CORN|SOYBEAN|WHEAT GROWERS|CATTLEMEN|PORK PRODUCERS|DAIRY|MILK PRODUCERS|LAND O'?LAKES|SUGAR|CROP INSURANCE|AGRIBUSINESS|AGRICULTURAL RETAILERS)\b", "producers"),
    ("A02", "Agriculture & Food", r"\b(CARGILL|ADM |ARCHER DANIELS|TYSON|SMITHFIELD|HORMEL|KRAFT|GENERAL MILLS|CONAGRA|PEPSI|COCA-?COLA|NESTLE|FOOD MARKETING|GROCERS|RESTAURANT ASSOCIATION|NATIONAL RESTAURANT)\b", "processors & retail"),
    ("A03", "Agriculture & Food", r"\b(BAYER|CORTEVA|SYNGENTA|MOSAIC|NUTRIEN|FERTILIZER|CROPLIFE|PESTICIDE|DEERE|CNH |AGCO|EQUIPMENT MANUFACTURERS)\b", "inputs & equipment"),

    ("L01", "Labor", r"\b(AFL-?CIO|TEAMSTERS|UAW|AFSCME|SEIU|IBEW|INTERNATIONAL BROTHERHOOD|UNITED STEELWORKERS|MACHINISTS|CARPENTERS|LABORERS|PLUMBERS|OPERATING ENGINEERS|SHEET METAL|IRON WORKERS|BRICKLAYERS|PAINTERS|BOILERMAKERS|LETTER CARRIERS|POSTAL WORKERS|TRANSPORT WORKERS|FLIGHT ATTENDANTS|AIR LINE PILOTS|EDUCATION ASSOCIATION|FEDERATION OF TEACHERS|FIRE FIGHTERS|POLICE ORGANIZATIONS|UNITED FOOD AND COMMERCIAL|COMMUNICATIONS WORKERS|BUILDING TRADES)\b", "organized labor"),

    ("R01", "Real Estate & Construction", r"\b(REALTORS|HOME BUILDERS|APARTMENT ASSOCIATION|MORTGAGE BANKERS|REAL ESTATE ROUNDTABLE|BUILDING OWNERS|COMMERCIAL REAL ESTATE|NAIOP)\b", "real estate"),
    ("R02", "Real Estate & Construction", r"\b(ASSOCIATED GENERAL CONTRACTORS|ASSOCIATED BUILDERS|ELECTRICAL CONTRACTORS|MECHANICAL CONTRACTORS|NATIONAL ASSOCIATION OF SURETY|ROAD.{0,12}BUILDERS|CONSTRUCTION)\b", "construction"),
    ("R03", "Real Estate & Construction", r"\b(ENGINEERING COMPANIES|CONSULTING ENGINEERS|ARCHITECTS|AECOM|JACOBS ENGINEERING|KIEWIT|FLUOR)\b", "engineering"),

    ("T01", "Transportation", r"\b(AIRLINES|AIRLINE|DELTA AIR|UNITED AIRLINES|AMERICAN AIRLINES|SOUTHWEST AIRLINES|AIRPORTS)\b", "aviation"),
    ("T02", "Transportation", r"\b(TRUCKING|TRUCKERS|UPS |FEDEX|MOTOR CARRIERS|OWNER-?OPERATOR)\b", "trucking"),
    ("T03", "Transportation", r"\b(RAILROAD|UNION PACIFIC|CSX |NORFOLK SOUTHERN|BNSF|AMTRAK|RAILWAY)\b", "rail"),
    ("T04", "Transportation", r"\b(AUTO DEALERS|AUTOMOBILE DEALERS|GENERAL MOTORS|FORD MOTOR|TOYOTA|STELLANTIS|HONDA|AUTO CARE|AUTOMOTIVE)\b", "auto"),
    ("T05", "Transportation", r"\b(MARITIME|SHIPBUILDERS|WATERWAYS|PORT AUTHORITY|CRUISE LINES)\b", "maritime"),

    ("D01", "Defense & Aerospace", r"\b(LOCKHEED|RAYTHEON|RTX |NORTHROP|BOEING|GENERAL DYNAMICS|L3HARRIS|HUNTINGTON INGALLS|BAE SYSTEMS|LEIDOS|BOOZ ALLEN|TEXTRON|AEROSPACE INDUSTRIES|OSHKOSH CORP)\b", "defense contractors"),

    ("C01", "Tech & Communications", r"\b(GOOGLE|ALPHABET|META PLATFORMS|FACEBOOK|AMAZON|MICROSOFT|APPLE INC|ORACLE|IBM |INTEL |QUALCOMM|NVIDIA|SALESFORCE|ADOBE|SEMICONDUCTOR|CONSUMER TECHNOLOGY|NETCHOICE|SOFTWARE)\b", "tech platforms"),
    ("C02", "Tech & Communications", r"\b(AT&T|VERIZON|COMCAST|CHARTER COMMUNICATIONS|T-?MOBILE|CTIA|NCTA|BROADBAND|TELECOMMUNICATIONS|CABLE|SATELLITE|NAB |BROADCASTERS)\b", "telecom & media"),

    ("M01", "Manufacturing", r"\b(NATIONAL ASSOCIATION OF MANUFACTURERS|MANUFACTURERS|3M |HONEYWELL|EMERSON|CATERPILLAR|ROCKWELL|JOHNSON CONTROLS|HARLEY-?DAVIDSON|KOHLER|GENERATOR|BRIGGS & STRATTON|STEEL|ALUMINUM|CHEMISTRY COUNCIL|CHEMICAL|PLASTICS|PAPER|FOREST.{0,10}PAPER)\b", "manufacturers"),

    ("S01", "Small Business & Retail", r"\b(NFIB|SMALL BUSINESS|RETAIL FEDERATION|RETAIL LEADERS|FRANCHISE|CONVENIENCE STORES|WHOLESALER|DISTRIBUTORS|CHAMBER OF COMMERCE)\b", "business associations"),

    # Two rules, not one. G01 used to match the NRA and Everytown with the same
    # pattern and give both the side "firearms policy" — a label that treats the
    # two organisations most opposed to each other in American politics as
    # occupying the same position. Order matters: gun-violence-prevention groups
    # are matched first, because "FIREARMS" appears in the names of groups on
    # both sides and the broad pattern would otherwise swallow them.
    ("G01", "Guns & Public Safety", r"\b(EVERYTOWN|GIFFORDS|BRADY CAMPAIGN|BRADY PAC|MARCH FOR OUR LIVES|MOMS DEMAND)\b", "gun violence prevention"),
    ("G02", "Guns & Public Safety", r"\b(NATIONAL RIFLE|NRA |GUN OWNERS|FIREARMS|SPORTING SHOOTING|SAFARI CLUB|NATIONAL SHOOTING SPORTS)\b", "gun rights"),
    # The same defect as the old G01, one sector over: a single rule gave AIPAC
    # and J Street the same interest side, and gave every country-specific
    # advocacy committee the same one as well. AIPAC and J Street lobby against
    # each other on the substance of most of the bills they both work — a shared
    # label states that they want the same thing, which is the one claim the
    # record does not support. They are separated here by organisation, not by
    # position: CivicTrace does not say which of them is right, and Foreign
    # Policy is deliberately left with no declared axis for the same reason.
    # J Street is matched first because "ISRAEL" appears in names on both sides.
    ("I01", "Foreign Policy", r"\b(J STREET)\b", "Israel policy — J Street"),
    ("I02", "Foreign Policy", r"\b(AMERICAN ISRAEL PUBLIC AFFAIRS|AIPAC)\b", "Israel policy — AIPAC"),
    ("I03", "Foreign Policy", r"\b(ARMENIAN)\b", "Armenian-American advocacy"),
    ("I04", "Foreign Policy", r"\b(HELLENIC)\b", "Greek-American advocacy"),
    ("I05", "Foreign Policy", r"\b(INDIA POLITICAL)\b", "India–U.S. advocacy"),
    ("I06", "Foreign Policy", r"\b(TURKISH)\b", "Turkey–U.S. advocacy"),
    ("J01", "Legal", r"\b(TRIAL LAWYERS|ASSOCIATION FOR JUSTICE|BAR ASSOCIATION|ATTORNEYS|LAW FIRM)\b", "legal profession"),
]

# --------------------------------------------------------------- interest axes
#
# C2, from the August 2026 outside review. `interest_side` recorded *what kind*
# of giver a committee is, but nothing recorded which sides are opposed to which
# — so `OPPOSING` in trail.py was a hand-written one-element set and every sector
# except Energy reported $0 opposing money by construction. A zero that can only
# ever be zero is not evidence of anything.
#
# An axis is only declared where two organised constituencies genuinely lobby
# against each other on the same bills, and where CivicTrace can name them
# without making a political judgement. Everything not listed here has no axis,
# and the trail pages say "no opposing side is classified for this industry"
# rather than printing a $0 that reads like a finding.
#
# Deliberately NOT declared, and why:
#   Agriculture     producers vs processors do fight over packer concentration,
#                   but they are on the same side of most farm-bill votes.
#   Labor / Legal   their opponents sit in other sectors (business associations,
#                   tort reform), and this axis is within-sector by construction.
#   Tech, Defense,  no organised counter-constituency appears in FEC committee
#   Transportation  giving to this delegation at all.
#
# Sides that exist in a sector with an axis but sit on neither pole are recorded
# as unaligned, not silently folded into one side. Nuclear and biofuels are the
# live examples: both are contested ground in energy politics and putting them
# on a pole would be an editorial call, not a classification.
SECTOR_AXIS = {
    "Energy & Utilities": {
        "axis": "carbon-intensive energy vs climate and conservation advocacy",
        "poles": {
            "carbon-intensive energy": ["oil & gas", "mining"],
            "climate & conservation": ["clean energy / environment"],
        },
        # Investor-owned utilities were on the carbon pole and should not have
        # been. Rule E01 matches Exelon, whose generation is majority nuclear,
        # and NextEra, the largest operator of wind and solar in the United
        # States, alongside utilities that burn mostly coal. A regulated utility
        # buys whatever its state commission lets it build, and its position on
        # a given energy bill follows from that mix rather than from being a
        # utility. Putting the whole side on one pole was an editorial call
        # dressed as a classification — and it was the side with the most money
        # in it, so it decided the pole split on most energy trails.
        "unaligned_note": "Utility, nuclear and biofuel committees are recorded but "
                          "placed on neither pole. Utilities own generation across the "
                          "whole mix, from lignite to offshore wind, and nuclear and "
                          "biofuels are contested ground in energy politics; assigning "
                          "any of them to a pole would be a political judgement rather "
                          "than a classification.",
    },
    "Health Care": {
        "axis": "payers vs providers",
        "poles": {
            "payers": ["health insurers"],
            "providers": ["providers"],
        },
        "unaligned_note": "Pharmaceutical, device and pharmacy committees are recorded "
                          "but placed on neither pole: their fights run across this axis "
                          "rather than along it.",
    },
    "Guns & Public Safety": {
        "axis": "gun rights vs gun violence prevention",
        "poles": {
            "gun rights": ["gun rights"],
            "gun violence prevention": ["gun violence prevention"],
        },
        "unaligned_note": "",
    },
}

# side -> (sector, pole). Built once so the trail engine never re-derives it.
SIDE_POLE = {}
for _sec, _cfg in SECTOR_AXIS.items():
    for _pole, _sides in _cfg["poles"].items():
        for _side in _sides:
            SIDE_POLE[(_sec, _side)] = _pole


# Bill -> sector. Matched against CRS policy area first, then title/summary text.
BILL_POLICY_SECTOR = {
    "Energy": ["Energy & Utilities"],
    "Environmental Protection": ["Energy & Utilities"],
    "Public Lands and Natural Resources": ["Energy & Utilities"],
    "Finance and Financial Sector": ["Finance & Insurance"],
    "Health": ["Health Care"],
    "Agriculture and Food": ["Agriculture & Food"],
    "Labor and Employment": ["Labor"],
    "Housing and Community Development": ["Real Estate & Construction"],
    "Transportation and Public Works": ["Transportation", "Real Estate & Construction"],
    "Armed Forces and National Security": ["Defense & Aerospace"],
    "Science, Technology, Communications": ["Tech & Communications"],
    "Commerce": ["Small Business & Retail", "Manufacturing"],
    "Taxation": ["Finance & Insurance", "Small Business & Retail"],
    "Crime and Law Enforcement": ["Guns & Public Safety"],
    "International Affairs": ["Foreign Policy"],
    "Foreign Trade and International Finance": ["Manufacturing"],
}
BILL_TEXT_RULES = [
    ("BT01", "Energy & Utilities", r"\b(energy|electric|pipeline|drilling|oil|natural gas|emission|mineral|mining|solar|wind|nuclear|utility|appliance|furnace|water heater|greenhouse gas)\b"),
    ("BT02", "Finance & Insurance", r"\b(bank|securities|investment|retirement savings|fiduciary|insurance|credit|mortgage|ESG)\b"),
    ("BT03", "Health Care", r"\b(medicare|medicaid|health|drug pricing|hospital|physician|prescription|FDA)\b"),
    ("BT04", "Agriculture & Food", r"\b(agricultur|farm|crop|livestock|dairy|ethanol|SNAP|nutrition|USDA)\b"),
    ("BT05", "Labor", r"\b(worker|labor|union|wage|overtime|OSHA|collective bargaining|employee)\b"),
    ("BT06", "Real Estate & Construction", r"\b(housing|construction|permitting|infrastructure|highway|building code|zoning)\b"),
    ("BT07", "Transportation", r"\b(aviation|airline|rail|truck|motor carrier|highway|transit|maritime|vehicle)\b"),
    ("BT08", "Defense & Aerospace", r"\b(defense|military|armed forces|weapon|shipbuilding|procurement)\b"),
    ("BT09", "Tech & Communications", r"\b(broadband|spectrum|internet|data privacy|semiconductor|artificial intelligence|telecommunications)\b"),
    ("BT10", "Manufacturing", r"\b(manufactur|steel|aluminum|chemical|tariff|supply chain|industrial)\b"),
]


# Bill -> a specific line of business inside a sector.
#
# "Transportation" contains aviation, rail, trucking, auto and maritime, and the
# bill match was happening at the sector level only. That is how an aviation
# safety bill came to be backed by railroad money on the site's flagship trail.
# These rules read the bill's own title and CRS summary and, where the subject is
# unambiguous, pin it to one `interest_side`. Money from the same sector on a
# different side is then reported separately instead of counted as sector money.
#
# Only unambiguous subjects get a rule. A bill about "surface transportation
# generally" has no side here, and falls back to whole-sector matching — that is
# the honest answer, not a guess.
BILL_SIDE_RULES = [
    ("BS-A1", "Transportation", "aviation",
     r"\b(aviation|aircraft|rotorcraft|helicopter|airline|airport|air traffic|ADS-?B|FAA|"
     r"federal aviation|pilot|airspace|airworthiness)\b"),
    ("BS-A2", "Transportation", "rail",
     r"\b(railroad|railway|rail carrier|amtrak|locomotive|freight rail|passenger rail|"
     r"grade crossing|surface transportation board)\b"),
    ("BS-A3", "Transportation", "trucking",
     r"\b(motor carrier|trucking|commercial driver|hours of service|highway safety|"
     r"interstate trucking)\b"),
    ("BS-A4", "Transportation", "maritime",
     r"\b(maritime|merchant marine|vessel|port authority|harbor|shipbuilding|coast guard|"
     r"jones act|waterway)\b"),
    ("BS-A5", "Transportation", "auto",
     r"\b(motor vehicle safety|automobile|passenger car|NHTSA|fuel economy standard|"
     r"vehicle emissions|autonomous vehicle)\b"),

    ("BS-H1", "Health Care", "pharma",
     r"\b(prescription drug|drug pricing|pharmaceutical|biosimilar|generic drug|"
     r"drug shortage|patent thicket|orphan drug)\b"),
    ("BS-H2", "Health Care", "health insurers",
     r"\b(health insurance|health plan|medicare advantage|prior authorization|"
     r"insurance marketplace|risk adjustment)\b"),
    ("BS-H3", "Health Care", "providers",
     r"\b(hospital|physician|nurse|graduate medical education|provider reimbursement|"
     r"rural health clinic|critical access)\b"),
    ("BS-H4", "Health Care", "device makers",
     r"\b(medical device|diagnostic equipment|durable medical equipment)\b"),
    ("BS-H5", "Health Care", "pharmacy & distribution",
     r"\b(pharmacy benefit manager|PBM|pharmacist|drug wholesaler|340B)\b"),

    ("BS-E1", "Energy & Utilities", "oil & gas",
     r"\b(oil and gas|petroleum|natural gas|offshore drilling|refinery|"
     r"strategic petroleum reserve|LNG|(natural gas|oil|gas|hazardous liquid) pipeline|"
     r"pipeline safety)\b"),
    ("BS-E2", "Energy & Utilities", "clean energy / environment",
     r"\b(renewable energy|solar power|wind energy|clean electricity|emissions reduction|"
     r"greenhouse gas|clean air act|endangered species|energy conservation standard|"
     r"climate change)\b"),
    ("BS-E3", "Energy & Utilities", "mining",
     r"\b(hardrock mining|critical mineral|coal mine|mine safety|mineral leasing)\b"),
    ("BS-E4", "Energy & Utilities", "nuclear",
     r"\b(nuclear reactor|nuclear energy|spent fuel|nuclear regulatory)\b"),
    ("BS-E5", "Energy & Utilities", "biofuels",
     r"\b(renewable fuel standard|ethanol|biodiesel|biofuel)\b"),

    ("BS-F1", "Finance & Insurance", "banking",
     r"\b(bank holding|community bank|credit union|deposit insurance|bank capital|"
     r"consumer financial protection)\b"),
    ("BS-F2", "Finance & Insurance", "insurance",
     r"\b(insurance company|flood insurance|reinsurance|insurance regulation)\b"),
    ("BS-F3", "Finance & Insurance", "investment",
     r"\b(securities and exchange|investment adviser|mutual fund|private equity|"
     r"capital formation|accredited investor)\b"),
    ("BS-F4", "Finance & Insurance", "payments",
     r"\b(interchange fee|payment card|credit card network|payment system)\b"),
]


def classify_pac(name, connected_org_name="", cmte_tp="", cmte_dsgn="", org_tp=""):
    """Industry rules win over structural codes: a corporate PAC that is also a
    leadership PAC should read as its industry. Structural codes are the fallback
    so 'Unclassified' means genuinely unknown, not just 'not an industry'."""
    hay = f"{name or ''} {connected_org_name or ''}".upper()
    for rid, sector, pat, side in PAC_RULES:
        if re.search(pat, hay):
            return rid, sector, side
    if (cmte_dsgn or "").strip() == "D":
        return "STR-LEAD", "Leadership PAC", "candidate-controlled"
    if (cmte_tp or "").strip() in ("X", "Y", "Z"):
        return "STR-PARTY", "Party Committee", "party"
    if (org_tp or "").strip() == "L":
        return "STR-LABOR", "Labor", "organized labor"
    if (org_tp or "").strip() == "C":
        return "STR-CORP", "Corporate (unclassified industry)", "corporate"
    if (org_tp or "").strip() in ("T", "M"):
        return "STR-TRADE", "Trade / Membership (unclassified industry)", "trade association"
    return None, "Unclassified", None


# H10, from the August 2026 review: a single common word was enough to attach a
# sector to a bill, so "health" anywhere in a defense authorisation made it a
# health-care bill and produced money trails off the back of it. These words are
# real signals in context and noise on their own, so on their own they no longer
# count. A rule fires when it matches something specific, or when a weak word
# appears in the *title* (where it is about the bill rather than incidental to
# it), or when several weak words appear together.
WEAK_TERMS = {
    "energy", "electric", "oil", "health", "credit", "bank", "insurance",
    "worker", "labor", "union", "wage", "employee", "housing", "building",
    "highway", "vehicle", "truck", "rail", "transit", "defense", "military",
    "weapon", "chemical", "industrial", "steel", "tariff", "internet", "farm",
    "crop", "utility", "mining", "water heater", "appliance",
}
WEAK_TOGETHER = 3     # this many distinct weak words, and nothing specific, still counts


def classify_bill(policy_area, title, summary):
    """Sector matches for a bill, with the weaker evidence dropped when better exists.

    A CRS policy area is one label for a whole committee's worth of subject
    matter, and several of them fan out to more than one sector: "Transportation
    and Public Works" hands a bill to both Transportation and Real Estate &
    Construction. That fan-out is a guess, and it was being treated as evidence
    equal to the bill's own words.

    The ROTOR Act is the case that exposed it. A rotorcraft transponder bill,
    correctly identified as aviation from its own title, was also matched to Real
    Estate & Construction on the policy area alone — so realtors, an apartment
    association and three construction PACs counted as its industry money, and
    the only genuinely aviation dollars in the trail were $2,500 from an airline
    pilots' union.

    So: when a bill's own text places it in some sector, sectors resting only on
    a multi-sector policy-area fan-out are dropped. A policy area that maps to
    exactly one sector is a precise statement, not a guess, and is kept.
    """
    hits = {}
    from_text = set()
    fanned_out = set()
    if policy_area and policy_area in BILL_POLICY_SECTOR:
        mapped = BILL_POLICY_SECTOR[policy_area]
        for s in mapped:
            hits.setdefault(s, []).append(f"CRS policy area: {policy_area}")
            if len(mapped) > 1:
                fanned_out.add(s)
    head = (title or "").lower()
    hay = f"{title or ''} {(summary or '')[:2500]}".lower()
    for rid, sector, pat in BILL_TEXT_RULES:
        # re.I, because `hay` is lower-cased and several patterns carry tokens
        # that only exist in upper case: 'PBM', 'LNG', '340B'. Those tokens could
        # never match anything and had been dead since the day they were
        # written — the PBM rule, in particular, is the whole of what pins a
        # health bill to pharmacy benefit managers, and it had never once fired.
        found = {m.group(0) for m in re.finditer(pat, hay, re.I)}
        if not found:
            continue
        specific = sorted(t for t in found if t not in WEAK_TERMS)
        in_title = sorted(t for t in found if re.search(r"\b" + re.escape(t) + r"\b", head))
        weak = sorted(found - set(specific))

        if specific:
            why = f"{rid}: matched {', '.join(repr(t) for t in specific[:3])}"
        elif in_title:
            why = f"{rid}: matched {', '.join(repr(t) for t in in_title[:3])} in the bill title"
        elif len(weak) >= WEAK_TOGETHER:
            why = (f"{rid}: matched {len(weak)} general terms together "
                   f"({', '.join(repr(t) for t in weak[:4])})")
        else:
            # One common word, buried in a summary, about something else. This is
            # the case that used to attach Health Care to defense bills.
            continue
        hits.setdefault(sector, []).append(why)
        from_text.add(sector)

    if from_text:
        dropped = [s for s in fanned_out if s not in from_text]
        for s in dropped:
            hits.pop(s, None)
    return hits


def main():
    con = sqlite3.connect(Path(__file__).parent / "civictrace.db"); c = con.cursor()
    c.executescript("""
    DROP TABLE IF EXISTS pac_sector; DROP TABLE IF EXISTS bill_sector;
    DROP TABLE IF EXISTS sector_axis;
    CREATE TABLE pac_sector (cmte_id TEXT, cycle INTEGER, cmte_name TEXT,
      sector TEXT, interest_side TEXT, rule_id TEXT, pole TEXT,
      PRIMARY KEY (cmte_id, cycle));
    CREATE TABLE bill_sector (bill_key TEXT, sector TEXT, evidence TEXT, interest_side TEXT);
    CREATE TABLE sector_axis (sector TEXT PRIMARY KEY, axis TEXT,
      pole_a TEXT, pole_b TEXT, sides_a TEXT, sides_b TEXT, unaligned_note TEXT);
    """)
    for sec, cfg in SECTOR_AXIS.items():
        (pa, sa), (pb, sb) = list(cfg["poles"].items())
        c.execute("INSERT INTO sector_axis VALUES (?,?,?,?,?,?,?)",
                  (sec, cfg["axis"], pa, pb, "; ".join(sa), "; ".join(sb),
                   cfg.get("unaligned_note") or None))
    n = 0
    for cmte_id, cycle, name, org, tp, dsgn, otp in c.execute(
            "SELECT cmte_id, cycle, cmte_name, connected_org, cmte_tp, cmte_dsgn, org_tp FROM committee").fetchall():
        rid, sector, side = classify_pac(name, org, tp, dsgn, otp)
        pole = SIDE_POLE.get((sector, side))
        c.execute("INSERT OR REPLACE INTO pac_sector VALUES (?,?,?,?,?,?,?)",
                  (cmte_id, cycle, name, sector, side, rid, pole))
        if sector != "Unclassified": n += 1
    print(f"PACs classified into a sector: {n}")

    nb = 0
    for k, pa, t, s in c.execute("SELECT bill_key, policy_area, title, summary FROM bill").fetchall():
        hay = f"{t or ''} {(s or '')[:2500]}".lower()
        for sector, ev in classify_bill(pa, t, s).items():
            side, side_ev = None, None
            for rid, sec, sd, pat in BILL_SIDE_RULES:
                if sec != sector:
                    continue
                m = re.search(pat, hay, re.I)
                if m:
                    # First match wins, and a second match on a *different* side
                    # means the bill spans the sector — no side, whole sector.
                    if side is not None and side != sd:
                        side, side_ev = None, "spans more than one line of business"
                        break
                    side, side_ev = sd, f"{rid}: matched '{m.group(0)}'"
            c.execute("INSERT INTO bill_sector VALUES (?,?,?,?)",
                      (k, sector, " | ".join(ev + ([side_ev] if side_ev else [])), side))
            nb += 1
    sided = c.execute("SELECT COUNT(*) FROM bill_sector WHERE interest_side IS NOT NULL").fetchone()[0]
    print(f"bill-sector links: {nb} ({sided} pinned to a specific line of business)")
    con.commit()
    print("interest axes:")
    for sec, cfg in SECTOR_AXIS.items():
        counts = {p: c.execute(
            "SELECT COUNT(*) FROM pac_sector WHERE sector=? AND pole=?", (sec, p)).fetchone()[0]
            for p in cfg["poles"]}
        unal = c.execute("SELECT COUNT(*) FROM pac_sector WHERE sector=? AND pole IS NULL",
                         (sec,)).fetchone()[0]
        print(f"  {sec}: " + ", ".join(f"{p} {n}" for p, n in counts.items())
              + f", unaligned {unal}")
    for r in c.execute("""SELECT ps.sector, COUNT(DISTINCT ps.cmte_id) pacs, ROUND(SUM(k.amount)) wi_dollars
        FROM contribution k JOIN pac_sector ps ON ps.cmte_id=k.filer_cmte_id AND ps.cycle=k.cycle
        WHERE k.transaction_tp='24K' AND (k.memo_cd IS NULL OR k.memo_cd<>'X')
        GROUP BY 1 ORDER BY 3 DESC"""):
        print(r)
    con.close()


if __name__ == "__main__":
    main()
