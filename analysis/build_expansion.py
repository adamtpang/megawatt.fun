#!/usr/bin/env python3
"""Build data/expansion-map.json from public Census, EIA-861, FEMA, and ERCOT files.

Usage:
  python3 -m pip install openpyxl pyshp
  python3 analysis/build_expansion.py

Downloads are cached in analysis/cache/. Re-running reuses them.
Pass --skip-ercot to rebuild the national score without the Texas price window.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from analysis.score import composite, percentile_ranks  # noqa: E402

CACHE = ROOT / "analysis" / "cache"
OUT = ROOT / "data" / "expansion-map.json"
HTML = ROOT / "notes" / "expansion-map.html"
UA = "megawatt.fun research"
TODAY = date.today().isoformat()

ACS_URL = (
    "https://www2.census.gov/programs-surveys/acs/summary_file/2024/"
    "table-based-SF/data/5YRData/acsdt5y2024-b25032.dat"
)
EIA_URL = "https://www.eia.gov/electricity/data/eia861/zip/f8612025.zip"
SHAPE_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip"
NRI_URL = (
    "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/"
    "National_Risk_Index_Counties/FeatureServer/0/query"
)
NRI_FIELDS = (
    "STATEABBRV,COUNTY,STCOFIPS,POPULATION,NRI_VER,HWAV_RISKS,HRCN_RISKS,"
    "TRND_RISKS,HAIL_RISKS,ISTM_RISKS,SWND_RISKS,WNTW_RISKS,LTNG_RISKS"
)
STORM_FIELDS = ["HRCN_RISKS", "TRND_RISKS", "HAIL_RISKS", "ISTM_RISKS", "SWND_RISKS", "WNTW_RISKS", "LTNG_RISKS"]
SKIP_STATES = {"PR", "VI", "GU", "AS", "MP"}

FACTORS = [
    {
        "id": "homes",
        "group": "Customer pull",
        "label": "Owner-occupied single-family homes",
        "help": "Census ACS 2024 5-year, table B25032. Owner-occupied one-unit detached plus one-unit attached. Large states score higher here.",
        "weight": 1,
    },
    {
        "id": "saidi",
        "group": "Customer pull",
        "label": "Outage duration (SAIDI)",
        "help": "EIA-861 2025 state total, including major events. Minutes per customer. Longer outages raise the score, as a backup-battery signal.",
        "weight": 1,
    },
    {
        "id": "saifi",
        "group": "Customer pull",
        "label": "Outage frequency (SAIFI)",
        "help": "EIA-861 2025 state total, including major events. Interruptions per customer. More frequent outages raise the score.",
        "weight": 1,
    },
    {
        "id": "storm",
        "group": "Customer pull",
        "label": "Storm risk",
        "help": "FEMA National Risk Index. County hurricane, tornado, hail, ice storm, strong wind, winter weather, and lightning scores, averaged and weighted by county population.",
        "weight": 1,
    },
    {
        "id": "heat",
        "group": "Customer pull",
        "label": "Heat-wave risk",
        "help": "FEMA National Risk Index heat-wave score, weighted by county population.",
        "weight": 1,
    },
    {
        "id": "retail",
        "group": "Market access",
        "label": "Retail delivery share",
        "help": "Share of residential customers served by a delivery utility. Texas wires companies come from EIA's delivery-companies file. Retail-only suppliers are removed first so the same Texas home is not counted twice.",
        "weight": 1,
    },
    {
        "id": "wholesale",
        "group": "Market access",
        "label": "Wholesale market share",
        "help": "Share of residential customers whose balancing authority is an ISO or RTO in EIA's 2025 authority list: CAISO, ERCOT, ISO-NE, MISO, NYISO, PJM, or SPP, detected from the authority's name.",
        "weight": 1,
    },
    {
        "id": "batteries",
        "group": "Market access",
        "label": "Residential batteries per 1,000 customers",
        "help": "EIA-861 2025 net-metered residential batteries, paired with solar plus standalone, per 1,000 residential customers.",
        "weight": 1,
    },
    {
        "id": "demand_response",
        "group": "Market access",
        "label": "Demand response per 1,000 customers",
        "help": "Residential demand-response enrollments reported on EIA-861 2025, per 1,000 residential customers. Blank cells are left out of the sum.",
        "weight": 1,
    },
    {
        "id": "dynamic_pricing",
        "group": "Market access",
        "label": "Dynamic pricing per 1,000 customers",
        "help": "Residential dynamic-pricing enrollments reported on EIA-861 2025, per 1,000 residential customers. Blank cells are left out of the sum.",
        "weight": 1,
    },
]

FOOTPRINT = {
    "TX": {
        "status": "operating",
        "label": "Operating",
        "detail": "Base's public offer is a Texas retail plan with a battery Base owns. A Connecticut job post describes expansion beyond Texas. The mark is not part of the score.",
    },
    "IL": {
        "status": "operating",
        "label": "Operating in ComEd",
        "detail": "Base Retail, LLC holds Illinois ARES certificate 26-0121 for residential customers in ComEd territory. Its supply agreement is the Battery Time of Use plan, and a founding-member offer was posted as available 15 June 2026. The mark covers ComEd, which is not all of Illinois.",
    },
    "GA": {
        "status": "announced",
        "label": "Announced",
        "detail": "Grid & Generation reported on 21 Oct 2026, citing Utility Dive, a Central Georgia EMC partnership for up to 50 MW, with installations planned to begin in 2027. This build did not open a Base or co-op primary release.",
    },
    "CT": {
        "status": "hiring",
        "label": "Hiring",
        "detail": "Base posted a Connecticut operations manager on 10 Sep 2026 and an electrical supervisor in North Haven. No customer offer was found in the sources opened for this note.",
    },
}


def fetch(url, dest: Path, timeout=180):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=timeout) as resp, dest.open("wb") as handle:
        handle.write(resp.read())


def num(value):
    if value is None or value == "" or value == ".":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    text = str(value).strip().replace(",", "")
    if text in {"", ".", "NA", "N/A"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean(value, places=6):
    if value is None:
        return None
    return round(float(value), places)


def norm_county(name):
    import unicodedata
    text = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    text = text.lower().replace(".", " ").replace("'", "").replace("-", " ")
    for suffix in (
        " census area",
        " city and borough",
        " municipality",
        " borough",
        " parish",
        " county",
        " municipio",
    ):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    text = text.replace("saint ", "st ")
    return " ".join(text.split())


def rows(path, sheet, min_row):
    import openpyxl
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        worksheet = book[sheet]
        for row in worksheet.iter_rows(min_row=min_row, values_only=True):
            if row and any(cell is not None and cell != "" for cell in row):
                yield row
    finally:
        book.close()


def weighted(pairs):
    num_sum = 0.0
    den = 0.0
    bare = []
    for value, weight in pairs:
        if value is None:
            continue
        bare.append(value)
        if weight is None or weight <= 0:
            continue
        num_sum += value * weight
        den += weight
    if den:
        return num_sum / den
    if bare:
        return sum(bare) / len(bare)
    return None


def albers(lon, lat):
    phi = math.radians(lat)
    lam = math.radians(lon)
    phi1 = math.radians(29.5)
    phi2 = math.radians(45.5)
    phi0 = math.radians(23.0)
    lam0 = math.radians(-96.0)
    n = 0.5 * (math.sin(phi1) + math.sin(phi2))
    c = math.cos(phi1) ** 2 + 2 * n * math.sin(phi1)
    rho = math.sqrt(max(c - 2 * n * math.sin(phi), 0)) / n
    rho0 = math.sqrt(max(c - 2 * n * math.sin(phi0), 0)) / n
    theta = n * (lam - lam0)
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


def fit_projector(points, box):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    x0, y0, x1, y1 = box

    def project(x, y):
        sx = x0 + (x - minx) / (maxx - minx) * (x1 - x0)
        sy = y0 + (maxy - y) / (maxy - miny) * (y1 - y0)
        return sx, sy

    return project


def shape_rings(shape):
    points = shape.points
    parts = list(shape.parts) + [len(points)]
    rings = []
    for start, end in zip(parts, parts[1:]):
        ring = points[start:end]
        if len(ring) > 700:
            step = max(1, len(ring) // 700)
            ring = ring[::step]
        if len(ring) >= 3:
            rings.append(ring)
    return rings


def path_from(rings, raw_fn, projector):
    commands = []
    drawn = []
    for ring in rings:
        xy = [projector(*raw_fn(lon, lat)) for lon, lat in ring]
        drawn.extend(xy)
        commands.append(f"M{xy[0][0]:.1f},{xy[0][1]:.1f}")
        commands.extend(f"L{x:.1f},{y:.1f}" for x, y in xy[1:])
        commands.append("Z")
    if not drawn:
        return "", 0, 0
    cx = (min(p[0] for p in drawn) + max(p[0] for p in drawn)) / 2
    cy = (min(p[1] for p in drawn) + max(p[1] for p in drawn)) / 2
    return "".join(commands), round(cx, 1), round(cy, 1)


def load_shapes():
    import shapefile
    dest = CACHE / "cb_2024_us_state_20m.zip"
    fetch(SHAPE_URL, dest)
    folder = CACHE / "states"
    if not any(folder.glob("*.shp")):
        folder.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest) as archive:
            archive.extractall(folder)
    shp = next(folder.glob("*.shp"))
    reader = shapefile.Reader(str(shp))
    states = []
    for record, shape in zip(reader.iterRecords(), reader.iterShapes()):
        data = record.as_dict()
        abbr = data.get("STUSPS") or data.get("stusps")
        if abbr in SKIP_STATES:
            continue
        states.append({
            "abbr": abbr,
            "fips": str(data.get("STATEFP") or data.get("statefp")).zfill(2),
            "name": data.get("NAME") or data.get("name"),
            "rings": shape_rings(shape),
        })
    return states


def load_homes():
    dest = CACHE / "acsdt5y2024-b25032.dat"
    fetch(ACS_URL, dest)
    homes = {}
    with dest.open(encoding="utf-8", errors="replace") as handle:
        header = handle.readline().strip().split("|")
        detached = header.index("B25032_E003")
        attached = header.index("B25032_E004")
        for line in handle:
            if not line.startswith("0400000US"):
                continue
            parts = line.rstrip("\n").split("|")
            fips = parts[0][-2:]
            homes[fips] = (num(parts[detached]) or 0) + (num(parts[attached]) or 0)
    if homes.get("48") != 6263597:
        raise SystemExit(f"ACS Texas homes changed or columns shifted: {homes.get('48')}")
    return homes


def load_nri():
    dest = CACHE / "nri-counties.json"
    if not dest.exists():
        features = []
        offset = 0
        version = None
        while True:
            query = urlencode({
                "where": "1=1",
                "outFields": NRI_FIELDS,
                "returnGeometry": "false",
                "f": "json",
                "resultRecordCount": 2000,
                "resultOffset": offset,
            })
            req = Request(f"{NRI_URL}?{query}", headers={"User-Agent": UA})
            with urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode())
            if payload.get("error"):
                raise SystemExit(f"NRI query failed: {payload['error']}")
            batch = payload.get("features") or []
            for feature in batch:
                attrs = feature["attributes"]
                version = version or attrs.get("NRI_VER")
                features.append(attrs)
            if not payload.get("exceededTransferLimit") or not batch:
                break
            offset += len(batch)
        dest.write_text(json.dumps({"version": version, "features": features}))
    payload = json.loads(dest.read_text())
    counties = []
    for attrs in payload["features"]:
        abbr = attrs.get("STATEABBRV")
        if not abbr or abbr in SKIP_STATES:
            continue
        record = {
            "abbr": abbr,
            "county": norm_county(attrs.get("COUNTY") or ""),
            "pop": num(attrs.get("POPULATION")) or 0,
            "heat": none_if_negative(num(attrs.get("HWAV_RISKS"))),
        }
        hazards = [none_if_negative(num(attrs.get(field))) for field in STORM_FIELDS]
        present = [value for value in hazards if value is not None]
        record["storm"] = sum(present) / len(present) if present else None
        counties.append(record)
    return payload.get("version"), counties


def none_if_negative(value):
    if value is None or value < 0:
        return None
    return value


def ensure_eia():
    dest = CACHE / "f8612025.zip"
    fetch(EIA_URL, dest)
    folder = CACHE / "eia861"
    marker = folder / "Reliability_2025.xlsx"
    if not marker.exists():
        folder.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest) as archive:
            archive.extractall(folder)
    return folder


def load_reliability(folder):
    out = {}
    for row in rows(folder / "Reliability_2025.xlsx", "State Totals", 4):
        abbr = row[1]
        if not abbr or abbr in SKIP_STATES:
            continue
        any_saidi, any_saifi, any_customers = num(row[13]), num(row[14]), num(row[12])
        ieee_saidi, ieee_saifi, ieee_customers = num(row[3]), num(row[4]), num(row[2])
        if any_saidi is not None:
            out[abbr] = {"saidi": any_saidi, "saifi": any_saifi, "customers": any_customers, "method": "any reporting method, with major events"}
        elif ieee_saidi is not None:
            out[abbr] = {"saidi": ieee_saidi, "saifi": ieee_saifi, "customers": ieee_customers, "method": "IEEE method, with major events"}
    if abs(((out.get("AK") or {}).get("saidi") or 0) - 540.9) > 0.05:
        raise SystemExit(f"EIA Alaska SAIDI did not match the state-total sheet: {out.get('AK')}")
    utility = {}
    for row in rows(folder / "Reliability_2025.xlsx", "Reliability_States", 4):
        abbr = row[3]
        util = row[1]
        if abbr in SKIP_STATES or util is None:
            continue
        ieee = (num(row[5]), num(row[6]), num(row[14]), "IEEE, with major events")
        other = (num(row[17]), num(row[18]), num(row[23]), "other method, with major events")
        chosen = ieee if ieee[0] is not None else other if other[0] is not None else None
        if chosen:
            utility[(int(util), abbr)] = {"saidi": chosen[0], "saifi": chosen[1], "customers": chosen[2], "method": chosen[3]}
    return out, utility


def is_iso_name(name):
    text = (name or "").lower()
    return (
        "independent system operator" in text
        or "independent transmission system operator" in text
        or "electric reliability council of texas" in text
        or text.startswith("southwest power pool")
        or text.startswith("pjm interconnection")
        or "iso new england" in text
    )


def short_iso(name):
    text = (name or "").lower()
    if "california" in text:
        return "CAISO"
    if "texas" in text:
        return "ERCOT"
    if "new england" in text:
        return "ISO-NE"
    if "midcontinent" in text:
        return "MISO"
    if "new york" in text:
        return "NYISO"
    if text.startswith("pjm"):
        return "PJM"
    if "southwest power pool" in text:
        return "SPP"
    return name


def load_sales_and_markets(folder):
    """Residential customers, with Texas retail suppliers removed.

    EIA codes Texas retail providers as bundled service, and codes the wires
    companies only in the delivery-companies file. Counting both would put the
    same home in the total twice. A utility is treated as retail-only when it
    checked retail marketing and did not check distribution.
    """
    iso_names = {}
    ba_labels = {}
    for row in rows(folder / "Balancing_Authority_2025.xlsx", "Balancing Authority", 2):
        code, name = row[2], row[4]
        if not code or not name:
            continue
        ba_labels.setdefault(str(code), name)
        if is_iso_name(name):
            iso_names[str(code)] = short_iso(name)
    activity = {}
    names = {}
    for row in rows(folder / "Utility_Data_2025.xlsx", "States", 3):
        util, name, abbr = row[1], row[2], row[3]
        if util is None or not abbr or abbr in SKIP_STATES:
            continue
        key = (int(util), abbr)
        distribution = str(row[25] or "").strip().upper() == "Y"
        retail = str(row[28] or "").strip().upper() == "Y"
        activity[key] = {"retail_only": retail and not distribution}
        names[key] = {"name": name, "ownership": row[4]}
    customers = defaultdict(lambda: {"Bundled": 0.0, "Delivery": 0.0, "name": "", "ownership": ""})
    ba_weight = defaultdict(lambda: defaultdict(float))
    utility_ba = defaultdict(lambda: defaultdict(float))

    def add(util, abbr, name, ownership, service, count, ba):
        if util is None or not abbr or abbr in SKIP_STATES or count is None or count <= 0:
            return
        if service not in {"Bundled", "Delivery"}:
            return
        # Retail suppliers bill the same homes the delivery utility bills.
        if str(ownership or "").strip() == "Retail Power Marketer":
            return
        key = (int(util), abbr)
        if activity.get(key, {}).get("retail_only"):
            return
        bucket = customers[key]
        bucket[service] += count
        bucket["name"] = name or bucket["name"]
        bucket["ownership"] = ownership or bucket["ownership"]
        if ba:
            ba_weight[abbr][str(ba)] += count
            utility_ba[key][str(ba)] += count

    for row in rows(folder / "Sales_Ult_Cust_2025.xlsx", "States", 4):
        add(row[1], row[6], row[2], row[7], row[4], num(row[11]), row[8])
    for row in rows(folder / "Delivery_Companies_2025.xlsx", "Delivery Companies", 4):
        add(row[1], row[6], row[2], row[7], row[4], num(row[11]), row[8])
    return customers, ba_weight, utility_ba, iso_names, ba_labels, names


def load_programs(folder):
    batteries = defaultdict(float)
    battery_seen = set()
    for row in rows(folder / "Net_Metering_2025.xlsx", "States- State Level", 4):
        abbr = row[1]
        if not abbr or abbr in SKIP_STATES:
            continue
        paired, standalone = num(row[42]), num(row[57])
        if paired is None and standalone is None:
            continue
        batteries[abbr] += (paired or 0) + (standalone or 0)
        battery_seen.add(abbr)
    utility_batteries = defaultdict(lambda: {"AC": [None, None], "other": [None, None]})
    for row in rows(folder / "Net_Metering_2025.xlsx", "States- Utility Level", 4):
        abbr, util, kind = row[1], row[2], str(row[5] or "")
        if util is None or not abbr:
            continue
        paired, standalone = num(row[46]), num(row[61])
        slot = "AC" if kind.upper() == "AC" else "other"
        current = utility_batteries[(int(util), abbr)][slot]
        utility_batteries[(int(util), abbr)][slot] = [
            None if paired is None and current[0] is None else (current[0] or 0) + (paired or 0),
            None if standalone is None and current[1] is None else (current[1] or 0) + (standalone or 0),
        ]
    demand = defaultdict(float)
    demand_seen = set()
    utility_demand = {}
    for row in rows(folder / "Demand_Response_2025.xlsx", "Demand Response_States", 4):
        util, abbr, count = row[1], row[3], num(row[5])
        if util is None or not abbr or count is None or abbr in SKIP_STATES:
            continue
        demand[abbr] += count
        demand_seen.add(abbr)
        utility_demand[(int(util), abbr)] = utility_demand.get((int(util), abbr), 0) + count
    dynamic = defaultdict(float)
    dynamic_seen = set()
    utility_dynamic = {}
    for row in rows(folder / "Dynamic_Pricing_2025.xlsx", "Dynamic Pricing_States", 4):
        util, abbr, count = row[1], row[4], num(row[6])
        if util is None or not abbr or count is None or abbr in SKIP_STATES:
            continue
        dynamic[abbr] += count
        dynamic_seen.add(abbr)
        utility_dynamic[(int(util), abbr)] = utility_dynamic.get((int(util), abbr), 0) + count
    return {
        "batteries": batteries,
        "battery_seen": battery_seen,
        "utility_batteries": utility_batteries,
        "demand": demand,
        "demand_seen": demand_seen,
        "utility_demand": utility_demand,
        "dynamic": dynamic,
        "dynamic_seen": dynamic_seen,
        "utility_dynamic": utility_dynamic,
    }


def load_territory(folder):
    territory = defaultdict(set)
    for row in rows(folder / "Service_Territory_2025.xlsx", "Counties_States", 2):
        util, abbr, county = row[1], row[4], row[5]
        if util is None or not abbr or not county or abbr in SKIP_STATES:
            continue
        territory[(int(util), abbr)].add(norm_county(county))
    return territory


def per_thousand(count, customers, seen):
    if not seen or customers is None or customers <= 0:
        return None
    return count / customers * 1000


def utility_battery_count(record):
    chosen = record["AC"] if any(value is not None for value in record["AC"]) else record["other"]
    if all(value is None for value in chosen):
        return None
    return (chosen[0] or 0) + (chosen[1] or 0)


def rto_label(parts, total):
    if not parts or not total:
        return "None reported"
    ordered = sorted(parts.items(), key=lambda item: -item[1])
    bits = [f"{name} {item / total * 100:.0f}%" for name, item in ordered if item > 0]
    label = ", ".join(bits[:3])
    if sum(parts.values()) > total * 1.02:
        label += " (tags overlap)"
    return label


def build_states(shapes, homes, nri_version, counties, reliability, customers, ba_weight, iso_names, ba_labels, programs):
    by_state_counties = defaultdict(list)
    for county in counties:
        by_state_counties[county["abbr"]].append(county)
    states = []
    for shape in shapes:
        abbr = shape["abbr"]
        cust_rows = [item for key, item in customers.items() if key[1] == abbr]
        bundled = sum(item["Bundled"] for item in cust_rows)
        delivery = sum(item["Delivery"] for item in cust_rows)
        residential = bundled + delivery
        market_parts = defaultdict(float)
        known = sum(ba_weight.get(abbr, {}).values())
        for code, count in ba_weight.get(abbr, {}).items():
            if code in iso_names:
                market_parts[iso_names[code]] += count
        in_market = sum(market_parts.values())
        top_code = max(ba_weight.get(abbr, {}), key=ba_weight.get(abbr).get) if ba_weight.get(abbr) else None
        rel = reliability.get(abbr, {})
        storm = weighted((county["storm"], county["pop"]) for county in by_state_counties[abbr])
        heat = weighted((county["heat"], county["pop"]) for county in by_state_counties[abbr])
        battery_count = programs["batteries"].get(abbr) if abbr in programs["battery_seen"] else None
        demand_count = programs["demand"].get(abbr) if abbr in programs["demand_seen"] else None
        dynamic_count = programs["dynamic"].get(abbr) if abbr in programs["dynamic_seen"] else None
        values = {
            "homes": homes.get(shape["fips"]),
            "saidi": rel.get("saidi"),
            "saifi": rel.get("saifi"),
            "storm": storm,
            "heat": heat,
            "retail": (delivery / residential) if residential else None,
            "wholesale": (in_market / known) if known else None,
            "batteries": per_thousand(battery_count, residential, abbr in programs["battery_seen"]),
            "demand_response": per_thousand(demand_count, residential, abbr in programs["demand_seen"]),
            "dynamic_pricing": per_thousand(dynamic_count, residential, abbr in programs["dynamic_seen"]),
        }
        note = (
            f"SAIDI and SAIFI use EIA's 2025 state total ({rel.get('method', 'not published')}"
            + (f", {rel.get('customers'):,.0f} customers" if rel.get("customers") else "")
            + "). Retail choice is delivery customers divided by bundled plus delivery customers. "
            "Program rates use that same residential customer count."
        )
        if known and residential and known < residential * 0.9:
            note += f" Balancing-authority coverage is {known / residential * 100:.0f}% of residential customers."
        states.append({
            "id": abbr,
            "fips": shape["fips"],
            "name": shape["name"],
            "abbr": abbr,
            "footprint": FOOTPRINT.get(abbr),
            "values": {key: clean(value) for key, value in values.items()},
            "detail": {
                "rtos": rto_label(market_parts, known) if market_parts else ("No ISO balancing authority" if known else "Not reported"),
                "top_ba": ba_labels.get(top_code, top_code) if top_code else None,
                "note": note,
                "residential_customers": int(residential) if residential else None,
                "battery_installs": None if battery_count is None else int(battery_count),
                "nri_version": nri_version,
            },
        })
    return states


def build_utilities(customers, utility_ba, iso_names, names, utility_reliability, programs, territory, counties):
    index = defaultdict(dict)
    for county in counties:
        index[county["abbr"]][county["county"]] = county
    matched = 0
    total = 0
    drafts = []
    for key, item in customers.items():
        residential = item["Bundled"] + item["Delivery"]
        name = (names.get(key) or {}).get("name") or item["name"] or ""
        keep = residential >= 10000 or "central georgia" in name.lower()
        if not keep:
            continue
        util, abbr = key
        for county_name in territory.get(key, ()):
            total += 1
            if county_name in index[abbr]:
                matched += 1
        rel = utility_reliability.get(key, {})
        parts = utility_ba.get(key, {})
        iso_parts = {iso_names[code]: count for code, count in parts.items() if code in iso_names}
        ba_total = sum(parts.values())
        battery_count = None
        if key in programs["utility_batteries"]:
            battery_count = utility_battery_count(programs["utility_batteries"][key])
        demand_count = programs["utility_demand"].get(key)
        dynamic_count = programs["utility_dynamic"].get(key)
        drafts.append({
            "key": key,
            "name": name,
            "abbr": abbr,
            "ownership": (names.get(key) or {}).get("ownership") or item["ownership"],
            "residential": residential,
            "retail": (item["Delivery"] / residential) if residential else None,
            "wholesale": (sum(iso_parts.values()) / ba_total) if ba_total else None,
            "rtos": ", ".join(sorted(iso_parts)) if iso_parts else "No ISO balancing authority",
            "saidi": rel.get("saidi"),
            "saifi": rel.get("saifi"),
            "method": rel.get("method"),
            "battery_count": battery_count,
            "demand_count": demand_count,
            "dynamic_count": dynamic_count,
            "counties": territory.get(key, set()),
        })
    use_nri = total > 0 and matched / total >= 0.75
    utilities = []
    for draft in drafts:
        storm = heat = None
        if use_nri and draft["counties"]:
            pairs_storm = []
            pairs_heat = []
            for county_name in draft["counties"]:
                county = index[draft["abbr"]].get(county_name)
                if not county:
                    continue
                pairs_storm.append((county["storm"], county["pop"]))
                pairs_heat.append((county["heat"], county["pop"]))
            storm = weighted(pairs_storm)
            heat = weighted(pairs_heat)
        residential = draft["residential"]
        utilities.append({
            "id": f"{draft['key'][0]}-{draft['abbr']}",
            "name": draft["name"],
            "state": draft["abbr"],
            "named": "commonwealth edison" in draft["name"].lower() or "central georgia" in draft["name"].lower(),
            "values": {
                "homes": clean(residential, 0),
                "saidi": clean(draft["saidi"]),
                "saifi": clean(draft["saifi"]),
                "storm": clean(storm),
                "heat": clean(heat),
                "retail": clean(draft["retail"]),
                "wholesale": draft["wholesale"],
                "batteries": clean(per_thousand(draft["battery_count"], residential, draft["battery_count"] is not None)),
                "demand_response": clean(per_thousand(draft["demand_count"], residential, draft["demand_count"] is not None)),
                "dynamic_pricing": clean(per_thousand(draft["dynamic_count"], residential, draft["dynamic_count"] is not None)),
            },
            "detail": {
                "rtos": draft["rtos"],
                "note": draft["method"] or "No SAIDI row on the utility reliability sheet.",
            },
        })
    coverage = matched / total if total else None
    return utilities, {"county_rows": total, "matched": matched, "used": use_nri, "coverage": clean(coverage)}


def score_rows(records):
    rank_table = {}
    for factor in FACTORS:
        ranks = percentile_ranks([record["values"][factor["id"]] for record in records])
        rank_table[factor["id"]] = {record["id"]: rank for record, rank in zip(records, ranks)}
    rows = []
    for record in records:
        rows.append({factor["id"]: rank_table[factor["id"]][record["id"]] for factor in FACTORS})
    return rank_table, rows


def rank(records, weights):
    _, rows = score_rows(records)
    scores = composite(rows, weights)
    ordered = sorted(
        ({"id": record["id"], "name": record["name"], "score": score, "record": record} for record, score in zip(records, scores)),
        key=lambda item: (-1 if item["score"] is None else -item["score"], item["name"]),
    )
    return ordered


def narrative(states, utilities):
    equal = {factor["id"]: 1 for factor in FACTORS}
    nosize = {factor["id"]: (0 if factor["id"] == "homes" else 1) for factor in FACTORS}
    ranked = rank(states, equal)
    ranked_nosize = rank(states, nosize)
    by_id = {record["id"]: record for record in states}
    rank_table, _ = score_rows(states)

    def place(abbr):
        for index, item in enumerate(ranked, start=1):
            if item["id"] == abbr:
                return index, item["score"]
        return None, None

    def strongest(abbr):
        pairs = []
        for factor in FACTORS:
            value = rank_table[factor["id"]][abbr]
            if value is not None:
                pairs.append((factor["label"], value))
        pairs.sort(key=lambda item: -item[1])
        return [f"{label.lower()} ({round(value * 100)})" for label, value in pairs[:2]]

    def brief(item):
        return f"{item['name']} ({round(item['score'] * 100)})"

    leader = ranked[0]
    saidi_leader = max(states, key=lambda record: record["values"]["saidi"] if record["values"]["saidi"] is not None else -1)
    retail_leader = max(states, key=lambda record: record["values"]["retail"] if record["values"]["retail"] is not None else -1)
    home_leader = max(states, key=lambda record: record["values"]["homes"] or -1)
    lines = [
        (
            f"At equal weights, {brief(ranked[0])}, {brief(ranked[1])}, and {brief(ranked[2])} lead the 51 geographies. "
            f"{leader['name']}'s strongest public signals on this scale are {strongest(leader['id'])[0]} and {strongest(leader['id'])[1]}. "
            "Read the score as a stack of percentiles. A high score means the public series line up. It is an outside view, with no Base install times, permit outcomes, or crew plan in it."
        ),
        (
            f"The home-count factor rewards size. {home_leader['name']} has the most owner-occupied single-family homes, "
            f"{home_leader['values']['homes']:,.0f}. With that weight set to zero, the top three become "
            f"{brief(ranked_nosize[0])}, {brief(ranked_nosize[1])}, and {brief(ranked_nosize[2])}."
        ),
    ]
    footprints = []
    for abbr in ("TX", "IL", "GA", "CT"):
        index, score = place(abbr)
        record = by_id[abbr]
        footprints.append(
            f"{record['name']} ranks {index} (score {round(score * 100)}), with SAIDI {record['values']['saidi']:.0f} minutes, "
            f"retail delivery share {record['values']['retail'] * 100:.1f}%, and wholesale mix {record['detail']['rtos']}"
        )
    lines.append("Base's public footprint, marked on the map and kept out of the weights: " + ". ".join(footprints) + ".")
    georgia = by_id["GA"]
    lines.append(
        f"Georgia's largest balancing authority in this file is {georgia['detail'].get('top_ba')}. "
        "EIA reports no residential delivery service there. A utility contract, the shape of the reported Central Georgia EMC project, does not appear in the retail-choice factor, so Georgia's rank is a weak guide to that path."
    )
    comed = next((item for item in utilities if "commonwealth edison" in item["name"].lower()), None)
    georgia = next((item for item in utilities if "central georgia" in item["name"].lower()), None)
    extra = (
        f"The longest state SAIDI in this file is {saidi_leader['name']} at {saidi_leader['values']['saidi']:.0f} minutes. "
        f"The highest residential delivery share is {retail_leader['name']} at {retail_leader['values']['retail'] * 100:.1f}%."
    )
    if comed:
        extra += (
            f" Commonwealth Edison reports {comed['values']['homes']:,.0f} residential customers, SAIDI {comed['values']['saidi']:.0f} minutes, "
            f"and wholesale tag {comed['detail']['rtos']}."
        )
    if georgia:
        saidi = "no SAIDI on the utility sheet" if georgia["values"]["saidi"] is None else f"SAIDI {georgia['values']['saidi']:.0f} minutes"
        extra += f" Central Georgia ({georgia['name']}) reports {georgia['values']['homes']:,.0f} residential customers and {saidi}."
    lines.append(extra)
    lines.append(
        "Install friction and a national price-volatility series sit outside the score. The Texas section is a short public day-ahead window, a congestion example rather than a yearly value of the nodes."
    )
    return lines


def build_map(shapes):
    groups = {"L48": [], "AK": [], "HI": []}
    for shape in shapes:
        key = shape["abbr"] if shape["abbr"] in {"AK", "HI"} else "L48"
        groups[key].append(shape)
    raw = {"L48": albers, "AK": lambda lon, lat: (lon, lat), "HI": lambda lon, lat: (lon, lat)}
    boxes = {"L48": (8, 10, 952, 468), "AK": (36, 482, 210, 588), "HI": (240, 512, 400, 588)}
    projectors = {}
    for key, members in groups.items():
        points = [raw[key](lon, lat) for shape in members for ring in shape["rings"] for lon, lat in ring]
        projectors[key] = fit_projector(points, boxes[key]) if points else None
    features = []
    for shape in shapes:
        key = shape["abbr"] if shape["abbr"] in {"AK", "HI"} else "L48"
        path, cx, cy = path_from(shape["rings"], raw[key], projectors[key])
        features.append({"id": shape["abbr"], "d": path, "cx": cx, "cy": cy})
    return features


def ercot_docs(report_type):
    url = f"https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId={report_type}"
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode())
    docs = payload["ListDocsByRptTypeRes"]["DocumentList"]
    if isinstance(docs, dict):
        docs = [docs]
    found = []
    for item in docs:
        doc = item.get("Document") if isinstance(item, dict) else item
        if isinstance(doc, list):
            found.extend(doc)
        elif isinstance(doc, dict):
            found.append(doc)
    return found


def download_doc(doc, folder):
    doc_id = str(doc.get("DocID"))
    name = doc.get("FriendlyName") or doc_id
    dest = folder / f"{doc_id}.zip"
    if not dest.exists() or dest.stat().st_size == 0:
        url = f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc_id}"
        fetch(url, dest, timeout=90)
    return name, dest


def csv_rows(path, prefer=None):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if prefer:
            member = next(name for name in names if prefer.lower() in name.lower())
        else:
            member = names[0]
        text = archive.read(member).decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    keys = {"".join(ch for ch in column.lower() if ch.isalnum()): index for index, column in enumerate(header)}
    for row in reader:
        yield keys, row


def parse_day(text):
    text = (text or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def cell(keys, row, *names):
    for name in names:
        index = keys.get(name)
        if index is not None and index < len(row):
            return row[index]
    return ""


def quantile(values, p):
    ordered = sorted(values)
    if not ordered:
        return None
    pos = (len(ordered) - 1) * p
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return ordered[low]
    return ordered[low] * (high - pos) + ordered[high] * (pos - low)


def build_ercot():
    folder = CACHE / "ercot"
    folder.mkdir(parents=True, exist_ok=True)
    price_docs = [doc for doc in ercot_docs(12331) if str(doc.get("FriendlyName", "")).lower().endswith("_csv")]
    if not price_docs:
        return {"available": False, "summary": "ERCOT did not return day-ahead settlement-point files for report 12331."}
    print(f"ERCOT price files: {len(price_docs)}")
    mapping_docs = [doc for doc in ercot_docs(10008) if str(doc.get("Extension", "")).lower() == "zip"]
    mapping_name, mapping_path = download_doc(mapping_docs[0], folder)
    zones = defaultdict(list)
    substations = defaultdict(list)
    for keys, row in csv_rows(mapping_path, "Settlement_Points"):
        node = cell(keys, row, "resourcenode").strip()
        zone = cell(keys, row, "settlementloadzone").strip()
        station = cell(keys, row, "substation").strip()
        if node and zone:
            zones[node].append(zone if zone.startswith("LZ_") else f"LZ_{zone}")
            if station:
                substations[node].append(station)
    zone_of = {node: max(set(items), key=items.count) for node, items in zones.items()}
    station_of = {node: max(set(items), key=items.count) for node, items in substations.items()}
    wanted = set(zone_of) | set(zone_of.values())
    prices = defaultdict(dict)
    dates = set()
    for doc in price_docs:
        try:
            _, path = download_doc(doc, folder)
        except Exception as exc:
            print("skip price file", doc.get("DocID"), exc)
            continue
        for keys, row in csv_rows(path):
            point = cell(keys, row, "settlementpoint", "settlementpointname").strip()
            if point not in wanted:
                continue
            value = num(cell(keys, row, "settlementpointprice"))
            if value is None:
                continue
            key = (
                parse_day(cell(keys, row, "deliverydate")),
                cell(keys, row, "hourending").strip(),
                cell(keys, row, "dstflag").strip(),
            )
            prices[point][key] = value
            dates.add(key[0])
    nodes = []
    for node, zone in zone_of.items():
        bases = []
        for key, price in prices.get(node, {}).items():
            zonal = prices.get(zone, {}).get(key)
            if zonal is None:
                continue
            bases.append(price - zonal)
        if len(bases) < 100:
            continue
        nodes.append({
            "name": node,
            "zone": zone,
            "substation": station_of.get(node) or "",
            "hours": len(bases),
            "p95_basis": round(quantile(bases, 0.95), 2),
            "mean_basis": round(sum(bases) / len(bases), 2),
            "share_ge_20": round(sum(1 for value in bases if value >= 20) / len(bases), 4),
        })
    nodes.sort(key=lambda item: -item["p95_basis"])
    zone_groups = defaultdict(list)
    for node in nodes:
        zone_groups[node["zone"]].append(node["p95_basis"])
    zone_rows = []
    for name, values in sorted(zone_groups.items()):
        ordered = sorted(values)
        mid = ordered[len(ordered) // 2]
        zone_rows.append({"name": name, "nodes": len(values), "median_p95": round(mid, 2)})
    constraints, constraint_note = build_constraints(folder, set(dates))
    window = f"{min(dates)} through {max(dates)}" if dates else "unknown dates"
    return {
        "available": True,
        "summary": (
            f"Day-ahead settlement point prices, ERCOT report NP4-190-CD (12331), {len(dates)} delivery dates ({window}). "
            f"Basis is the resource-node price minus its settlement load zone in the same hour. "
            f"{len(nodes)} resource nodes had at least 100 comparable hours. The settlement-point file is {mapping_name}. "
            "The public price file has no coordinates, so the nodes are a table."
        ),
        "window": {"start": min(dates) if dates else None, "end": max(dates) if dates else None, "days": len(dates)},
        "nodes": nodes[:12],
        "zones": zone_rows,
        "constraints": constraints,
        "notes": [
            "A positive basis means the node cleared higher than its load zone in the day-ahead market. Losses and congestion are both inside that spread. There is no shift-factor file here, so a constraint is not assigned to a node.",
            "The $20 threshold counts hours. It is a label for this note, not an ERCOT rule. This window is the files posted on the public list at build time, not a calendar year.",
            constraint_note,
        ],
    }


def build_constraints(folder, dates):
    try:
        docs = [doc for doc in ercot_docs(12332) if str(doc.get("FriendlyName", "")).lower().endswith("_csv")]
    except Exception as exc:
        return [], f"Day-ahead shadow prices were not read ({exc})."
    if not docs:
        return [], "Report 12332 did not list a shadow-price CSV, so constraints are omitted."
    totals = {}
    for doc in docs:
        try:
            _, path = download_doc(doc, folder)
        except Exception as exc:
            print("skip shadow file", doc.get("DocID"), exc)
            continue
        for keys, row in csv_rows(path):
            delivery = parse_day(cell(keys, row, "deliverydate"))
            if dates and delivery and delivery not in dates:
                continue
            price = num(cell(keys, row, "shadowprice"))
            if price is None or price <= 0:
                continue
            name = cell(keys, row, "constraintname").strip() or "unnamed"
            slot = totals.setdefault(name, {"hours": 0, "shadow_sum": 0.0, "from": "", "to": ""})
            slot["hours"] += 1
            slot["shadow_sum"] += price
            slot["from"] = slot["from"] or cell(keys, row, "fromstation").strip()
            slot["to"] = slot["to"] or cell(keys, row, "tostation").strip()
    ordered = sorted(totals.items(), key=lambda item: -item[1]["hours"])[:8]
    return [
        {"name": name, "hours": item["hours"], "shadow_sum": round(item["shadow_sum"], 1), "from": item["from"], "to": item["to"]}
        for name, item in ordered
    ], "Shadow prices are ERCOT report NP4-191-CD, DAM Shadow Prices. Hours count rows with a positive shadow price on the same delivery dates. One constraint can bind under more than one contingency, so the hour count can run past the length of the window."


def sources(nri_version):
    return [
        {
            "title": "Census ACS 2024 5-year, table B25032",
            "url": ACS_URL,
            "detail": "Owner-occupied one-unit detached (B25032_E003) plus one-unit attached (B25032_E004), state rows only. Vintage 2020–2024.",
        },
        {
            "title": "EIA Form 861, 2025 final",
            "url": EIA_URL,
            "detail": "Released 7 Oct 2026. State SAIDI and SAIFI from the state-total sheet, any method with major events when that column is filled. Customers, delivery share, RTO tags, net-metered batteries, demand response, and dynamic pricing from the same zip.",
        },
        {
            "title": "FEMA National Risk Index, counties",
            "url": "https://hazards.fema.gov/nri/data-resources",
            "detail": f"County feature service queried {TODAY}. File version {nri_version or 'not labeled'}. Storm is the unweighted mean of the hazard risk scores a county actually has.",
        },
        {
            "title": "Census cartographic state boundaries, 2024 1:20,000,000",
            "url": SHAPE_URL,
            "detail": "Used only to draw the map.",
        },
        {
            "title": "ERCOT day-ahead settlement point prices, NP4-190-CD",
            "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-190-CD",
            "detail": "Report type 12331. Node basis against the settlement load zone from the settlement-point list, NP4-160-SG, report type 10008.",
        },
        {
            "title": "Base Retail Illinois supply agreement",
            "url": "https://www.basepowercompany.com/_bpc/files/ENC6_mP2RRd-de1nBi7v6w-esa-uds-v09302026-docx.pdf",
            "detail": "Battery Time of Use plan for ComEd residential customers. License 26-0121. ICC docket P2026-0121.",
        },
        {
            "title": "Base founding-member terms",
            "url": "https://help.basepowercompany.com/en/articles/12742081",
            "detail": "Help center page edited 17 June 2026: offer available as of 15 June 2026 for the first 2,000 Illinois installations.",
        },
        {
            "title": "Base Connecticut operations manager posting",
            "url": "https://jobs.ashbyhq.com/base-power/6874d333-86da-465b-a2f8-f14ee397e460",
            "detail": "Published 10 Sep 2026. North Haven electrical supervisor posting describes expansion beyond Texas.",
        },
        {
            "title": "Grid & Generation, Georgia partnership report",
            "url": "https://gridandgeneration.com/news/base-power-expands-georgia-mw-residential-battery-network/",
            "detail": "21 Oct 2026. Attributes the Central Georgia EMC, 50 MW, 2027 installation timing to Utility Dive and energytech.com. Secondary report.",
        },
    ]


def omitted(utility_nri):
    items = [
        {
            "title": "Permitting speed",
            "reason": "The SolarAPP+ locations CSV on gosolarapp.org returned HTTP 403. The public HTML table contained 100 jurisdictions and stopped alphabetically at Del Norte, so it is not a state census. It is not in the score.",
        },
        {
            "title": "Home-battery interconnection time",
            "reason": "No machine-readable national series of residential permission-to-operate times was retrieved. Berkeley Lab's Queued Up measures generator interconnection, a different queue, so it is not used as a home-battery proxy.",
        },
        {
            "title": "Price volatility outside ERCOT",
            "reason": "A comparable public nodal series was not pulled for PJM, MISO, CAISO, or the other markets. Those states are not given a zero on a grid-value factor. Texas is a separate section.",
        },
        {
            "title": "DSIRE incentives",
            "reason": "State battery rebates were not scraped into this build. Program activity is EIA-861 enrollment and net-metered battery counts, which is a different fact from a rebate existing on paper.",
        },
    ]
    if not utility_nri["used"]:
        items.append({
            "title": "Utility storm and heat",
            "reason": f"Service-territory counties matched the risk index on {utility_nri['matched']} of {utility_nri['county_rows']} rows. Below a 75% match, county risk is left off the utility score.",
        })
    return items


def inject_narrative(paragraphs):
    if not HTML.exists():
        return
    text = HTML.read_text()
    start = "<!-- findings:start -->"
    end = "<!-- findings:end -->"
    if start not in text or end not in text:
        return
    body = "\n".join(f"<p>{paragraph.replace('&', '&amp;').replace('<', '&lt;')}</p>" for paragraph in paragraphs)
    HTML.write_text(text.split(start)[0] + start + "\n" + body + "\n" + end + text.split(end)[1])


def main():
    skip_ercot = "--skip-ercot" in sys.argv
    print("shapes")
    shapes = load_shapes()
    print("homes", len(shapes))
    homes = load_homes()
    print("nri")
    nri_version, counties = load_nri()
    print("nri counties", len(counties), nri_version)
    folder = ensure_eia()
    print("eia")
    reliability, utility_reliability = load_reliability(folder)
    customers, ba_weight, utility_ba, iso_names, ba_labels, names = load_sales_and_markets(folder)
    print("ISO codes", sorted(set(iso_names.values())))
    programs = load_programs(folder)
    territory = load_territory(folder)
    states = build_states(shapes, homes, nri_version, counties, reliability, customers, ba_weight, iso_names, ba_labels, programs)
    utilities, utility_nri = build_utilities(customers, utility_ba, iso_names, names, utility_reliability, programs, territory, counties)
    print("utility county match", utility_nri)
    print("ercot" if not skip_ercot else "skip ercot")
    try:
        ercot = {"available": False, "summary": "ERCOT was skipped for this run."} if skip_ercot else build_ercot()
    except Exception as exc:
        ercot = {"available": False, "summary": f"The ERCOT extract failed and was left out: {exc}"}
        print("ERCOT failed:", exc)
    paragraphs = narrative(states, utilities)
    if ercot.get("nodes"):
        top = ercot["nodes"][0]
        houston = next((zone for zone in ercot.get("zones", []) if zone["name"] == "LZ_HOUSTON"), None)
        constraint = ercot["constraints"][0]["name"] if ercot.get("constraints") else None
        houston_bit = (
            f" The median resource node in LZ_HOUSTON had a 95th-percentile basis of ${houston['median_p95']:.2f}/MWh."
            if houston else ""
        )
        constraint_bit = f" The constraint with the most positive shadow-price rows was {constraint}." if constraint else ""
        paragraphs.append(
            f"From {ercot['window']['start']} through {ercot['window']['end']}, {top['name']} in {top['zone']} "
            f"(substation {top['substation']}) had a 95th-percentile day-ahead basis of ${top['p95_basis']:.2f}/MWh "
            f"across {top['hours']} hours, and {top['share_ge_20'] * 100:.0f}% of those hours cleared at least $20/MWh above the zone."
            + houston_bit + constraint_bit
        )
    payload = {
        "generated": TODAY,
        "vintage": (
            f"Built {TODAY}. Homes: ACS 2024 5-year. Outages, customers, choice, markets, batteries, and programs: EIA-861 calendar 2025, final release 7 Oct 2026. "
            f"Storm and heat: FEMA National Risk Index counties, version {nri_version or 'unlabeled'}, queried {TODAY}."
        ),
        "factors": FACTORS,
        "states": states,
        "utilities": utilities,
        "map": build_map(shapes),
        "ercot": ercot,
        "omitted": omitted(utility_nri),
        "narrative": paragraphs,
        "sources": sources(nri_version),
        "utility_nri": utility_nri,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1))
    inject_narrative(paragraphs)
    print("wrote", OUT, "states", len(states), "utilities", len(utilities))
    for item in rank(states, {factor["id"]: 1 for factor in FACTORS})[:10]:
        print(f"  {item['name']:20} {round(item['score']*100):3}  homes={item['record']['values']['homes']}")


if __name__ == "__main__":
    main()
