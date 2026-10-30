"""Refresh public ERCOT hub/load-zone evidence, preserving the static page contract."""
import argparse
import csv
import hashlib
import json
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode
from ercot_prices import CENTRAL, POINTS, PublicCache, load_prices

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--as-of', type=date.fromisoformat, default=datetime.now(CENTRAL).date(), help='Select latest twelve complete months relative to this date')
    parser.add_argument('--fetch', action='store_true', help='Refresh listings AND archive bytes, including corrected prices')
    parser.add_argument('--offline', action='store_true', help='Require cached inputs; never access the network')
    parser.add_argument('--points', nargs='+', choices=sorted(POINTS), help='Default: all 15 published hubs, averages and load zones')
    args = parser.parse_args()
    if args.fetch and args.offline:
        parser.error('--fetch and --offline cannot be combined')
    cache = PublicCache(ROOT / '.cache/deployment', args.offline)
    dataset = load_prices(cache, args.as_of, args.points, args.fetch)
    url = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer/13/query?' + urlencode(
        dict(where="STATE='48'", outFields='GEOID,NAME', outSR=4326, f='geojson', geometryPrecision=3))
    geometry = json.loads(cache.get('texas-counties.geojson', url))
    if len(geometry.get('features', [])) != 254:
        raise ValueError('Expected all 254 Texas counties')
    dataset['sources'] = cache.sources
    out = ROOT / 'data/deployment'
    out.mkdir(parents=True, exist_ok=True)
    # Validate the entire dataset before touching public outputs.
    for point, series in dataset['zones'].items():
        with (out / f'{point}.csv').open('w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file); writer.writerow(dataset['columns']); writer.writerows(series['rows'])
    (out / 'texas-counties.geojson').write_text(json.dumps(geometry, separators=(',', ':')), encoding='utf-8')
    (out / 'prices.json').write_text(json.dumps(dataset, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    outputs = ['prices.json', 'sites.json', 'texas-counties.geojson', *[f'{p}.csv' for p in dataset['zones']]]
    (out / 'manifest.json').write_text(json.dumps(dict(period=dataset['period'], sources=cache.sources,
        method='RTM is the mean of four complete 15-minute intervals. DAM matched by date, hour ending and DST repeated-hour flag. Full physical-hour coverage required; no imputation. LZEW excluded; HU/SH/AH preserved separately.',
        outputs={name: hashlib.sha256((out / name).read_bytes()).hexdigest() for name in outputs}), indent=2), encoding='utf-8')
    print(f'Validated {len(dataset["zones"])} points x {dataset["period"]["expectedHours"]} physical hours. Saved data/deployment.')


if __name__ == '__main__':
    main()
