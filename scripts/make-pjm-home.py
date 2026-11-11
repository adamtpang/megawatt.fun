"""One-off: make PJM the homepage. Run once from the repo root AFTER:
  git mv index.html battery.html && git mv pjm.html index.html
PJM is served at /, the Texas home-battery tool at /battery, and /pjm redirects to /."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel'}


def nav(page):
    cur = lambda p: ' aria-current="page"' if page == p else ''
    return (f'<nav aria-label="Main navigation"><a href="/"{cur("index")}>PJM</a><a href="/battery"{cur("battery")}>Texas battery</a>'
            f'<a href="/live"{cur("live")}>Live</a><a href="/notes"{cur("notes")}>Notes</a></nav>')


changed = []
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts):
        continue
    s = f.read_text(encoding='utf-8')
    o = s
    page = 'notes' if rel.as_posix() == 'notes/index.html' else f.stem
    # Only rewrite the current four-link header; pages with another nav are left alone.
    s = re.sub(r'<nav aria-label="Main navigation"><a href="/"[^>]*>Home battery</a><a href="/pjm"[^>]*>PJM</a><a href="/live"[^>]*>Live</a><a href="/notes"[^>]*>Notes</a></nav>',
               lambda m: nav(page), s, count=1)
    if s != o:
        f.write_text(s, encoding='utf-8')
        changed.append(rel.as_posix())
print(len(changed), 'headers:', ' '.join(sorted(changed)))


def patch(name, pairs):
    p = ROOT / name
    s = p.read_text(encoding='utf-8')
    for a, b in pairs:
        assert a in s, name + ': ' + a[:70]
        s = s.replace(a, b, 1)
    p.write_text(s, encoding='utf-8')


FOOT = ('<footer class="site-bottom"><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a>'
        '<a href="/live">Live</a><a href="/notes">Notes</a><a href="/notes/kardashev-stack">Make, move, store, sell</a><a href="/sources">Sources</a></div>'
        '<p>Independent. Not affiliated with Base Power.</p></footer>')
# New homepage (was pjm.html).
patch('index.html', [
    ('<link rel="canonical" href="https://megawatt.fun/pjm">', '<link rel="canonical" href="https://megawatt.fun/">'),
    ('<meta property="og:url" content="https://megawatt.fun/pjm">', '<meta property="og:url" content="https://megawatt.fun/">'),
    ('<title>PJM, the Next Market</title>', '<title>megawatt.fun: where a home battery pays in PJM</title>'),
    ('<a href="/">Home battery tool</a><a href="/market">Market map</a><a href="/pjm" aria-current="page">PJM, the next market</a>',
     '<a href="/" aria-current="page">PJM, the next market</a><a href="/battery">The same battery in Texas</a><a href="/market">US market map</a>'),
    ('<footer class="site-bottom"><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a></div><p>Independent. Not affiliated with Base Power.</p></footer>', FOOT),
])
# Texas home-battery tool (was index.html).
s = (ROOT / 'battery.html').read_text(encoding='utf-8')
s = s.replace('<link rel="canonical" href="https://megawatt.fun/">', '<link rel="canonical" href="https://megawatt.fun/battery">', 1)
s = re.sub(r'\n  <section class="result-card roi-next".*?</section>', '', s, count=1, flags=re.S)
(ROOT / 'battery.html').write_text(s, encoding='utf-8')

patch('api/v1/home.js', [("page: L.SITE + '/',", "page: L.SITE + '/battery',")])
patch('api/v1/pjm.js', [("docs: L.SITE + '/pjm',\n    page: L.SITE + '/pjm',", "docs: L.SITE + '/',\n    page: L.SITE + '/',")])
patch('api/v1/health.js', [("docs: t === 'pjm' ? L.SITE + '/pjm' : L.docsUrl(t),", "docs: t === 'pjm' ? L.SITE + '/' : L.docsUrl(t),")])
patch('tests/api.test.cjs', [("t === 'pjm' ? 'https://megawatt.fun/pjm' :", "t === 'pjm' ? 'https://megawatt.fun/' :")])
patch('tests/pjm.test.cjs', [("for (const f of ['pjm.html', 'pjm.js',", "for (const f of ['index.html', 'pjm.js',"),
                             ("path.join(__dirname, '..', 'pjm.html')", "path.join(__dirname, '..', 'index.html')")])
patch('market.js', [('See <a href="/pjm">PJM, the next market</a>', 'See <a href="/">PJM, the next market</a>')])
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/pjm</loc></url>\n', '  <url><loc>https://megawatt.fun/battery</loc></url>\n')])
patch('scripts/serve.py', [('"/ops", "/market", "/pjm", "/pitch"', '"/ops", "/market", "/battery", "/pitch"'),
                           ('        if path == "/notes":', '        if path == "/pjm":\n            self.send_response(301); self.send_header("Location", "/"); self.end_headers(); return\n        if path == "/notes":')])
patch('scripts/package-site.py', [('"favicon.ico", "index.html",', '"favicon.ico", "index.html", "battery.html",')])
patch('docs/api.md', [('the same way [/pjm](https://megawatt.fun/pjm) does', 'the same way the [homepage](https://megawatt.fun/) does')])

v = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
if not any(r['source'] == '/pjm' for r in v['redirects']):
    v['redirects'].append({'source': '/pjm', 'destination': '/', 'permanent': False})
(ROOT / 'vercel.json').write_text(json.dumps(v, indent=2) + '\n', encoding='utf-8')
print('ok')
