"""One-off: put the US market map back in the main navigation, after PJM. Run once from the repo root."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel'}
done = []
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    m = re.search(r'<header class="site-top">.*?</header>', s, flags=re.S)
    if not m or 'href="/market"' in m.group(0) or not re.search(r'<a href="/"[^>]*>PJM</a>', m.group(0)):
        continue
    cur = ' aria-current="page"' if rel.as_posix() == 'market.html' else ''
    h = re.sub(r'(<a href="/"[^>]*>PJM</a>)', r'\1<a href="/market"' + cur + '>US map</a>', m.group(0), count=1)
    f.write_text(s.replace(m.group(0), h, 1), encoding='utf-8')
    done.append(rel.as_posix())
print(len(done), 'headers:', ' '.join(sorted(done)))


def patch(name, pairs):
    p = ROOT / name
    s = p.read_text(encoding='utf-8')
    for a, b in pairs:
        assert a in s, name + ': ' + a[:70]
        s = s.replace(a, b, 1)
    p.write_text(s, encoding='utf-8')


# The map's own tool strip still listed the shelved tools.
s = (ROOT / 'market.html').read_text(encoding='utf-8')
s = re.sub(r'<nav class="gift-set".*?</nav>',
           '<nav class="gift-set" aria-label="Home battery company tools"><span>For a home-battery company</span><a href="/">PJM, the next market</a><a href="/market" aria-current="page">US market map</a><a href="/battery">The same battery in Texas</a></nav>',
           s, count=1, flags=re.S)
(ROOT / 'market.html').write_text(s, encoding='utf-8')
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/battery</loc></url>\n', '  <url><loc>https://megawatt.fun/market</loc></url>\n  <url><loc>https://megawatt.fun/battery</loc></url>\n')])
patch('llms.txt', [('- [Texas home battery ROI]', "- [US market map](https://megawatt.fun/market): Every US state scored for a home-battery program on public Census, EIA and FEMA data, with a retail path and a utility-partner path, and what one battery earns in each Texas load zone.\n- [Texas home battery ROI]")])
# Homepage: point from the PJM ranking to the national map.
patch('index.html', [('Below is one battery’s yearly value in each of its 20 utility areas.</p>',
                      'Below is one battery’s yearly value in each of its 20 utility areas. For all 50 states, see the <a href="/market">US market map</a>.</p>')])
print('ok')
