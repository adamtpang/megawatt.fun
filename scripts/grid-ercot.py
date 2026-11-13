"""Build data/grid-ercot.json: how power moves through Texas (ERCOT). Run from the repo root.

    python scripts/grid-ercot.py            # use analysis/cache/ercot/, fetching any file that is missing
    python scripts/grid-ercot.py --refresh  # fetch them again first

It joins three public ERCOT files over the same twelve months the rest of the site uses:
  where power is made   Interval Generation by Fuel (also used by scripts/supply-ercot.py)
  where power goes      Native Load by weather zone, hourly: https://www.ercot.com/gridinfo/load/load_hist
  what it was worth     hub average real-time price by hour, data/deployment/HB_HUBAVG.csv (already in the repo)

Raw files stay in analysis/cache/ercot/ (git-ignored). No number is invented. The split by customer type
(homes, businesses, industry) is NOT here: the public EIA state file reachable when this was written stopped
at 2021, too old to set beside 2026 generation."""
import csv
import datetime as dt
import glob
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'analysis' / 'cache' / 'ercot'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
GEN = {2025: 'https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx', 2026: 'https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx'}
LOAD = {2024: 'https://www.ercot.com/files/docs/2024/02/06/Native_Load_2024.zip', 2025: 'https://www.ercot.com/files/docs/2025/02/11/Native_Load_2025.zip',
        2026: 'https://www.ercot.com/files/docs/2026/02/10/Native_Load_2026.zip'}
START, END = dt.date(2025, 10, 1), dt.date(2026, 10, 1)
PREV_START, PREV_END = dt.date(2024, 10, 1), dt.date(2025, 10, 1)
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

SOURCES = [('gas', 'Natural gas', ['Gas', 'Gas-CC']), ('wind', 'Wind', ['Wind']), ('solar', 'Solar', ['Solar']), ('coal', 'Coal', ['Coal']),
           ('nuclear', 'Nuclear', ['Nuclear']), ('other', 'Other', ['Other']), ('hydro', 'Hydro', ['Hydro']), ('biomass', 'Biomass', ['Biomass'])]
# ERCOT's eight weather zones, with the largest places in each.
ZONES = [('NCENT', 'North Central', 'Dallas and Fort Worth'), ('COAST', 'Coast', 'Houston'), ('SCENT', 'South Central', 'Austin and San Antonio'),
         ('FWEST', 'Far West', 'Midland, Odessa and the Permian Basin'), ('SOUTH', 'South', 'Corpus Christi and the Rio Grande Valley'),
         ('WEST', 'West', 'Abilene and San Angelo'), ('EAST', 'East', 'Tyler'), ('NORTH', 'North', 'Wichita Falls')]


def fetch(refresh):
    CACHE.mkdir(parents=True, exist_ok=True)
    for year, url in GEN.items():
        p = CACHE / f'IntGenbyFuel{year}.xlsx'
        if refresh or not p.exists():
            p.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read())
    for year, url in LOAD.items():
        d = CACHE / f'nl{year}'
        if refresh or not glob.glob(str(d / '*.xlsx')):
            d.mkdir(exist_ok=True)
            zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read())).extractall(d)


def prices():
    """(date, hour ending) -> hub average real-time price, $/MWh. A repeated hour (clock change) is averaged."""
    acc = {}
    with open(ROOT / 'data' / 'deployment' / 'HB_HUBAVG.csv', newline='') as f:
        for r in csv.DictReader(f):
            acc.setdefault((r['date'], int(r['hourEnding'])), []).append(float(r['rtm']))
    return {k: sum(v) / len(v) for k, v in acc.items()}


