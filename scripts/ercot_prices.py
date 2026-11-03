"""Typed ERCOT annual-file loader. No credentials, interpolation or synthetic prices."""
from __future__ import annotations

import calendar
import hashlib
import io
import json
import math
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, TypedDict
from zoneinfo import ZoneInfo

import openpyxl
import requests

CENTRAL = ZoneInfo('America/Chicago')
POINTS = {
    **{f'HB_{name}': 'HU' for name in ['HOUSTON', 'NORTH', 'PAN', 'SOUTH', 'WEST']},
    'HB_BUSAVG': 'SH', 'HB_HUBAVG': 'AH',
    **{f'LZ_{name}': 'LZ' for name in ['AEN', 'CPS', 'HOUSTON', 'LCRA', 'NORTH', 'RAYBN', 'SOUTH', 'WEST']},
}
PriceRow = tuple[str, int, Literal['N', 'Y'], float, float]


class PointSeries(TypedDict):
    kind: Literal['hub', 'hub-average', 'load-zone']
    settlementType: str
    rows: list[PriceRow]
    spikeIntervalsByHour: list[int]
    spikeThresholdPerMWh: float
    rtIntervals: int


class Period(TypedDict):
    start: str
    endExclusive: str
    asOf: str
    timezone: str
    expectedHours: int
    description: str


class Source(TypedDict):
    id: str
    url: str
    retrievedAt: str
    sha256: str
    bytes: int


class PriceDataset(TypedDict):
    schemaVersion: int
    period: Period
    columns: list[str]
    zones: dict[str, PointSeries]  # Retains the existing page's key; includes hubs.
    sources: list[Source]


def window(as_of: date) -> tuple[date, date]:
    """The last twelve COMPLETE Central calendar months, end exclusive."""
    end = as_of.replace(day=1)
    return end.replace(year=end.year - 1), end


def expected_hours(start: date, end: date) -> set[tuple[str, int, str]]:
    current = datetime.combine(start, datetime.min.time(), CENTRAL).astimezone(timezone.utc)
    stop = datetime.combine(end, datetime.min.time(), CENTRAL).astimezone(timezone.utc)
    result = set()
    while current < stop:
        local = current.astimezone(CENTRAL)
        result.add((local.date().isoformat(), local.hour + 1, 'Y' if local.fold else 'N'))
        current += timedelta(hours=1)
    return result


class PublicCache:
    def __init__(self, folder: Path, offline: bool = False):
        self.folder, self.offline, self.sources = folder, offline, []

    def get(self, name: str, url: str, refresh: bool = False) -> bytes:
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self.folder / name
        meta = path.with_suffix(path.suffix + '.meta.json')
        if refresh or not path.exists():
            if self.offline:
                raise ValueError(f'Offline cache miss: {name}')
            response = requests.get(url, timeout=90)
            response.raise_for_status()
            content = response.content
            # Do not replace a good cache with an error document returned as HTTP 200.
            if name.endswith('.zip'):
                if not zipfile.is_zipfile(io.BytesIO(content)):
                    raise ValueError(f'Expected ZIP, received another format: {name}')
            else:
                json.loads(content)
            record = dict(url=url, retrievedAt=datetime.now(timezone.utc).isoformat(),
                          sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))
            temporary = path.with_suffix(path.suffix + '.tmp')
            temporary.write_bytes(content)
            temporary.replace(path)
            meta.write_text(json.dumps(record, indent=2), encoding='utf-8')
        record = json.loads(meta.read_text(encoding='utf-8'))
        content = path.read_bytes()
        if record['url'] != url or hashlib.sha256(content).hexdigest() != record['sha256']:
            raise ValueError(f'Cache provenance/hash mismatch: {name}')
        self.sources.append(dict(id=name, **record))
        return content


