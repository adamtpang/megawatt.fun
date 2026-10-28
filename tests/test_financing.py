import json
import unittest
from pathlib import Path

from analysis.build_financing import dispatch_revenue

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data" / "financing.json").read_text())


class DispatchTests(unittest.TestCase):
    def test_a_spike_before_the_cheap_hours_is_captured(self):
        # 2 kWh, 1 kW, perfect efficiency. Sell 2 kWh at $100/MWh, recharge at $0.
        revenue = dispatch_revenue([100, 100, 0, 0], 2, 1, 1.0, 0.0, step=1)
        self.assertAlmostEqual(revenue, 0.2, places=6)

    def test_a_flat_day_earns_nothing(self):
        self.assertAlmostEqual(dispatch_revenue([10, 10, 10, 10], 2, 1, 1.0, 0.0, step=1), 0.0, places=6)

    def test_houston_distribution_includes_the_extreme_years(self):
        block = DATA["zones"]["LZ_HOUSTON"]
        years = {item["year"]: item["revenue_usd"] for item in block["years"]}
        self.assertEqual(sorted(years), [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025])
        self.assertEqual(block["worst_year"], 2020)
        self.assertAlmostEqual(block["worst_usd"], 463.57, places=2)
        self.assertAlmostEqual(block["p50_usd"], 1101.77, places=2)
        self.assertAlmostEqual(block["p90_exceedance_usd"], 566.27, places=2)
        self.assertEqual(block["best_year"], 2023)
        self.assertGreater(years[2021], years[2020])
        self.assertGreater(years[2023], years[2021])

    def test_routes_and_independence(self):
        html = (ROOT / "notes" / "financing-a-home-battery.html").read_text()
        self.assertEqual(html.count("<h1"), 1)
        self.assertIn("Independent analysis, not affiliated with Base Power", html)
        self.assertIn("What I couldn't see", html)
        self.assertIn("/notes/financing-a-home-battery", (ROOT / "scripts" / "serve.py").read_text())
        self.assertIn("https://megawatt.fun/notes/financing-a-home-battery", (ROOT / "sitemap.xml").read_text())
        self.assertIn("https://megawatt.fun/notes/financing-a-home-battery", (ROOT / "llms.txt").read_text())


if __name__ == "__main__":
    unittest.main()
