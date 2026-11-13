"""Build data/supply-ercot.json: where Texas (ERCOT) power comes from, by source. Run from the repo root.

    python scripts/supply-ercot.py            # use the files in analysis/cache/ercot/, fetching any that are missing
    python scripts/supply-ercot.py --refresh  # fetch them again first

Sources, all public:
  ERCOT "Interval Generation by Fuel" workbooks (15-minute MWh by fuel, from settlement), listed on
    https://www.ercot.com/gridinfo/generation
  ERCOT fuel mix dashboard (installed capacity by fuel): https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json
  Hub average price by hour: data/deployment/HB_HUBAVG.csv, already in the repo (provenance in its manifest).

The raw files stay in analysis/cache/ercot/ (git-ignored). Only the derived JSON is committed. No number is invented:
a category ERCOT does not explain is passed through under ERCOT's own name with a note."""
import csv
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'analysis' / 'cache' / 'ercot'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
FILES = {
    'IntGenbyFuel2025.xlsx': 'https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx',
    'IntGenbyFuel2026.xlsx': 'https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx',
    'fuel-mix.json': 'https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json',
}
START, END = dt.date(2025, 10, 1), dt.date(2026, 10, 1)  # the same twelve months as the price data on the site
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# ERCOT's fuel names -> the sources shown on the page, in stacking order (steady sources at the bottom).
SOURCES = [
    ('nuclear', 'Nuclear', ['Nuclear']),
    ('coal', 'Coal', ['Coal']),
    ('gas', 'Natural gas', ['Gas', 'Gas-CC']),
    ('wind', 'Wind', ['Wind']),
    ('solar', 'Solar', ['Solar']),
    ('other', 'Other', ['Other']),
    ('hydro', 'Hydro', ['Hydro']),
    ('biomass', 'Biomass', ['Biomass']),
]
CAPACITY_KEYS = {'nuclear': 'Nuclear', 'coal': 'Coal and Lignite', 'gas': 'Natural Gas', 'wind': 'Wind', 'solar': 'Solar', 'hydro': 'Hydro', 'storage': 'Power Storage'}


def fetch(refresh):
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        p = CACHE / name
        if p.exists() and not refresh:
            continue
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120) as r:
            p.write_bytes(r.read())
        print('fetched', name, p.stat().st_size)


def main():
    fetch('--refresh' in sys.argv)
    fuel_to_id = {f: sid for sid, _, fuels in SOURCES for f in fuels}
    ids = [s[0] for s in SOURCES]
    energy = {i: 0.0 for i in ids}                      # MWh over the window
    by_hour = {i: [0.0] * 24 for i in ids}               # MWh summed per hour of day
    monthly = {}                                         # 'YYYY-MM' -> {id: MWh}
    charging = 0.0                                       # WSL: wholesale storage load, negative in the file
    charge_hour = [0.0] * 24
    days = set()
    settlement = {}
    for year in (2025, 2026):
        wb = openpyxl.load_workbook(CACHE / f'IntGenbyFuel{year}.xlsx', read_only=True, data_only=True)
        stamp = None
        for m in MONTHS:
            for row in wb[m].iter_rows(min_row=2, values_only=True):
                if row[0] is None:
                    continue
                day = row[0].date() if hasattr(row[0], 'date') else dt.date.fromisoformat(str(row[0])[:10])
                if not (START <= day < END):
                    continue
                fuel, kind = row[1], row[2]
                key = day.strftime('%Y-%m')
                settlement[key] = kind
                days.add(day)
                vals = [v or 0.0 for v in row[4:100]]     # 96 fifteen-minute intervals, MWh each
                if fuel == 'WSL':
                    charging += sum(vals)
                    for h in range(24):
                        charge_hour[h] += sum(vals[h * 4:h * 4 + 4])
                    continue
                sid = fuel_to_id[fuel]
                energy[sid] += sum(vals)
                monthly.setdefault(key, {i: 0.0 for i in ids})[sid] += sum(vals)
                for h in range(24):
                    by_hour[sid][h] += sum(vals[h * 4:h * 4 + 4])
        wb.close()
    n = len(days)
    assert n == (END - START).days, f'{n} days found, expected {(END - START).days}'
    total = sum(energy.values())

    dash = json.loads((CACHE / 'fuel-mix.json').read_text(encoding='utf-8'))
    cap = dash['monthlyCapacity']

    # Hub average real-time price by hour of day, over the same window.
    psum, pn = [0.0] * 24, [0] * 24
    with open(ROOT / 'data' / 'deployment' / 'HB_HUBAVG.csv', newline='') as f:
        for r in csv.DictReader(f):
            if not (START.isoformat() <= r['date'] < END.isoformat()):
                continue
            h = int(r['hourEnding']) - 1
            psum[h] += float(r['rtm']); pn[h] += 1
    price = [round(psum[h] / pn[h], 2) for h in range(24)]

    out = {
        'built': dt.date.today().isoformat(),
        'grid': 'ERCOT',
        'period': {'start': START.isoformat(), 'endExclusive': END.isoformat(), 'days': n, 'timezone': 'America/Chicago'},
        'sourceEnergy': {'title': 'ERCOT Interval Generation by Fuel, 2025 and 2026 workbooks', 'page': 'https://www.ercot.com/gridinfo/generation',
                         'files': [FILES['IntGenbyFuel2025.xlsx'], FILES['IntGenbyFuel2026.xlsx']],
                         'note': 'Fifteen-minute generation by fuel from settlement. A plant that can burn more than one fuel is counted under its primary fuel.',
                         'settlement': settlement},
        'sourceCapacity': {'title': 'ERCOT fuel mix dashboard, installed capacity', 'url': FILES['fuel-mix.json'], 'asOf': dash['lastUpdated'][:10]},
        'sourcePrice': {'title': 'ERCOT hub average real-time price, by hour of day', 'file': '/data/deployment/HB_HUBAVG.csv', 'manifest': '/data/deployment/manifest.json'},
        'totalGwh': round(total / 1000, 1),
        'sources': [{
            'id': sid, 'name': name, 'ercotFuels': fuels,
            'gwh': round(energy[sid] / 1000, 1), 'share': round(energy[sid] / total, 4),
            'capacityMw': cap.get(CAPACITY_KEYS[sid]) if sid in CAPACITY_KEYS else None,
            'avgMwByHour': [round(by_hour[sid][h] / n, 1) for h in range(24)],
        } for sid, name, fuels in SOURCES],
        'storage': {
            'chargingGwh': round(-charging / 1000, 1),
            'chargingAvgMwByHour': [round(-charge_hour[h] / n, 1) for h in range(24)],
            'capacityMw': cap.get('Power Storage'),
            'note': "ERCOT's file lists battery charging as WSL (wholesale storage load), a negative number, and has no line named for batteries discharging. Its 'Other' line rises and falls with WSL, so it probably holds most battery discharge, but the file does not say so.",
        },
        'months': [{'month': k, 'settlement': settlement[k], 'gwh': {i: round(v / 1000, 1) for i, v in monthly[k].items()}} for k in sorted(monthly)],
        'priceByHourUsdPerMwh': price,
    }
    (ROOT / 'data' / 'supply-ercot.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('days', n, 'total TWh', round(total / 1e6, 1))
    for s in out['sources']:
        print(f"{s['name']:12} {s['gwh'] / 1000:7.1f} TWh {s['share'] * 100:5.1f}%  capacity {s['capacityMw']}")
    print('charging TWh', out['storage']['chargingGwh'] / 1000, 'price', price)


if __name__ == '__main__':
    main()
