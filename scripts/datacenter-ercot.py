"""Build data/datacenter-ercot.json: what a large load pays for power in Texas (ERCOT). Run from the repo root.

    python scripts/datacenter-ercot.py

It joins files already in the repo with one ERCOT file in the git-ignored cache (fetched by scripts/grid-ercot.py):
  prices by load zone      data/deployment/LZ_*.csv (hourly, twelve months; provenance in its manifest)
  the four summer peaks    ERCOT Native Load 2026, hourly (analysis/cache/ercot/nl2026/)
  the large-load queue     data/siting/large-load.json (ERCOT's June 2026 status deck, read by scripts/build_siting.py)
  demand growth by region  data/grid-ercot.json
  the wires charges        typed in below from a PUCT rate report, with its URL and date

No number is invented. Charges that could not be sourced are left out and named in 'notIncluded'."""
import csv
import datetime as dt
import glob
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
START, END = '2025-10-01', '2026-10-01'
STEPS = [0, 10, 25, 50, 100, 200, 300, 500]  # the priciest N hours a site could sit out

# Oncor Electric Delivery, Transmission service class. Read from the PUCT monthly rate report on 2026-11-13.
TARIFF = {
    'utility': 'Oncor Electric Delivery', 'class': 'Transmission service', 'asOf': '2026-11-01', 'read': '2026-11-13',
    'source': 'https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/Oncor_Rate_Report.pdf',
    'sourceTitle': 'Oncor Electric Delivery Company LLC, PUCT Monthly Report, as of November 1, 2026',
    'per4cpKwMonthUsd': 6.260839,      # "Transmission ... per 4CP kW"
    'perBillingKwMonthUsd': 0.163822,  # "Transmission ... Volumetric Charges per Billing kW"
    'customerMonthUsd': 258.80, 'meteringMonthUsd': 321.63,
    'note': 'Oncor is the largest wires company in ERCOT and is used here as the example. CenterPoint, AEP Texas and TNMP publish their own rates, and the city utilities and co-ops (Austin Energy, CPS Energy, LCRA, Rayburn) set their own.',
}
RULES = [
    {'id': '4cp', 'status': 'in force', 'title': '16 TAC 25.192, transmission service rates',
     'what': "A transmission provider's rate is its approved cost of service divided by the average of ERCOT's coincident peak demand in June, July, August and September (4CP).",
     'source': 'https://ftp.puc.texas.gov/public/puct-info/agency/rulesnlaws/subrules/electric/25.192/25.192.pdf'},
    {'id': '12cp', 'status': 'proposal', 'title': 'PUCT Project 58000, proposal for publication, 9 July 2026',
     'what': 'Would replace the four coincident peak (4CP) method with a twelve coincident peak (12CP) method for assigning transmission costs. Not adopted as a rule when this was built.',
     'source': 'https://www.ercot.com/files/docs/2026/07/23/PUCT-Project-58000-pfp_adopted-9-July-2026.pdf'},
]


def zone_prices(zid):
    rows = []
    with open(ROOT / 'data' / 'deployment' / f'{zid}.csv', newline='') as f:
        for r in csv.DictReader(f):
            if START <= r['date'] < END:
                rows.append(float(r['rtm']))
    rows.sort(reverse=True)
    cum, s = [], 0.0
    for i, p in enumerate(rows):
        if i in STEPS:
            cum.append(round(s, 2))
        s += p
    return {'hours': len(rows), 'avg': round(sum(rows) / len(rows), 2), 'max': round(rows[0], 2),
            'over1000': sum(1 for p in rows if p > 1000), 'over200': sum(1 for p in rows if p > 200),
            'topHoursSumUsdPerMw': cum}  # dollars one MW would pay across its N priciest hours, for N in STEPS


