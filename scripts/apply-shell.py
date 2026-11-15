"""Give every page the same frame: the shared footer as the last thing in <body>, and no page-made link rows.

Run from the repo root: python scripts/apply-shell.py
The master footer lives here. Each page's own closing sentence (what it is not affiliated with, what it does not do)
is kept, moved to a <p class="mw-note"> at the end of its <main>. Safe to run again.
"""
import glob, re

FOOTER = ('<!--mw-footer--><footer class="mw-footer"><nav aria-label="Site"><a href="/about">About</a><a href="/sources">Sources</a>'
          '<a href="/notes">Notes</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a></nav>'
          '<p>megawatt.fun is independent. It is not affiliated with Base Power, ERCOT, PJM, Oncor or any company named on it. '
          'Figures are public data or labelled estimates.</p></footer><!--/mw-footer-->')
PRELOAD = ''.join('<link rel="preload" href="/fonts/ibm-plex-sans-latin-%s-normal.woff2" as="font" type="font/woff2" crossorigin>' % w for w in ('300', '400', '600'))
FULL = {'market.html', 'notes/expansion-map.html', 'ops.html'}  # pages that run edge to edge
SKIP = {'essay.html'}  # a fixed-size sheet made to be screenshotted

for path in sorted(glob.glob('*.html') + glob.glob('notes/*.html') + ['scripts/plug-and-play.template.html']):
    name = path.replace(chr(92), '/')
    if name in SKIP: continue
    s = open(path, encoding='utf-8', newline='').read()
    if '<!--mw-header-->' not in s: continue
    s = re.sub(r'\s*<!--mw-footer-->[\s\S]*?<!--/mw-footer-->', '', s)
    # Old pages: a <footer class="site-bottom"> after <main>. Keep its sentence, drop its links.
    for m in list(re.finditer(r'\s*<footer class="site-bottom">([\s\S]*?)</footer>', s)):
        inner = m.group(1)
        p = re.search(r'<p>([\s\S]*?)</p>', inner)
        note = p.group(1) if p else re.split(r'<br\s*/?>', re.sub(r'<div class="footer-links">[\s\S]*?</div>', '', inner))[0]
        note = ' '.join(note.split())
        s = s.replace(m.group(0), '', 1)
        if note and 'class="mw-note"' not in s:
            i = s.rfind('</main>')
            s = s[:i].rstrip() + '\n  <p class="mw-note">' + note + '</p>\n' + s[i:]
    # Newer pages: a link row inside the page's own footer.
    s = re.sub(r'\s*<div class="foot-links">[\s\S]*?</div>', '', s)
    if name in FULL and 'mw-full' not in s:
        s = re.sub(r'<main([^>]*?)class="', r'<main\1class="mw-full ', s, count=1) if re.search(r'<main[^>]*class="', s) else s.replace('<main', '<main class="mw-full"', 1)
    # The typeface is asked for early, so text does not redraw in a new font after the page shows.
    if 'rel="preload" href="/fonts/ibm-plex-sans' not in s: s = s.replace('<link rel="stylesheet"', PRELOAD + chr(10) + '<link rel="stylesheet"', 1)
    i = s.rfind('</body>')
    s = s[:i].rstrip() + '\n' + FOOTER + '\n' + s[i:]
    open(path, 'w', encoding='utf-8', newline='').write(s)
    print('framed', name)
