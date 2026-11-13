"""One-off: turn "Grid prices" in the shared header into a "Grid" list (How power flows, Live prices), on every
page, and register the new /grid page. Run once from the repo root. index.html holds the master header."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design', 'vendor', 'demo'}
MARK = re.compile(r'<!--mw-header-->.*?<!--/mw-header-->', re.S)
CHEVRON = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M5 6 0 1l.7-.7L5 4.6 9.3.3l.7.7z"/></svg>'

index = (ROOT / 'index.html').read_text(encoding='utf-8')
old = MARK.search(index).group(0)
a = '<li><a href="/live">Grid prices</a></li>'
assert a in old and 'href="/grid"' not in old
new = old.replace(a, '<li><button type="button" aria-expanded="false">Grid' + CHEVRON + '</button><ul class="sub"><li><a href="/grid">How power flows</a></li><li><a href="/live">Live prices</a></li></ul></li>', 1)

n = 0
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    if old in s:
        f.write_text(s.replace(old, new, 1), encoding='utf-8', newline='\n'); n += 1
    elif rel.as_posix() == 'grid.html':
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


patch('scripts/serve.py', [('{"/ops", "/generation",', '{"/ops", "/grid", "/generation",')])
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/generation</loc></url>\n', '  <url><loc>https://megawatt.fun/generation</loc></url>\n  <url><loc>https://megawatt.fun/grid</loc></url>\n')])
patch('llms.txt', [('- [PJM, the next market](https://megawatt.fun/pjm):', "- [How power moves through Texas](https://megawatt.fun/grid): A year of ERCOT electricity followed from the plants that made it to the eight regions that used it, the busiest hour the grid is built for, and what each source earned at the hub price. Data: https://megawatt.fun/data/grid-ercot.json.\n- [PJM, the next market](https://megawatt.fun/pjm):")])
patch('scripts/package-site.py', [('"generation.html", "generation.css",', '"grid.html", "grid.css", "grid.js", "grid-core.js", "data/grid-ercot.json", "generation.html", "generation.css",')])
patch('generation.html', [('    <p class="more"><a class="cds--link" href="/">See what one home battery does with the same prices</a></p>',
                           '    <p class="more"><a class="cds--link" href="/grid">Follow this power to where it goes</a></p>\n    <p class="more"><a class="cds--link" href="/">See what one home battery does with the same prices</a></p>')])
print('ok')
