/* Displays saved LOCAL process-test evidence. Does not start or stop workers. */
(function () {
  'use strict';
  const score = document.getElementById('restart-score');
  const rows = document.getElementById('restart-cases');
  const names = {
    none: 'Clean restart', before_intent: 'Before saving intent',
    before_intent_commit: 'During intent transaction', after_intent: 'Intent saved, action not sent',
    after_action: 'Action sent, receipt not saved', after_receipt: 'Receipt saved'
  };
  async function read(url, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Evidence unavailable');
    return type === 'json' ? r.json() : r.arrayBuffer();
  }
  Promise.all([
    read('/demo/dispatch-bench/restart-results.json', 'json'),
    read('/demo/dispatch-bench/restart_fixture.py', 'bytes')
  ]).then(async ([result, source]) => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if (result.model !== 'restart-fixture-v1' || result.source_sha256 !== hash ||
        !Array.isArray(result.cases) || result.cases.length !== 6 ||
        new Set(result.cases.map(c => c.fault)).size !== 6) throw new Error('Evidence failed validation');
    let passed = 0;
    for (const c of result.cases) {
      const expected = c.fault === 'after_intent' ? 0 : 1;
      const mustHold = ['after_intent', 'after_action'].includes(c.fault);
      const exit = c.fault === 'none' ? 0 : 86;
      if (!names[c.fault] || !c.durable || !c.baseline ||
          ![c.durable, c.baseline].every(r => Number.isInteger(r.applications) && r.applications >= 0 &&
            r.applications <= 2 && Number.isFinite(r.stored_kwh) && Number.isFinite(r.exported_kwh) &&
            typeof r.retry === 'string' && r.first_exit === exit)) throw new Error('Evidence failed validation');
      const ok = c.durable.applications === expected && c.durable.stored_kwh >= result.reserve_kwh &&
        (!mustHold || c.durable.retry === 'reconciliation required');
      if (ok) passed++;
      const tr = document.createElement('tr');
      for (const value of [names[c.fault], c.baseline.applications, c.durable.applications, c.durable.retry]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      rows.append(tr);
    }
    score.textContent = `${passed} / 6 passed`;
  }).catch(() => {
    rows.textContent = '';
    score.textContent = 'Evidence unavailable';
  });
})();
