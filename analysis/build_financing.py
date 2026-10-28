#!/usr/bin/env python3
"""Annual revenue of one home battery on ERCOT day-ahead load-zone prices.

Usage:
  python3 analysis/build_financing.py

Reads Historical DAM Load Zone and Hub Prices, report type 13060,
years 2018 through 2025. 2026 is a partial file and is not in the distribution.
Writes data/financing.json. Cached zips stay in analysis/cache/ercot-lz/.
"""

from __future__ import annotations

import json
import math
import zipfile
from collections import defaultdict
from datetime import date
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "analysis" / "cache" / "ercot-lz"
OUT = ROOT / "data" / "financing.json"
UA = "megawatt.fun research"
ZONES = ("LZ_HOUSTON", "LZ_NORTH", "LZ_SOUTH", "LZ_WEST")
YEARS = {
    2018: "642564845",
    2019: "694281912",
    2020: "751351545",
    2021: "814918746",
    2022: "886627599",
    2023: "969803138",
    2024: "1065468714",
    2025: "1177667469",
}
# Published Base Core energy. Continuous kilowatts are not on the public spec sheet.
ENERGY_KWH = 39.2
# Illustrative 4-hour duration, because no public continuous-power rating was found.
POWER_KW = 9.8
# Illustrative. Base does not publish round-trip efficiency on the Core spec sheet.
RTE = 0.90
RESERVE = 0.0
STEP_KWH = 0.4


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=180) as resp:
        dest.write_bytes(resp.read())
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


def dispatch_revenue(prices, energy_kwh, power_kw, rte, reserve=0.0, step=STEP_KWH):
    """Perfect foresight over the series. Start full and end full, so a one-time
    emptying is not revenue. The battery can sell into a spike and recharge later.
    """
    usable = energy_kwh * (1 - reserve)
    n_soc = int(math.floor(usable / step + 1e-9))
    if n_soc < 1 or not prices:
        return None
    eta = math.sqrt(rte)
    neg = -1e100
    prev = [neg] * (n_soc + 1)
    prev[n_soc] = 0.0
    for price in prices:
        cur = [neg] * (n_soc + 1)
        per_kwh = price / 1000.0
        for soc in range(n_soc + 1):
            base = prev[soc]
            if base <= neg / 2:
                continue
            # idle
            if base > cur[soc]:
                cur[soc] = base
            # charge, AC kWh limited by power and remaining headroom
            headroom = (n_soc - soc) * step
            charge = min(power_kw, headroom / eta if eta else 0)
            if charge > 1e-9:
                nxt = soc + int(math.floor(charge * eta / step + 1e-9))
                nxt = min(n_soc, nxt)
                moved = (nxt - soc) * step / eta
                val = base - moved * per_kwh
                if val > cur[nxt]:
                    cur[nxt] = val
            # discharge
            stored = soc * step
            discharge = min(power_kw, stored * eta)
            if discharge > 1e-9:
                nxt = soc - int(math.floor(discharge / eta / step + 1e-9))
                nxt = max(0, nxt)
                moved = (soc - nxt) * step * eta
                val = base + moved * per_kwh
                if val > cur[nxt]:
                    cur[nxt] = val
        prev = cur
    if prev[n_soc] <= neg / 2:
        return None
    return prev[n_soc]


def load_year(year, doc_id):
    dest = fetch(
        f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc_id}",
        CACHE / f"{doc_id}.zip",
    )
    with zipfile.ZipFile(dest) as archive:
        name = next(item for item in archive.namelist() if item.endswith(".xlsx"))
        raw = archive.read(name)
    # Older workbooks publish a wrong used-range, so read_only mode drops every column but the first.
    wb = load_workbook(BytesIO(raw), read_only=False, data_only=True)
    buckets = defaultdict(list)
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = [str(cell).strip() if cell is not None else "" for cell in next(rows)]
        index = {name: pos for pos, name in enumerate(header)}
        for row in rows:
            if row[index["Settlement Point"]] is None:
                continue
            point = row[index["Settlement Point"]]
            if point not in ZONES:
                continue
            hour = int(str(row[index["Hour Ending"]]).split(":")[0])
            flag = str(row[index["Repeated Hour Flag"]] or "N")
            price = float(row[index["Settlement Point Price"]])
            buckets[(point, str(row[index["Delivery Date"]]))].append((hour, flag, price))
    wb.close()
    by_day = {zone: {} for zone in ZONES}
    for (point, stamp), triples in buckets.items():
        triples.sort(key=lambda item: (item[0], 0 if item[1] == "N" else 1))
        prices = [item[2] for item in triples]
        if len(prices) >= 20:
            text = str(stamp)[:10]
            if "/" in text:
                month, day, year_text = text.split("/")
                key = (int(year_text), int(month), int(day))
            else:
                year_text, month, day = text.split("-")
                key = (int(year_text), int(month), int(day))
            by_day[point][key] = prices
    return {zone: [by_day[zone][key] for key in sorted(by_day[zone])] for zone in ZONES}


