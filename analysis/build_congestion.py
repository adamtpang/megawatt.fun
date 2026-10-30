"""Build data/congestion.json from public ERCOT day-ahead files.

One command, from the repository root:

    python3 analysis/build_congestion.py

Cached downloads live in analysis/cache/ (gitignored). The script reads every
day-ahead settlement-point zip and shadow-price zip it already has, and asks
the public MIS list for any newer files. A failed network call keeps the cache.

The ranked nodes are resource nodes in LZ_HOUSTON, LZ_NORTH, and LZ_SOUTH.
Basis is the node price minus that node's settlement load zone, same hour.
"""

import csv
import io
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "analysis" / "cache"
ERCOT = CACHE / "ercot"
OUT = ROOT / "data" / "congestion.json"
HTML = ROOT / "notes" / "where-batteries-earn-most.html"
UA = "megawatt.fun congestion note (public ERCOT data)"

RANKED_ZONES = ("LZ_HOUSTON", "LZ_NORTH", "LZ_SOUTH")
HUB_OF = {
    "LZ_HOUSTON": "HB_HOUSTON",
    "LZ_NORTH": "HB_NORTH",
    "LZ_SOUTH": "HB_SOUTH",
    "LZ_WEST": "HB_WEST",
}
SCARCITY = 100.0
TAIL = 20.0
MIN_HOURS = 100
HIFLD = (
    "https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/"
    "Electric_Substations/FeatureServer/0/query"
)
SHAPE_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip"
LON0, LON1 = -106.65, -93.50
LAT0, LAT1 = 25.80, 36.55
MAP_W, MAP_H = 720.0, 640.0
WORD_DROP = {"SUBSTATION", "SUB", "STATION", "SWITCH", "SWITCHING", "ST", "KV"}


def fetch(url, dest, timeout=90):
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=timeout) as resp:
        dest.write_bytes(resp.read())
    return dest


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
    dest = folder / f"{doc_id}.zip"
    if not dest.exists() or dest.stat().st_size == 0:
        url = f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc_id}"
        fetch(url, dest)
    return dest


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


def hour_ending(text):
    hour = int(str(text).strip().split(":")[0])
    if hour == 0:
        return 24
    if hour < 1 or hour > 24:
        raise ValueError(text)
    return hour


def block_of(hour):
    if 1 <= hour <= 6:
        return "night"
    if 7 <= hour <= 12:
        return "morning"
    if 13 <= hour <= 18:
        return "afternoon"
    if 19 <= hour <= 24:
        return "evening"
    return None


