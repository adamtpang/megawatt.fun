"""One-off: add "The twin" (/twin) to the shared header on every page, and register the new page.
Run once from the repo root. index.html holds the master header."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design', 'vendor', 'demo'}
MARK = re.compile(r'<!--mw-header-->.*?<!--/mw-header-->', re.S)

index = (ROOT / 'index.html').read_text(encoding='utf-8')
old = MARK.search(index).group(0)
a = '<nav class="mw-nav" id="mw-nav" aria-label="Main navigation"><ul><li><a href="/generation">Power supply</a></li>'
assert a in old and 'href="/twin"' not in old
new = old.replace(a, '<nav class="mw-nav" id="mw-nav" aria-label="Main navigation"><ul><li><a href="/twin">The twin</a></li><li><a href="/generation">Power supply</a></li>', 1)

n = 0
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    if old in s:
        f.write_text(s.replace(old, new, 1), encoding='utf-8', newline='\n'); n += 1
    elif rel.as_posix() == 'twin.html':
        assert '<!--mw-header-->\n' in s
        f.write_text(s.replace('<!--mw-header-->\n', new + '\n', 1), encoding='utf-8', newline='\n'); n += 1
print(n, 'pages')


def patch(name, pairs):
    p = ROOT / name
    s = p.read_text(encoding='utf-8')
    for x, y in pairs:
        assert x in s, name + ': ' + x[:60]
        s = s.replace(x, y, 1)
    p.write_text(s, encoding='utf-8', newline='\n')


patch('scripts/serve.py', [('{"/ops", "/data-centers",', '{"/ops", "/twin", "/data-centers",')])
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/generation</loc></url>\n', '  <url><loc>https://megawatt.fun/twin</loc></url>\n  <url><loc>https://megawatt.fun/generation</loc></url>\n')])
patch('llms.txt', [('- [PJM, the next market](https://megawatt.fun/pjm):', "- [The twin](https://megawatt.fun/twin): An hour-by-hour simulation of one real year on the Texas grid. Run a home battery or a data center with a battery through 8,760 hours of real ERCOT prices and demand, change the rule it follows, replay any day, cut the power, and run a ramp test to see where it breaks. Engine: https://megawatt.fun/twin-core.js.\n- [PJM, the next market](https://megawatt.fun/pjm):")])
patch('scripts/package-site.py', [('"data-centers.html", "largeload.css",', '"twin.html", "twin.css", "twin.js", "twin-core.js", "data/twin-ercot-load.json", "data-centers.html", "largeload.css",')])
patch('index.html', [('<div class="foot-links"><a href="/generation">Power supply</a>', '<div class="foot-links"><a href="/twin">The twin</a><a href="/generation">Power supply</a>')])
patch('data-centers.html', [('    <p class="src" id="ll-src"></p>\n', '    <p class="src" id="ll-src"></p>\n    <p class="more"><a class="cds--link" href="/twin#data-center">Run this site through the real year in the twin, with a battery and a rule</a></p>\n')])
print('ok')