def treasury_10y():
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        "daily-treasury-rates.csv/all/202610?type=daily_treasury_yield_curve"
        "&field_tdr_date_value_month=202610&page&_format=csv"
    )
    try:
        req = Request(url, headers={"User-Agent": UA})
        with urlopen(req, timeout=40) as resp:
            text = resp.read().decode("utf-8", "replace")
    except Exception as exc:
        return {"available": False, "reason": str(exc)}
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return {"available": False, "reason": "Treasury CSV had no data rows."}
    header = [cell.strip().strip('"') for cell in lines[0].split(",")]
    latest = [cell.strip().strip('"') for cell in lines[1].split(",")]
    # The 10-year column is labeled "10 Yr"
    try:
        col = header.index("10 Yr")
        value = float(latest[col])
    except (ValueError, IndexError):
        return {"available": False, "reason": "10 Yr column was not in the Treasury CSV.", "header": header[:12]}
    return {"available": True, "date": latest[0], "percent": value, "source": url}


def main():
    by_zone = {zone: [] for zone in ZONES}
    for year, doc_id in YEARS.items():
        print(f"year {year}", flush=True)
        days = load_year(year, doc_id)
        for zone in ZONES:
            series = [price for day in days[zone] for price in day]
            earned = dispatch_revenue(series, ENERGY_KWH, POWER_KW, RTE, RESERVE)
            revenue = 0.0 if earned is None else earned
            by_zone[zone].append({
                "year": year,
                "revenue_usd": round(revenue, 2),
                "hours": len(series),
                "days": len(days[zone]),
            })
            print(f"  {zone} {revenue:.0f} over {len(series)} hours", flush=True)

    summary = {}
    for zone, years in by_zone.items():
        values = [item["revenue_usd"] for item in years]
        worst = min(years, key=lambda item: item["revenue_usd"])
        best = max(years, key=lambda item: item["revenue_usd"])
        mean = sum(values) / len(values)
        summary[zone] = {
            "years": years,
            "p50_usd": round(quantile(values, 0.50), 2),
            "p90_exceedance_usd": round(quantile(values, 0.10), 2),
            "worst_year": worst["year"],
            "worst_usd": worst["revenue_usd"],
            "best_year": best["year"],
            "best_usd": best["revenue_usd"],
            "mean_usd": round(mean, 2),
            "stdev_usd": round(math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1)), 2),
        }

    payload = {
        "generated": date.today().isoformat(),
        "method": (
            "Each year is one perfect-foresight dispatch. The battery starts full and must finish "
            "the year full, so it can sell into a spike and recharge later, and a one-time emptying "
            "is not revenue. Charge and discharge are limited by power and by stored energy. "
            "Round-trip efficiency is split evenly between charge and discharge. The state of charge "
            f"is stepped in {STEP_KWH} kWh. Prices are ERCOT day-ahead load-zone settlement prices, report 13060."
        ),
        "defaults": {
            "energy_kwh": ENERGY_KWH,
            "energy_source": "Base Core public spec, basepowercompany.com/core, 39.2 kWh. Read 27 October 2026.",
            "power_kw": POWER_KW,
            "power_source": "Illustrative. The public Core spec lists energy, voltage, and backup duration. It does not list continuous kilowatts. 9.8 kW is 39.2 kWh over 4 hours.",
            "rte": RTE,
            "rte_source": "Illustrative. Round-trip efficiency is not on the public Core spec sheet.",
            "reserve": RESERVE,
            "reserve_source": "Zero reserve in the default, so the whole nameplate can cycle. Raise it to hold energy back for backup.",
            "degradation_per_year": 0.02,
            "degradation_source": "Illustrative 2% per year. Base does not publish a fade rate on the Core spec sheet.",
            "interest_spread": 0.0,
            "term_years": 10,
            "term_source": "Illustrative. Base's debt term is not public.",
            "capex_usd_per_kwh": None,
            "capex_source": "No residential-battery capital cost row was retrieved from NREL ATB in this build. Debt service stays blank until a $/kWh is entered. The $695 installation fee and $19 monthly membership on basepowercompany.com are customer prices, not the cost of the battery Base owns.",
        },
        "treasury_10y": treasury_10y(),
        "zones": summary,
        "omitted": [
            "2026 is a partial archive, published 25 October 2026, and is not in the distribution.",
            "Real-time prices are not included.",
            "Nodal prices for these years are not in report 13060. Settlement here is the load zone, which is also what ADER Phase 4 still pays.",
            "Base's fleet dispatch, reserve policy, degradation, capex, and debt terms are not public.",
            "Perfect daily foresight overstates what a forecast-based operator would capture.",
        ],
    }
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