def parse_day(text):
    text = (text or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def num(text):
    text = (text or "").strip().replace(",", "")
    if text in {"", "."}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def majority(items):
    counts = Counter(item for item in items if item)
    if not counts:
        return None
    top = counts.most_common()
    if len(top) > 1 and top[0][1] == top[1][1]:
        return None
    return top[0][0]


def norm_ercot(text):
    return "".join(ch for ch in (text or "").upper() if ch.isalnum())


def norm_hifld(text):
    cleaned = re.sub(r"[^A-Z0-9 ]", " ", (text or "").upper())
    words = [word for word in cleaned.split() if word not in WORD_DROP]
    return "".join(words)


def csv_rows(path, prefer=None):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if prefer:
            member = next(name for name in names if prefer.lower() in name.lower())
        else:
            member = names[0]
        text = archive.read(member).decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    header = [column.strip() for column in next(reader)]
    keys = {"".join(ch for ch in column.lower() if ch.isalnum()): index for index, column in enumerate(header)}
    for row in reader:
        yield keys, row


def cell(keys, row, *names):
    for name in names:
        index = keys.get(name)
        if index is not None and index < len(row):
            return row[index].strip()
    return ""


def classify(folder):
    prices, shadows, mappings = [], [], []
    if not folder.exists():
        return prices, shadows, mappings
    for path in folder.glob("*.zip"):
        try:
            with zipfile.ZipFile(path) as archive:
                names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
                if not names:
                    continue
                if any("Settlement_Points" in name for name in names):
                    mappings.append(path)
                    continue
                head = archive.read(names[0]).splitlines()[0].decode("utf-8-sig", errors="replace")
        except (zipfile.BadZipFile, OSError, IndexError):
            continue
        if head.startswith("DeliveryDate,HourEnding,SettlementPoint,"):
            prices.append(path)
        elif "ShadowPrice" in head and head.startswith("DeliveryDate,HourEnding,ConstraintID,"):
            shadows.append(path)
    prices.sort(key=lambda path: int(path.stem) if path.stem.isdigit() else 0)
    shadows.sort(key=lambda path: int(path.stem) if path.stem.isdigit() else 0)
    mappings.sort(key=lambda path: int(path.stem) if path.stem.isdigit() else 0)
    return prices, shadows, mappings


def refresh_ercot():
    """Download price, shadow, and settlement-point zips missing from the cache."""
    notes = []
    ERCOT.mkdir(parents=True, exist_ok=True)
    try:
        price_docs = [doc for doc in ercot_docs(12331) if str(doc.get("FriendlyName", "")).lower().endswith("_csv")]
        for doc in price_docs:
            download_doc(doc, ERCOT)
        notes.append(f"NP4-190-CD list returned {len(price_docs)} price files.")
    except Exception as exc:
        notes.append(f"Price-list refresh failed ({exc}). Cached price files are unchanged.")
    try:
        shadow_docs = [doc for doc in ercot_docs(12332) if str(doc.get("FriendlyName", "")).lower().endswith("_csv")]
        for doc in shadow_docs:
            download_doc(doc, ERCOT)
        notes.append(f"NP4-191-CD list returned {len(shadow_docs)} shadow-price files.")
    except Exception as exc:
        notes.append(f"Shadow-price refresh failed ({exc}). Cached shadow files are unchanged.")
    try:
        mapping_docs = [doc for doc in ercot_docs(10008) if str(doc.get("Extension", "")).lower() == "zip"]
        if mapping_docs:
            mapping_docs.sort(key=lambda doc: str(doc.get("PublishDate") or ""))
            download_doc(mapping_docs[-1], ERCOT)
            notes.append(f"Settlement-point list used {mapping_docs[-1].get('FriendlyName')}.")
    except Exception as exc:
        notes.append(f"Settlement-point refresh failed ({exc}). Cached mapping is unchanged.")
    return notes


def report_span(report_type):
    docs = ercot_docs(report_type)
    if not docs:
        return {"report_type": report_type, "documents": 0}
    published = sorted(str(doc.get("PublishDate") or "") for doc in docs)
    return {
        "report_type": report_type,
        "documents": len(docs),
        "publish_start": published[0],
        "publish_end": published[-1],
        "sample_name": docs[0].get("FriendlyName"),
    }


def load_mapping(path):
    zones = defaultdict(list)
    stations = defaultdict(list)
    voltages = defaultdict(list)
    for keys, row in csv_rows(path, "Settlement_Points"):
        node = cell(keys, row, "resourcenode")
        zone = cell(keys, row, "settlementloadzone")
        station = cell(keys, row, "substation")
        voltage = cell(keys, row, "voltagelevel")
        if not node or not zone:
            continue
        if not zone.startswith("LZ_"):
            zone = f"LZ_{zone}"
        zones[node].append(zone)
        if station:
            stations[node].append(station)
        if voltage:
            voltages[node].append(voltage)
    mapped = {}
    skipped = 0
    for node, zone_list in zones.items():
        zone = majority(zone_list)
        if zone is None:
            skipped += 1
            continue
        mapped[node] = {
            "zone": zone,
            "substation": majority(stations[node]) or "",
            "kv": majority(voltages[node]) or "",
        }
    return mapped, skipped


def load_prices(paths, wanted):
    prices = defaultdict(dict)
    dates = set()
    for path in paths:
        for keys, row in csv_rows(path):
            point = cell(keys, row, "settlementpoint", "settlementpointname")
            if point not in wanted:
                continue
            value = num(cell(keys, row, "settlementpointprice"))
            if value is None:
                continue
            day = parse_day(cell(keys, row, "deliverydate"))
            hour = hour_ending(cell(keys, row, "hourending"))
            dst = cell(keys, row, "dstflag") or "N"
            prices[point][(day, hour, dst)] = value
            dates.add(day)
    return prices, dates


def summarize(bases, node_prices):
    if not bases:
        return None
    return {
        "hours": len(bases),
        "mean": round(sum(bases) / len(bases), 2),
        "p95": round(quantile(bases, 0.95), 2),
        "share20": round(sum(1 for value in bases if value >= TAIL) / len(bases), 4),
        "scarcity": sum(1 for value in node_prices if value >= SCARCITY),
    }


def load_constraints(paths, dates, station_nodes):
    totals = {}
    by_station = defaultdict(lambda: {"rows": 0, "sum": 0.0, "names": Counter()})
    for path in paths:
        for keys, row in csv_rows(path):
            delivery = parse_day(cell(keys, row, "deliverydate"))
            if dates and delivery not in dates:
                continue
            price = num(cell(keys, row, "shadowprice"))
            if price is None or price <= 0:
                continue
            name = cell(keys, row, "constraintname") or "unnamed"
            slot = totals.setdefault(name, {
                "hours": 0,
                "shadow_sum": 0.0,
                "shadow_max": 0.0,
                "from": "",
                "to": "",
                "from_kv": "",
                "to_kv": "",
            })
            slot["hours"] += 1
            slot["shadow_sum"] += price
            slot["shadow_max"] = max(slot["shadow_max"], price)
            origin = cell(keys, row, "fromstation")
            dest = cell(keys, row, "tostation")
            slot["from"] = slot["from"] or origin
            slot["to"] = slot["to"] or dest
            slot["from_kv"] = slot["from_kv"] or cell(keys, row, "fromstationkv")
            slot["to_kv"] = slot["to_kv"] or cell(keys, row, "tostationkv")
            seen = set()
            for station in (norm_ercot(origin), norm_ercot(dest)):
                if not station or station in seen:
                    continue
                seen.add(station)
                station_slot = by_station[station]
                station_slot["rows"] += 1
                station_slot["sum"] += price
                station_slot["names"][name] += 1
    rows = []
    for name, item in totals.items():
        matched = []
        for station in (item["from"], item["to"]):
            matched.extend(station_nodes.get(norm_ercot(station), []))
        rows.append({
            "name": name,
            "hours": item["hours"],
            "shadow_sum": round(item["shadow_sum"], 1),
            "shadow_max": round(item["shadow_max"], 2),
            "from": item["from"],
            "to": item["to"],
            "from_kv": item["from_kv"],
            "to_kv": item["to_kv"],
            "matched_nodes": sorted(set(matched))[:8],
        })
    rows.sort(key=lambda item: -item["shadow_sum"])
    return rows, by_station


def load_hifld(refresh):
    dest = CACHE / "hifld-tx-substations.json"
    if dest.exists() and dest.stat().st_size > 0:
        return json.loads(dest.read_text()), "cache"
    if not refresh:
        return [], "not downloaded"
    rows = []
    offset = 0
    while True:
        query = (
            f"{HIFLD}?where=STATE%3D%27TX%27&outFields=NAME,LATITUDE,LONGITUDE,STATUS"
            f"&returnGeometry=false&f=json&resultRecordCount=2000&resultOffset={offset}"
        )
        req = Request(query, headers={"User-Agent": UA})
        with urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
        features = payload.get("features") or []
        for feature in features:
            rows.append(feature.get("attributes") or {})
        if not features or not payload.get("exceededTransferLimit"):
            break
        offset += len(features)
    dest.write_text(json.dumps(rows))
    return rows, "live"


def coordinate_index(rows):
    buckets = defaultdict(list)
    for row in rows:
        lat = row.get("LATITUDE")
        lon = row.get("LONGITUDE")
        if lat is None or lon is None:
            continue
        if not (25 <= float(lat) <= 37 and -107 <= float(lon) <= -93):
            continue
        key = norm_hifld(row.get("NAME") or "")
        if key:
            buckets[key].append((float(lat), float(lon), row.get("NAME") or ""))
    unique = {}
    ambiguous = 0
    for key, points in buckets.items():
        if len(points) == 1:
            unique[key] = points[0]
        else:
            ambiguous += 1
    return unique, ambiguous


def project(lon, lat):
    x = (lon - LON0) / (LON1 - LON0) * MAP_W
    y = (LAT1 - lat) / (LAT1 - LAT0) * MAP_H
    return round(x, 1), round(y, 1)


def texas_outline():
    try:
        import shapefile
    except ImportError:
        return None, "pyshp is not installed, so the state outline was left out."
    shp = CACHE / "states" / "cb_2024_us_state_20m.shp"
    if not shp.exists():
        try:
            zpath = CACHE / "cb_2024_us_state_20m.zip"
            fetch(SHAPE_URL, zpath)
            with zipfile.ZipFile(zpath) as archive:
                archive.extractall(CACHE / "states")
        except Exception as exc:
            return None, f"The Census state outline was not available ({exc})."
    reader = shapefile.Reader(str(shp))
    fields = [field[0] for field in reader.fields[1:]]
    index = fields.index("STUSPS")
    for record in reader.iterShapeRecords():
        if record.record[index] != "TX":
            continue
        shape = record.shape
        stops = list(shape.parts) + [len(shape.points)]
        chunks = []
        for start, end in zip(stops, stops[1:]):
            ring = shape.points[start:end]
            if len(ring) < 3:
                continue
            x, y = project(*ring[0])
            commands = [f"M{x} {y}"]
            for lon, lat in ring[1:]:
                x, y = project(lon, lat)
                commands.append(f"L{x} {y}")
            commands.append("Z")
            chunks.append(" ".join(commands))
        return " ".join(chunks), "Census cartographic boundary, 2024 1:20,000,000, Texas only."
    return None, "The state shapefile had no Texas polygon."


def money(value):
    return f"${value:,.2f}"


def inject_findings(paragraphs):
    if not HTML.exists():
        return
    text = HTML.read_text()
    start, end = "<!-- findings:start -->", "<!-- findings:end -->"
    if start not in text or end not in text:
        return
    body = "\n".join(
        "<p>" + paragraph.replace("&", "&amp;").replace("<", "&lt;") + "</p>"
        for paragraph in paragraphs
    )
    HTML.write_text(text.split(start)[0] + start + "\n" + body + "\n" + end + text.split(end)[1])


def findings(payload):
    window = payload["window"]
    nodes = payload["nodes"]
    top = nodes[0]
    lines = [
        (
            f"From {window['start']} through {window['end']} ({window['days']} delivery dates, "
            f"{top['hours']} hours), the largest 95th-percentile basis in Houston, North, and South was "
            f"{top['name']} in {top['zone']}"
            + (f", substation {top['substation']}" if top.get("substation") else "")
            + f": {money(top['p95'])}/MWh. Mean {money(top['mean'])}/MWh. "
            f"{top['share20'] * 100:.1f}% of hours cleared at least {money(TAIL)}/MWh above the zone. "
            f"The node price reached {money(SCARCITY)}/MWh in {top['scarcity']} hours."
        )
    ]
    by_zone = []
    for zone in RANKED_ZONES:
        zone_nodes = [node for node in nodes if node["zone"] == zone]
        if not zone_nodes:
            continue
        lead = zone_nodes[0]
        by_zone.append(
            f"{zone} led with {lead['name']} at a 95th percentile of {money(lead['p95'])}/MWh "
            f"(mean {money(lead['mean'])}/MWh, {lead['hours']} hours)."
        )
    context = payload.get("context_zones") or []
    medians = []
    for zone in RANKED_ZONES:
        row = next((item for item in context if item["name"] == zone), None)
        if row:
            medians.append(f"{zone} median {money(row['median_p95'])} ({row['nodes']} nodes)")
    above = sum(1 for node in nodes if node["p95"] >= TAIL)
    west = next((zone for zone in context if zone["name"] == "LZ_WEST"), None)
    blocks = top.get("blocks") or {}
    lead_block = max(blocks.items(), key=lambda item: item[1]["p95"]) if blocks else None
    second = []
    if by_zone:
        second.append("By zone: " + " ".join(by_zone))
    if medians:
        second.append(
            "Most nodes sit close to the zone. "
            + "; ".join(medians)
            + f". {above} of {len(nodes)} reached {money(TAIL)}/MWh at the 95th percentile."
        )
    if west and west.get("top"):
        second.append(
            f"Same files, outside the rank: {west['top']['name']} in LZ_WEST at {money(west['top']['p95'])}/MWh."
        )
    if lead_block:
        second.append(
            f"At {top['name']} the highest block was {lead_block[0]}, {money(lead_block[1]['p95'])}/MWh over {lead_block[1]['hours']} hours."
        )
    if second:
        lines.append(" ".join(second))
    shadow_bits = []
    if top.get("shadow_rows", 0) == 0 and top.get("substation"):
        shadow_bits.append(
            f"{top['substation']} has no positive shadow-price row in this window, so the {top['name']} basis is a price gap without a same-name constraint."
        )
    pavlov = [node for node in nodes if node.get("substation") == "PAVLOV"]
    if pavlov:
        sample = pavlov[0]
        names = ", ".join(sample.get("shadow_names") or [])
        shadow_bits.append(
            f"PAVLOV ({' and '.join(node['name'] for node in pavlov[:2])}) is named on {sample['shadow_rows']} positive rows, sum {money(sample['shadow_sum'])}"
            + (f", including {names}." if names else ".")
        )
    watched = payload.get("watched_constraint")
    if watched:
        shadow_bits.append(
            f"Constraint {watched['name']} has {watched['hours']} positive rows, sum {money(watched['shadow_sum'])}."
        )
    else:
        shadow_bits.append("Constraint 5127 does not appear in this day-ahead shadow-price extract.")
    lead_constraint = (payload.get("constraints") or [None])[0]
    if lead_constraint and (not watched or lead_constraint["name"] != watched["name"]):
        shadow_bits.append(
            f"The largest shadow-price sum was {lead_constraint['name']}, {lead_constraint['from']} to {lead_constraint['to']}: "
            f"{lead_constraint['hours']} rows, sum {money(lead_constraint['shadow_sum'])}."
        )
    hifld = payload["coverage"]["hifld"]
    if hifld.get("map_drawn"):
        shadow_bits.append(
            f"The map places {hifld['top15_matched']} of the top 15. Unique HIFLD matches: {hifld['matched']} of {hifld['attempted']}."
        )
    else:
        shadow_bits.append(
            f"No map. Unique HIFLD names matched {hifld.get('matched', 0)} of {hifld.get('attempted', 0)} substations"
            + (f" and {hifld.get('top15_matched', 0)} of the top 15." if hifld.get("attempted") else ".")
            + " Unmatched nodes were left unplaced."
        )
    if shadow_bits:
        lines.append(" ".join(shadow_bits))
    return lines


def build(refresh=True):
    notes = refresh_ercot() if refresh else ["Live MIS refresh skipped. Cached files only."]
    prices_paths, shadow_paths, mapping_paths = classify(ERCOT)
    if not prices_paths or not mapping_paths:
        raise SystemExit("No cached day-ahead price zip or settlement-point zip. Run with network access once.")
    mapped, ambiguous_nodes = load_mapping(mapping_paths[-1])
    wanted = set(mapped) | set(HUB_OF.values()) | {item["zone"] for item in mapped.values()}
    prices, dates = load_prices(prices_paths, wanted)
    if not dates:
        raise SystemExit("Price files contained no dated rows for mapped nodes.")
    station_nodes = defaultdict(list)
    nodes = []
    for name, meta in mapped.items():
        series = prices.get(name) or {}
        zone_series = prices.get(meta["zone"]) or {}
        hub_name = HUB_OF.get(meta["zone"])
        hub_series = prices.get(hub_name) or {} if hub_name else {}
        grouped = defaultdict(lambda: {"basis": [], "price": []})
        hub_bases = []
        for key, price in series.items():
            zonal = zone_series.get(key)
            if zonal is None:
                continue
            block = block_of(key[1])
            grouped["all"]["basis"].append(price - zonal)
            grouped["all"]["price"].append(price)
            if block:
                grouped[block]["basis"].append(price - zonal)
                grouped[block]["price"].append(price)
            hub_price = hub_series.get(key)
            if hub_price is not None:
                hub_bases.append(price - hub_price)
        overall = summarize(grouped["all"]["basis"], grouped["all"]["price"])
        if overall is None or overall["hours"] < MIN_HOURS:
            continue
        blocks = {}
        for block in ("night", "morning", "afternoon", "evening"):
            stats = summarize(grouped[block]["basis"], grouped[block]["price"])
            if stats and stats["hours"] >= 20:
                blocks[block] = stats
        node = {
            "name": name,
            "zone": meta["zone"],
            "substation": meta["substation"],
            "kv": meta["kv"],
            "hours": overall["hours"],
            "mean": overall["mean"],
            "p95": overall["p95"],
            "share20": overall["share20"],
            "scarcity": overall["scarcity"],
            "blocks": blocks,
        }
        if hub_bases:
            node["hub"] = hub_name
            node["mean_hub"] = round(sum(hub_bases) / len(hub_bases), 2)
            node["p95_hub"] = round(quantile(hub_bases, 0.95), 2)
        if meta["zone"] in RANKED_ZONES and meta["substation"]:
            station_nodes[norm_ercot(meta["substation"])].append(name)
        if meta["zone"] in RANKED_ZONES:
            nodes.append(node)
    nodes.sort(key=lambda item: (-item["p95"], -item["mean"], item["name"]))

    context = []
    all_brief = []
    for name, meta in mapped.items():
        series = prices.get(name) or {}
        zone_series = prices.get(meta["zone"]) or {}
        bases = [price - zone_series[key] for key, price in series.items() if key in zone_series]
        if len(bases) < MIN_HOURS:
            continue
        all_brief.append({
            "name": name,
            "zone": meta["zone"],
            "hours": len(bases),
            "p95": round(quantile(bases, 0.95), 2),
            "mean": round(sum(bases) / len(bases), 2),
        })
    grouped_brief = defaultdict(list)
    for item in all_brief:
        grouped_brief[item["zone"]].append(item)
    for zone, items in sorted(grouped_brief.items()):
        ordered = sorted(item["p95"] for item in items)
        mid = ordered[len(ordered) // 2]
        lead = max(items, key=lambda item: (item["p95"], item["mean"]))
        zone_prices = list((prices.get(zone) or {}).values())
        context.append({
            "name": zone,
            "nodes": len(items),
            "median_p95": round(mid, 2),
            "top": {"name": lead["name"], "p95": lead["p95"], "mean": lead["mean"], "hours": lead["hours"]},
            "scarcity_hours": sum(1 for value in zone_prices if value >= SCARCITY),
            "ranked": zone in RANKED_ZONES,
        })

    constraints, by_station = load_constraints(shadow_paths, dates, station_nodes)
    for node in nodes:
        station = by_station.get(norm_ercot(node.get("substation")))
        if station:
            node["shadow_rows"] = station["rows"]
            node["shadow_sum"] = round(station["sum"], 1)
            node["shadow_names"] = [name for name, _count in station["names"].most_common(3)]
        else:
            node["shadow_rows"] = 0
            node["shadow_sum"] = 0
            node["shadow_names"] = []
    watched = next((item for item in constraints if "5127" in item["name"]), None)
    hifld_note = "HIFLD Texas substations were not loaded."
    hifld_rows, hifld_source = [], "skipped"
    try:
        hifld_rows, hifld_source = load_hifld(refresh)
    except Exception as exc:
        hifld_note = f"HIFLD request failed ({exc}). No coordinates were invented."
    unique, ambiguous_names = coordinate_index(hifld_rows) if hifld_rows else ({}, 0)
    matched = 0
    for node in nodes:
        point = unique.get(norm_hifld(node["substation"])) if node.get("substation") else None
        if not point:
            continue
        lat, lon, label = point
        x, y = project(lon, lat)
        if not (0 <= x <= MAP_W and 0 <= y <= MAP_H):
            continue
        node["lat"] = round(lat, 5)
        node["lon"] = round(lon, 5)
        node["x"] = x
        node["y"] = y
        node["hifld_name"] = label
        matched += 1
    top15_matched = sum(1 for node in nodes[:15] if "x" in node)
    attempted = sum(1 for node in nodes if node.get("substation"))
    map_drawn = top15_matched >= 8
    outline, outline_note = (None, "Map omitted, so the state outline was not required.")
    if map_drawn:
        outline, outline_note = texas_outline()
        if not outline:
            map_drawn = False
    coverage_hifld = {
        "source": hifld_source,
        "rows": len(hifld_rows),
        "matched": matched,
        "attempted": attempted,
        "ambiguous": ambiguous_names,
        "top15_matched": top15_matched,
        "map_drawn": map_drawn,
        "note": hifld_note if hifld_rows == [] and hifld_source != "cache" else (
            "Match is a unique normalized substation name. Ambiguous HIFLD names were dropped. "
            "No coordinate was interpolated."
        ),
    }
    rt_meta = {"used": False, "reason": "Not queried."}
    se_meta = {"report_type": 12999, "emil": "NP6-619-ER", "documents": None, "used": False}
    hist_meta = {"used": False, "reason": "NP4-180-ER (13060) and the real-time hub and load-zone archive (13061) publish hubs and load zones, not resource nodes."}
    if refresh:
        try:
            rt_meta = report_span(12301)
            rt_meta["used"] = False
            rt_meta["reason"] = (
                "Real-time settlement point prices at resource nodes (NP6-905-CD, report 12301) "
                "were on the public list only across the publish dates recorded here, as small interval files. "
                "They were not mixed into the day-ahead ranking."
            )
        except Exception as exc:
            rt_meta = {"used": False, "reason": f"The real-time list was not read ({exc})."}
        try:
            se_meta = report_span(12999)
            se_meta["emil"] = "NP6-619-ER"
            se_meta["used"] = False
            se_meta["reason"] = "The public document list was empty, so 60-day state-estimator line flows are not in this note."
        except Exception as exc:
            se_meta = {"emil": "NP6-619-ER", "report_type": 12999, "used": False, "reason": f"The list was not read ({exc})."}
    ordered_dates = sorted(dates)
    missing = []
    if ordered_dates:
        cursor = date.fromisoformat(ordered_dates[0])
        last = date.fromisoformat(ordered_dates[-1])
        have = set(ordered_dates)
        while cursor <= last:
            if cursor.isoformat() not in have:
                missing.append(cursor.isoformat())
            cursor = date.fromordinal(cursor.toordinal() + 1)
    hours_labeled = max((node["hours"] for node in nodes), default=0)
    payload = {
        "generated": date.today().isoformat(),
        "title": "Where the next 100 MW of home batteries is worth the most in ERCOT",
        "independent": "Independent analysis. Not affiliated with Base Power, ERCOT, or a utility.",
        "vintage": (
            f"Day-ahead settlement point prices, ERCOT NP4-190-CD report type 12331, "
            f"delivery dates {ordered_dates[0]} through {ordered_dates[-1]}. "
            f"Zones from the settlement-point list NP4-160-SG. "
            f"Shadow prices NP4-191-CD report type 12332, same delivery dates."
        ),
        "window": {
            "start": ordered_dates[0],
            "end": ordered_dates[-1],
            "days": len(ordered_dates),
            "missing_dates": missing,
            "hours_labeled": hours_labeled,
            "price_files": len(prices_paths),
            "shadow_files": len(shadow_paths),
            "mapping_file": mapping_paths[-1].name,
        },
        "method": {
            "basis": "Resource-node day-ahead settlement point price minus the settlement load zone price, same delivery date, hour ending, and DST flag.",
            "rank": "95th percentile of that basis, descending. Mean basis and the share of hours at least $20/MWh above the zone are reported beside it.",
            "tail_label_usd": TAIL,
            "scarcity_label_usd": SCARCITY,
            "min_hours": MIN_HOURS,
            "zones": list(RANKED_ZONES),
            "zone_reason": (
                "Public Base sources name ADER participation in load zones Houston, North, and South. "
                "The Inside Base post and the 11 August 2026 DSWG deck do not name LZ_LCRA or LZ_AEN. "
                "Those NOIE zones are omitted from the ranking."
            ),
            "blocks": {
                "night": "Hour ending 01 through 06",
                "morning": "Hour ending 07 through 12",
                "afternoon": "Hour ending 13 through 18",
                "evening": "Hour ending 19 through 24",
            },
            "season": "Omitted. The public nodal day-ahead list is about a month, and this extract is one autumn window.",
            "interpolated": False,
        },
        "nodes": nodes,
        "context_zones": context,
        "constraints": constraints[:8],
        "watched_constraint": watched,
        "map": {
            "drawn": map_drawn,
            "d": outline if map_drawn else None,
            "width": MAP_W,
            "height": MAP_H,
            "note": outline_note,
        },
        "coverage": {
            "ambiguous_node_zones": ambiguous_nodes,
            "notes": notes,
            "rt_12301": rt_meta,
            "historical_hubs_only": hist_meta,
            "np6_619": se_meta,
            "hifld": coverage_hifld,
        },
        "sources": [
            {
                "title": "ERCOT day-ahead settlement point prices, NP4-190-CD",
                "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-190-CD",
                "detail": "Report type 12331. Resource nodes, hubs, and load zones. Public list keeps roughly 31 days.",
            },
            {
                "title": "ERCOT settlement points list, NP4-160-SG",
                "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-160-SG",
                "detail": "Report type 10008. Resource node, substation, and settlement load zone.",
            },
            {
                "title": "ERCOT day-ahead shadow prices, NP4-191-CD",
                "url": "https://www.ercot.com/mp/data-products/data-product-details?id=NP4-191-CD",
                "detail": "Report type 12332. Positive shadow price, from station, and to station.",
            },
            {
                "title": "HIFLD electric substations",
                "url": "https://services5.arcgis.com/HDRa0B57OVrv2E1q/ArcGIS/rest/services/Electric_Substations/FeatureServer",
                "detail": "Texas substation name, latitude, and longitude. Used only on a unique normalized name match.",
            },
            {
                "title": "Census cartographic state boundaries, 2024",
                "url": SHAPE_URL,
                "detail": "Texas outline only.",
            },
            {
                "title": "ADER Phase 4, WMS 7 October 2026",
                "url": "https://www.ercot.com/files/docs/2026/10/06/06.-ADER_Phase-4_WMS_10072026.pdf",
                "detail": "Dispatch moves to nodal. Settlement stays at the load zone.",
            },
            {
                "title": "Base Power ADER updates, DSWG 11 August 2026",
                "url": "https://www.ercot.com/files/docs/2026/08/12/2026-08-11-Base-Power-Company-ADER-Updates.pdf",
                "detail": "Public ERCOT file. Names approved ADER participation across LZ Houston, North, and South.",
            },
            {
                "title": "Chase Dowling, ADER Phase IV and the capacity crunch",
                "url": "https://inside.basepowercompany.com/aggregated-ders-and-the-capacity-crunch",
                "detail": "Inside Base. August 2026 fleet chart names North, South, and Houston ADER partitions. The 5127__A example is a West Texas import path.",
            },
        ],
    }
    payload["findings"] = findings(payload)
    return payload


def main():
    refresh = "--offline" not in sys.argv
    payload = build(refresh=refresh)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload))
    inject_findings(payload["findings"])
    top = payload["nodes"][0]
    print(
        f"wrote {OUT} nodes={len(payload['nodes'])} "
        f"window={payload['window']['start']}..{payload['window']['end']} "
        f"top={top['name']} p95={top['p95']} map={payload['map']['drawn']}"
    )
    for paragraph in payload["findings"]:
        print(paragraph)
        print()


if __name__ == "__main__":
    main()
