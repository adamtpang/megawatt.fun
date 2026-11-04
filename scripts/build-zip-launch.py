#!/usr/bin/env python3
"""Build data/zip-launch.json from free, no-key public files.

Downloads (or reuses analysis/cache/zip-launch/, which is gitignored):

- NREL/OpenEI U.S. Electric Utility Companies and Rates: Look-up by Zip Code
  (2024), iou and non-IOU CSVs. The 2022 vintage is scanned only to confirm
  whether Oncor and CenterPoint are missing there too.
- Census 2020 ZCTA-to-county and ZCTA-to-place relationship files.
- The SolarAPP+ participating-jurisdictions CSV linked from
  https://www.gosolarapp.org/where-is-solarapp-available
- Power to Choose, the PUCT's retail-plan site (api.powertochoose.org), one
  request per Texas ZCTA. Each plan names the wires company (TDU) it is
  delivered over, so the set of TDU names for a ZIP is the list of wires
  utilities inside Texas retail choice for that ZIP. Cached as ptc-tdus.json.
- EIA-861 2024 Service_Territory (county level), used only to check the
  Power to Choose answer and to read EIA utility numbers.

The committed file keeps Texas, Illinois, Georgia, and Connecticut. Retail
power marketer rows are dropped. Rates are not copied: OpenEI's rates are
utility averages, not ZIP averages.

Clocks below were read from the cited pages on 2026-11-03. A figure that was
not on those pages is not invented here.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "analysis" / "cache" / "zip-launch"
OUT = ROOT / "data" / "zip-launch.json"
UA = "megawatt.fun-zip-launch/1.0 (public data build; +https://megawatt.fun/launch)"

STATES = {"48": "TX", "17": "IL", "13": "GA", "09": "CT"}
KEEP_STATE = set(STATES.values())
WIRES = {"Investor Owned", "Municipal", "Cooperative", "Political Subdivision"}
RETRIEVED = "2026-11-03"
SOLARAPP_PAGE = "https://www.gosolarapp.org/where-is-solarapp-available"

PTC_API = "http://api.powertochoose.org/api/PowerToChoose/plans?zip_code="
EIA861_ZIP = "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip"

# Every wires company Power to Choose names for a Texas ZIP must be listed here.
# A new name stops the build: decide its ownership and EIA number explicitly.
# EIA numbers were read from EIA-861 2024 Service_Territory (checked in main()).
PTC_TDUS = {
    "CENTERPOINT ENERGY HOUSTON ELECTRIC LLC": {"key": "centerpoint", "name": "CenterPoint Energy Houston Electric", "eia_id": "8901", "ownership": "Investor Owned"},
    "ONCOR ELECTRIC DELIVERY COMPANY": {"key": "oncor", "name": "Oncor Electric Delivery", "eia_id": "44372", "ownership": "Investor Owned"},
    "AEP TEXAS CENTRAL": {"key": "aep_central", "name": "AEP Texas Central", "eia_id": "3278", "ownership": "Investor Owned"},
    "AEP TEXAS NORTH": {"key": "aep_north", "name": "AEP Texas North", "eia_id": "20404", "ownership": "Investor Owned"},
    "TEXAS-NEW MEXICO POWER COMPANY": {"key": "tnmp", "name": "Texas-New Mexico Power (TNMP)", "eia_id": "40051", "ownership": "Investor Owned"},
    "LUBBOCK POWER & LIGHT SYSTEM": {
        "key": "lpl", "name": "Lubbock Power & Light", "eia_id": "11292", "ownership": "Municipal",
        "joined": "2024-03-04",
        "note": "City-owned. ERCOT told the PUCT that LP&L customers would begin moving to competitive retail electric providers on or about March 4, 2024, finishing on or about April 1, 2024.",
        "source": "puct-55999-lpl",
    },
    "NUECES ELECTRIC COOPERATIVE": {
        "key": "nueces", "name": "Nueces Electric Cooperative", "eia_id": "13830", "ownership": "Cooperative",
    },
}

# Column 6 of the SolarAPP CSV is published with the header "#e0e0e4".
# Its TRUE/FALSE values line up with solar PV (Houston is TRUE).
SOLARAPP_PV_INDEX = 5


def fetch(url: str, dest: Path) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as res:
        body = res.read()
        headers = {k.lower(): v for k, v in res.headers.items()}
    dest.write_bytes(body)
    return headers


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def share(part: str, total: str) -> float:
    p, t = int(part or 0), int(total or 0)
    if t <= 0:
        return 0.0
    return round(p / t, 4)


def read_pipe(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        header = f.readline().rstrip("\n").split("|")
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) != len(header):
                continue
            yield dict(zip(header, parts))


def load_utilities(paths: list[Path]) -> tuple[dict, dict]:
    """zip -> state -> list of row dicts. Also the set of TX utility names."""
    by_zip: dict[str, dict[str, list]] = {}
    names: dict[str, set] = {st: set() for st in KEEP_STATE}
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                st = row["state"].strip()
                if st not in KEEP_STATE:
                    continue
                z = row["zip"].strip().zfill(5)
                if not re.fullmatch(r"\d{5}", z):
                    continue
                names[st].add(row["utility_name"].strip())
                item = {
                    "name": row["utility_name"].strip(),
                    "eia_id": row["eiaid"].strip(),
                    "ownership": row["ownership"].strip(),
                    "service_type": row["service_type"].strip(),
                }
                by_zip.setdefault(z, {}).setdefault(st, [])
                # One row per utility. OpenEI lists a utility twice where it has both bundled
                # customers and delivery-only customers on a retail supplier (ComEd, CL&P);
                # those merge into one row with service_type "Bundled and Delivery".
                bucket = by_zip[z][st]
                same = next((b for b in bucket if b["eia_id"] == item["eia_id"] and b["ownership"] == item["ownership"]), None)
                if same is None:
                    bucket.append(item)
                elif item["service_type"] not in same["service_type"].split(" and "):
                    same["service_type"] = " and ".join(sorted(same["service_type"].split(" and ") + [item["service_type"]]))
    for st in by_zip.values():
        for rows in st.values():
            rows.sort(key=lambda r: (r["name"], r["eia_id"]))
    return by_zip, names


def name_hit(names: set[str], needle: str) -> bool:
    n = needle.lower()
    return any(n in u.lower() for u in names)


def ptc_one(zip_code: str) -> dict:
    """Plans Power to Choose lists for one ZIP, reduced to wires-company names."""
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(PTC_API + zip_code, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as res:
                body = json.loads(res.read().decode("utf-8"))
            if not body.get("success"):
                raise ValueError(body.get("message"))
            plans = body.get("data") or []
            tdus = sorted({(p.get("company_tdu_name") or "").strip().upper() for p in plans} - {""})
            return {"plans": len(plans), "tdus": tdus, "message": body.get("message")}
        except Exception as e:  # network blip: retry, then record the failure
            last = e
            time.sleep(2 * (attempt + 1))
    return {"error": str(last)}


def ptc_scan(zips: list[str]) -> dict:
    """zip -> {plans, tdus} from Power to Choose, cached so a rebuild does not re-hit the API."""
    path = CACHE / "ptc-tdus.json"
    cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = [z for z in zips if z not in cache or "error" in cache[z]]
    if todo:
        print(f"power to choose: {len(todo)} ZIPs to query")
        done = 0
        with ThreadPoolExecutor(max_workers=4) as pool:
            for z, res in zip(todo, pool.map(ptc_one, todo)):
                cache[z] = res
                done += 1
                if done % 200 == 0:
                    path.write_text(json.dumps(cache, sort_keys=True), encoding="utf-8")
                    print(f"  {done}/{len(todo)}")
        cache["_retrieved"] = time.strftime("%Y-%m-%d")
        path.write_text(json.dumps(cache, sort_keys=True), encoding="utf-8")
    return cache


def xlsx_rows(data: bytes, member: str):
    """First sheet of one .xlsx inside a zip, as lists of cell text. Standard library only."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(data)) as outer:
        inner = zipfile.ZipFile(io.BytesIO(outer.read(member)))
    shared = []
    if "xl/sharedStrings.xml" in inner.namelist():
        for si in ET.fromstring(inner.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
    sheet = ET.fromstring(inner.read("xl/worksheets/sheet1.xml"))

    def col(ref: str) -> int:
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group(0):
            n = n * 26 + ord(ch) - 64
        return n - 1

    for row in sheet.iter("{%s}row" % ns["m"]):
        out: list[str] = []
        for c in row.findall("m:c", ns):
            v = c.find("m:v", ns)
            text = ""
            if c.get("t") == "s" and v is not None:
                text = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in c.iter("{%s}t" % ns["m"]))
            elif v is not None:
                text = v.text or ""
            i = col(c.get("r"))
            while len(out) < i:
                out.append("")
            out.append(text)
        yield out


