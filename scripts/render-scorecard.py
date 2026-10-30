"""Render the reviewed metric snapshot into static HTML and a downloadable CSV."""
import argparse
import csv
import io
import json
import math
from datetime import date
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START, END = '<!-- progress-scorecard:start -->', '<!-- progress-scorecard:end -->'


def validate(data):
    assert date.fromisoformat(data['review_due']) > date.fromisoformat(data['reviewed_on'])
    ids = set()
    for metric in data['metrics']:
        assert metric['id'] not in ids
        ids.add(metric['id'])
        assert metric['scope'] in ('World', 'United States')
        assert metric['comparison_kind'] in ('calculated_yoy', 'source_reported', 'historical_benchmark')
        assert isinstance(metric['value'], (int, float)) and math.isfinite(metric['value'])
        assert metric['source_url'].startswith('https://')
        for field in ('period', 'definition', 'limitation', 'source_evidence', 'source_name'):
            assert metric[field].strip()
        if metric['comparison_kind'] == 'calculated_yoy':
            assert metric['previous_value'] > 0 and metric['previous_period']
            change = 100 * (metric['value'] / metric['previous_value'] - 1)
            assert f'{change:+.1f}%' in metric['change_label']
        else:
            assert metric['previous_value'] is None, 'Do not fabricate comparison values from narrative trends'
    assert len(ids) == 6


def render(data):
    e = escape
    cards = []
    kinds = {'calculated_yoy': 'Calculated annual comparison', 'source_reported': 'Source-reported direction', 'historical_benchmark': 'Historical benchmark'}
    for m in data['metrics']:
        region = 'world' if m['scope'] == 'World' else 'us'
        comparison_link = f'<a href="{e(m["comparison_source_url"])}">Comparison source</a>' if m.get('comparison_source_url') else ''
        history = ''
        if m['history']:
            rows = ''.join(f'<tr><th scope="row">{e(p["period"])}</th><td>{p["value"]:,.2f}</td></tr>' for p in m['history'])
            history = f'<table><caption>Published series, {e(m["unit"])}</caption><thead><tr><th scope="col">Year</th><th scope="col">Value</th></tr></thead><tbody>{rows}</tbody></table>'
        cards.append(f'''<article class="metric-card" data-scope="{region}" aria-labelledby="metric-{e(m['id'])}">
  <div class="metric-meta"><span>{e(m['category'])}</span><span class="metric-scope">{e(m['scope'])}</span></div>
  <h3 id="metric-{e(m['id'])}">{e(m['title'])}</h3>
  <p class="metric-value">{e(m['display'])} <span>{e(m['unit'])}</span></p>
  <p class="metric-period">{e(m['period'])} · {e(m['qualifier'])}</p>
  <p class="metric-direction {e(m['tone'])}">{e(m['trend'])}</p>
  <p class="metric-comparison">{e(m['change_label'])}</p>
  <p class="metric-interpretation">{e(m['interpretation'])}</p>
  <details><summary>Definition, comparison &amp; source<span class="sr-only"> for {e(m['title'])}</span></summary>
    <div class="metric-notes"><p><b>Measure.</b> {e(m['definition'])}</p><p><b>{kinds[m['comparison_kind']]}.</b> {e(m['source_evidence'])}</p><p><b>Limit.</b> {e(m['limitation'])}</p>{history}<p><b>Next measurement.</b> {e(m['next_step'])}</p><a href="{e(m['source_url'])}">{e(m['source_name'])}</a>{comparison_link}</div>
  </details>
</article>''')
    return f'''{START}
<section id="progress" class="scoreboard section-space" aria-labelledby="score-title">
  <div class="section-heading"><div><p class="section-index">03 / The progress scorecard</p><h2 id="score-title">More power. Uneven progress.</h2></div><p>Track what is changing, not just what we want to build. These indicators have different dates and scopes; they do not add up to a single civilization score.</p></div>
  <div class="score-review"><p>Sources reviewed <time datetime="{e(data['reviewed_on'])}">21 September 2026</time></p><p>Next review due <time datetime="{e(data['review_due'])}">21 December 2026</time></p></div>
  <p class="score-scope-note">Three global indicators and three US indicators. The US measures provide regional evidence about connections, outages and prices; they are not substitutes for global coverage.</p>
  <div class="score-controls" hidden><div class="score-filters" role="group" aria-label="Filter scorecard by geography"><button type="button" data-score-scope="all" aria-pressed="true">All indicators</button><button type="button" data-score-scope="world" aria-pressed="false">World</button><button type="button" data-score-scope="us" aria-pressed="false">United States</button></div><p id="metric-count" role="status">6 indicators</p></div>
  <div class="metric-grid">{''.join(cards)}</div>
  <div class="score-bottom"><p><strong>Coverage still missing:</strong> a comparable global measure of outage duration, grid connection time, and household energy burden. Nominal electricity prices do not establish affordability.</p><div><a href="/data/progress-scorecard.json">Definitions &amp; sources (JSON)</a><a href="/data/progress-scorecard.csv">Download indicators (CSV)</a></div></div>
  <p class="score-rule">{e(data['update_policy'])} No forecasts are mixed into the observed indicators; preliminary estimates are labeled. A higher K is not a substitute for reliable, affordable, low-impact energy.</p>
</section>
{END}'''


def csv_text(data):
    out = io.StringIO(newline='')
    fields = ['id', 'title', 'scope', 'period', 'value', 'display', 'unit', 'comparison_kind', 'previous_period', 'previous_value', 'change_label', 'source_url', 'comparison_source_url', 'limitation', 'reviewed_on']
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    for metric in data['metrics']:
        writer.writerow({key: data['reviewed_on'] if key == 'reviewed_on' else metric.get(key, '') for key in fields})
    return out.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/progress-scorecard.json').read_text(encoding='utf-8'))
    validate(data)
    page = ROOT / 'index.html'
    text = page.read_text(encoding='utf-8')
    if START in text:
        a, b = text.index(START), text.index(END) + len(END)
    else:
        a = text.index('  <section class="scoreboard section-space"')
        b = text.index('</section>', a) + len('</section>')
    html = text[:a] + render(data) + text[b:]
    csv_path = ROOT / 'data/progress-scorecard.csv'
    if args.check:
        assert text == html, 'Run python scripts/render-scorecard.py to update HTML'
        assert csv_path.read_text(encoding='utf-8') == csv_text(data), 'CSV is stale'
        print('Scorecard definitions, calculated comparisons, static HTML and CSV agree.')
    else:
        page.write_text(html, encoding='utf-8')
        csv_path.write_text(csv_text(data), encoding='utf-8', newline='')
        print('Rendered six sourced indicators and public CSV.')


if __name__ == '__main__':
    main()
