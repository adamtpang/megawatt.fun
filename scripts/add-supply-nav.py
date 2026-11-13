"""One-off: add "Power supply" (/generation) to the shared header on every page, and register the new page.
Run once from the repo root. The header is the block between the mw-header markers; index.html holds the master."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design', 'vendor', 'demo'}
MARK = re.compile(r'<!--mw-header-->.*?<!--/mw-header-->', re.S)

index = (ROOT / 'index.html').read_text(encoding='utf-8')
old = MARK.search(index).group(0)
a = '<nav class="mw-nav" id="mw-nav" aria-label="Main navigation"><ul><li><button type="button" aria-expanded="false">Homes'
assert a in old and '/generation' not in old
new = old.replace(a, '<nav class="mw-nav" id="mw-nav" aria-label="Main navigation"><ul><li><a href="/generation">Power supply</a></li><li><button type="button" aria-expanded="false">Homes', 1)

n = 0
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    if old in s:
        f.write_text(s.replace(old, new, 1), encoding='utf-8', newline='\n'); n += 1
    elif rel.as_posix() == 'generation.html':
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


patch('scripts/serve.py', [('{"/ops", "/pjm",', '{"/ops", "/generation", "/pjm",')])
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/pjm</loc></url>\n', '  <url><loc>https://megawatt.fun/generation</loc></url>\n  <url><loc>https://megawatt.fun/pjm</loc></url>\n')])
patch('llms.txt', [('- [PJM, the next market](https://megawatt.fun/pjm):', "- [Where Texas power comes from](https://megawatt.fun/generation): A year of ERCOT generation by source (natural gas, wind, solar, coal, nuclear, hydro), an average day hour by hour beside the hub price, the months of the year, and grid batteries. Data: https://megawatt.fun/data/supply-ercot.json.\n- [PJM, the next market](https://megawatt.fun/pjm):")])
patch('scripts/package-site.py', [('"pjm.html", "battery.html",', '"generation.html", "generation.css", "generation.js", "generation-core.js", "data/supply-ercot.json", "pjm.html", "battery.html",')])
patch('index.html', [('<div class="foot-links"><a href="/pjm">PJM ranking</a>', '<div class="foot-links"><a href="/generation">Power supply</a><a href="/pjm">PJM ranking</a>')])
print('ok')
