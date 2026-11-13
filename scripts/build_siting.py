#!/usr/bin/env python3
"""Build data/siting from free public files. No API key and no paid source.

    python3 scripts/build_siting.py

Cached downloads stay in analysis/cache/siting/ (gitignored). The committed
files are the processed snapshots: each one names a source URL and the
retrieval time. Re-running the script refreshes whatever the public servers
still publish. Chart numbers that were read off an image are emitted only
when that image's sha256 still matches; a changed deck becomes a gap instead
of a stale transcription.

County appraisal rolls are not downloaded. They publish owner names and
street addresses, and this tool keeps counts only. Census ACS is the homes
count until a later run streams a roll, aggregates a state-class code, and
discards the owner fields before anything is written.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "analysis" / "cache" / "siting"
OUT = ROOT / "data" / "siting"
UA = "megawatt.fun-siting/1.0 (public data build; +https://megawatt.fun)"

CHARGE_HOURS = (11, 12, 13, 14)
DISCHARGE_HOURS = (20, 21)
HUB_LZ = [
    "HB_HOUSTON", "HB_NORTH", "HB_PAN", "HB_SOUTH", "HB_WEST", "HB_BUSAVG", "HB_HUBAVG",
    "LZ_AEN", "LZ_CPS", "LZ_HOUSTON", "LZ_LCRA", "LZ_NORTH", "LZ_RAYBN", "LZ_SOUTH", "LZ_WEST",
]
RETAIL_TDU = {"centerpoint", "oncor", "aep_central", "aep_north", "tnmp", "lpl", "nueces"}
NOIE_OWNERSHIP = {"Municipal", "Cooperative", "Political Subdivision"}
OPTED_IN_NAMES = ("lubbock", "nueces")

# Chart labels read from PNGs inside the June 19, 2026 LLWG deck.
# Emitted only when the embedded image hash still matches.
CHARTS = {
    "ppt/media/image13.png": {
        "sha256": "ee563986dfc5234ca3ec323a06e9e3f8a29012543272a32b6fa01bf45a7c66cf",
        "slide": 7,
        "title": "Approved to Energize by Load Zone",
        "note": "Printed segment labels. LZ_WEST 3142 + 1908 = 5050. Other 2394 + 1482 = 3876. The two totals sum to 8926 MW. Slide 8 text says 8927 MW approved to energize. The 1 MW difference is left as printed.",
        "rows": [
            {"zone": "LZ_WEST", "remainingApprovedMw": 3142, "observedNonSimultaneousPeakMw": 1908, "totalMw": 5050},
            {"zone": "Other", "remainingApprovedMw": 2394, "observedNonSimultaneousPeakMw": 1482, "totalMw": 3876,
             "note": "ERCOT did not split this bar into Houston, South, or the NOIE load zones."},
        ],
    },
    "ppt/media/image14.png": {
        "sha256": "37440e1284122da14b18c5f69d478978340652bceb2e09e527ec390608c7d912",
        "slide": 7,
        "title": "Approved to Energize by Project Type",
        "note": "Co-located 918 + 1144 = 2062. Standalone 4882 + 1982 = 6864. Sum 8926 MW, against 8927 MW in the slide text.",
        "rows": [
            {"type": "Co-Located", "remainingApprovedMw": 918, "observedNonSimultaneousPeakMw": 1144, "totalMw": 2062},
            {"type": "Standalone", "remainingApprovedMw": 4882, "observedNonSimultaneousPeakMw": 1982, "totalMw": 6864},
        ],
    },
    "ppt/media/image22.png": {
        "sha256": "f4f16064390259cd9bd4a4e85cae38acc0aae13c5e30edb82b019cc4fc250438",
        "slide": 15,
        "title": "Large load study status by load zone, MW",
        "note": "Queue requests, not operating load. Printed totals: LZ_WEST 82247 (segments sum to 82246), LZ_NORTH 56788, Other 60927.",
        "rows": [
            {"zone": "LZ_WEST", "underReviewMw": 57790, "section94OnlyMw": 4268, "section9495MetMw": 20188, "printedTotalMw": 82247},
            {"zone": "LZ_NORTH", "underReviewMw": 44016, "section94OnlyMw": 4021, "section9495MetMw": 8751, "printedTotalMw": 56788},
            {"zone": "Other", "underReviewMw": 49267, "section94OnlyMw": 3514, "section9495MetMw": 8146, "printedTotalMw": 60927},
        ],
    },
    "ppt/media/image23.png": {
        "sha256": "e93635eb0ef1457bce173cd0b649bc91385912129205f2255d870226278a5dd9",
        "slide": 16,
        "title": "Large load study status by load zone, project count",
        "rows": [
            {"zone": "LZ_WEST", "underReview": 59, "section94Only": 7, "section9495Met": 44, "total": 110},
            {"zone": "LZ_NORTH", "underReview": 60, "section94Only": 10, "section9495Met": 22, "total": 92},
            {"zone": "Other", "underReview": 78, "section94Only": 10, "section9495Met": 14, "total": 102},
        ],
    },
    "ppt/media/image17.png": {
        "sha256": "c4383c273a22fbfdb388dfa8efb4e1707d2c6425ca7f85cd2cde14f7247c383c",
        "slide": 10,
        "title": "Distribution of Large Load Projects by Size",
        "note": "Requested MW, not observed consumption. ERCOT does not label these projects as data centers.",
        "rows": [
            {"bin": "75-<250 MW", "projects": 115, "requestedMw": 18686},
            {"bin": "250-<500 MW", "projects": 144, "requestedMw": 50198},
            {"bin": "500-<1000 MW", "projects": 175, "requestedMw": 114851},
            {"bin": "1000+ MW", "projects": 207, "requestedMw": 305149},
        ],
    },
}

GROWTH_SHA = "0cf2bef51ff2c131f151bea88a445dee66a14eb0ca30ce4d3d253cbdaecceed8"
GROWTH = {
    "image": "ppt/media/image10.png",
    "slide": 4,
    "title": "Actual and Projected Large Load Growth 2022-2033",
    "unit": "GW",
    "note": "Printed table on the chart. 2026 and later years mix operating load with requests that have no studies. Not a forecast this site endorses.",
    "statuses": [
        "No Studies Submitted",
        "Under ERCOT Review",
        "Section 9.4 Requirements Only",
        "Section 9.4/9.5 Requirements Met",
        "A2E but not operational",
        "Observed Energized",
    ],
    "years": [2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033],
    "values": [
        [0.0, 0.0, 0.0, 4.1, 32.3, 102.4, 188.9, 232.4, 245.8, 257.3, 257.6, 257.6],
        [0.0, 0.0, 0.0, 0.0, 8.1, 52.9, 111.0, 131.2, 147.7, 148.2, 151.1, 151.1],
        [0.0, 0.0, 0.0, 0.0, 1.5, 5.7, 7.2, 10.4, 11.8, 11.8, 11.8, 11.8],
        [0.0, 0.0, 0.0, 0.0, 10.1, 31.0, 36.1, 36.8, 36.8, 36.8, 37.1, 37.1],
        [0.0, 0.4, 1.8, 3.1, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2],
        [3.3, 4.3, 4.8, 5.7, 5.7, 5.7, 5.7, 5.7, 5.7, 5.7, 5.7, 5.7],
    ],
    "totals": [3.3, 4.7, 6.6, 12.9, 60.8, 201.0, 352.2, 419.7, 451.0, 463.0, 466.5, 466.5],
}

BATCH_SHA = "d48ecd486ff7798d1cd0dd93309759f3e45285d399428f5b48f5617c1d42c27d"
BATCH_ZONES = ["North Central", "North", "West", "South Central", "Far West", "South", "Coast", "East", "Not Specified"]
BATCH_ROWS = [
    ["(1) Base Load Eligible", [3.4, 13.1, 1.8, 1.2, 1.9, 1.4, 0.7, 1.4, 0.0], 24.9],
    ["(2a) Studies Complete", [0.0, 1.3, 1.1, 0.0, 0.0, 1.6, 2.7, 1.9, 0.0], 8.7],
    ["(2b) Potentially Invalid", [0.3, 1.6, 1.6, 0.5, 0.0, 0.0, 0.1, 0.0, 0.0], 4.2],
    ["(2c) Under Review", [0.5, 1.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 3.0],
    ["(3) Studied/Base Eligible", [3.7, 0.1, 1.6, 1.0, 0.9, 0.2, 2.1, 0.0, 0.1], 9.6],
    ["(4) One Study Complete", [19.8, 7.7, 1.4, 7.6, 2.4, 3.8, 0.5, 3.5, 0.0], 46.6],
    ["(5) Path to Studied", [16.1, 21.9, 16.2, 9.0, 8.0, 11.5, 11.9, 2.6, 0.0], 97.2],
    ["(6) Not Included", [100.2, 58.8, 27.7, 31.7, 17.9, 11.1, 11.0, 19.1, 9.6], 287.2],
]
BATCH_TOTALS = [144.0, 106.0, 52.4, 51.0, 31.1, 29.6, 29.0, 28.5, 9.7, 481.4]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def fetch(url: str, dest: Path, timeout: int = 180) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=timeout) as response:
        blob = response.read()
        status = getattr(response, "status", 200)
    if status != 200 or not blob:
        raise RuntimeError(f"Empty response for {url}")
    dest.write_bytes(blob)
    record = {
        "url": url,
        "retrievedAt": now_iso(),
        "sha256": sha256_bytes(blob),
        "bytes": len(blob),
        "path": str(dest.relative_to(ROOT)),
    }
    dest.with_suffix(dest.suffix + ".meta.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


def fetch_cached(url: str, dest: Path, timeout: int = 180) -> dict:
    meta = dest.with_suffix(dest.suffix + ".meta.json")
    if dest.exists() and dest.stat().st_size > 0 and meta.exists():
        record = json.loads(meta.read_text(encoding="utf-8"))
        blob = dest.read_bytes()
        if record.get("sha256") == sha256_bytes(blob) and record.get("url") == url:
            record["cache"] = "reused"
            return record
    record = fetch(url, dest, timeout=timeout)
    record["cache"] = "downloaded"
    return record


def ercot_docs(report_type: int) -> list:
    url = f"https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId={report_type}"
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=60) as response:
        payload = json.loads(response.read().decode())
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


def hour_ending(text: str) -> int:
    hour = int(str(text).strip().split(":")[0])
    if hour == 0:
        return 24
    if not 1 <= hour <= 24:
        raise ValueError(text)
    return hour


def mean(values):
    if not values:
        return None
    return sum(values) / len(values)


def round4(value):
    if value is None:
        return None
    return round(value, 4)


def summarize_hourly(rows):
    """rows: iterable of (date, hour_ending, price). Duplicate hours are averaged.

    Diurnal spread for one day is the mean of discharge hours minus the mean of
    charge hours. The series spread is the mean of those daily spreads, and a
    negative day stays in the average. A day missing any clock hour is dropped.
    """
    bucket = defaultdict(list)
    for day, hour, price in rows:
        if price is None:
            continue
        bucket[(day, int(hour))].append(float(price))
    by_day = defaultdict(dict)
    all_prices = []
    for (day, hour), prices in bucket.items():
        value = sum(prices) / len(prices)
        by_day[day][hour] = value
        all_prices.append(value)
    daily = []
    for day, hours in by_day.items():
        if any(hour not in hours for hour in CHARGE_HOURS + DISCHARGE_HOURS):
            continue
        charge = sum(hours[hour] for hour in CHARGE_HOURS) / len(CHARGE_HOURS)
        discharge = sum(hours[hour] for hour in DISCHARGE_HOURS) / len(DISCHARGE_HOURS)
        daily.append({"date": day, "charge": charge, "discharge": discharge, "spread": discharge - charge})
    daily.sort(key=lambda item: item["date"])
    return {
        "hours": len(all_prices),
        "days": len(daily),
        "mean": mean(all_prices),
        "diurnal": mean([item["spread"] for item in daily]),
        "negativeDays": sum(1 for item in daily if item["spread"] < 0),
        "daily": daily,
    }


def read_deployment_csv(path: Path):
    rows = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ["date", "hourEnding", "repeated", "dam", "rtm"]:
            raise ValueError(f"Unexpected columns in {path.name}: {reader.fieldnames}")
        for row in reader:
            rows.append((row["date"], int(row["hourEnding"]), float(row["dam"]), float(row["rtm"])))
    return rows


def hub_lz_prices(sources: list) -> dict:
    manifest = json.loads((ROOT / "data" / "deployment" / "manifest.json").read_text(encoding="utf-8"))
    sources.append({
        "id": "ercot-hub-lz-annual",
        "title": "ERCOT hub and load-zone day-ahead (report 13060) and real-time (report 13061)",
        "url": "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=13060",
        "retrievedAt": manifest["sources"][0]["retrievedAt"],
        "sha256": None,
        "bytes": None,
        "detail": "Processed hourly files already in data/deployment/*.csv. Provenance is data/deployment/manifest.json. scripts/ercot_prices.py is the fetcher. This siting build does not re-download the annual workbooks.",
        "manifestSources": manifest["sources"],
        "period": manifest["period"],
    })
    points = {}
    daily = {}
    for point in HUB_LZ:
        path = ROOT / "data" / "deployment" / f"{point}.csv"
        rows = read_deployment_csv(path)
        dam = summarize_hourly((day, hour, dam_price) for day, hour, dam_price, _rt in rows)
        rt = summarize_hourly((day, hour, rt_price) for day, hour, _dam, rt_price in rows)
        kind = "hub-average" if point in ("HB_BUSAVG", "HB_HUBAVG") else "hub" if point.startswith("HB_") else "load-zone"
        points[point] = {
            "id": point,
            "kind": kind,
            "hours": dam["hours"],
            "days": dam["days"],
            "meanDam": round4(dam["mean"]),
            "meanRt": round4(rt["mean"]),
            "diurnalDam": round4(dam["diurnal"]),
            "diurnalRt": round4(rt["diurnal"]),
            "negativeDamDays": dam["negativeDays"],
            "negativeRtDays": rt["negativeDays"],
        }
        if dam["days"] != rt["days"]:
            raise ValueError(f"{point} DAM days {dam['days']} != RT days {rt['days']}")
        daily[point] = {
            "dates": [item["date"] for item in dam["daily"]],
            "damSpread": [round4(item["spread"]) for item in dam["daily"]],
            "rtSpread": [round4(item["spread"]) for item in rt["daily"]],
        }
    return {"period": manifest["period"], "points": points, "daily": daily}


def column_key(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def csv_members(blob: bytes, prefer: str | None = None):
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not names:
            return None, None
        if prefer:
            member = next((name for name in names if prefer.lower() in name.lower()), None)
            if member is None:
                return None, None
        else:
            member = names[0]
        text = archive.read(member).decode("utf-8-sig", errors="replace")
    return member, text


def parse_settlement_points(blob: bytes) -> list:
    _member, text = csv_members(blob, "Settlement_Points")
    if text is None:
        raise ValueError("Settlement point zip has no Settlement_Points csv")
    reader = csv.reader(io.StringIO(text))
    header = [column.strip() for column in next(reader)]
    keys = {column_key(column): index for index, column in enumerate(header)}

    def cell(row, *names):
        for name in names:
            index = keys.get(name)
            if index is not None and index < len(row):
                return row[index].strip()
        return ""

    points = []
    seen = set()
    for row in reader:
        node = cell(row, "resourcenode", "settlementpoint", "settlementpointname")
        if not node or node in seen:
            continue
        seen.add(node)
        zone = cell(row, "settlementloadzone")
        if zone and not zone.startswith("LZ_"):
            zone = f"LZ_{zone}"
        if node.startswith("HB_"):
            kind = "hub"
        elif node.startswith("LZ_"):
            kind = "load-zone"
        else:
            kind = "resource-node"
        points.append({
            "name": node,
            "kind": kind,
            "zone": zone or None,
            "substation": cell(row, "substation") or None,
            "kv": cell(row, "voltagelevel") or None,
        })
    points.sort(key=lambda item: item["name"])
    return points


def _substation_counts(blob: bytes, member: str, zone_col: str) -> dict:
    counts = defaultdict(Counter)
    _name, text = csv_members(blob, member)
    if text is None:
        return counts
    reader = csv.reader(io.StringIO(text))
    header = [column.strip() for column in next(reader)]
    keys = {column_key(column): index for index, column in enumerate(header)}
    sub_i = keys.get("substation")
    zone_i = keys.get(zone_col)
    if sub_i is None or zone_i is None:
        return counts
    for row in reader:
        if sub_i >= len(row) or zone_i >= len(row):
            continue
        station = row[sub_i].strip()
        zone = row[zone_i].strip()
        if not station or not zone:
            continue
        if not zone.startswith("LZ_"):
            zone = f"LZ_{zone}"
        counts[station][zone] += 1
    return counts


def parse_zone_substations(blob: bytes) -> list:
    """One row per substation.

    Settlement_Points tags transmission buses with a competitive load zone.
    NOIE_Mapping tags the same names with the municipal or co-op load zone
    (LZ_AEN, LZ_CPS, LZ_LCRA, LZ_RAYBN). When a name is on the NOIE list, that
    zone is the one used here, because a NOIE meter settles at the NOIE zone.
    A tie inside one file is left without a zone.
    """
    bus = _substation_counts(blob, "Settlement_Points", "settlementloadzone")
    noie = _substation_counts(blob, "NOIE_Mapping", "noie")

    def pick(zones: Counter):
        if not zones:
            return None
        ranked = zones.most_common()
        if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
            return None
        return ranked[0][0]

    rows = []
    for station in sorted(set(bus) | set(noie)):
        source = "noie" if station in noie else "bus"
        zone = pick(noie[station] if station in noie else bus[station])
        buses = sum((noie[station] if station in noie else bus[station]).values())
        rows.append({"name": station, "zone": zone, "buses": buses, "zoneSource": source})
    return rows


def parse_dam_zip(blob: bytes, wanted_hours: set) -> dict:
    """point -> date -> hour -> [prices]. Only the clock hours, plus nothing else."""
    _member, text = csv_members(blob)
    if text is None:
        return {}
    reader = csv.reader(io.StringIO(text))
    header = [column.strip() for column in next(reader)]
    keys = {column_key(column): index for index, column in enumerate(header)}
    for required in ("deliverydate", "hourending", "settlementpoint", "settlementpointprice"):
        if required not in keys:
            raise ValueError(f"DAM header missing {required}: {header}")
    out = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for row in reader:
        try:
            hour = hour_ending(row[keys["hourending"]])
        except (ValueError, IndexError):
            continue
        if hour not in wanted_hours:
            continue
        point = row[keys["settlementpoint"]].strip()
        if not point:
            continue
        raw_day = row[keys["deliverydate"]].strip()
        # YYYY-MM-DD or MM/DD/YYYY
        if "/" in raw_day:
            month, day, year = raw_day.split("/")
            iso = f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        else:
            iso = raw_day[:10]
        try:
            price = float(row[keys["settlementpointprice"]])
        except ValueError:
            continue
        out[point][iso][hour].append(price)
    return out


def fold_node_prices(collected: dict) -> list:
    nodes = []
    for point, days in collected.items():
        daily = []
        all_prices = []
        for day, hours in days.items():
            resolved = {}
            for hour, prices in hours.items():
                resolved[hour] = sum(prices) / len(prices)
                all_prices.append(resolved[hour])
            if any(hour not in resolved for hour in CHARGE_HOURS + DISCHARGE_HOURS):
                continue
            charge = sum(resolved[hour] for hour in CHARGE_HOURS) / len(CHARGE_HOURS)
            discharge = sum(resolved[hour] for hour in DISCHARGE_HOURS) / len(DISCHARGE_HOURS)
            daily.append(discharge - charge)
        if len(daily) < 20:
            continue
        kind = "hub" if point.startswith("HB_") else "load-zone" if point.startswith("LZ_") else "resource-node"
        nodes.append({
            "name": point,
            "kind": kind,
            "days": len(daily),
            "diurnalDam": round4(sum(daily) / len(daily)),
            "meanClockDam": round4(sum(all_prices) / len(all_prices)) if all_prices else None,
        })
    nodes.sort(key=lambda item: (-(item["diurnalDam"] or 0), item["name"]))
    return nodes


def download_dam(sources: list):
    docs = [doc for doc in ercot_docs(12331) if str(doc.get("FriendlyName", "")).lower().endswith("_csv")]
    folder = CACHE / "dam"
    folder.mkdir(parents=True, exist_ok=True)

    def one(doc):
        doc_id = str(doc.get("DocID"))
        dest = folder / f"{doc_id}.zip"
        url = f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc_id}"
        record = fetch_cached(url, dest, timeout=120)
        record["docId"] = doc_id
        record["friendlyName"] = doc.get("FriendlyName")
        record["publishDate"] = doc.get("PublishDate")
        return record

    records = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(one, doc) for doc in docs]
        for future in as_completed(futures):
            records.append(future.result())
            print(f"DAM files {len(records)}/{len(docs)}", flush=True)
    records.sort(key=lambda item: str(item.get("publishDate") or ""))
    sources.append({
        "id": "ercot-dam-np4-190-cd",
        "title": "ERCOT day-ahead settlement point prices, NP4-190-CD, report type 12331",
        "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-190-CD",
        "retrievedAt": now_iso(),
        "files": len(records),
        "detail": "Public list keeps roughly a month. Hourly rows are not committed. The snapshot keeps the mean daily clock spread.",
    })
    wanted = set(CHARGE_HOURS + DISCHARGE_HOURS)
    collected = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    dates = set()
    for record in records:
        blob = (folder / f"{record['docId']}.zip").read_bytes()
        parsed = parse_dam_zip(blob, wanted)
        for point, days in parsed.items():
            for day, hours in days.items():
                dates.add(day)
                for hour, prices in hours.items():
                    collected[point][day][hour].extend(prices)
    return records, fold_node_prices(collected), sorted(dates)


def norm_name(text: str) -> str:
    return "".join(ch for ch in (text or "").upper() if ch.isalnum())


def load_hifld(sources: list):
    url_base = (
        "https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/"
        "Electric_Substations/FeatureServer/0/query"
    )
    rows = []
    offset = 0
    while True:
        query = (
            f"{url_base}?where=STATE%3D%27TX%27&outFields=NAME,LATITUDE,LONGITUDE,STATUS"
            f"&returnGeometry=false&f=json&resultRecordCount=2000&resultOffset={offset}"
        )
        req = Request(query, headers={"User-Agent": UA})
        with urlopen(req, timeout=60) as response:
            payload = json.loads(response.read().decode())
        features = payload.get("features") or []
        for feature in features:
            rows.append(feature.get("attributes") or {})
        if not features or not payload.get("exceededTransferLimit"):
            break
        offset += len(features)
    sources.append({
        "id": "hifld-tx-substations",
        "title": "HIFLD Electric Substations, Texas, public feature service",
        "url": url_base + "?where=STATE='TX'",
        "retrievedAt": now_iso(),
        "rows": len(rows),
        "detail": "Used only to place an ERCOT substation name that matches exactly one HIFLD name. No owner and no address is stored.",
    })
    buckets = defaultdict(list)
    for row in rows:
        try:
            lat = float(row.get("LATITUDE"))
            lon = float(row.get("LONGITUDE"))
        except (TypeError, ValueError):
            continue
        if not (25 <= lat <= 37 and -107 <= lon <= -93):
            continue
        key = norm_name(row.get("NAME") or "")
        if key:
            buckets[key].append((lat, lon))
    unique = {key: points[0] for key, points in buckets.items() if len(points) == 1}
    return unique, len(buckets) - len(unique)


def point_in_ring(lon, lat, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi + 0.0) + xi):
            inside = not inside
        j = i
    return inside


def point_in_geometry(lon, lat, geometry) -> bool:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        if not coords or not point_in_ring(lon, lat, coords[0]):
            return False
        return not any(point_in_ring(lon, lat, hole) for hole in coords[1:])
    if kind == "MultiPolygon":
        return any(point_in_geometry(lon, lat, {"type": "Polygon", "coordinates": polygon}) for polygon in coords)
    return False


def county_boxes(features):
    boxes = []
    for feature in features:
        lon_lat = []

        def walk(node):
            if isinstance(node, list) and node and isinstance(node[0], (int, float)):
                lon_lat.append(node)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(feature["geometry"]["coordinates"])
        if not lon_lat:
            continue
        lons = [pair[0] for pair in lon_lat]
        lats = [pair[1] for pair in lon_lat]
        boxes.append((min(lons), min(lats), max(lons), max(lats), feature))
    return boxes


def load_counties(sources: list):
    url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/"
        "State_County/MapServer/13/query?where=STATE%3D%2748%27&outFields=GEOID%2CNAME"
        "&outSR=4326&f=geojson&geometryPrecision=3"
    )
    dest = CACHE / "texas-counties.geojson"
    try:
        record = fetch_cached(url, dest, timeout=120)
        geo = json.loads(dest.read_text(encoding="utf-8"))
        if geo.get("type") != "FeatureCollection" or len(geo.get("features") or []) < 250:
            raise ValueError("County geojson was short")
        sources.append({
            "id": "census-texas-counties",
            "title": "Census TIGERweb generalized county polygons, Texas",
            "url": url,
            "retrievedAt": record["retrievedAt"],
            "sha256": record["sha256"],
            "bytes": record["bytes"],
        })
        return geo
    except Exception as exc:
        fallback = ROOT / "data" / "deployment" / "texas-counties.geojson"
        geo = json.loads(fallback.read_text(encoding="utf-8"))
        sources.append({
            "id": "census-texas-counties",
            "title": "Census TIGERweb generalized county polygons, Texas",
            "url": url,
            "retrievedAt": "2026-10-19T14:41:04.044314+00:00",
            "detail": f"Live fetch failed ({exc}). Copied data/deployment/texas-counties.geojson, retrieved 2026-10-19.",
            "sha256": sha256_bytes(fallback.read_bytes()),
        })
        return geo


def locate(lon, lat, boxes):
    for min_lon, min_lat, max_lon, max_lat, feature in boxes:
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        if point_in_geometry(lon, lat, feature["geometry"]):
            return feature
    return None


def assign_counties(substations, node_prices, hifld_unique, geo):
    boxes = county_boxes(geo["features"])
    attempted = 0
    placed = 0
    by_county = defaultdict(list)
    for station in substations:
        key = norm_name(station.get("name") or "")
        if not key or key not in hifld_unique or not station.get("zone"):
            continue
        attempted += 1
        lat, lon = hifld_unique[key]
        hit = locate(lon, lat, boxes)
        if hit is None:
            continue
        placed += 1
        geoid = str(hit["properties"]["GEOID"])
        by_county[geoid].append({"name": station["name"], "zone": station["zone"], "key": key})
    nodes_by_station = defaultdict(list)
    for node in node_prices:
        if node.get("kind") != "resource-node":
            continue
        key = norm_name(node.get("substation") or "")
        if key and node.get("diurnalDam") is not None:
            nodes_by_station[key].append(node)
    counties = []
    for feature in geo["features"]:
        geoid = str(feature["properties"]["GEOID"])
        name = feature["properties"]["NAME"]
        matched = by_county.get(geoid) or []
        zones = [item["zone"] for item in matched if item.get("zone")]
        counts = Counter(zones)
        zone = None
        share = None
        if counts:
            top, votes = counts.most_common(1)[0]
            second = counts.most_common(2)[1][1] if len(counts) > 1 else 0
            share_value = votes / len(zones)
            # One or two name collisions are enough to put a Houston substation
            # in the wrong zone. Require three matches and a 75 percent majority.
            if votes > second and len(zones) >= 3 and share_value >= 0.75:
                zone = top
                share = round(share_value, 4)
        station_keys = {item["key"] for item in matched if item.get("zone") == zone}
        priced = []
        for key in station_keys:
            priced.extend(nodes_by_station.get(key) or [])
        spreads = sorted(node["diurnalDam"] for node in priced)
        median = None
        if spreads:
            mid = len(spreads) // 2
            median = spreads[mid] if len(spreads) % 2 else round((spreads[mid - 1] + spreads[mid]) / 2, 4)
        top_nodes = sorted(priced, key=lambda item: item["diurnalDam"], reverse=True)[:5]
        counties.append({
            "geoid": geoid,
            "name": name,
            "zone": zone,
            "zoneShare": share,
            "matchedSubstations": len(matched),
            "pricedNodes": len(priced),
            "nodeDiurnalDamMedian": median,
            "assignment": "substation-majority" if zone else "unassigned",
            "topNodes": [{"name": item["name"], "diurnalDam": item["diurnalDam"], "substation": item.get("substation")} for item in top_nodes],
        })
    counties.sort(key=lambda item: item["geoid"])
    return counties, {"attempted": attempted, "placed": placed, "countiesWithZone": sum(1 for item in counties if item["zone"])}


def acs_candidate_urls():
    years = (2024, 2023)
    urls = []
    for year in years:
        base = f"https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData/"
        urls.append(base + f"acsdt5y{year}-b25032.dat")
        urls.append(base + f"acsdt5y{year}-b25032.dat.gz")
    return urls


def download_first(urls, dest: Path):
    last = None
    for url in urls:
        try:
            return fetch_cached(url, dest, timeout=300), url
        except Exception as exc:
            last = exc
            print(f"ACS miss {url}: {exc}", flush=True)
    raise RuntimeError(f"No ACS B25032 file: {last}")


def parse_acs(path: Path):
    raw = path.read_bytes()
    if path.suffix == ".gz" or raw[:2] == b"\x1f\x8b":
        import gzip
        text = gzip.decompress(raw).decode("utf-8-sig", errors="replace")
    else:
        text = raw.decode("utf-8-sig", errors="replace")
    sample = text.splitlines()[0]
    delimiter = "|" if sample.count("|") >= sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError("ACS file has no header")
    fields = {name.strip(): name for name in reader.fieldnames}

    def find_col(*options):
        for name in options:
            if name in fields:
                return fields[name]
        return None

    # 2024 table-based files use B25032_E003. Older shells use B25032_003E.
    # The Census table shell says line 003 is owner-occupied "1, detached" and 004 is "1, attached".
    detached = find_col("B25032_003E", "B25032_E003")
    attached = find_col("B25032_004E", "B25032_E004")
    geo_key = find_col("GEO_ID", "GEOID")
    name_key = find_col("NAME")
    if not detached or not attached or not geo_key:
        raise ValueError(f"ACS columns missing: {reader.fieldnames[:12]}")

    def number(value):
        if value is None:
            return None
        text_value = str(value).strip()
        if text_value in {"", ".", "null", "None", "-"}:
            return None
        try:
            parsed = int(float(text_value))
        except ValueError:
            return None
        if parsed < 0:
            return None
        return parsed

    tracts = []
    zctas = {}
    for row in reader:
        geo = (row.get(geo_key) or "").strip()
        detached_n = number(row.get(detached))
        attached_n = number(row.get(attached))
        both = None if detached_n is None or attached_n is None else detached_n + attached_n
        name = (row.get(name_key) or "").strip() if name_key else ""
        if "US48" in geo and geo.startswith("140"):
            tract = geo.split("US", 1)[1]
            if len(tract) < 11:
                continue
            tracts.append({
                "geoid": tract,
                "name": name,
                "countyGeoid": tract[:5],
                "detached": detached_n,
                "attached": attached_n,
                "singleFamily": both,
            })
        elif geo.startswith("860"):
            zcta = geo.split("US", 1)[-1]
            if re.fullmatch(r"\d{5}", zcta):
                zctas[zcta] = {
                    "zip": zcta,
                    "name": name,
                    "detached": detached_n,
                    "attached": attached_n,
                    "singleFamily": both,
                }
    tracts.sort(key=lambda item: item["geoid"])
    return tracts, zctas, delimiter


def tract_centroids(sources: list):
    urls = [
        "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_tracts_48.txt",
        "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_gaz_tracts_48.txt",
    ]
    dest = CACHE / "gaz_tracts_48.txt"
    record, url = download_first(urls, dest)
    sources.append({
        "id": "census-tract-gazetteer",
        "title": "Census Gazetteer tract internal points, Texas",
        "url": url,
        "retrievedAt": record["retrievedAt"],
        "sha256": record["sha256"],
        "bytes": record["bytes"],
    })
    points = {}
    text = dest.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    for row in reader:
        geoid = (row.get("GEOID") or "").strip()
        try:
            lat = float(row.get("INTPTLAT"))
            lon = float(row.get("INTPTLONG"))
        except (TypeError, ValueError):
            continue
        if geoid:
            points[geoid] = {"lat": round(lat, 6), "lon": round(lon, 6)}
    return points


def territory_flag(utilities, tdus):
    retail = [key for key in tdus if key in RETAIL_TDU]
    noi = []
    for utility in utilities:
        ownership = utility.get("ownership") or ""
        name = (utility.get("name") or "").lower()
        opted = any(token in name for token in OPTED_IN_NAMES)
        if ownership in NOIE_OWNERSHIP and not opted:
            noi.append(utility["name"])
    if retail and noi:
        flag = "split"
    elif retail:
        flag = "deregulated"
    elif noi or any((utility.get("ownership") or "") in NOIE_OWNERSHIP for utility in utilities):
        flag = "coop_muni"
    else:
        flag = "unknown"
    return flag, retail, noi


def build_territory(zctas, sources: list):
    payload = json.loads((ROOT / "data" / "zip-launch.json").read_text(encoding="utf-8"))
    sources.append({
        "id": "zip-territory",
        "title": "Texas ZIP to wires utility, from data/zip-launch.json",
        "url": payload["sources"]["ptc"]["url"],
        "retrievedAt": payload["retail_choice"]["retrieved"],
        "detail": "Rebuilt by scripts/build-zip-launch.py. Retail-choice wires companies come from the PUCT Power to Choose API. Municipal and cooperative names come from the NREL/OpenEI 2024 ZIP file. This siting file keeps Texas only and does not copy plan prices.",
        "upstream": {
            "generated": payload["generated"],
            "ptcRetrieved": payload["retail_choice"]["retrieved"],
            "sources": {key: {"title": value.get("title"), "url": value.get("url"), "retrieved": value.get("retrieved")} for key, value in payload["sources"].items()},
        },
    })
    rows = []
    for zip_code, row in payload["zips"].items():
        if row.get("state") != "TX":
            continue
        utilities = row.get("utilities") or []
        tdus = row.get("tdus") or []
        flag, retail, noi = territory_flag(utilities, tdus)
        acs = zctas.get(zip_code) or {}
        county = row.get("county") or {}
        rows.append({
            "zip": zip_code,
            "countyGeoid": county.get("geoid"),
            "countyName": county.get("name"),
            "flag": flag,
            "retailChoice": bool(retail),
            "tdus": tdus,
            "noiBesidesOptIn": noi,
            "utilities": [
                {"name": utility["name"], "eiaId": utility.get("eia_id"), "ownership": utility.get("ownership")}
                for utility in utilities
            ],
            "singleFamily": acs.get("singleFamily"),
            "detached": acs.get("detached"),
            "attached": acs.get("attached"),
        })
    rows.sort(key=lambda item: item["zip"])
    return rows


def pptx_image_hashes(blob: bytes) -> dict:
    hashes = {}
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        for name in archive.namelist():
            if name.startswith("ppt/media/image") and name.endswith(".png"):
                hashes[name] = sha256_bytes(archive.read(name))
    return hashes


def pptx_text(blob: bytes) -> str:
    chunks = []
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        slides = [name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
        slides.sort(key=lambda name: int(re.search(r"slide(\d+)", name).group(1)))
        for name in slides:
            root = ET.fromstring(archive.read(name))
            texts = [node.text or "" for node in root.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}t")]
            chunks.append(re.sub(r"\s+", " ", " ".join(texts)))
    return "\n".join(chunks)


def require_phrase(text: str, phrase: str, label: str):
    if phrase not in text:
        raise ValueError(f"{label} missing phrase: {phrase}")


def build_large_load(sources: list, gaps: list):
    llwg_url = "https://www.ercot.com/files/docs/2026/06/18/June-19-LLWG-Report.pptx"
    sb6_url = "https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00006F.htm"
    puct_url = "https://ftp.puc.texas.gov/public/puct-info/agency/rulesnlaws/subrules/electric/25.194/58481pub.pdf"
    eia_url = "https://www.eia.gov/electricity/state/texas/"
    llwg = fetch_cached(llwg_url, CACHE / "llwg-2026-06-19.pptx")
    sb6 = fetch_cached(sb6_url, CACHE / "sb6.html")
    puct = fetch_cached(puct_url, CACHE / "puct-58481-proposal.pdf")
    eia = fetch_cached(eia_url, CACHE / "eia-texas.html")
    sources.extend([
        {"id": "ercot-llwg-2026-06-19", "title": "ERCOT Large Load Interconnection Status Update, Large Load Integration Team", "url": llwg_url, "retrievedAt": llwg["retrievedAt"], "sha256": llwg["sha256"], "bytes": llwg["bytes"], "asOf": "2026-06-18"},
        {"id": "sb6-enrolled", "title": "Texas SB 6, 89th Regular Session, enrolled bill text", "url": sb6_url, "retrievedAt": sb6["retrievedAt"], "sha256": sb6["sha256"], "bytes": sb6["bytes"]},
        {"id": "puct-58481-proposal", "title": "PUCT Project No. 58481, proposal for publication of 16 TAC section 25.194", "url": puct_url, "retrievedAt": puct["retrievedAt"], "sha256": puct["sha256"], "bytes": puct["bytes"], "detail": "Proposal text, not the adoption order."},
        {"id": "eia-texas-profile", "title": "EIA Texas Electricity Profile, Table 1, 2024 summary", "url": eia_url, "retrievedAt": eia["retrievedAt"], "sha256": eia["sha256"], "bytes": eia["bytes"]},
    ])
    slide_text = pptx_text((CACHE / "llwg-2026-06-19.pptx").read_bytes())
    require_phrase(slide_text, "8927 MW", "LLWG")
    require_phrase(slide_text, "3900 MW", "LLWG")
    require_phrase(slide_text, "3675 MW", "LLWG")
    require_phrase(slide_text, "June 18, 2026", "LLWG")
    sb6_text = re.sub(r"<[^>]+>", " ", (CACHE / "sb6.html").read_text(encoding="utf-8", errors="replace"))
    sb6_text = re.sub(r"\s+", " ", sb6_text.replace("&#xA0;", " "))
    statute = "The commission shall establish a demand threshold of 75 megawatts unless the commission determines that a lower threshold is necessary"
    require_phrase(sb6_text, statute, "SB 6")
    proposal = "a new interconnection that is equal to or exceeds 75 megawatts (MW)"
    # The proposal PDF is compressed. The quote is kept only when the file hash matches the copy that was read.
    if puct["sha256"] != "dad6f957ec227f7551c14849137f91050a979a93a2dbb4c7cb12ac6b2f29168f":
        gaps.append("PUCT 58481 proposal PDF hash changed, so the 75 MW applicability quote was not copied.")
        proposal_quote = None
    else:
        proposal_quote = "(b) Applicability. This section applies to a large load customer that seeks: (1) a new interconnection that is equal to or exceeds 75 megawatts (MW); (2) an expanded interconnection that equals or exceeds 75 MW for the first time; and (3) an expanded interconnection that exceeds 75 MW by 75 MW or more."
    eia_html = (CACHE / "eia-texas.html").read_text(encoding="utf-8", errors="replace")
    match = re.search(r"Average retail price \(cents/kWh\)</td>\s*<td>([0-9.]+)</td>", eia_html)
    if not match:
        gaps.append("EIA Texas profile page did not contain the average retail price cell.")
        retail_cents = None
    else:
        retail_cents = float(match.group(1))
    hashes = pptx_image_hashes((CACHE / "llwg-2026-06-19.pptx").read_bytes())
    charts = []
    for image, spec in CHARTS.items():
        if hashes.get(image) != spec["sha256"]:
            gaps.append(f"{image} hash changed. Chart '{spec['title']}' was not transcribed.")
            continue
        charts.append({"image": image, "sha256": spec["sha256"], "slide": spec["slide"], "title": spec["title"], "note": spec.get("note"), "rows": spec["rows"]})
    growth = None
    if hashes.get(GROWTH["image"]) == GROWTH_SHA:
        growth = {
            "image": GROWTH["image"],
            "sha256": GROWTH_SHA,
            "slide": GROWTH["slide"],
            "title": GROWTH["title"],
            "unit": "GW",
            "note": GROWTH["note"],
            "years": GROWTH["years"],
            "rows": [
                {"status": status, "gw": values}
                for status, values in zip(GROWTH["statuses"], GROWTH["values"])
            ],
            "totalGw": GROWTH["totals"],
        }
    else:
        gaps.append("Large-load growth chart hash changed. The GW table was not transcribed.")
    batch = None
    if hashes.get("ppt/media/image24.png") == BATCH_SHA:
        batch = {
            "image": "ppt/media/image24.png",
            "sha256": BATCH_SHA,
            "slide": 17,
            "title": "Batch Zero Tracking by Weather Zone (GW)",
            "generated": "2026-06-02",
            "unit": "GW",
            "note": "ERCOT weather zones, not counties and not load zones. Printed table on the chart.",
            "zones": BATCH_ZONES,
            "rows": [{"bucket": label, "gw": values, "totalGw": total} for label, values, total in BATCH_ROWS],
            "totalGw": BATCH_TOTALS,
        }
    else:
        gaps.append("Batch Zero weather-zone chart hash changed. The GW table was not transcribed.")
    return {
        "asOf": "2026-06-18",
        "whatItIs": "ERCOT large-load interconnection status. The deck does not say these loads are data centers. County and customer names are not in the slides that this build could read.",
        "textFigures": [
            {"id": "approved-to-energize", "value": 8927, "unit": "MW", "label": "Approval to Energize", "quote": "Of the 8927 MW that have received Approval to Energize", "slide": 8},
            {"id": "non-simultaneous-peak", "value": 3900, "unit": "MW", "label": "Non-simultaneous monthly peak, June 2026", "quote": "a non-simultaneous monthly peak consumption of 3900 MW in June 2026", "slide": 8},
            {"id": "simultaneous-peak", "value": 3675, "unit": "MW", "label": "Simultaneous monthly peak, June 2026", "quote": "a simultaneous monthly peak consumption of 3675 MW in June 2026", "slide": 9},
        ],
        "charts": charts,
        "growth": growth,
        "batchZeroWeatherZones": batch,
        "rules": [
            {"id": "sb6", "citation": "SB 6, 89th Legislature, enrolled", "url": sb6_url, "quote": statute + " to accomplish the purposes described by Subsection (b)."},
            {"id": "puct-58481-proposal", "citation": "PUCT Project No. 58481, proposal for publication of section 25.194", "url": puct_url, "quote": proposal_quote, "label": "PROPOSAL"},
        ],
        "retailContext": {
            "id": "eia-texas-average-retail",
            "centsPerKwh": retail_cents,
            "year": 2024,
            "url": eia_url,
            "label": "Texas average retail price, all sectors. Not a data-center tariff and not the ERCOT nodal price.",
        },
    }


def areas_from(tracts, zips, counties, hub_points):
    by_county = {item["geoid"]: item for item in counties}
    zone_price = hub_points

    def attach(county_geoid):
        county = by_county.get(county_geoid or "")
        if not county or not county.get("zone"):
            return {"zone": None, "zoneAssignment": "unassigned", "spreadNodeDam": None, "spreadZoneDam": None, "spreadZoneRt": None}
        zone = zone_price.get(county["zone"]) or {}
        return {
            "zone": county["zone"],
            "zoneAssignment": county["assignment"],
            "zoneShare": county.get("zoneShare"),
            "spreadNodeDam": county.get("nodeDiurnalDamMedian"),
            "spreadZoneDam": zone.get("diurnalDam"),
            "spreadZoneRt": zone.get("diurnalRt"),
            "meanZoneRt": zone.get("meanRt"),
        }

    tract_rows = []
    for tract in tracts:
        linked = attach(tract["countyGeoid"])
        county = by_county.get(tract["countyGeoid"]) or {}
        tract_rows.append({
            "id": tract["geoid"],
            "kind": "tract",
            "name": tract["name"],
            "countyGeoid": tract["countyGeoid"],
            "countyName": county.get("name"),
            "singleFamily": tract["singleFamily"],
            "detached": tract["detached"],
            "attached": tract["attached"],
            "lat": tract.get("lat"),
            "lon": tract.get("lon"),
            "flag": None,
            **linked,
        })
    zip_rows = []
    for row in zips:
        linked = attach(row.get("countyGeoid"))
        zip_rows.append({
            "id": row["zip"],
            "kind": "zip",
            "name": row["zip"],
            "countyGeoid": row.get("countyGeoid"),
            "countyName": row.get("countyName"),
            "singleFamily": row.get("singleFamily"),
            "flag": row["flag"],
            "tdus": row["tdus"],
            "utilities": [utility["name"] for utility in row["utilities"]],
            **linked,
        })
    return tract_rows, zip_rows


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    sources = []
    gaps = [
        "Real-time prices at resource nodes (NP6-905-CD, report 12301) were not downloaded. The public daily files are much larger than the day-ahead extract. Hub and load-zone real-time prices are the annual series.",
        "ERCOT's June 19, 2026 large-load deck does not list projects by county or by customer. Load zones other than LZ_WEST and LZ_NORTH are one bar labeled Other. The TSP chart was not transcribed because the segment values are not in a table.",
        "The large-load figures are not a data-center census. ERCOT does not label the queue as data centers on the slides this build read.",
        "County appraisal district bulk files were not downloaded. Harris and Travis publish owner names and street addresses on the roll. This snapshot uses Census counts only.",
        "PUCT Project 58481 adoption order text was not extracted. The 75 MW applicability sentence in this file is from the proposal for publication, labeled PROPOSAL, plus the enrolled SB 6 statute.",
        "No public capex or opex range for a Texas data center was retrieved from EIA or LBNL in this run. Those inputs stay empty until someone types an EXAMPLE.",
        "Base service territory and Base retail pricing are not in any source used here. No county is marked as a Base county.",
        "A home meter settles at its load zone, not at a resource node. A county gets a zone only when at least three ERCOT substation names match exactly one HIFLD point inside the county and at least 75 percent of those matches share a zone. A name that is on the NOIE map uses the NOIE zone. Counties that fail the test stay unassigned. The node spread is the median day-ahead clock spread of priced resource nodes at the matched substations.",
    ]
    print("Hub and load-zone annual spreads", flush=True)
    annual = hub_lz_prices(sources)
    print("Settlement point list", flush=True)
    sp_docs = [doc for doc in ercot_docs(10008) if str(doc.get("Extension", "")).lower() == "zip"]
    sp_docs.sort(key=lambda doc: str(doc.get("PublishDate") or ""))
    if not sp_docs:
        raise SystemExit("No settlement point list on report 10008")
    latest = sp_docs[-1]
    sp_url = f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={latest['DocID']}"
    sp_record = fetch_cached(sp_url, CACHE / "settlement-points.zip")
    sp_record["friendlyName"] = latest.get("FriendlyName")
    sp_record["publishDate"] = latest.get("PublishDate")
    sp_blob = (CACHE / "settlement-points.zip").read_bytes()
    points = parse_settlement_points(sp_blob)
    substations = parse_zone_substations(sp_blob)
    sources.append({
        "id": "ercot-settlement-points",
        "title": "ERCOT settlement points list, NP4-160-SG, report type 10008",
        "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-160-SG",
        "download": sp_url,
        "retrievedAt": sp_record["retrievedAt"],
        "sha256": sp_record["sha256"],
        "bytes": sp_record["bytes"],
        "friendlyName": latest.get("FriendlyName"),
        "publishDate": latest.get("PublishDate"),
        "points": len(points),
        "substations": len(substations),
    })
    print(f"Settlement points {len(points)} substations {len(substations)}", flush=True)
    print("Day-ahead nodal files", flush=True)
    _dam_records, node_prices, dam_dates = download_dam(sources)
    by_point = {item["name"]: item for item in points}
    for node in node_prices:
        meta = by_point.get(node["name"]) or {}
        node["zone"] = meta.get("zone")
        node["substation"] = meta.get("substation")
        node["kv"] = meta.get("kv")
        if node["kind"] == "resource-node" and meta.get("kind"):
            node["kind"] = meta["kind"]
    print(f"Priced points {len(node_prices)} over {dam_dates[0] if dam_dates else '?'} to {dam_dates[-1] if dam_dates else '?'}", flush=True)
    print("Substations and counties", flush=True)
    hifld_unique, ambiguous = load_hifld(sources)
    geo = load_counties(sources)
    counties, match_stats = assign_counties(substations, node_prices, hifld_unique, geo)
    match_stats["hifldUniqueNames"] = len(hifld_unique)
    match_stats["hifldAmbiguousNames"] = ambiguous
    print("County match", match_stats, flush=True)
    print("Census homes", flush=True)
    acs_record, acs_url = download_first(acs_candidate_urls(), CACHE / "b25032.dat")
    tracts, zctas, _delimiter = parse_acs(CACHE / "b25032.dat")
    if not tracts:
        # gzip URL may have been saved with the .dat name
        gz = CACHE / "b25032.dat"
        tracts, zctas, _delimiter = parse_acs(gz)
    centroids = tract_centroids(sources)
    for tract in tracts:
        point = centroids.get(tract["geoid"]) or {}
        tract["lat"] = point.get("lat")
        tract["lon"] = point.get("lon")
    sources.append({
        "id": "census-acs-b25032",
        "title": "Census ACS 5-year table B25032, owner-occupied units by structure",
        "url": acs_url,
        "retrievedAt": acs_record["retrievedAt"],
        "sha256": acs_record["sha256"],
        "bytes": acs_record["bytes"],
        "detail": "singleFamily is B25032_003E (owner-occupied 1-unit detached) plus B25032_004E (owner-occupied 1-unit attached). A suppressed or negative cell is left null, not zero. No address and no owner name.",
        "tracts": len(tracts),
        "zctas": len(zctas),
    })
    print(f"Tracts {len(tracts)} ZCTAs {len(zctas)}", flush=True)
    zips = build_territory(zctas, sources)
    print("Large load", flush=True)
    large = build_large_load(sources, gaps)
    tract_areas, zip_areas = areas_from(tracts, zips, counties, annual["points"])
    manifest = {
        "generated": now_iso(),
        "clock": {
            "chargeHoursEnding": list(CHARGE_HOURS),
            "dischargeHoursEnding": list(DISCHARGE_HOURS),
            "definition": "Daily spread is the mean settlement price in hours ending 20 and 21 minus the mean in hours ending 11 through 14, Central time, delivery date. The stored spread is the mean of those daily spreads. Negative days stay in. This is the clock in data/zone-value.json (charge late morning, discharge the early evening). It is not an optimized dispatch.",
        },
        "formula": "profit = (spreadUsdPerMwh / 1000) * cyclesPerYear * usableKwh * roundTripEfficiency - degradationUsdPerYear",
        "sources": sources,
        "gaps": gaps,
        "match": match_stats,
        "nodeWindow": {"start": dam_dates[0] if dam_dates else None, "end": dam_dates[-1] if dam_dates else None, "dates": len(dam_dates)},
        "annualPeriod": annual["period"],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUT / "counties.geojson").write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")
    (OUT / "settlement-points.json").write_text(json.dumps({
        "points": points,
        "substations": substations,
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "nodes.json").write_text(json.dumps({
        "window": manifest["nodeWindow"],
        "clock": manifest["clock"],
        "points": node_prices,
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "prices.json").write_text(json.dumps({
        "period": annual["period"],
        "clock": manifest["clock"],
        "points": list(annual["points"].values()),
        "daily": annual["daily"],
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "territory.json").write_text(json.dumps({
        "rule": "deregulated: a Power to Choose wires company and no other municipal, cooperative, or political-subdivision utility. Lubbock Power & Light and Nueces are treated as opted into retail choice when the utility name contains those words, citing PUCT Project 55999 for Lubbock. coop_muni: a municipal, cooperative, or political-subdivision utility and no retail-choice wires company. split: both. unknown: neither. A ZCTA is not a parcel.",
        "zips": zips,
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "homes.json").write_text(json.dumps({
        "table": "B25032",
        "definition": "Owner-occupied one-unit detached (B25032_003E) plus owner-occupied one-unit attached (B25032_004E). Counts only.",
        "tracts": tracts,
    }, separators=(",", ":")), encoding="utf-8")
    (OUT / "counties.json").write_text(json.dumps({"match": match_stats, "counties": counties}, separators=(",", ":")), encoding="utf-8")
    (OUT / "large-load.json").write_text(json.dumps(large, indent=2), encoding="utf-8")
    (OUT / "areas.json").write_text(json.dumps({
        "spreadKeys": {
            "spreadNodeDam": "Median resource-node day-ahead clock spread in the short public window. Proxy. Homes do not settle at the resource node.",
            "spreadZoneRt": "Twelve-month real-time load-zone clock spread. This is the settlement price a load in that zone is paid.",
            "spreadZoneDam": "Twelve-month day-ahead load-zone clock spread.",
        },
        "tracts": tract_areas,
        "zips": zip_areas,
    }, separators=(",", ":")), encoding="utf-8")
    print("Wrote", OUT, flush=True)
    priced = [row for row in tract_areas if row.get("spreadZoneRt") is not None]
    priced.sort(key=lambda row: (-(row["spreadZoneRt"] or 0), -(row["singleFamily"] or 0)))
    print("Top tracts by zone RT spread:")
    for row in priced[:10]:
        print(f"  {row['id']} {row['countyName']} {row['zone']} spread {row['spreadZoneRt']} homes {row['singleFamily']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
