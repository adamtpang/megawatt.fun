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

    def test_launch_path_is_a_sourced_legal_flag(self):
        # Open residential retail choice by state law, not a delivery-share cut.
        for abbr in ("TX", "OH", "IL", "PA", "MD", "NY", "NJ", "MA", "CT", "DC"):
            self.assertEqual(state(abbr)["values"]["launch_path"], 1, abbr)
            choice = state(abbr)["detail"]["retail_choice"]
            self.assertTrue(choice["open"], abbr)
            self.assertTrue(choice["url"].startswith("https://"), abbr)
            self.assertEqual(choice["checked"], "2026-11-04")
        # Capped or closed for homes: California (Direct Access, CCAs) and Michigan (10% cap).
        for abbr in ("CA", "MI", "VA", "OR", "GA", "CO"):
            self.assertEqual(state(abbr)["values"]["launch_path"], 0, abbr)
            self.assertFalse(state(abbr)["detail"]["retail_choice"]["open"], abbr)
        self.assertGreater(state("CA")["values"]["retail"], 0.30)  # a share cut would have scored it 1
        self.assertIn("cpuc.ca.gov", state("CA")["detail"]["retail_choice"]["url"])
        self.assertEqual(sum(1 for s in DATA["states"] if s["values"]["launch_path"] == 1), 14)
        self.assertNotIn("30%", next(f for f in DATA["factors"] if f["id"] == "launch_path")["help"])
        # Utility rows: co-ops and city utilities in a choice state, with no delivery customers, stay 0.
        comed = next(u for u in DATA["utilities"] if u["id"] == "4110-IL")
        self.assertEqual(comed["values"]["launch_path"], 1)
        coserv = next(u for u in DATA["utilities"] if u["id"] == "5078-TX")
        self.assertEqual(coserv["values"]["launch_path"], 0)

    def test_footprints_are_labeled(self):
        self.assertEqual(state("TX")["footprint"]["status"], "operating")
        self.assertEqual(state("IL")["footprint"]["status"], "operating")
        self.assertEqual(state("GA")["footprint"]["status"], "announced")
        for abbr in ("CO", "CT"):
            mark = state(abbr)["footprint"]
            self.assertEqual(mark["status"], "equipment")
            self.assertEqual(mark["label"], "Equipment and installation")
            self.assertIn("Base offers home battery equipment and installation", mark["detail"])
            self.assertEqual(mark["source"]["url"], "https://www.basepowercompany.com/")
            self.assertNotIn("ashbyhq", json.dumps(mark))  # no job post behind a mark

    def test_ercot_section_is_congestion_context(self):
        self.assertIn("not what a home battery earns", DATA["ercot"]["summary"])
        self.assertTrue(any(p.startswith("Grid-congestion context, not battery value") for p in DATA["narrative"]))


if __name__ == "__main__":
    unittest.main()
