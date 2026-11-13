"""One-off: put every page on the Carbon design language. Run once from the repo root.

1. Every page gets the shared header (the block between the mw-header markers in index.html), shell.css and nav.js.
2. site.css gets a Carbon theme block at the end. It re-points the existing tokens at Carbon's values, so the
   27 pages that share site.css change color, type and corner radius together without being rewritten."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews', 'shelved', '.vercel', 'design', 'vendor', 'demo'}
index = (ROOT / 'index.html').read_text(encoding='utf-8')
HEADER = re.search(r'<!--mw-header-->.*?<!--/mw-header-->', index, flags=re.S).group(0)

done = []
for f in ROOT.rglob('*.html'):
    rel = f.relative_to(ROOT)
    if SKIP & set(rel.parts) or rel.as_posix() == 'index.html':
        continue
    s = f.read_text(encoding='utf-8')
    if 'class="site-top"' not in s:
        continue
    t, n = re.subn(r'<header class="site-top">.*?</header>', lambda m: HEADER, s, count=1, flags=re.S)
    assert n == 1, rel
    if '/shell.css' not in t:
        t, n = re.subn(r'(<link rel="stylesheet" href="/site\.css"[^>]*>)', r'\1<link rel="stylesheet" href="/shell.css">', t, count=1)
        assert n == 1, ('no site.css link', rel)
    if '/nav.js' not in t:
        t = t.replace('</head>', '<script src="/nav.js" defer></script>\n</head>', 1)
    f.write_text(t, encoding='utf-8', newline='\n')
    done.append(rel.as_posix())
print(len(done), 'pages')

THEME = '''

/* ==========================================================================================================
   Carbon theme, 2026-11-13. megawatt.fun adopted IBM Carbon (white theme) as its design language; see
   docs/design-language.md. The rules above were written against Base Power's public tokens. Rather than rewrite
   27 pages, this block re-points those tokens at Carbon's values and squares the corners. The homepage uses real
   Carbon components (vendor/carbon); these pages wear the same colors, type and shapes. Header: shell.css.
   ========================================================================================================== */
:root {
  --bpc-color-white: #ffffff;
  --bpc-color-grey-5: #f4f4f4; --bpc-color-grey-20: #e0e0e0; --bpc-color-grey-40: #a8a8a8; --bpc-color-grey-60: #6f6f6f;
  --bpc-color-grey-80: #525252; --bpc-color-grey-100: #161616;
  /* Base's greens were its brand, its selected state and its action color. Selected surfaces take Carbon's blue 20
     with blue 70 text; buttons are set to solid blue 60 further down. */
  --bpc-color-green-5: #edf5ff; --bpc-color-green-20: #d0e2ff; --bpc-color-green-60: #198038; --bpc-color-green-90: #0043ce; --bpc-color-green-100: #002d9c;
  --bpc-color-orange-5: #fff2e8; --bpc-color-orange-40: #ffb784; --bpc-color-orange-60: #ff832b; --bpc-color-orange-90: #8a3800;
  --bpc-color-red-5: #fff1f1; --bpc-color-red-20: #ffb3b8; --bpc-color-red-80: #da1e28; --bpc-color-grid-off: #da1e28;
  --bpc-color-blue-10: #e5f6ff; --bpc-color-blue-40: #82cfff; --bpc-color-blue-60: #1192e8; --bpc-color-blue-80: #00539a; --bpc-color-blue-100: #003a6d;
  --bpc-color-yellow-5: #fcf4d6; --bpc-color-yellow-10: #fddc69; --bpc-color-yellow-20: #f1c21b; --bpc-color-yellow-60: #8e6a00; --bpc-color-yellow-80: #684e00;
  --bpc-color-timeline-active: #0f62fe; --bpc-color-timeline-inactive: #e0e0e0;
  --bpc-color-surface-default: #ffffff; --bpc-color-surface-raised: #f4f4f4; --bpc-color-surface-inset: #ffffff; --bpc-color-surface-subtle: #e0e0e0;
  --bpc-color-brand-primary-hover: #a6c8ff;
  --bpc-radius-sm: 0px; --bpc-radius-md: 0px; --bpc-radius-lg: 0px;
  --bpc-font-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --bpc-font-display: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --bpc-header-h: 48px;
  --raised: #e8e8e8; --good: #198038;
}
body { font-family: var(--bpc-font-sans); }
h1, .tool-page h1 { font-weight: 300; letter-spacing: 0; }
h2, .tool-page h2 { font-weight: 400; letter-spacing: 0; }
h3, .tool-page h3 { font-weight: 600; }
a { color: #0f62fe; }
a:hover { color: #0043ce; }
/* Buttons: Carbon primary and tertiary. */
.btn, .button, .trust-page .button-link.primary { background: #0f62fe; color: #ffffff; border-color: transparent; border-radius: 0; font-weight: 400; }
.btn:hover, .button:hover, .trust-page .button-link.primary:hover { background: #0050e6; color: #ffffff; }
.btn-outline, .trust-page .button-link { background: transparent; border-color: #0f62fe; color: #0f62fe; border-radius: 0; }
.btn-outline:hover { background: #0f62fe; border-color: #0f62fe; color: #ffffff; }
:focus-visible { outline-color: #0f62fe; }
/* Fields: Carbon's grey field with a strong lower edge. */
input:not([type=range]):not([type=checkbox]):not([type=radio]), select, textarea { background-color: #f4f4f4; border: 0; border-bottom: 1px solid #8d8d8d; border-radius: 0; }
input[type=range], input[type=checkbox], input[type=radio] { accent-color: #0f62fe; }
/* Labels above headings: Carbon's label style, not tracked capitals. */
.eyebrow, .kicker, .tool-tag, .section-index, .lp-eyebrow { text-transform: none; letter-spacing: .32px; font-weight: 400; color: #525252; }
.badge { text-transform: none; letter-spacing: .32px; border-radius: 999px; padding: 2px 10px; font-weight: 400; }
.badge-solid { background: #0f62fe; color: #ffffff; }
.ds-table thead th { text-transform: none; letter-spacing: .16px; color: #161616; background: #e0e0e0; border-bottom: 0; }
.card, .ds-card { background: #f4f4f4; border: 0; }
.notice { border-radius: 0; }
.site-bottom { background: #ffffff; }
'''
p = ROOT / 'site.css'
s = p.read_text(encoding='utf-8')
if 'Carbon theme, 2026-11-13' not in s:
    p.write_text(s.rstrip('\n') + THEME, encoding='utf-8', newline='\n')
print('site.css themed')
