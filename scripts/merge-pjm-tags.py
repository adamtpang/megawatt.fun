"""Merge the per-utility tag-method research files into data/pjm-tags.json.
Usage: python scripts/merge-pjm-tags.py <folder with pa-il.json, nj-md.json, ohio.json>
Each entry answers, from the utility's own documents: does a home with an interval (smart) meter get its
capacity tag (PLC) and transmission tag (NSPL) from its own hourly data, or from a class load profile?
Zone status: "interval" when every utility in the zone is confirmed interval, "partly" when some are,
"profile" when the method on file is a class profile, else "unknown"."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1])
zones = {}
checked = None
for name in ['pa-il.json', 'nj-md.json', 'ohio.json']:
    d = json.loads((src / name).read_text(encoding='utf-8'))
    checked = d.get('checked') or checked
    for u in d['utilities']:
        zones.setdefault(u['zone'], []).append(u)


def ami(u, key):
    v = (u.get(key) or {}).get('residential_with_ami')
    return v if v in ('interval', 'profile') else 'unknown'  # "mixed" is not a confirmation


out = {}
for zone, us in sorted(zones.items()):
    kinds = [ami(u, 'plc') for u in us]
    if all(k == 'interval' for k in kinds):
        status = 'interval'
    elif any(k == 'interval' for k in kinds):
        status = 'partly'
    elif any(k == 'profile' for k in kinds):
        status = 'profile'
    else:
        status = 'unknown'
    entries = []
    for u in us:
        e = {'utility': u['utility'], 'plc': u.get('plc'), 'notes': u.get('notes', '')}
        if u.get('nspl'):
            e['nspl'] = u['nspl']
        if u.get('transmission'):
            e['transmission'] = u['transmission']
        entries.append(e)
    out[zone] = {'status': status, 'utilities': entries}

text = json.dumps({'checked': checked, 'about': __doc__.split('\n')[2].strip() + ' ' + __doc__.split('\n')[3].strip(), 'zones': out}, indent=2, ensure_ascii=False) + '\n'
assert '—' not in text, 'em dash in research text'
(ROOT / 'data' / 'pjm-tags.json').write_text(text, encoding='utf-8')
print({z: v['status'] for z, v in out.items()})