def summer_peaks():
    f = glob.glob(str(ROOT / 'analysis' / 'cache' / 'ercot' / 'nl2026' / '*.xlsx'))
    if not f:
        raise SystemExit('Run scripts/grid-ercot.py first: it fetches the ERCOT native load file this needs.')
    wb = openpyxl.load_workbook(f[0], read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    best = {}
    first = True
    for row in ws.iter_rows(values_only=True):
        if first:
            first = False
            continue
        if row[0] is None:
            continue
        stamp = str(row[0]).replace(' DST', '').strip()
        month, day, year, he = int(stamp[0:2]), int(stamp[3:5]), int(stamp[6:10]), int(stamp[11:13])
        if year != 2026 or month not in (6, 7, 8, 9):
            continue
        mw = row[9]
        if month not in best or mw > best[month]['mw']:
            best[month] = {'date': dt.date(year, month, day).isoformat(), 'hourEnding': he, 'mw': round(mw)}
    wb.close()
    return [best[m] for m in (6, 7, 8, 9)]


def main():
    day = json.loads((ROOT / 'data' / 'day-ercot.json').read_text(encoding='utf-8'))
    grid = json.loads((ROOT / 'data' / 'grid-ercot.json').read_text(encoding='utf-8'))
    queue = json.loads((ROOT / 'data' / 'siting' / 'large-load.json').read_text(encoding='utf-8'))
    zones = []
    for z in day['zones']:
        p = zone_prices(z['id'])
        assert abs(p['avg'] - z['avgRtUsdPerMwh']) < 0.02, (z['id'], p['avg'], z['avgRtUsdPerMwh'])
        zones.append({'id': z['id'], 'name': z['utility'], 'choice': z['choice'], 'who': z['who'],
                      'avgRtUsdPerMwh': p['avg'], 'maxRtUsdPerMwh': p['max'], 'hours': p['hours'],
                      'hoursOver1000': p['over1000'], 'hoursOver200': p['over200'], 'topHoursSumUsdPerMw': p['topHoursSumUsdPerMw']})
    zones.sort(key=lambda z: z['avgRtUsdPerMwh'])
    fig = {f['id']: f for f in queue['textFigures']}
    by_zone = next(c for c in queue['charts'] if c['title'] == 'Approved to Energize by Load Zone')
    out = {
        'built': dt.date.today().isoformat(),
        'grid': 'ERCOT',
        'period': {'start': START, 'endExclusive': END},
        'steps': STEPS,
        'zones': zones,
        'pricesSource': {'title': 'ERCOT load zone settlement point prices, real-time, hourly', 'url': 'https://www.ercot.com/mktinfo/prices', 'manifest': '/data/deployment/manifest.json'},
        'tariff': TARIFF,
        'rules': RULES,
        'peaks': {'year': 2026, 'hours': summer_peaks(),
                  'source': 'https://www.ercot.com/gridinfo/load/load_hist',
                  'note': "The highest hour of ERCOT demand in each of June, July, August and September, from ERCOT's hourly native load file. ERCOT sets the official 4CP on fifteen-minute intervals, so its times can differ from these by part of an hour."},
        'queue': {'asOf': queue['asOf'], 'what': queue['whatItIs'],
                  'approvedMw': fig['approved-to-energize']['value'], 'peakSeenMw': fig['non-simultaneous-peak']['value'], 'peakSeenTogetherMw': fig['simultaneous-peak']['value'],
                  'byZone': by_zone['rows'], 'source': 'https://www.ercot.com/files/docs/2026/06/18/June-19-LLWG-Report.pptx', 'page': '/siting'},
        'growth': [{'name': z['name'], 'places': z['places'], 'change': z['change'], 'gwh': z['gwh']} for z in sorted(grid['zones'], key=lambda z: -z['change'])],
        'gridPeakMw': grid['peak']['mw'],
        'notIncluded': [
            'How long a site waits to connect. ERCOT publishes queue totals, not a wait for each site.',
            "The retail provider's margin, ERCOT's own fees, reserve (ancillary service) costs passed through, and taxes.",
            'Wires charges for any utility other than Oncor.',
            'The cost of the building, the chips, cooling and backup generators.',
        ],
    }
    (ROOT / 'data' / 'datacenter-ercot.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8', newline='\n')
    for z in zones:
        print(f"{z['id']:11} avg {z['avgRtUsdPerMwh']:6.2f} max {z['maxRtUsdPerMwh']:8.2f} >1000: {z['hoursOver1000']:3} >200: {z['hoursOver200']:4} top100 sum {z['topHoursSumUsdPerMw'][4]}")
    print('peaks', out['peaks']['hours'])
    print('queue', out['queue']['approvedMw'], out['queue']['peakSeenMw'], 'tariff/yr per MW', round(TARIFF['per4cpKwMonthUsd'] * 12 * 1000))


if __name__ == '__main__':
    main()
