import json
import unittest
from pathlib import Path

from analysis.score import composite, percentile_ranks

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "expansion-score-cases.json").read_text())


class PercentileTests(unittest.TestCase):
    def test_shared_cases(self):
        for case in CASES["percentiles"]:
            got = percentile_ranks(case["values"])
            self.assertEqual(len(got), len(case["ranks"]))
            for a, b in zip(got, case["ranks"]):
                if b is None:
                    self.assertIsNone(a)
                else:
                    self.assertAlmostEqual(a, b, places=6)

    def test_missing_factor_is_not_zero(self):
        rows = [
            {"homes": 1.0, "saidi": None},
            {"homes": 0.0, "saidi": 1.0},
        ]
        # homes-only: first row wins. Treating the missing SAIDI as 0 would tie them at 0.5.
        scores = composite(rows, {"homes": 1, "saidi": 1})
        self.assertAlmostEqual(scores[0], 1.0)
        self.assertAlmostEqual(scores[1], 0.5)

    def test_zero_weight_is_ignored(self):
        rows = [{"homes": 0.0, "saidi": 1.0}]
        self.assertAlmostEqual(composite(rows, {"homes": 0, "saidi": 2})[0], 1.0)

    def test_empty_weights_score_nothing(self):
        self.assertIsNone(composite([{"homes": 1.0}], {"homes": 0})[0])


if __name__ == "__main__":
    unittest.main()
