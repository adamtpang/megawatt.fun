"""Offline tests at the upstream-file and cache boundary; no network calls."""
import io
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ercot_prices import PublicCache, collect_sheet, expected_hours, normalize, window


class PricesTest(unittest.TestCase):
    def test_complete_month_window_and_dst(self):
        self.assertEqual(window(date(2026, 10, 19)), (date(2025, 10, 1), date(2026, 10, 1)))
        self.assertEqual(window(date(2026, 1, 1)), (date(2025, 1, 1), date(2026, 1, 1)))
        keys = expected_hours(date(2025, 10, 1), date(2026, 10, 1))
        self.assertEqual(len(keys), 8760)
        self.assertIn(('2025-11-02', 2, 'Y'), keys)
        self.assertNotIn(('2026-03-08', 3, 'N'), keys)
        self.assertEqual(len(expected_hours(date(2023, 10, 1), date(2024, 10, 1))), 8784)

    def parse(self, rows, market='rtm'):
        target = {'LZ_HOUSTON': {}, 'HB_HOUSTON': {}, 'HB_BUSAVG': {}, 'HB_HUBAVG': {}}
        collect_sheet(iter(rows), market, target, list(target), date(2026, 1, 1), date(2026, 2, 1))
        return target

    def rt(self, point='LZ_HOUSTON', kind='LZ', interval=1, price=10):
        return ['01/01/2026', 1, interval, 'N', point, kind, price]

    header = ['Delivery Date', 'Delivery Hour', 'Delivery Interval', 'Repeated Hour Flag', 'Settlement Point Name', 'Settlement Point Type', 'Settlement Point Price']

    def test_types_and_named_columns(self):
        rows = [self.header, self.rt(kind='LZEW', price=999), self.rt(), self.rt('HB_HOUSTON', 'HU'), self.rt('HB_BUSAVG', 'SH'), self.rt('HB_HUBAVG', 'AH')]
        target = self.parse([list(reversed(row)) for row in rows])
        self.assertTrue(all(len(series) == 1 for series in target.values()))
        self.assertEqual(target['LZ_HOUSTON'][('2026-01-01', 1, 'N')][1], 10)

    def test_duplicates_and_nonfinite_rejected(self):
        for rows in [[self.header, self.rt(), self.rt()], [self.header, self.rt(interval=5)], [self.header, self.rt(price=float('nan'))]]:
            with self.assertRaises(ValueError): self.parse(rows)
        header = ['Delivery Date', 'Hour Ending', 'Repeated Hour Flag', 'Settlement Point', 'Settlement Point Price']
        row = ['01/01/2026', '01:00', 'N', 'LZ_HOUSTON', 20]
        with self.assertRaisesRegex(ValueError, 'Duplicate DAM'): self.parse([header, row, row], 'dam')

    def test_complete_quarters_and_physical_keys(self):
        key = ('2026-01-01', 1, 'N')
        dam = {key: 50}; rtm = {key: {1: 0, 2: 100, 3: -10, 4: 30}}
        series = normalize('LZ_HOUSTON', dam, rtm, {key})
        self.assertEqual(series['rows'][0][4], 30)
        self.assertEqual(series['spikeIntervalsByHour'][0], 1)
        rtm[key].pop(4)
        with self.assertRaisesRegex(ValueError, 'Incomplete RTM'): normalize('LZ_HOUSTON', dam, rtm, {key})
        with self.assertRaisesRegex(ValueError, 'coverage'): normalize('LZ_HOUSTON', dam, rtm, {('2026-01-01', 2, 'N')})

    def test_cache_offline_hashes_refresh_and_error_document(self):
        def archive(text):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as z: z.writestr('fixture.txt', text)
            return buffer.getvalue()
        old, corrected = archive('old'), archive('correction')
        test_root = Path(__file__).resolve().parents[1] / '.cache/deployment'
        test_root.mkdir(parents=True, exist_ok=True)
        # TemporaryDirectory cleans up only its own generated child of this workspace.
        with tempfile.TemporaryDirectory(dir=test_root, prefix='test-cache-') as folder, patch('ercot_prices.requests.get') as get:
            self.assertEqual(Path(folder).resolve().parent, test_root.resolve())
            cache = PublicCache(Path(folder))
            get.return_value = Mock(content=old)
            self.assertEqual(cache.get('prices.zip', 'https://example.test'), old)
            self.assertEqual(PublicCache(Path(folder), offline=True).get('prices.zip', 'https://example.test'), old)
            get.assert_called_once()
            get.return_value = Mock(content=corrected)
            self.assertEqual(cache.get('prices.zip', 'https://example.test', refresh=True), corrected)
            get.return_value = Mock(content=b'<html>upstream error</html>')
            with self.assertRaisesRegex(ValueError, 'Expected ZIP'): cache.get('prices.zip', 'https://example.test', refresh=True)
            self.assertEqual(cache.get('prices.zip', 'https://example.test'), corrected)
            Path(folder, 'prices.zip').write_bytes(old)
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): cache.get('prices.zip', 'https://example.test')
            with self.assertRaisesRegex(ValueError, 'Offline cache miss'): PublicCache(Path(folder), True).get('missing.json', 'https://example.test')


if __name__ == '__main__':
    unittest.main()
