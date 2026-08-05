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

    ("G01", "Guns & Public Safety", r"\b(NATIONAL RIFLE|NRA |GUN OWNERS|FIREARMS|SPORTING SHOOTING|SAFARI CLUB|EVERYTOWN|GIFFORDS|BRADY)\b", "firearms policy"),
    ("I01", "Foreign Policy", r"\b(AMERICAN ISRAEL PUBLIC AFFAIRS|AIPAC|J STREET|ARMENIAN|HELLENIC|INDIA POLITICAL|TURKISH)\b", "foreign policy advocacy"),
    ("J01", "Legal", r"\b(TRIAL LAWYERS|ASSOCIATION FOR JUSTICE|BAR ASSOCIATION|ATTORNEYS|LAW FIRM)\b", "legal profession"),
]

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


def classify_bill(policy_area, title, summary):
    hits = {}
    if policy_area and policy_area in BILL_POLICY_SECTOR:
        for s in BILL_POLICY_SECTOR[policy_area]:
            hits.setdefault(s, []).append(f"CRS policy area: {policy_area}")
    hay = f"{title or ''} {(summary or '')[:2500]}".lower()
    for rid, sector, pat in BILL_TEXT_RULES:
        m = re.search(pat, hay)
        if m:
            hits.setdefault(sector, []).append(f"{rid}: matched '{m.group(0)}'")
    return hits


def main():
    con = sqlite3.connect(Path(__file__).parent / "civictrace.db"); c = con.cursor()
    c.executescript("""
    DROP TABLE IF EXISTS pac_sector; DROP TABLE IF EXISTS bill_sector;
    CREATE TABLE pac_sector (cmte_id TEXT, cycle INTEGER, cmte_name TEXT,
      sector TEXT, interest_side TEXT, rule_id TEXT, PRIMARY KEY (cmte_id, cycle));
    CREATE TABLE bill_sector (bill_key TEXT, sector TEXT, evidence TEXT);
    """)
    n = 0
    for cmte_id, cycle, name, org, tp, dsgn, otp in c.execute(
            "SELECT cmte_id, cycle, cmte_name, connected_org, cmte_tp, cmte_dsgn, org_tp FROM committee").fetchall():
        rid, sector, side = classify_pac(name, org, tp, dsgn, otp)
        c.execute("INSERT OR REPLACE INTO pac_sector VALUES (?,?,?,?,?,?)",
                  (cmte_id, cycle, name, sector, side, rid))
        if sector != "Unclassified": n += 1
    print(f"PACs classified into a sector: {n}")

    nb = 0
    for k, pa, t, s in c.execute("SELECT bill_key, policy_area, title, summary FROM bill").fetchall():
        for sector, ev in classify_bill(pa, t, s).items():
            c.execute("INSERT INTO bill_sector VALUES (?,?,?)", (k, sector, " | ".join(ev)))
            nb += 1
    print(f"bill-sector links: {nb}")
    con.commit()
    for r in c.execute("""SELECT ps.sector, COUNT(DISTINCT ps.cmte_id) pacs, ROUND(SUM(k.amount)) wi_dollars
        FROM contribution k JOIN pac_sector ps ON ps.cmte_id=k.filer_cmte_id AND ps.cycle=k.cycle
        WHERE k.transaction_tp='24K' AND (k.memo_cd IS NULL OR k.memo_cd<>'X')
        GROUP BY 1 ORDER BY 3 DESC"""):
        print(r)
    con.close()


if __name__ == "__main__":
    main()