def collect_sheet(rows, market, target, points, start, end):
    """Validate schema and ingest one worksheet, keeping LZEW out of LZ series."""
    columns = {str(value).strip(): i for i, value in enumerate(next(rows))}
    point_col = 'Settlement Point' if market == 'dam' else 'Settlement Point Name'
    hour_col = 'Hour Ending' if market == 'dam' else 'Delivery Hour'
    required = ['Delivery Date', hour_col, 'Repeated Hour Flag', point_col, 'Settlement Point Price']
    if market == 'rtm':
        required += ['Delivery Interval', 'Settlement Point Type']
    if any(name not in columns for name in required):
        raise ValueError(f'Unexpected {market} columns: {list(columns)}')
    for row in rows:
        point = row[columns[point_col]]
        if point not in points:
            continue
        if market == 'rtm' and row[columns['Settlement Point Type']] != POINTS[point]:
            continue
        raw_date = row[columns['Delivery Date']]
        delivery = raw_date.date() if isinstance(raw_date, datetime) else datetime.strptime(str(raw_date), '%m/%d/%Y').date()
        if not start <= delivery < end:
            continue
        hour = int(str(row[columns[hour_col]]).split(':')[0])
        flag = row[columns['Repeated Hour Flag']]
        if flag not in ('N', 'Y') or not 1 <= hour <= 24:
            raise ValueError(f'Invalid interval at {point}/{delivery}')
        key = (delivery.isoformat(), hour, flag)
        value = float(row[columns['Settlement Point Price']])
        if not math.isfinite(value):
            raise ValueError(f'Nonfinite price: {point}/{key}')
        series = target[point]
        if market == 'dam':
            if key in series:
                raise ValueError(f'Duplicate DAM: {point}/{key}')
            series[key] = value
        else:
            interval = int(row[columns['Delivery Interval']])
            series.setdefault(key, {})
            if interval not in (1, 2, 3, 4) or interval in series[key]:
                raise ValueError(f'Invalid/duplicate RTM interval: {point}/{key}/{interval}')
            series[key][interval] = value


def normalize(point, dam, rtm, expected) -> PointSeries:
    if set(dam) != expected or set(rtm) != expected:
        raise ValueError(f'Incomplete physical-hour coverage: {point}; expected {len(expected)}, DAM {len(dam)}, RTM {len(rtm)}')
    rows, spikes = [], [0] * 24
    for key in sorted(expected):
        intervals = rtm[key]
        if set(intervals) != {1, 2, 3, 4}:
            raise ValueError(f'Incomplete RTM hour: {point}/{key}')
        rows.append((*key, dam[key], sum(intervals.values()) / 4))
        spikes[key[1] - 1] += sum(value >= 100 for value in intervals.values())
    kind = 'load-zone' if point.startswith('LZ_') else 'hub' if POINTS[point] == 'HU' else 'hub-average'
    return dict(kind=kind, settlementType=POINTS[point], rows=rows, spikeIntervalsByHour=spikes,
                spikeThresholdPerMWh=100, rtIntervals=len(rows) * 4)


def load_prices(cache: PublicCache, as_of: date, points: list[str] | None = None, refresh: bool = False) -> PriceDataset:
    points = sorted(POINTS if points is None else points)
    if not points or len(set(points)) != len(points) or any(p not in POINTS for p in points):
        raise ValueError('Use unique published hub/load-zone names from POINTS.')
    start, end = window(as_of)
    prices = {market: {point: {} for point in points} for market in ['dam', 'rtm']}
    for market, report in [('dam', 13060), ('rtm', 13061)]:
        listing = json.loads(cache.get(f'{market}-listing.json',
            f'https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId={report}', refresh))
        for year in range(start.year, (end - timedelta(days=1)).year + 1):
            matches = [item['Document'] for item in listing['ListDocsByRptTypeRes']['DocumentList']
                       if item['Document']['FriendlyName'].endswith(str(year))]
            if len(matches) != 1:
                raise ValueError(f'Expected one {market}/{year} archive, got {len(matches)}')
            doc = matches[0]
            blob = cache.get(f'{market}-{year}-{doc["DocID"]}-download.zip',
                f'https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc["DocID"]}', refresh)
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                for name in archive.namelist():
                    if not name.lower().endswith('.xlsx'):
                        continue
                    book = openpyxl.load_workbook(io.BytesIO(archive.read(name)), read_only=True, data_only=True)
                    try:
                        for sheet in book.worksheets:
                            # Known annual workbooks have month tabs; other tab names still get date-filtered.
                            if sheet.title in calendar.month_abbr:
                                month = list(calendar.month_abbr).index(sheet.title)
                                if not month or not start <= date(year, month, 1) < end:
                                    continue
                            print(f'Reading {market} {year} {sheet.title}', flush=True)
                            collect_sheet(iter(sheet.iter_rows(values_only=True)), market, prices[market], points, start, end)
                    finally:
                        book.close()
    expected = expected_hours(start, end)
    return dict(schemaVersion=2, period=dict(start=start.isoformat(), endExclusive=end.isoformat(),
        asOf=as_of.isoformat(), timezone='America/Chicago', expectedHours=len(expected),
        description='Latest twelve complete calendar months; current partial month excluded'),
        columns=['date', 'hourEnding', 'repeated', 'dam', 'rtm'],
        zones={point: normalize(point, prices['dam'][point], prices['rtm'][point], expected) for point in points},
        sources=list(cache.sources))
