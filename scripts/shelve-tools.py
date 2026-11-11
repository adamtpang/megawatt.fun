"""One-off: shelve /pitch, /launch, /finance and /supply from site navigation (pages stay live by URL)
and point the tool strip at the market map and the PJM page. Run once from the repo root."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'docs', '.cache', 'node_modules', 'analysis', 'tests', '.git', 'interviews'}
SHELVED = r'<a href="/(?:pitch|launch|finance|supply)"(?: aria-current="page")?>[^<]*</a>'


def strip(page_is):
    cur = lambda p: ' aria-current="page"' if page_is == p else ''
    return ('<nav class="gift-set" aria-label="Home battery company tools"><span>For a home-battery company</span>'
            f'<a href="/market"{cur("market")}>Where to grow</a><a href="/pjm"{cur("pjm")}>PJM, the next market</a></nav>')


changed = []
for f in ROOT.rglob('*.html'):
    if SKIP & set(f.relative_to(ROOT).parts):
        continue
    s = f.read_text(encoding='utf-8')
    o = s
    # Nav "More" menu: drop shelved links, add PJM after the market map.
    def menu(m):
        body = re.sub(SHELVED, '', m.group(0))
        if 'href="/pjm"' not in body:
            body = re.sub(r'(<a href="/market"(?: aria-current="page")?>Market map</a>)', r'\1<a href="/pjm">PJM next market</a>', body, count=1)
        return body
    s = re.sub(r'<div class="nav-more-menu">.*?</div>', menu, s, flags=re.S)
    page = f.stem
    s = re.sub(r'<nav class="gift-set".*?</nav>', lambda m: strip(page), s, flags=re.S)
    if s != o:
        f.write_text(s, encoding='utf-8')
        changed.append(str(f.relative_to(ROOT)))
print(len(changed), 'files:', ' '.join(sorted(changed)))
