"""One-off: turn "Data centers" in the shared header into a list (What a data center pays, Texas siting), on every
page, and register the new /data-centers page. Run once from the repo root. index.html holds the master header."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design', 'vendor', 'demo'}
MARK = re.compile(r'<!--mw-header-->.*?<!--/mw-header-->', re.S)
CHEVRON = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M5 6 0 1l.7-.7L5 4.6 9.3.3l.7.7z"/></svg>'

index = (ROOT / 'index.html').read_text(encoding='utf-8')
old = MARK.search(index).group(0)
a = '<li><a href="/#data-center">Data centers</a></li>'
assert a in old and 'href="/data-centers"' not in old
new = old.replace(a, '<li><button type="button" aria-expanded="false">Data centers' + CHEVRON + '</button><ul class="sub"><li><a href="/data-centers">What a data center pays</a></li><li><a href="/siting">Texas siting and the queue</a></li></ul></li>', 1)

n = 0
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    if old in s:
        f.write_text(s.replace(old, new, 1), encoding='utf-8', newline='\n'); n += 1
    elif rel.as_posix() == 'data-centers.html':
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


patch('scripts/serve.py', [('{"/ops", "/grid",', '{"/ops", "/data-centers", "/grid",')])
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/grid</loc></url>\n', '  <url><loc>https://megawatt.fun/grid</loc></url>\n  <url><loc>https://megawatt.fun/data-centers</loc></url>\n')])
patch('llms.txt', [('- [PJM, the next market](https://megawatt.fun/pjm):', "- [What a data center pays for power in Texas](https://megawatt.fun/data-centers): A year's power bill for a large load by ERCOT load zone: energy at real-time prices, the transmission charge set by four summer peak hours (Oncor's published rate as the example), what flexibility saves, the 2026 peak hours, and ERCOT's large-load queue. Data: https://megawatt.fun/data/datacenter-ercot.json.\n- [PJM, the next market](https://megawatt.fun/pjm):")])
patch('scripts/package-site.py', [('"grid.html", "grid.css",', '"data-centers.html", "largeload.css", "largeload.js", "largeload-core.js", "data/datacenter-ercot.json", "grid.html", "grid.css",')])
patch('index.html', [('      <p class="src" id="load-src"></p>\n', '      <p class="src" id="load-src"></p>\n      <p class="more"><a class="cds--link" href="/data-centers">The full data center page: the four peak hours and what flexibility saves</a></p>\n')])
print('ok')
