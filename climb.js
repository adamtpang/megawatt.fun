/* Offline scenario calculator. Baseline provenance: data/kardashev-baseline.json. */
(function (root) {
  'use strict';
  const BASELINE_TW = 176737.094 / 8784;
  const BASELINE_YEAR = 2024;
  function powerTW(k) { return Math.pow(10, 10 * k + 6) / 1e12; }
  function yearsTo(targetTW, growthPercent, baselineTW = BASELINE_TW) {
    if (![targetTW, growthPercent, baselineTW].every(Number.isFinite) || targetTW <= 0 || baselineTW <= 0 || growthPercent < 0) throw new RangeError('Invalid scenario input');
    if (targetTW <= baselineTW) return 0;
    if (growthPercent === 0) return Infinity;
    return Math.ceil(Math.log(targetTW / baselineTW) / Math.log1p(growthPercent / 100));
  }
  const math = { BASELINE_TW, BASELINE_YEAR, powerTW, yearsTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = math;
  if (typeof document === 'undefined') return;
  root.MegawattScale = math;
  if (!document.getElementById('growth')) return; // pages without the roadmap calculator only need the math
  const milestones = {
    '0.75': ['Build the next layer of capability.', 'Improve what exists, connect ready projects, and expand clean supply alongside reliable access. Make deployment repeatable before assuming it can scale.', 'An editorial near-term checkpoint; no fixed completion date.'],
    '0.8': ['Make abundant power repeatable.', 'Scale clean supply, connect it, and make it dependable. Then repeat the whole deployment process across regions.', 'An editorial checkpoint, not an official Kardashev category or a forecast.'],
    '0.9': ['Reassess the system at planetary scale.', 'At a thousand terawatts, revisit land, materials, heat rejection and ecosystem limits. Demonstrate sustainable architectures before multiplying current infrastructure.', 'A long-horizon research direction. Today’s deployment recipe is not a validated path to this scale.'],
    '1': ['Reach Type I without losing the planet.', 'The modern convention sets Type I at ten thousand terawatts. What can safely operate on Earth, and what would belong off-world, remain open design questions.', 'A civilization-scale ambition, not a claim that Earth can sustainably host this entire power level.']
  };
  const roles = {
    software: ['Help operators make better decisions', 'Make dispatch claims testable.', 'Compare a simple battery schedule against forecast-based dispatch. Account for losses, reserve energy and the cost of being wrong.', 'Run the existing Go study, inspect a losing day and explain what the model leaves out.', 'A reproducible comparison with a baseline, feasible battery states and no look-ahead in the forecast policy.', 'Battery operators and engineers evaluating dispatch policies.', '/tools#dispatch-study', 'Explore the dispatch experiment'],
    engineering: ['Make physical constraints visible', 'Find what stops a project connecting.', 'Choose one public project or equipment specification. Trace its connection, power and reliability requirements before proposing a design change.', 'Read a public connection study or equipment datasheet. Document one limiting rating and the assumptions behind it.', 'A sourced engineering note with units, limits, uncertainties and a testable improvement. Field work requires qualified supervision.', 'Grid engineers, project developers and equipment teams.', 'https://www.iea.org/reports/building-the-future-transmission-grid', 'Read the transmission study'],
    operations: ['Shorten the path from proposal to power', 'Map one connection workflow.', 'Understand where a project waits, who owns each handoff, and what evidence is needed to move it forward.', 'Map one local utility’s published interconnection process. Separate application, study, construction and commissioning.', 'A workflow with sourced requirements, handoff owners and measured wait times. Do not label every delay as permitting.', 'Utilities, developers, regulators and community organizations.', 'https://www.iea.org/reports/electricity-grids-and-secure-energy-transitions', 'Explore grid deployment constraints'],
    research: ['Keep the scoreboard honest', 'Reproduce humanity’s starting point.', 'Trace a world energy total to its source and accounting method. Explain what changes when primary energy becomes useful electricity.', 'Download the baseline snapshot and independently calculate average power, K and the gap to the next rung.', 'Reproducible arithmetic, a named accounting method and an explanation of why efficiency gains need not raise K.', 'Energy analysts, educators and anyone comparing competing roadmaps.', '/data/kardashev-baseline.json', 'Download the baseline']
  };
  let selected = '0.8';
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const format = (n, digits = 2) => n.toLocaleString('en-US', {maximumFractionDigits: digits});
  function scenario() {
    const growth = Number(document.getElementById('growth').value);
    const years = yearsTo(powerTW(Number(selected)), growth);
    text('growth-label', growth.toFixed(1) + '%');
    text('scenario-years', Number.isFinite(years) ? format(years, 0) + ' years' : 'No arrival');
    text('scenario-year', Number.isFinite(years) ? 'around ' + (BASELINE_YEAR + years) + ' from the 2024 baseline' : 'A higher rung needs positive growth.');
  }
  function selectMilestone(k) {
    selected = k;
    const power = powerTW(Number(k));
    const percent = BASELINE_TW / power * 100;
    document.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    text('target-label', 'K ' + (k === '1' ? '1.0' : k) + ' / ' + format(power) + ' TW');
    ['target-title','target-copy','target-caution'].forEach((id, i) => text(id, milestones[k][i]));
    text('target-power', format(power) + ' TW');
    text('target-gap', '+' + format(power - BASELINE_TW) + ' TW');
    text('target-multiple', format(power / BASELINE_TW) + '×');
    text('progress-label', format(percent, percent < 1 ? 3 : 2) + '%');
    document.getElementById('power-meter').value = percent;
    document.getElementById('power-meter').textContent = format(percent, 3) + '%';
    scenario();
  }
  document.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => selectMilestone(b.dataset.k)));
  document.getElementById('growth').addEventListener('input', scenario);
  document.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => {
    const values = roles[b.dataset.role];
    document.querySelectorAll('[data-role]').forEach(button => button.setAttribute('aria-pressed', String(button === b)));
    ['role-context','role-title','role-copy','role-week','role-evidence','role-user'].forEach((id, i) => text(id, values[i]));
    const link = document.getElementById('role-link'); link.href = values[6]; link.textContent = values[7];
  }));
  // A source-note deep link should reveal its explanation as well as scroll.
  function revealMethod() { if (location.hash === '#method') document.getElementById('method').open = true; }
  window.addEventListener('hashchange', revealMethod); revealMethod();
  const scoreControls = document.querySelector('.score-controls');
  if (scoreControls) {
    scoreControls.hidden = false;
    document.querySelectorAll('[data-score-scope]').forEach(button => button.addEventListener('click', () => {
      const scope = button.dataset.scoreScope;
      let count = 0;
      document.querySelectorAll('.metric-card').forEach(card => {
        card.hidden = scope !== 'all' && card.dataset.scope !== scope;
        if (!card.hidden) count++;
      });
      document.querySelectorAll('[data-score-scope]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      text('metric-count', count + ' indicators' + (scope === 'all' ? '' : scope === 'world' ? ' · World' : ' · United States'));
    }));
  }
  selectMilestone(selected);
})(typeof window !== 'undefined' ? window : globalThis);
