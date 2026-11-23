"""Put the link preview tags on every page. Run from the repo root: python scripts/add-og-tags.py

Every page gets the same card (og.png, built by scripts/make-og.mjs) and the home screen icon. A page that has no
og:title, og:description, og:url or og:type gets one from its own <title>, meta description and canonical link.
The twitter:title and twitter:description copy the page's og values. Safe to run again: the block between
<!--og--> and <!--/og--> is rewritten each time.
"""
import glob, html, re

IMAGE = 'https://megawatt.fun/og.png?v=1'
ALT = ('A day of Houston grid prices with a home battery charging midday and powering the home in the evening. '
       'megawatt.fun by Adam Pang.')
HOME = {'og:title': 'megawatt.fun: one battery, one day'}  # index.html, per OG_PREVIEW_HANDOFF.md section 4

def meta(s, attr, key):
    m = re.search(r'<meta %s="%s" content="([^"]*)"' % (attr, re.escape(key)), s)
    return m.group(1) if m else None

# plug-and-play.html is built from its template by scripts/build-plug-docs.py, so the template carries the tags too.
for path in sorted(glob.glob('*.html') + glob.glob('notes/*.html') + ['scripts/plug-and-play.template.html']):
    name = path.replace(chr(92), '/').replace('scripts/plug-and-play.template.html', 'plug-and-play.html')
    s = open(path, encoding='utf-8', newline='').read()
    if '<head>' not in s:
        continue
    s = re.sub(r'\s*<!--og-->[\s\S]*?<!--/og-->', '', s)
    title = re.search(r'<title>([^<]*)</title>', s)
    canon = re.search(r'<link rel="canonical" href="([^"]*)"', s)
    want = {
        'og:title': meta(s, 'property', 'og:title') or (title and title.group(1)),
        'og:description': meta(s, 'property', 'og:description') or meta(s, 'name', 'description'),
        'og:url': meta(s, 'property', 'og:url') or (canon and canon.group(1)) or 'https://megawatt.fun/' + ('' if name == 'index.html' else name[:-5].replace('/index', '')),
        'og:type': meta(s, 'property', 'og:type') or 'website',
    }
    if name == 'index.html':
        want.update(HOME)
        s = re.sub(r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="%s">' % HOME['og:title'], s)
    added = [(k, v) for k, v in want.items() if v and meta(s, 'property', k) is None]
    tags = ''.join('<meta property="%s" content="%s">' % (k, v) for k, v in added)
    tags += ('<meta property="og:site_name" content="megawatt.fun">'
             '<meta property="og:image" content="%s"><meta property="og:image:type" content="image/png">'
             '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
             '<meta property="og:image:alt" content="%s">'
             '<meta name="twitter:card" content="summary_large_image">' % (IMAGE, ALT))
    if want['og:title']: tags += '<meta name="twitter:title" content="%s">' % want['og:title']
    if want['og:description']: tags += '<meta name="twitter:description" content="%s">' % want['og:description']
    tags += '<meta name="twitter:image" content="%s"><link rel="apple-touch-icon" href="/apple-touch-icon.png">' % IMAGE
    anchor = re.search(r'<link rel="icon"[^>]*>', s) or re.search(r'<meta charset="utf-8">', s)
    s = s[:anchor.end()] + '\n<!--og-->' + tags + '<!--/og-->' + s[anchor.end():]
    open(path, 'w', encoding='utf-8', newline='').write(s)
    print(name, '+' + ','.join(k for k, _ in added) if added else '')