def load_rows(year):
    wb = openpyxl.load_workbook(glob.glob(str(CACHE / f'nl{year}' / '*.xlsx'))[0], read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    head = None
    for row in ws.iter_rows(values_only=True):
        if head is None:
            head = [str(c).strip() for c in row]
            continue
        if row[0] is None:
            continue
        stamp = str(row[0]).replace(' DST', '').strip()         # 'MM/DD/YYYY HH:00', hour ending 01 to 24
        d = dt.date(int(stamp[6:10]), int(stamp[0:2]), int(stamp[3:5]))
        yield d, int(stamp[11:13]), dict(zip(head[1:], row[1:]))
    wb.close()


def main():
    fetch('--refresh' in sys.argv)
    price = prices()

    # ---- where power goes: load by zone, this window and the one before it
    zone = {z[0]: 0.0 for z in ZONES}
    prev = {z[0]: 0.0 for z in ZONES}
    total = total_prev = load_value = 0.0
    priced_mwh = 0.0
    peak = {'mw': 0}
    low = {'mw': 1e12}
    hours = 0
    for year in (2024, 2025, 2026):
        for d, he, vals in load_rows(year):
            if PREV_START <= d < PREV_END:
                for z in prev:
                    prev[z] += vals[z] or 0.0
                total_prev += vals['ERCOT'] or 0.0
            if not (START <= d < END):
                continue
            hours += 1
            mw = vals['ERCOT']
            total += mw
            for z in zone:
                zone[z] += vals[z] or 0.0
            p = price.get((d.isoformat(), he))
            if p is not None:
                load_value += mw * p; priced_mwh += mw
            stamp = {'date': d.isoformat(), 'hourEnding': he, 'mw': round(mw)}
            if mw > peak['mw']:
                peak = stamp
            if mw < low['mw']:
                low = stamp
    assert 8758 <= hours <= 8762, hours

    # ---- where power is made, and what each source was paid at the hub price in the hour it ran
    ids = [s[0] for s in SOURCES]
    fuel_to_id = {f: sid for sid, _, fuels in SOURCES for f in fuels}
    mwh = {i: 0.0 for i in ids}
    value = {i: 0.0 for i in ids}
    priced = {i: 0.0 for i in ids}
    charge_mwh = charge_value = charge_priced = 0.0
    for year in (2025, 2026):
        wb = openpyxl.load_workbook(CACHE / f'IntGenbyFuel{year}.xlsx', read_only=True, data_only=True)
        for m in MONTHS:
            for row in wb[m].iter_rows(min_row=2, values_only=True):
                if row[0] is None:
                    continue
                d = row[0].date() if hasattr(row[0], 'date') else dt.date.fromisoformat(str(row[0])[:10])
                if not (START <= d < END):
                    continue
                vals = [v or 0.0 for v in row[4:100]]
                day = d.isoformat()
                for h in range(24):
                    e = sum(vals[h * 4:h * 4 + 4])
                    p = price.get((day, h + 1))
                    if row[1] == 'WSL':
                        charge_mwh += e
                        if p is not None:
                            charge_value += e * p; charge_priced += e
                        continue
                    sid = fuel_to_id[row[1]]
                    mwh[sid] += e
                    if p is not None:
                        value[sid] += e * p; priced[sid] += e
        wb.close()
    made = sum(mwh.values())
    charging = -charge_mwh

    out = {
        'built': dt.date.today().isoformat(),
        'grid': 'ERCOT',
        'period': {'start': START.isoformat(), 'endExclusive': END.isoformat(), 'hours': hours},
        'previous': {'start': PREV_START.isoformat(), 'endExclusive': PREV_END.isoformat()},
        'sourceGeneration': {'title': 'ERCOT Interval Generation by Fuel, 2025 and 2026 workbooks', 'page': 'https://www.ercot.com/gridinfo/generation'},
        'sourceLoad': {'title': 'ERCOT Native Load by weather zone, hourly, 2024 to 2026', 'page': 'https://www.ercot.com/gridinfo/load/load_hist', 'files': list(LOAD.values())},
        'sourcePrice': {'title': 'ERCOT hub average real-time price, hourly', 'file': '/data/deployment/HB_HUBAVG.csv', 'manifest': '/data/deployment/manifest.json'},
        'madeGwh': round(made / 1000, 1),
        'sources': [{'id': sid, 'name': name, 'gwh': round(mwh[sid] / 1000, 1), 'share': round(mwh[sid] / made, 4),
                     'valueUsd': round(value[sid]), 'avgPriceUsdPerMwh': round(value[sid] / priced[sid], 2) if priced[sid] else None} for sid, name, _ in SOURCES],
        'usedGwh': round(total / 1000, 1),
        'zones': sorted([{'id': zid, 'name': name, 'places': places, 'gwh': round(zone[zid] / 1000, 1), 'share': round(zone[zid] / total, 4),
                          'previousGwh': round(prev[zid] / 1000, 1), 'change': round(zone[zid] / prev[zid] - 1, 4)} for zid, name, places in ZONES], key=lambda z: -z['gwh']),
        'usedPreviousGwh': round(total_prev / 1000, 1),
        'usedChange': round(total / total_prev - 1, 4),
        'peak': peak, 'low': low, 'averageMw': round(total / hours),
        'storage': {'chargingGwh': round(charging / 1000, 1), 'chargingCostUsd': round(-charge_value),
                    'chargingAvgPriceUsdPerMwh': round(charge_value / charge_priced, 2) if charge_priced else None,
                    'note': "ERCOT lists battery charging as WSL (wholesale storage load). Its file has no line named for batteries discharging; the 'Other' line probably holds most of it, but the file does not say so."},
        # What is left after load and battery charging are taken from generation. ERCOT does not label it in these files.
        'differenceGwh': round((made - total - charging) / 1000, 1),
        'loadValueUsd': round(load_value), 'loadAvgPriceUsdPerMwh': round(load_value / priced_mwh, 2),
        'averagePriceUsdPerMwh': round(sum(price[k] for k in price if START.isoformat() <= k[0] < END.isoformat()) / sum(1 for k in price if START.isoformat() <= k[0] < END.isoformat()), 2),
        'notIncluded': 'The split by customer type (homes, businesses, industry) is not here. The public EIA state file reachable on the build date stopped at 2021.',
    }
    (ROOT / 'data' / 'grid-ercot.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('made TWh', round(made / 1e6, 1), 'used', round(total / 1e6, 1), 'charging', round(charging / 1e6, 1), 'difference', out['differenceGwh'] / 1000)
    for s in out['sources']:
        print(f"  {s['name']:12} {s['gwh'] / 1000:6.1f} TWh  {s['avgPriceUsdPerMwh']} $/MWh  ${s['valueUsd'] / 1e9:.2f}B")
    for z in out['zones']:
        print(f"  {z['name']:14} {z['gwh'] / 1000:6.1f} TWh {z['share'] * 100:5.1f}%  {z['change'] * 100:+.1f}%")
    print('peak', peak, 'low', low, 'avg', out['averageMw'], 'load cost $B', round(load_value / 1e9, 2), 'avg price', out['averagePriceUsdPerMwh'], 'load-weighted', out['loadAvgPriceUsdPerMwh'],
          'charging price', out['storage']['chargingAvgPriceUsdPerMwh'], 'total change', out['usedChange'])


if __name__ == '__main__':
    main()
