import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data" / "congestion.json").read_text())
HTML = (ROOT / "notes" / "where-batteries-earn-most.html").read_text()


def words(section_id):
    chunk = HTML.split(f'id="{section_id}"', 1)[1].split("</section>", 1)[0]
    text = re.sub(r"<[^>]+>", " ", chunk)
    return re.findall(r"[A-Za-z0-9$][A-Za-z0-9'’.$,%/_-]*", text)


class CongestionDataTests(unittest.TestCase):
    def test_window_and_rank_are_the_public_snapshot(self):
        self.assertEqual(DATA["window"]["start"], "2026-09-27")
        self.assertEqual(DATA["window"]["end"], "2026-10-28")
        self.assertEqual(DATA["window"]["days"], 32)
        self.assertEqual(DATA["window"]["missing_dates"], [])
        self.assertFalse(DATA["method"]["interpolated"])
        self.assertEqual(DATA["method"]["zones"], ["LZ_HOUSTON", "LZ_NORTH", "LZ_SOUTH"])
        top = DATA["nodes"][0]
        self.assertEqual(top["name"], "RHESS2_ESS1")
        self.assertEqual(top["zone"], "LZ_SOUTH")
        self.assertEqual(top["substation"], "GEORSO")
        self.assertEqual(top["hours"], 768)
        self.assertEqual(top["p95"], 64.31)
        self.assertEqual(top["mean"], 10.62)
        self.assertEqual(top["scarcity"], 73)
        self.assertEqual(top["shadow_rows"], 0)
        self.assertNotIn("lat", top)

    def test_zones_and_block_hours(self):
        zones = {node["zone"] for node in DATA["nodes"]}
        self.assertEqual(zones, {"LZ_HOUSTON", "LZ_NORTH", "LZ_SOUTH"})
        top = DATA["nodes"][0]
        self.assertEqual(sum(block["hours"] for block in top["blocks"].values()), top["hours"])
        houston = next(node for node in DATA["nodes"] if node["zone"] == "LZ_HOUSTON")
        self.assertEqual(houston["name"], "CR_RN")
        self.assertEqual(houston["p95"], 43.73)
        pavlov = next(node for node in DATA["nodes"] if node["name"] == "PAVLOV_RN")
        self.assertEqual(pavlov["shadow_rows"], 469)
        self.assertIn("BLESSI_PAVLOV1_1", pavlov["shadow_names"])
        west = next(zone for zone in DATA["context_zones"] if zone["name"] == "LZ_WEST")
        self.assertEqual(west["top"]["name"], "KNAPP_RN")
        self.assertGreater(west["top"]["p95"], 100)
        self.assertIsNone(DATA["watched_constraint"])
        self.assertEqual(DATA["constraints"][0]["name"], "6437__F")
        self.assertFalse(DATA["map"]["drawn"])

    def test_page_carries_the_same_numbers(self):
        self.assertIn("Independent analysis, not affiliated with Base Power", HTML)
        self.assertEqual(HTML.count("<h1>"), 1)
        self.assertIn("RHESS2_ESS1", HTML)
        self.assertIn("$64.31", HTML)
        self.assertIn("5127", HTML)
        self.assertIn("$196.68", HTML)
        prose = sum(len(words(section)) for section in ("question", "why", "method", "findings", "limits", "next"))
        self.assertGreaterEqual(prose, 800)
        self.assertLessEqual(prose, 1200)

    def test_routes_are_published(self):
        self.assertIn("/notes/where-batteries-earn-most", (ROOT / "scripts" / "serve.py").read_text())
        self.assertIn("https://megawatt.fun/notes/where-batteries-earn-most", (ROOT / "sitemap.xml").read_text())
        self.assertIn("https://megawatt.fun/notes/where-batteries-earn-most", (ROOT / "llms.txt").read_text())
        home = (ROOT / "index.html").read_text()
        self.assertIn('href="/notes">Notes</a>', home)
        self.assertIn('href="/live">Live</a>', home)

    def test_quantile_matches_the_builder(self):
        from analysis.build_congestion import block_of, quantile

        self.assertEqual(block_of(1), "night")
        self.assertEqual(block_of(6), "night")
        self.assertEqual(block_of(7), "morning")
        self.assertEqual(block_of(24), "evening")
        self.assertAlmostEqual(quantile([1, 2, 3, 4], 0.95), 3.85)


if __name__ == "__main__":
    unittest.main()
