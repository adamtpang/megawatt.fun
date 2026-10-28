import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def gigawatts(dk, tw=20.120343123861566):
    return tw * (10 ** (10 * dk) - 1) * 1000


class KardashevStackTest(unittest.TestCase):
    def test_one_thousandth_is_469_gw(self):
        self.assertEqual(round(gigawatts(0.001)), 469)

    def test_page_states_the_scale_and_the_independence_line(self):
        html = (ROOT / "notes" / "kardashev-stack.html").read_text()
        self.assertEqual(html.count("<h1"), 1)
        self.assertIn("Independent analysis, not affiliated with Base Power", html)
        self.assertIn("469 GW", html)
        self.assertIn("make it (generation)", html)
        self.assertIn("https://www.notboring.co/p/base-power-company-chapter-3", html)
        self.assertIn('href="/notes/where-batteries-earn-most"', html)

    def test_routes(self):
        self.assertIn("/notes/kardashev-stack", (ROOT / "scripts" / "serve.py").read_text())
        self.assertIn("https://megawatt.fun/notes/kardashev-stack", (ROOT / "sitemap.xml").read_text())
        self.assertIn("https://megawatt.fun/notes/kardashev-stack", (ROOT / "llms.txt").read_text())
        home = (ROOT / "index.html").read_text()
        self.assertIn('href="/notes/kardashev-stack"', home)
        self.assertIn('href="/notes">Notes', home)


if __name__ == "__main__":
    unittest.main()
