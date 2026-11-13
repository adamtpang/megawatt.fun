"""One-off: make the one-day screen the homepage and move the PJM ranking to /pjm. Run once from the repo root.

Builds index.html, day.css and day-scene.js from the approved proof (design/proof-v2.html, design/stage-scene.js),
then repoints every "PJM" link that meant the homepage."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
proof = (ROOT / 'design' / 'proof-v2.html').read_text(encoding='utf-8')


def write(name, text):
    (ROOT / name).write_text(text, encoding='utf-8', newline='\n')


def patch(name, pairs, count=1):
    s = (ROOT / name).read_text(encoding='utf-8')
    for a, b in pairs:
        assert a in s, name + ': ' + a[:70]
        s = s.replace(a, b) if count == 0 else s.replace(a, b, count)
    write(name, s)


# ---- day.css: the proof's styles, with the display face self-hosted (font-src is 'self').
css = re.search(r'<style>\n(.*?)</style>', proof, flags=re.S).group(1)
css = '\n'.join(line[2:] if line.startswith('  ') else line for line in css.split('\n'))
head, rest = css.split(':root {', 1)
face = ('/* Homepage. Display face: Bricolage Grotesque 800 (SIL OFL, fonts/OFL-bricolage.txt). Text: Instrument Sans. */\n'
        '@font-face { font-family: "Bricolage Grotesque"; src: url("/fonts/bricolage-grotesque-latin-800-normal.woff2") format("woff2"); font-weight: 500 800; font-display: swap; }\n')
css = face + head + ':root {' + rest
nav_css = '''
/* Site links: in the top bar on a wide screen, in the footer on a phone. */
.bar nav { display: none; }
.foot-links { display: flex; flex-wrap: wrap; gap: 0 18px; margin: 0 0 12px; }
.foot-links a, .bar nav a { min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; font-weight: 500; color: var(--ink); }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 16px; top: 8px; z-index: 5; padding: 8px 12px; background: var(--card); border-radius: var(--r-ctl); }
.more { margin: 14px 0 0; font-size: 15px; }
@media (min-width: 880px) {
  .bar nav { display: flex; gap: 22px; margin-left: 28px; font-size: 15px; white-space: nowrap; }
  .place { margin-left: auto; white-space: nowrap; }
  .place select { max-width: 300px; }
}
'''
css = css.replace('\n@media (min-width: 560px) {', nav_css + '\n@media (min-width: 560px) {', 1)
assert nav_css in css
write('day.css', css)

# ---- day-scene.js: the proof's scene under its shipping name.
scene = (ROOT / 'design' / 'stage-scene.js').read_text(encoding='utf-8')
write('day-scene.js', scene.replace('/* The house on the day stage.', '/* The house on the homepage stage.', 1))

# ---- index.html
body = proof.split('<div class="wrap">', 1)[1].split('<script src="/pjm-core.js">', 1)[0]
NAV = '<nav aria-label="Main navigation"><a href="/pjm">PJM</a><a href="/market">US map</a><a href="/battery">Texas battery</a><a href="/live">Live</a><a href="/notes">Notes</a></nav>'
a = '    <a class="mark" href="/">megawatt.fun</a>\n'
assert a in body
body = body.replace(a, a + '    ' + NAV + '\n', 1)
a = '        <p class="src" id="owner-src"></p>'
assert a in body
body = body.replace(a, a + '\n        <p class="more"><a href="/pjm">All 20 PJM utility areas, ranked, and what each state needs to launch</a></p>', 1)
a = '  <footer>\n'
assert a in body
body = body.replace(a, a + '    <div class="foot-links"><a href="/pjm">PJM ranking</a><a href="/market">US map</a><a href="/battery">Texas battery</a><a href="/live">Live</a><a href="/notes">Notes</a><a href="/notes/kardashev-stack">Make, move, store, sell</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/sources">Sources</a></div>\n', 1)
a = '  <main>'
assert a in body
body = body.replace(a, '  <main id="main">', 1)
DESC = 'Drag through one day of a home battery on real PJM prices: when it charges, when it runs the home, and what that is worth to the home, the company that owns it, a lender and a data center. Independent, not affiliated with Base Power.'
index = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>megawatt.fun: one battery, one day</title>
<link rel="canonical" href="https://megawatt.fun/">
<meta name="description" content="{DESC}">
<meta property="og:title" content="One battery, one day">
<meta property="og:description" content="What a home battery does through a day of real grid prices, and who makes what. Public data. Not affiliated with Base Power.">
<meta property="og:url" content="https://megawatt.fun/">
<meta property="og:type" content="website">
<meta name="theme-color" content="#101a2b">
<link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/day.css">
<script src="/pjm-core.js" defer></script>
<script src="/finance-core.js" defer></script>
<script src="/day-core.js" defer></script>
<script src="/day.js" defer></script>
<script type="importmap">
{{ "imports": {{ "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" }} }}
</script>
<script type="module" src="/day-scene.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to the day</a>
<div class="wrap">{body.rstrip()}
</body>
</html>
'''
assert '—' not in index and '—' not in css
write('index.html', index)

# ---- The PJM ranking now lives at /pjm.
patch('pjm.html', [
    ('<link rel="canonical" href="https://megawatt.fun/">', '<link rel="canonical" href="https://megawatt.fun/pjm">'),
    ('<meta property="og:url" content="https://megawatt.fun/">', '<meta property="og:url" content="https://megawatt.fun/pjm">'),
    ('<a href="/" aria-current="page">PJM</a>', '<a href="/pjm" aria-current="page">PJM</a>'),
    ('<a href="/" aria-current="page">PJM, the next market</a>', '<a href="/pjm" aria-current="page">PJM, the next market</a>'),
])
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design'}
n = 0
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts) or rel.as_posix() in ('index.html', 'pjm.html'):
        continue
    s = f.read_text(encoding='utf-8')
    t = s.replace('<a href="/">PJM</a>', '<a href="/pjm">PJM</a>').replace('<a href="/">PJM, the next market</a>', '<a href="/pjm">PJM, the next market</a>')
    if t != s:
        f.write_text(t, encoding='utf-8', newline='\n'); n += 1
print(n, 'pages repointed')
patch('tools.html', [('<p><a class="btn" href="/">Open the tool</a></p>', '<p><a class="btn" href="/pjm">Open the tool</a></p>')])
patch('scripts/serve.py', [
    ('        if path == "/pjm":\n            self.send_response(301); self.send_header("Location", "/"); self.end_headers(); return\n', ''),
    ('{"/ops", "/market", "/battery",', '{"/ops", "/pjm", "/market", "/battery",'),
])
v = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
before = len(v['redirects'])
v['redirects'] = [r for r in v['redirects'] if r['source'] != '/pjm']
assert len(v['redirects']) == before - 1
raw = (ROOT / 'vercel.json').read_text(encoding='utf-8')
write('vercel.json', json.dumps(v, indent=2 if '\n  "' in raw else 4) + '\n')
patch('sitemap.xml', [('  <url><loc>https://megawatt.fun/market</loc></url>\n', '  <url><loc>https://megawatt.fun/pjm</loc></url>\n  <url><loc>https://megawatt.fun/market</loc></url>\n')])
patch('api/v1/pjm.js', [("page: L.SITE + '/',", "page: L.SITE + '/pjm',")])
patch('scripts/package-site.py', [('"index.html", "battery.html",', '"index.html", "day.css", "day.js", "day-core.js", "day-scene.js", "pjm.html", "battery.html",')])
print('ok')