def eia861_tx_counties(path: Path) -> dict:
    """Texas county name -> set of EIA utility numbers serving it, EIA-861 2024."""
    rows = xlsx_rows(path.read_bytes(), "Service_Territory_2024.xlsx")
    header = next(rows)
    i_num, i_state, i_county = header.index("Utility Number"), header.index("State"), header.index("County")
    out: dict[str, set] = {}
    for r in rows:
        if len(r) > i_county and r[i_state] == "TX":
            out.setdefault(r[i_county].strip().lower(), set()).add(str(int(float(r[i_num]))))
    return out


def solarapp_url() -> str:
    req = urllib.request.Request(SOLARAPP_PAGE, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        html = res.read().decode("utf-8", "replace")
    found = re.findall(r"https://cdn\.prod\.website-files\.com/[^\"']+\.csv", html)
    if not found:
        raise SystemExit("SolarAPP+ page did not link a CSV. Refusing to guess a list.")
    return found[0]


def load_solarapp(path: Path) -> tuple[list, int]:
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        raw = list(csv.reader(f))
    header, body = raw[0], raw[1:]
    if len(header) < 10:
        raise SystemExit(f"Unexpected SolarAPP header: {header}")
    for rec in body:
        if len(rec) < 10 or not rec[3].strip():
            continue
        st = rec[3].strip().upper()
        if st not in KEEP_STATE:
            continue

        def flag(value: str) -> bool:
            return value.strip().upper() == "TRUE"

        rows.append({
            "name": rec[0].strip(),
            "state": st,
            "subtitle": rec[4].strip(),
            "pv": flag(rec[SOLARAPP_PV_INDEX]),
            "solar_plus_storage": flag(rec[6]),
            "main_panel_upgrade": flag(rec[7]),
            "main_breaker_derate": flag(rec[8]),
            "url": rec[9].strip(),
            "pv_column_header": header[SOLARAPP_PV_INDEX],
        })
    rows.sort(key=lambda r: (r["state"], r["name"]))
    return rows, len(body)


def clocks() -> list:
    return [
        {
            "id": "puct-25211-precertified",
            "input": "interconnection_days",
            "fills_input": False,
            "kind": "outside_limit",
            "low_days": 28,
            "high_days": 28,
            "unit": "calendar days",
            "display": "within 4 weeks (28 days)",
            "about": "Outside limit after a completed application for pre-certified equipment. Not a typical duration. The rule applies to an electric utility. It says cooperatives are covered only by subsection (o), so this clock is not applied to cooperatives or to municipal utilities.",
            "quote": "For a facility with pre-certified equipment, interconnection shall take place within four weeks of the utility's receipt of a completed application.",
            "applies": {"state": "TX", "ownership": "Investor Owned"},
            "source": "puct-25211",
        },
        {
            "id": "puct-25211-other",
            "input": "interconnection_days",
            "fills_input": False,
            "kind": "outside_limit",
            "low_days": 42,
            "high_days": 42,
            "unit": "calendar days",
            "display": "within 6 weeks (42 days)",
            "about": "Outside limit for equipment that is not pre-certified, from the same subsection. Not a typical duration, and not applied to cooperatives or municipal utilities.",
            "quote": "For other facilities, interconnection shall take place within six weeks of the utility's receipt of a completed application.",
            "applies": {"state": "TX", "ownership": "Investor Owned"},
            "source": "puct-25211",
        },
        {
            "id": "austin-energy-solar-meter",
            "input": "interconnection_days",
            "fills_input": False,
            "kind": "typical_window",
            "low_days": 5,
            "high_days": 10,
            "unit": "business days",
            "display": "typically 5 to 10 business days",
            "about": "Austin Energy installs a solar meter after a passed final solar inspection. The agreement covers solar and energy storage, but this sentence is the solar-meter step. It is not permit review and not crew time, and it is not added into the calendar-day total.",
            "quote": "Austin Energy will install a solar meter in addition to the existing revenue meter, typically within 5-10 business days of a passed final solar inspection.",
            "applies": {"eia_id": "1015"},
            "source": "austin-energy-ica",
        },
        {
            "id": "pec-inspection-visit",
            "input": "interconnection_days",
            "fills_input": False,
            "kind": "typical_window",
            "low_days": 10,
            "high_days": 15,
            "unit": "business days",
            "display": "10 to 15 business days",
            "about": "How soon PEC says it will visit after the member requests the final inspection. The page does not state how long the application review before installation takes, so that earlier step stays unknown.",
            "quote": "PEC's Energy Services Advisor will receive your request to inspect and perform a site visit within 10-15 business days though we strive for sooner.",
            "applies": {"eia_id": "14626"},
            "source": "pec-interconnection",
        },
        {
            "id": "oncor-points-at-25211",
            "input": "interconnection_days",
            "fills_input": False,
            "kind": "pointer",
            "low_days": None,
            "high_days": None,
            "unit": None,
            "display": "no day count of Oncor's own; points at PUCT 25.211(m)",
            "about": "Oncor's residential solar page does not give its own turnaround in days. It points readers at PUCT 25.211(m). Oncor is not in the OpenEI ZIP file; it attaches to a ZIP where Power to Choose lists plans over Oncor.",
            "quote": "There are various timelines to process interconnection applications depending on the generation equipment and if system upgrades are required. For more information, please refer to the PUCT Substantitive Rule 25.211 section (m).",
            "applies": {"name_includes": "Oncor"},
            "source": "oncor-residential",
        },
    ]


def sources(solar_modified: str, solar_url: str, ptc_retrieved: str) -> dict:
    return {
        "ptc": {
            "title": "Power to Choose (Public Utility Commission of Texas), retail plans by ZIP",
            "url": "https://www.powertochoose.org/",
            "api": PTC_API + "77002",
            "dated": None,
            "retrieved": ptc_retrieved,
            "quote": "One request per Texas ZCTA to the PUCT Web API. Each plan carries company_tdu_name, the wires company the plan is delivered over. No plans means no retail choice in that ZIP. Plan prices were not copied.",
        },
        "eia861-2024-territory": {
            "title": "EIA-861 2024, Service_Territory (utilities by county)",
            "url": EIA861_ZIP,
            "dated": "2025-10-06",
            "retrieved": RETRIEVED,
            "quote": "Utility number, name, state, and county for each county a utility serves. Used to confirm EIA numbers and to check the Power to Choose answer, not to assign a utility to a ZIP.",
        },
        "puct-55999-lpl": {
            "title": "ERCOT notification regarding the upcoming transition of LP&L's customers to retail competition, PUCT Project 55999, item 15",
            "url": "https://interchange.puc.texas.gov/Documents/55999_15_1369350.PDF",
            "dated": "2024-02-27",
            "retrieved": "2026-11-04",
            "quote": "Customers of the City of Lubbock, acting by and through Lubbock Power & Light, (LP&L) will begin transitioning to competitive Retail Electric Providers (REPs) on or about March 4, 2024. Customers will be transitioned to REPs based on LP&L's meter-read cycles, with the transition scheduled to be completed on or about April 1, 2024.",
        },
        "openei-2024": {
            "title": "NREL/OpenEI, U.S. Electric Utility Companies and Rates: Look-up by Zip Code (2024)",
            "url": "https://data.openei.org/submissions/8563",
            "files": [
                "https://data.openei.org/files/8563/iou_zipcodes_2024.csv",
                "https://data.openei.org/files/8563/non_iou_zipcodes_2024.csv",
            ],
            "dated": "2025-11-10",
            "retrieved": RETRIEVED,
            "quote": "Compiled by NREL from ABB Velocity Suite and EIA-861. Average residential, commercial, and industrial rates with likely ZIP codes, for investor-owned and non-investor-owned utilities. Rates in the file are utility averages, not ZIP averages, and are not copied into this file.",
        },
        "census-zcta-county": {
            "title": "Census Bureau, 2020 ZCTA to County Relationship File",
            "url": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
            "dated": "2021-12-09",
            "retrieved": RETRIEVED,
            "quote": "Each record is one intersection of a 2020 ZIP Code Tabulation Area and a 2020 county. ZCTAs follow ZIP codes as of January 1, 2020. They are not the USPS ZIP list.",
        },
        "census-zcta-place": {
            "title": "Census Bureau, 2020 ZCTA to Place Relationship File",
            "url": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt",
            "dated": "2021-12-09",
            "retrieved": RETRIEVED,
            "quote": "Each record is one intersection of a 2020 ZCTA and a 2020 place. Incorporated places use class codes that start with C. Census designated places are not treated as the permit office.",
        },
        "solarapp": {
            "title": "SolarAPP+ participating jurisdictions CSV",
            "url": solar_url,
            "page": SOLARAPP_PAGE,
            "dated": solar_modified,
            "retrieved": RETRIEVED,
            "quote": "The public where-available page links this CSV. Column 6 is published with the header #e0e0e4 and TRUE/FALSE values; this file stores that column as pv. Solar + Storage is the published battery column. Jurisdictions outside TX, IL, GA, and CT were not committed.",
        },
        "puct-25211": {
            "title": "PUCT Substantive Rule 25.211, Interconnection of On-Site Distributed Generation",
            "url": "https://ftp.puc.texas.gov/public/puct-info/agency/rulesnlaws/subrules/electric/25.211/25.211.pdf",
            "dated": "2017-01-05",
            "retrieved": RETRIEVED,
            "quote": "Effective 1/5/17. Applies to an electric utility. The only part that applies to electric cooperatives is subsection (o). Subsection (m): pre-certified equipment within four weeks of a completed application; other facilities within six weeks.",
        },
        "puct-ercot-tdus": {
            "title": "PUCT, Guide to the Electric Rate Case Process for Investor-owned Utilities inside ERCOT",
            "url": "https://www.puc.texas.gov/agency/about/ope/inside_ercot/Default.aspx",
            "dated": None,
            "retrieved": RETRIEVED,
            "quote": "CenterPoint Energy, Oncor, TNMP, AEP Texas are investor-owned Transmission and Distribution (TDU) electric utilities operating the poles and wires. TDUs charge delivery rates to retail electric providers.",
        },
        "austin-energy-ica": {
            "title": "Austin Energy, Residential Interconnection Agreement for Solar and Energy Storage Systems",
            "url": "https://austinenergy.com/-/media/Project/Websites/AustinEnergy/Green-Power/Solar/Residential-Solar-Interconnection-Agreement.pdf",
            "dated": "2026-10-01",
            "retrieved": RETRIEVED,
            "quote": "Effective 10/1/2026. Austin Energy will install a solar meter in addition to the existing revenue meter, typically within 5-10 business days of a passed final solar inspection.",
        },
        "pec-interconnection": {
            "title": "Pedernales Electric Cooperative, Interconnection Process",
            "url": "https://mypec.com/solar-and-distributed-generation-dg/interconnection-process/",
            "dated": None,
            "retrieved": RETRIEVED,
            "quote": "PEC's Energy Services Advisor will receive your request to inspect and perform a site visit within 10-15 business days though we strive for sooner.",
        },
        "oncor-residential": {
            "title": "Oncor, Residential and small commercial solar",
            "url": "https://www.oncor.com/content/oncorwww/us/en/home/smart-energy/renewables-solar-and-more/residential-small-commercial-thinking-about-solar.html",
            "dated": None,
            "retrieved": RETRIEVED,
            "quote": "Oncor does not publish its own turnaround in days. The page says timelines vary and refers readers to PUCT Substantive Rule 25.211 section (m). The page spells the word Substantitive.",
        },
    }


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    needed = {
        "iou_zipcodes_2024.csv": "https://data.openei.org/files/8563/iou_zipcodes_2024.csv",
        "non_iou_zipcodes_2024.csv": "https://data.openei.org/files/8563/non_iou_zipcodes_2024.csv",
        "iou_zipcodes_2022.csv": "https://data.openei.org/files/5993/iou_zipcodes_2022.csv",
        "non_iou_zipcodes_2022.csv": "https://data.openei.org/files/5993/non_iou_zipcodes_2022.csv",
        "tab20_zcta520_county20_natl.txt": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
        "tab20_zcta520_place20_natl.txt": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt",
        "f8612024.zip": EIA861_ZIP,
    }
    for name, url in needed.items():
        dest = CACHE / name
        if not dest.exists() or dest.stat().st_size == 0:
            print("download", name)
            fetch(url, dest)

    solar_url = solarapp_url()
    solar_headers = fetch(solar_url, CACHE / "solarapp-locations.csv")
    solar_modified = (solar_headers.get("last-modified") or "").strip()
    if not solar_modified:
        raise SystemExit("SolarAPP CSV response had no Last-Modified. Refusing to invent a date.")
    # HTTP-date to YYYY-MM-DD without adding a dependency. Example: Mon, 23 Mar 2026 13:40:34 GMT
    months = {"Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04", "May": "05", "Jun": "06",
              "Jul": "07", "Aug": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"}
    m = re.search(r"(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})", solar_modified)
    if not m or m.group(2) not in months:
        raise SystemExit(f"Could not read SolarAPP Last-Modified: {solar_modified}")
    solar_dated = f"{m.group(3)}-{months[m.group(2)]}-{int(m.group(1)):02d}"

    utils, names = load_utilities([
        CACHE / "iou_zipcodes_2024.csv",
        CACHE / "non_iou_zipcodes_2024.csv",
    ])
    names_2022_tx: set[str] = set()
    for path in [CACHE / "iou_zipcodes_2022.csv", CACHE / "non_iou_zipcodes_2022.csv"]:
        with path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row["state"].strip() == "TX":
                    names_2022_tx.add(row["utility_name"].strip())

    missing_2024 = [n for n in ("Oncor", "CenterPoint", "AEP Texas", "TNMP") if not name_hit(names["TX"], n)]
    missing_2022 = [n for n in ("Oncor", "CenterPoint", "AEP Texas", "TNMP") if not name_hit(names_2022_tx, n)]

    # Largest county nationwide, then keep the ZCTA only when that county is in
    # TX, IL, GA, or CT. A sliver of Texas on an Oklahoma ZCTA does not pull it in.
    best_county: dict[str, dict] = {}
    all_counties: dict[str, set] = {}  # ZCTA -> every Texas county it touches, for the EIA-861 check
    for rec in read_pipe(CACHE / "tab20_zcta520_county20_natl.txt"):
        z = rec["GEOID_ZCTA5_20"]
        geoid = rec["GEOID_COUNTY_20"]
        if not re.fullmatch(r"\d{5}", z) or not re.fullmatch(r"\d{5}", geoid):
            continue
        if geoid.startswith("48"):
            all_counties.setdefault(z, set()).add(rec["NAMELSAD_COUNTY_20"].lower().removesuffix(" county"))
        part = int(rec["AREALAND_PART"] or 0)
        cand = {
            "name": rec["NAMELSAD_COUNTY_20"],
            "geoid": geoid,
            "state": STATES.get(geoid[:2]),
            "part": part,
            "land_share": share(rec["AREALAND_PART"], rec["AREALAND_ZCTA5_20"]),
        }
        cur = best_county.get(z)
        if cur is None or part > cur["part"] or (part == cur["part"] and geoid < cur["geoid"]):
            best_county[z] = cand
    counties = {z: c for z, c in best_county.items() if c["state"] in KEEP_STATE}

    places: dict[str, dict] = {}
    for rec in read_pipe(CACHE / "tab20_zcta520_place20_natl.txt"):
        z = rec["GEOID_ZCTA5_20"]
        if z not in counties:
            continue
        name = rec["NAMELSAD_PLACE_20"].strip()
        klass = rec["CLASSFP_PLACE_20"].strip()
        if not name or not klass.startswith("C"):
            continue
        part = int(rec["AREALAND_PART"] or 0)
        if part <= 0:
            continue
        cand = {
            "name": name,
            "geoid": rec["GEOID_PLACE_20"],
            "class": klass,
            "incorporated": True,
            "part": part,
            "land_share": share(rec["AREALAND_PART"], rec["AREALAND_ZCTA5_20"]),
        }
        cur = places.get(z)
        if cur is None or part > cur["part"] or (part == cur["part"] and cand["geoid"] < cur["geoid"]):
            places[z] = cand

    zips = {}
    by_state = {st: 0 for st in sorted(KEEP_STATE)}
    for z, county in counties.items():
        st = county["state"]
        rows = utils.get(z, {}).get(st, [])
        wires = [r for r in rows if r["ownership"] in WIRES]
        marketers = sorted({r["name"] for r in rows if r["ownership"] == "Retail Power Marketer"})
        other = sorted({r["ownership"] for r in rows if r["ownership"] not in WIRES and r["ownership"] != "Retail Power Marketer"})
        if other:
            raise SystemExit(f"Unexpected ownership on {z}: {other}. Decide explicitly; do not drop it.")
        place = places.get(z)
        rec = {
            "state": st,
            "county": {"name": county["name"], "geoid": county["geoid"], "land_share": county["land_share"]},
            "utilities": [{k: r[k] for k in ("name", "eia_id", "ownership", "service_type")} for r in wires],
        }
        if place:
            rec["place"] = {k: place[k] for k in ("name", "geoid", "class", "incorporated", "land_share")}
        if marketers and not wires:
            rec["retail_marketers"] = marketers
        zips[z] = rec
        by_state[st] += 1

    # Texas: which wires companies does Power to Choose sell plans over in each ZIP?
    tx_zips = sorted(z for z, r in zips.items() if r["state"] == "TX")
    ptc = ptc_scan(tx_zips)
    unknown_tdus = sorted({n for z in tx_zips for n in ptc[z].get("tdus", []) if n not in PTC_TDUS})
    if unknown_tdus:
        raise SystemExit(f"Power to Choose named wires companies not in PTC_TDUS: {unknown_tdus}. Decide explicitly.")
    ptc_failed = sorted(z for z in tx_zips if "error" in ptc[z])
    for z in tx_zips:
        if "error" in ptc[z]:
            continue  # no tdus key: the page says the retail-choice check is unknown here
        zips[z]["tdus"] = sorted(PTC_TDUS[n]["key"] for n in ptc[z]["tdus"])

    # Check against EIA-861 2024: each Power to Choose wires company should serve the ZIP's main county.
    county_util = eia861_tx_counties(CACHE / "f8612024.zip")
    eia_ids = {v["eia_id"] for v in PTC_TDUS.values()}
    seen_eia = set().union(*county_util.values())
    missing_eia = sorted(eia_ids - seen_eia)
    if missing_eia:
        raise SystemExit(f"EIA numbers not in EIA-861 2024 Texas service territory: {missing_eia}")
    by_key = {v["key"]: v for v in PTC_TDUS.values()}
    county_miss = []
    county_none = []  # not in any county the ZCTA touches
    county_multi = 0
    for z in tx_zips:
        cname = zips[z]["county"]["name"].lower().removesuffix(" county")
        served = county_util.get(cname, set())
        tdus_here = zips[z].get("tdus", [])
        for k in tdus_here:
            if by_key[k]["eia_id"] not in served:
                county_miss.append(f"{z}:{k}")
                if not any(by_key[k]["eia_id"] in county_util.get(c, set()) for c in all_counties.get(z, ())):
                    county_none.append(f"{z} {by_key[k]['name']}")
        if len({k for k, v in by_key.items() if v["eia_id"] in served and v["ownership"] == "Investor Owned"}) > 1:
            county_multi += 1
    with_tdu = sum(1 for z in tx_zips if zips[z].get("tdus"))

    solar_rows, solar_total = load_solarapp(CACHE / "solarapp-locations.csv")
    file_hashes = {
        name: sha256(CACHE / name)
        for name in [
            "iou_zipcodes_2024.csv", "non_iou_zipcodes_2024.csv",
            "iou_zipcodes_2022.csv", "non_iou_zipcodes_2022.csv",
            "tab20_zcta520_county20_natl.txt", "tab20_zcta520_place20_natl.txt",
            "solarapp-locations.csv", "f8612024.zip", "ptc-tdus.json",
        ]
    }
    ptc_retrieved = ptc.get("_retrieved", RETRIEVED)

    tx_gaps = [
        "OpenEI 2024 ZIP rows for Texas do not include "
        + ", ".join(missing_2024)
        + ". The 2022 vintage was scanned the same way and is also missing "
        + ", ".join(missing_2022)
        + ". The Texas wires utility inside retail choice comes from Power to Choose (PUCT) instead: "
        + f"{with_tdu} of {len(tx_zips)} Texas ZCTAs list retail plans over at least one wires company.",
        "Power to Choose answers by ZIP, not by address. It lists plans if any part of the ZIP is inside retail "
        "choice, so a ZIP split between a retail-choice wires company and a city utility or co-op (Denton 76201 "
        "is one) shows both, and the bill decides. County-level EIA-861 data was not used to assign utilities: "
        f"{county_multi} Texas ZCTAs sit in a county that EIA-861 2024 lists with more than one investor-owned "
        "wires company (Dallas County has Oncor and TNMP), so a county answer would be a guess. "
        f"{len(county_miss)} ZIP and wires-company pairs from Power to Choose are not in EIA-861 for the ZIP's "
        f"main county. {len(county_miss) - len(county_none)} of those are in another county the ZIP touches. "
        f"{len(county_none)} are in no county the ZIP touches ({', '.join(county_none)}); they are kept as "
        "Power to Choose lists them, and the bill decides.",
        "Power to Choose returned an error for "
        + (", ".join(ptc_failed) if ptc_failed else "no Texas ZCTA")
        + ". Those ZIPs show the retail-choice check as unknown.",
        "The CenterPoint distributed-generation FAQ at https://www.centerpointenergy.com/en-us/Services/Pages/DGAP-FAQs.aspx returned HTTP 404 on 2026-11-03, so no CenterPoint-specific day count is stored.",
        "No published city permit-review duration, in days, is on file for Austin, Houston, Dallas, or San Antonio. Houston is on the SolarAPP+ list for solar PV and not for solar plus storage. That list does not state a day count.",
        "PUCT 25.211(m) is an outside limit (four weeks for pre-certified equipment, six weeks otherwise). The rule text says cooperatives are covered only by subsection (o). The limit is not applied to municipal utilities or cooperatives, and it is not used as a typical duration.",
    ]
    # Gaps that hold in every state. A ZIP's result carries these plus its own state's list.
    gaps = [
        "Rows whose OpenEI ownership is Retail Power Marketer (TXU Energy and Reliant among them) are not treated as the wires utility. A ZIP that lists only a marketer has utility unknown.",
        "Crew days are unknown. No construction duration was added.",
        "ZCTAs follow ZIP codes as of January 1, 2020. A ZIP created after that, a PO Box-only ZIP, or a code with no ZCTA is not covered.",
    ]
    state_names = {"TX": "Texas", "IL": "Illinois", "GA": "Georgia", "CT": "Connecticut"}
    merged_states = sorted({r["state"] for r in zips.values() for u in r["utilities"] if " and " in u["service_type"]})
    gaps_by_state = {"TX": tx_gaps}
    for st in ("IL", "GA", "CT"):
        g = [
            f"No interconnection clock and no permit-review duration in days is on file for {state_names[st]} "
            "utilities or permit offices. The interconnection path for an investor-owned utility here is unknown in "
            "this file, and the day total stays unknown.",
            f"The Power to Choose retail-choice check is Texas only. Whether a {state_names[st]} home buys power "
            "from a retail supplier is not in this file.",
        ]
        if st in merged_states:
            g.append(
                "OpenEI lists some utilities here twice, once with Bundled and once with Delivery customers (homes "
                "that buy power from a retail supplier). Those rows are merged into one utility per EIA number, "
                "with service type Bundled and Delivery."
            )
        gaps_by_state[st] = g
    coverage_note = (
        "Texas first, plus Illinois, Georgia, and Connecticut. Austin, Houston, Dallas, and San Antonio "
        "ZCTAs are in the file. The city or county comes from the 2020 Census overlap. The wires utility "
        "comes from the NREL/OpenEI 2024 ZIP file when that file names one. Oncor, CenterPoint, AEP Texas, "
        "and TNMP are not in that file, so for Texas the wires companies inside retail choice come from "
        "Power to Choose, the PUCT's plan site, ZIP by ZIP (retrieved " + ptc_retrieved + "). A ZIP split "
        "between a retail-choice wires company and a city utility or co-op lists both. A ZCTA is not a USPS ZIP code."
    )
    explainer = (
        "Type the ZIP on the electric bill. The utility is whoever the public ZIP file names as the wires "
        "company, plus, in Texas, any wires company Power to Choose sells retail plans over in that ZIP. The permit office is the incorporated city or town that covers at least half of this "
        "ZIP's census land, and otherwise the county. The day count adds three clocks: permit review, "
        "interconnection, and the crew. If any of those is not a published calendar-day number, the total "
        "stays unknown. A business-day window, or a rule that says within four weeks, is shown beside the "
        "formula and is not turned into a single number."
    )

    doc = {
        "generated": RETRIEVED,
        "about": "ZIP to utility, permit office, interconnection path, and days to a first home-battery install. Every figure is sourced or the word unknown.",
        "coverage": {
            "states": ["TX", "IL", "GA", "CT"],
            "zip_counts": by_state,
            "note": coverage_note,
            "gaps": gaps,
            "gaps_by_state": gaps_by_state,
            "metros": {
                "Austin": ["78701", "78702", "78704"],
                "Houston": ["77002", "77004", "77006"],
                "Dallas": ["75201", "75204", "75206"],
                "San Antonio": ["78205", "78209", "78212"],
            },
        },
        "explainer": explainer,
        "formula": {
            "expression": "permit_review_days + interconnection_days + crew_days",
            "rule": "Add the three inputs only when each one is a single calendar-day number. An outside limit (within four weeks) is not that number. A business-day window is not converted into calendar days. If any input is missing, days_to_first_install is unknown.",
        },
        "ahj_rule": {
            "min_incorporated_land_share": 0.5,
            "text": "This site's rule, not a Census rule: the permitting authority is the incorporated place (class code starting with C) with the largest land overlap when that overlap is at least half of the ZCTA. Otherwise it is the county with the largest land overlap. A ZIP can cross city lines. Confirm with the city before applying.",
        },
        "ercot_tdu_names": ["oncor", "centerpoint", "aep texas", "tnmp", "texas-new mexico power"],
        "sources": sources(solar_dated, solar_url, ptc_retrieved),
        "clocks": clocks(),
        "solarapp": {
            "retrieved": RETRIEVED,
            "file_modified": solar_dated,
            "last_modified_header": solar_modified,
            "source": "solarapp",
            "rows_in_download": solar_total,
            "rows_committed": len(solar_rows),
            "pv_column_header": solar_rows[0]["pv_column_header"] if solar_rows else None,
            "jurisdictions": [{k: r[k] for k in r if k != "pv_column_header"} for r in solar_rows],
        },
        "files": file_hashes,
        "retail_choice": {
            "source": "ptc",
            "retrieved": ptc_retrieved,
            "rule": "A Texas ZIP's tdus are the wires companies named on the plans Power to Choose lists for that ZIP. A city utility or co-op that appears there is inside retail choice: a retail electric provider sells the power and the utility owns the wires. A city utility or co-op that never appears there statewide is outside retail choice.",
            "zips_queried": len(tx_zips),
            "zips_with_plans": with_tdu,
            "zips_failed": ptc_failed,
            "eia861_check": {
                "source": "eia861-2024-territory",
                "pairs_not_in_main_county": len(county_miss),
                "pairs_not_in_any_county_touched": county_none,
                "zips_in_multi_tdu_counties": county_multi,
            },
            "tdus": {
                v["key"]: {k: v[k] for k in ("name", "eia_id", "ownership", "joined", "note", "source") if k in v} | {"ptc_name": n}
                for n, v in sorted(PTC_TDUS.items(), key=lambda kv: kv[1]["key"])
            },
        },
        "openei_2022_scan": {
            "missing_names": missing_2022,
            "note": "Scanned for the gap only. 2022 rows were not copied into the ZIP table.",
        },
        "zips": zips,
    }

    # Sanity checks before writing. These are the metros the page promises.
    def must(z, msg):
        if z not in zips:
            raise SystemExit(msg)

    must("78704", "Austin 78704 missing")
    must("77002", "Houston 77002 missing")
    must("75201", "Dallas 75201 missing")
    must("78205", "San Antonio 78205 missing")
    if zips["78704"]["utilities"][0]["name"] != "Austin Energy":
        raise SystemExit(zips["78704"])
    if zips["78205"]["utilities"][0]["name"] != "City of San Antonio - (TX)":
        raise SystemExit(zips["78205"])
    if zips["77002"]["utilities"] or zips["75201"]["utilities"]:
        raise SystemExit("OpenEI gained a Houston or Dallas wires utility; update the coverage note before trusting it.")
    expect = {"77002": ["centerpoint"], "75201": ["oncor"], "78701": [], "78130": [], "79401": ["lpl"]}
    for z, want in expect.items():
        if zips[z].get("tdus") != want:
            raise SystemExit(f"Power to Choose wires companies for {z}: {zips[z].get('tdus')}, expected {want}")
    if zips["77002"]["place"]["name"] != "Houston city" or zips["75201"]["place"]["name"] != "Dallas city":
        raise SystemExit("metro place mismatch")
    # Compact on purpose: the ZIP table is thousands of rows, and the page fetches this file.
    blob = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    if "\u2014" in blob:
        raise SystemExit("em dash in zip-launch.json")
    OUT.write_text(blob + "\n", encoding="utf-8")
    print(f"wrote {OUT} bytes={OUT.stat().st_size} zips={len(zips)} by_state={by_state} solarapp={len(solar_rows)}/{solar_total} dated={solar_dated}")


if __name__ == "__main__":
    main()
