/* Local scenarios only. Nothing entered here is sent to Franklin or a server. */
(() => {
  'use strict';
  const M = window.MarketIntelligence, $ = id => document.getElementById(id);
  const escape = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = x => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(x);
  const blank = () => ['HOUSTON', 'NORTH', 'SOUTH'].map((zone, i) => ({ id: String(i), name: `Candidate ${String.fromCharCode(65 + i)}`, zone: `LZ_${zone}`, eligible: null,
    property: { installedCostUsd: null, usableAreaM2: null }, grid: { headroomKw: null }, basis: 'missing', source: 'No property or grid evidence supplied', asOf: null }));
  let candidates = blank(), results = {}, weights = { ...M.DEFAULT_WEIGHTS };
  const current = () => candidates[Number($('candidate-select').value)];
  function editor() {
    const c = current();
    $('candidate-zone').value = c.zone;
    $('candidate-eligible').value = c.eligible === null ? '' : String(c.eligible);
    $('candidate-cost').value = c.property.installedCostUsd ?? '';
    $('candidate-area').value = c.property.usableAreaM2 ?? '';
    $('candidate-headroom').value = c.grid.headroomKw ?? '';
  }
  function render() {
    try {
      const normalized = M.normalizedWeights(weights);
      for (const key of Object.keys(weights)) $(`normalized-${key}`).textContent = `${fmt(normalized[key] * 100)}%`;
      const ranked = M.scoreCandidates(candidates, results, weights);
      $('candidate-results').innerHTML = ranked.map((c, i) => `<tr><td>${c.score === null ? '' : `${i + 1}. `}${escape(c.name)}<span class="rank-reason">${escape(c.zone)}</span></td><td>${c.score === null ? 'Unscored' : c.score.toFixed(1)}<span class="rank-reason">${c.status === 'excluded' ? 'Excluded by eligibility' : c.missing.map(key => escape(M.FACTORS[key]?.label || key)).join(', ')}</span></td><td>${Object.entries(c.breakdown).map(([key, b]) => `${escape(M.FACTORS[key].label)}: ${fmt(b.value)} ${escape(M.FACTORS[key].unit)} → ${fmt(b.points)} pts`).join('<br>') || 'Supply the missing inputs.'}</td><td>${escape(c.basis)}<span class="rank-reason">${escape(c.source)}<br>${c.asOf ? escape(c.asOf) : 'No evidence date'}</span></td></tr>`).join('');
      $('candidate-error').hidden = true;
    } catch (error) {
      $('candidate-results').replaceChildren();
      for (const key of Object.keys(weights)) $(`normalized-${key}`).textContent = '—';
      $('candidate-error').textContent = error.message; $('candidate-error').hidden = false;
    }
  }
  for (const key of Object.keys(weights)) $(`weight-${key}`).addEventListener('input', event => {
    weights[key] = event.target.value === '' ? NaN : Number(event.target.value); render();
  });
  $('candidate-select').addEventListener('change', editor);
  for (const id of ['candidate-zone', 'candidate-eligible', 'candidate-cost', 'candidate-area', 'candidate-headroom']) $(id).addEventListener('input', () => {
    const c = current(), value = id => $(id).value === '' ? null : Number($(id).value);
    c.zone = $('candidate-zone').value; c.eligible = $('candidate-eligible').value === '' ? null : $('candidate-eligible').value === 'true';
    c.property = { installedCostUsd: value('candidate-cost'), usableAreaM2: value('candidate-area') };
    c.grid = { headroomKw: value('candidate-headroom') }; c.basis = 'user-scenario'; c.source = 'User assumptions; not independently verified'; c.asOf = null;
    render();
  });
  $('candidate-example').addEventListener('click', () => {
    candidates = blank();
    const examples = [[6000, 12, 100], [12000, 8, 40], [9000, 10, 60]];
    candidates.forEach((c, i) => { c.eligible = true; c.property = { installedCostUsd: examples[i][0], usableAreaM2: examples[i][1] }; c.grid.headroomKw = examples[i][2]; c.basis = 'synthetic'; c.source = 'Fictional inputs for weight sensitivity only'; });
    editor(); render();
  });
  $('candidate-clear').addEventListener('click', () => { candidates = blank(); editor(); render(); });
  window.addEventListener('market-update', event => {
    results = event.detail.results;
    const previous = $('candidate-zone').value;
    $('candidate-zone').innerHTML = Object.entries(event.detail.prices.zones).filter(([, series]) => series.kind === 'load-zone').map(([zone]) => `<option>${zone}</option>`).join('');
    $('candidate-zone').value = previous || current().zone; render();
  });
  editor(); render();
})();
