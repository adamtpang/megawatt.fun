"""Build data/twin-ercot-load.json: ERCOT system demand for every hour of the twin's year. Run from the repo root.

    python scripts/twin-ercot.py

Reads ERCOT's hourly Native Load workbooks from analysis/cache/ercot/ (fetched by scripts/grid-ercot.py) and writes
one list of megawatts per calendar day, in the same hour order as the price files in data/deployment/ (23 hours on
the spring clock change, 25 on the autumn one). The twin's data center uses it to decide when the grid is near a
peak. Source: https://www.ercot.com/gridinfo/load/load_hist"""
import datetime as dt
import glob
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
START, END = dt.date(2025, 10, 1), dt.date(2026, 10, 1)


def main():
    days = {}
    for year in (2025, 2026):
        files = glob.glob(str(ROOT / 'analysis' / 'cache' / 'ercot' / f'nl{year}' / '*.xlsx'))
        if not files:
            raise SystemExit('Run scripts/grid-ercot.py first: it fetches the ERCOT native load files this needs.')
        wb = openpyxl.load_workbook(files[0], read_only=True, data_only=True)
        first = True
        for row in wb[wb.sheetnames[0]].iter_rows(values_only=True):
            if first:
                first = False
                continue
            if row[0] is None:
                continue
            stamp = str(row[0]).replace(' DST', '').strip()
            d = dt.date(int(stamp[6:10]), int(stamp[0:2]), int(stamp[3:5]))
            if START <= d < END:
                days.setdefault(d.isoformat(), []).append(round(row[9]))
        wb.close()
    n = sum(len(v) for v in days.values())
    assert len(days) == 365 and n == 8760, (len(days), n)
    odd = {k: len(v) for k, v in days.items() if len(v) != 24}
    out = {
        'built': dt.date.today().isoformat(),
        'what': 'ERCOT system demand (native load), megawatts, one list per calendar day in hour order, Central time.',
        'period': {'start': START.isoformat(), 'endExclusive': END.isoformat(), 'hours': n},
        'source': 'https://www.ercot.com/gridinfo/load/load_hist',
        'clockChangeDays': odd,
        'days': days,
    }
    (ROOT / 'data' / 'twin-ercot-load.json').write_text(json.dumps(out, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    peak = max((mw, k, i + 1) for k, v in days.items() for i, mw in enumerate(v))
    print('days', len(days), 'hours', n, 'clock change days', odd, 'peak', peak)


if __name__ == '__main__':
    main()
