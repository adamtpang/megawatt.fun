import json
import unittest
from pathlib import Path

DATA = json.loads((Path(__file__).resolve().parents[1] / "data" / "expansion-map.json").read_text())


def state(abbr):
    return next(item for item in DATA["states"] if item["id"] == abbr)


class ExpansionDataTests(unittest.TestCase):
    def test_census_and_eia_anchors(self):
        # B25032 owner-occupied one-unit detached 6,091,247 plus attached 172,350.
        self.assertEqual(state("TX")["values"]["homes"], 6263597)
        # EIA-861 2025 state total, any method, with major events.
        self.assertAlmostEqual(state("AK")["values"]["saidi"], 540.9, places=1)

    def test_market_structure_is_not_a_checkbox(self):
        self.assertGreater(state("TX")["values"]["retail"], 0.5)
        self.assertEqual(state("GA")["values"]["wholesale"], 0)
        self.assertIn("Southern", state("GA")["detail"]["top_ba"])
        self.assertEqual(state("CT")["values"]["wholesale"], 1)
        self.assertIn("PJM", state("IL")["detail"]["rtos"])
        self.assertIn("MISO", state("IL")["detail"]["rtos"])

    def test_coverage_and_ercot_window(self):
        self.assertEqual(len(DATA["states"]), 51)
        self.assertEqual(len(DATA["map"]), 51)
        self.assertTrue(DATA["ercot"]["available"])
        self.assertGreaterEqual(DATA["ercot"]["window"]["days"], 14)
        self.assertEqual(DATA["ercot"]["nodes"][0]["name"], "KNAPP_RN")
        self.assertGreater(DATA["ercot"]["nodes"][0]["p95_basis"], 50)

    def test_omitted_factors_are_named(self):
        titles = {item["title"] for item in DATA["omitted"]}
        self.assertIn("Permitting speed", titles)
        self.assertIn("Price volatility outside ERCOT", titles)
        joined = json.dumps(DATA["factors"])
        self.assertNotIn("volatility", joined)

    def test_footprints_are_labeled(self):
        self.assertEqual(state("TX")["footprint"]["status"], "operating")
        self.assertEqual(state("IL")["footprint"]["status"], "operating")
        self.assertEqual(state("GA")["footprint"]["status"], "announced")
        self.assertEqual(state("CT")["footprint"]["status"], "hiring")


if __name__ == "__main__":
    unittest.main()
