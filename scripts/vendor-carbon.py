"""Vendor IBM Carbon into the repo. Run from the repo root: python scripts/vendor-carbon.py

The site's Content-Security-Policy allows styles and fonts from 'self' only, so Carbon cannot load from a CDN.
This downloads one pinned release of Carbon's compiled stylesheet and IBM Plex Sans, and writes:

  vendor/carbon/styles.min.css   Carbon's CSS with its @font-face rules removed (they point at IBM's CDN,
                                 which the policy blocks; fonts/ibm-plex-sans-*.woff2 replace them in shell.css)
  vendor/carbon/LICENSE          Apache-2.0
  fonts/ibm-plex-sans-latin-{300,400,600}-normal.woff2, fonts/OFL-ibm-plex.txt   SIL OFL 1.1

Sources: https://cdn.jsdelivr.net/npm/@carbon/styles and https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans
"""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARBON = '1.119.0'  # @carbon/styles, released November 2026
PLEX = '5'          # @fontsource/ibm-plex-sans major


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'vendor-script'}), timeout=60) as r:
        return r.read()


def main():
    out = ROOT / 'vendor' / 'carbon'
    out.mkdir(parents=True, exist_ok=True)
    base = f'https://cdn.jsdelivr.net/npm/@carbon/styles@{CARBON}/'
    css = get(base + 'css/styles.min.css').decode('utf-8')
    stripped, n = re.subn(r'@font-face\{[^}]*\}', '', css)
    assert n > 50 and 'url(https://' not in stripped, 'expected only font URLs to leave the file'
    header = f'/* IBM Carbon, @carbon/styles {CARBON}, Apache-2.0 (vendor/carbon/LICENSE). {n} @font-face rules removed by scripts/vendor-carbon.py: fonts are self-hosted. */\n'
    (out / 'styles.min.css').write_text(header + stripped, encoding='utf-8', newline='\n')
    (out / 'LICENSE').write_bytes(get(base + 'LICENSE'))
    fonts = ROOT / 'fonts'
    plex = f'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@{PLEX}/'
    for w in (300, 400, 600):
        (fonts / f'ibm-plex-sans-latin-{w}-normal.woff2').write_bytes(get(plex + f'files/ibm-plex-sans-latin-{w}-normal.woff2'))
    (fonts / 'OFL-ibm-plex.txt').write_bytes(get(plex + 'LICENSE'))
    print('carbon', CARBON, 'css bytes', len(stripped), 'font rules removed', n)


if __name__ == '__main__':
    main()
