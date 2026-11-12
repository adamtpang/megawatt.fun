"""Apply researched patches to data/pjm-states.json.
Usage: python scripts/apply-state-patches.py <patches.json> [<patches.json> ...]
Each patch: { "path": "PA/license/fee", "value": "...", "source": "https://...", "resolved": true }.
A path is state code / field / index or key ... into states[]. A resolved patch replaces the text and,
where the entry has its own "source" key, the source. License and billing fields share one source key, so
their per-field sources go to "field_sources". Unresolved patches only replace the text when it is clearer
than a bare "unverified"."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
F = ROOT / 'data' / 'pjm-states.json'
d = json.loads(F.read_text(encoding='utf-8'))
by = {s['code']: s for s in d['states']}
done, kept = [], []
for name in sys.argv[1:]:
    for p in json.loads(Path(name).read_text(encoding='utf-8'))['patches']:
        parts = p['path'].split('/')
        node = by[parts[0]]
        for k in parts[1:-1]:
            node = node[int(k)] if isinstance(node, list) else node[k]
        key = parts[-1]
        # A path that ends on a list index names the whole entry: patch its text field.
        if isinstance(node, list):
            node = node[int(key)]
            key = next(k for k in ('what', 'rule', 'due') if k in node)
        value, src = p.get('value'), p.get('source')
        assert isinstance(value, str) and value.strip(), p['path'] + ': empty value'
        assert chr(0x2014) not in value, p['path'] + ': em dash'
        resolved = bool(p.get('resolved')) and isinstance(src, str) and src.startswith('http')
        if not resolved:
            # Keep it honest: an unresolved item stays marked, with what was checked.
            if 'unverified' not in value.lower():
                value = value.rstrip('. ') + ' (unverified)'
            node[key] = value
            kept.append(p['path'])
            continue
        node[key] = value
        if isinstance(node, dict) and 'source' in node and parts[1] not in ('license', 'billing'):
            node['source'] = src
        else:
            node.setdefault('field_sources', {})[key] = src
            if p.get('extra_sources'):
                node.setdefault('more_sources', [])
                node['more_sources'] = sorted(set(node['more_sources']) | {u for u in p['extra_sources'] if isinstance(u, str) and u.startswith('http')})
        done.append(p['path'])
d['verified_pass'] = '2026-11-11 third pass'
text = json.dumps(d, indent=2, ensure_ascii=False) + '\n'
F.write_text(text, encoding='utf-8')
print('resolved', len(done), 'still unverified', len(kept), kept)
print('unverified left in file:', text.lower().count('unverified'))
