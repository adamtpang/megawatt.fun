"""Guard against misleading comparisons and stale generated public artifacts."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scorecard', ROOT / 'scripts/render-scorecard.py')
scorecard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorecard)


class ScorecardTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'data/progress-scorecard.json').read_text(encoding='utf-8'))

    def test_public_snapshot_is_valid(self):
        scorecard.validate(self.data)

    def test_wrong_computed_trend_is_rejected(self):
        metric = next(m for m in self.data['metrics'] if m['id'] == 'price')
        metric['change_label'] = '+2.0% versus 2024'
        with self.assertRaises(AssertionError):
            scorecard.validate(self.data)

    def test_narrative_trend_cannot_gain_a_fabricated_prior_value(self):
        metric = next(m for m in self.data['metrics'] if m['id'] == 'connections')
        metric['previous_value'] = 4
        with self.assertRaises(AssertionError):
            scorecard.validate(self.data)

    def test_unknown_values_cannot_turn_into_numeric_indicators(self):
        for value in [None, float('nan'), float('inf')]:
            changed = copy.deepcopy(self.data)
            changed['metrics'][0]['value'] = value
            with self.assertRaises(AssertionError):
                scorecard.validate(changed)

    def test_shipped_html_and_csv_match_reviewed_snapshot(self):
        html = (ROOT / 'roadmap.html').read_text(encoding='utf-8')
        self.assertIn(scorecard.render(self.data), html)
        self.assertEqual(scorecard.csv_text(self.data), (ROOT / 'data/progress-scorecard.csv').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
