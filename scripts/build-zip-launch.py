#!/usr/bin/env python3
"""Build data/zip-launch.json from free, no-key public files.

Downloads (or reuses analysis/cache/zip-launch/, which is gitignored):

- NREL/OpenEI U.S. Electric Utility Companies and Rates: Look-up by Zip Code
  (2024), iou and non-IOU CSVs. The 2022 vintage is scanned only to confirm
  whether Oncor and CenterPoint are missing there too.
- Census 2020 ZCTA-to-county and ZCTA-to-place relationship files.
- The SolarAPP+ participating-jurisdictions CSV linked from
  https://www.gosolarapp.org/where-is-solarapp-available

The committed file keeps Texas, Illinois, Georgia, and Connecticut. Retail
power marketer rows are dropped. Rates are not copied: OpenEI's rates are
utility averages, not ZIP averages.

Clocks below were read from the cited pages on 2026-11-03. A figure that was
not on those pages is not invented here.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import urllib.request
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
                # Dedupe identical utility rows.
                bucket = by_zip[z][st]
                if item not in bucket:
                    bucket.append(item)
    for st in by_zip.values():
        for rows in st.values():
            rows.sort(key=lambda r: (r["name"], r["eia_id"]))
    return by_zip, names


def name_hit(names: set[str], needle: str) -> bool:
    n = needle.lower()
    return any(n in u.lower() for u in names)


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
            "about": "Oncor's residential solar page does not give its own turnaround in days. It points readers at PUCT 25.211(m). Oncor is not in the OpenEI ZIP file, so this clock does not attach to a ZIP.",
            "quote": "There are various timelines to process interconnection applications depending on the generation equipment and if system upgrades are required. For more information, please refer to the PUCT Substantitive Rule 25.211 section (m).",
            "applies": {"name_includes": "Oncor"},
            "source": "oncor-residential",
        },
    ]


def sources(solar_modified: str, solar_url: str) -> dict:
    return {
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
    for rec in read_pipe(CACHE / "tab20_zcta520_county20_natl.txt"):
        z = rec["GEOID_ZCTA5_20"]
        geoid = rec["GEOID_COUNTY_20"]
        if not re.fullmatch(r"\d{5}", z) or not re.fullmatch(r"\d{5}", geoid):
            continue
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

    solar_rows, solar_total = load_solarapp(CACHE / "solarapp-locations.csv")
    file_hashes = {
        name: sha256(CACHE / name)
        for name in [
            "iou_zipcodes_2024.csv", "non_iou_zipcodes_2024.csv",
            "iou_zipcodes_2022.csv", "non_iou_zipcodes_2022.csv",
            "tab20_zcta520_county20_natl.txt", "tab20_zcta520_place20_natl.txt",
            "solarapp-locations.csv",
        ]
    }

    gaps = [
        "OpenEI 2024 ZIP rows for Texas do not include "
        + ", ".join(missing_2024)
        + ". The 2022 vintage was scanned the same way and is also missing "
        + ", ".join(missing_2022)
        + ". Houston and Dallas wires utilities are therefore unknown, not guessed.",
        "Rows whose OpenEI ownership is Retail Power Marketer (TXU Energy and Reliant among them) are not treated as the wires utility. A ZIP that lists only a marketer has utility unknown.",
        "The CenterPoint distributed-generation FAQ at https://www.centerpointenergy.com/en-us/Services/Pages/DGAP-FAQs.aspx returned HTTP 404 on 2026-11-03, so no CenterPoint-specific day count is stored.",
        "No published city permit-review duration, in days, is on file for Austin, Houston, Dallas, or San Antonio. Houston is on the SolarAPP+ list for solar PV and not for solar plus storage. That list does not state a day count.",
        "Crew days are unknown. No construction duration was added.",
        "PUCT 25.211(m) is an outside limit (four weeks for pre-certified equipment, six weeks otherwise). The rule text says cooperatives are covered only by subsection (o). The limit is not applied to municipal utilities or cooperatives, and it is not used as a typical duration.",
        "ZCTAs follow ZIP codes as of January 1, 2020. A ZIP created after that, a PO Box-only ZIP, or a code with no ZCTA is not covered.",
    ]
    coverage_note = (
        "Texas first, plus Illinois, Georgia, and Connecticut. Austin, Houston, Dallas, and San Antonio "
        "ZCTAs are in the file. The city or county comes from the 2020 Census overlap. The wires utility "
        "comes from the NREL/OpenEI 2024 ZIP file when that file names one. Oncor, CenterPoint, AEP Texas, "
        "and TNMP are not in that file, so a Houston or Dallas ZIP can show the city and still show the "
        "utility as unknown. A ZCTA is not a USPS ZIP code."
    )
    explainer = (
        "Type the ZIP on the electric bill. The utility is whoever the public ZIP file names as the wires "
        "company. The permit office is the incorporated city or town that covers at least half of this "
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
        "sources": sources(solar_dated, solar_url),
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
        raise SystemExit("Houston or Dallas gained a wires utility; update the coverage note before trusting it.")
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
