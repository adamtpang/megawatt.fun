/* /launch page wiring. Logic lives in launch-core.js (window.LaunchCore). */
(function () {
  'use strict';
  const L = window.LaunchCore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = w => (Math.round(w * 10) / 10).toString();

  const ui = { abbr: 'GA', path: 'utility', kase: 'low', edits: {} };
  let DATA, MAP, STATES;

  function editKey() { return ui.abbr + ':' + ui.path; }
  function currentEdits() { return ui.edits[editKey()] || (ui.edits[editKey()] = {}); }
  function state() { return STATES[ui.abbr]; }

  function steps() {
    return L.applyEdits(L.resolveSteps(DATA, ui.path, ui.abbr), currentEdits());
  }

  function basisBadge(s) {
    if (s.edited) return '<span class="lp-badge is-edited">yours</span>';
    if (s.basis === 'sourced') return '<span class="lp-badge is-sourced">sourced</span>';
    if (s.basis === 'partly') return '<span class="lp-badge is-partly">partly sourced</span>';
    return '<span class="lp-badge is-assumption">assumption</span>';
  }

  function srcLink(id) {
    const s = DATA.sources[id];
    if (!s) return '';
    return '<a href="' + esc(s.url) + '"' + (s.url.startsWith('http') ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.title) + '</a> (retrieved ' + esc(s.retrieved) + ')';
  }

  function renderWhy() {
    const st = state();
    const sug = L.suggestPath(st);
    const fp = st.footprint;
    const rtos = st.detail && st.detail.rtos ? st.detail.rtos : 'n/a';
    let html = '<h2>' + esc(st.name) + ': the public data suggests <em>' + esc(DATA.paths[sug.path].label.toLowerCase()) + '</em></h2>';
    html += '<p>' + esc(sug.reason) + '</p>';
    html += '<dl class="lp-facts">' +
      '<div><dt>Retail choice</dt><dd>' + Math.round(st.values.retail * 100) + '% of residential customers</dd></div>' +
      '<div><dt>In an ISO/RTO</dt><dd>' + Math.round(st.values.wholesale * 100) + '%</dd></div>' +
      '<div><dt>Markets</dt><dd>' + esc(rtos) + '</dd></div>' +
      '<div><dt>Base footprint</dt><dd>' + (fp ? esc(fp.label) : 'None found') + '</dd></div>' +
      '</dl>';
    if (fp) html += '<p class="lp-small"><strong>Public footprint note:</strong> ' + esc(fp.detail) + '</p>';
    if (fp && fp.status === 'operating') html += '<p class="lp-small">Base already operates here. The timeline shows a fresh start, which is what a new state would look like.</p>';
    if (ui.path === 'retail' && !sug.retailAllowed) {
      html += '<p class="lp-warn">Retail provider is not available here: there is no residential retail choice in EIA-861 2025. Showing the steps anyway so you can compare, but a license would have nothing to sell into.</p>';
    } else if (ui.path !== sug.path) {
      html += '<p class="lp-small">You picked ' + esc(DATA.paths[ui.path].label.toLowerCase()) + ', which differs from the suggestion. That is fine; the suggestion is only about retail share.</p>';
    }
    html += '<p class="lp-small">' + esc(DATA.paths[ui.path].summary) + ' Data: <a href="/data/expansion-map.json">expansion-map.json</a> (EIA-861 2025).</p>';
    $('why').innerHTML = html;
  }

  function months(w) { return L.weeksToMonths(w); }

  function render() {
    const list = steps();
    let fast, slow, cur;
    try {
      fast = L.schedule(list, 'low');
      slow = L.schedule(list, 'high');
    } catch (e) {
      $('err').hidden = false; $('err').textContent = e.message; return;
    }
    $('err').hidden = true;
    cur = ui.kase === 'low' ? fast : slow;
    const byId = Object.fromEntries(list.map(s => [s.id, s]));
    const name = id => byId[id] ? byId[id].name : id;
    const lever = L.bestShortening(list, ui.kase);
    const firstFast = fast.steps.first_installs ? fast.steps.first_installs.ef : null;
    const firstSlow = slow.steps.first_installs ? slow.steps.first_installs.ef : null;
    const sourcedCount = list.filter(s => s.basis !== 'assumption' && !s.edited).length;
    const editedCount = list.filter(s => s.edited).length;

    $('stats').innerHTML =
      stat('First install', fmt(firstFast) + ' to ' + fmt(firstSlow) + ' weeks', months(firstFast) + ' to ' + months(firstSlow) + ' months') +
      stat('At target volume', fmt(fast.total) + ' to ' + fmt(slow.total) + ' weeks', months(fast.total) + ' to ' + months(slow.total) + ' months') +
      stat('Durations sourced', sourcedCount + ' of ' + list.length, editedCount ? editedCount + ' edited by you' : 'the rest are assumptions') +
      '<div class="lp-stat lp-lever"><span>What shortens launch most (' + (ui.kase === 'low' ? 'fast' : 'slow') + ' case)</span>' +
      (lever.best && lever.best.saved > 0
        ? '<b>' + esc(name(lever.best.id)) + '</b><small>Cutting it in half (' + fmt(lever.best.cutWeeks) + ' weeks) saves ' + fmt(lever.best.saved) + ' weeks overall.' + leverRunnerUp(lever, name) + '</small>'
        : '<b>No single step</b><small>Halving any one critical step saves nothing; parallel branches tie.</small>') +
      '</div>';

    renderGantt(list, cur);
    renderSteps(list, cur);
    renderSnags(list, cur);
    renderReal(list);
    $('gantt-note').textContent = (ui.kase === 'low' ? 'Fast' : 'Slow') + ' case. Critical path: ' + cur.criticalPath.map(name).join(' > ') + '. Bars start when every step they depend on has finished.';
  }

  function leverRunnerUp(lever, name) {
    const next = lever.options.filter(o => o.id !== lever.best.id && o.saved > 0)[0];
    return next ? ' Next best: ' + esc(name(next.id)) + ' (' + fmt(next.saved) + ' weeks).' : '';
  }

  function stat(label, big, small) {
    return '<div class="lp-stat"><span>' + esc(label) + '</span><b>' + esc(big) + '</b><small>' + esc(small) + '</small></div>';
  }

  function renderGantt(list, sch) {
    const total = Math.max(sch.total, 1);
    const tickEvery = total > 80 ? 26 : 13; // weeks: 6 or 3 months
    let ticks = '';
    for (let w = 0; w <= total; w += tickEvery) {
      ticks += '<span class="lp-tick" style="left:' + (w / total * 100) + '%"><em>' + Math.round(w * 7 / 30.4375) + ' mo</em></span>';
    }
    const ms = sch.steps.first_installs ? sch.steps.first_installs.ef : null;
    const msLine = ms != null ? '<span class="lp-ms" style="left:' + (ms / total * 100) + '%" title="First install"></span>' : '';
    let rows = '';
    for (const id of sch.order) {
      const r = sch.steps[id], s = list.find(x => x.id === id);
      const left = r.es / total * 100, width = Math.max(r.dur / total * 100, 0.6);
      const slackW = r.slack / total * 100;
      rows += '<div class="lp-row' + (r.critical ? ' is-crit' : '') + '">' +
        '<div class="lp-label"><span>' + esc(s.name) + '</span><small>' + fmt(r.es) + ' to ' + fmt(r.ef) + ' wk' + (r.critical ? ', critical' : ', ' + fmt(r.slack) + ' wk slack') + '</small></div>' +
        '<div class="lp-track">' + ticks.replace(/<em>.*?<\/em>/g, '') + msLine +
        (r.slack > 0 ? '<span class="lp-slack" style="left:' + (left + width) + '%;width:' + slackW + '%"></span>' : '') +
        '<span class="lp-bar" style="left:' + left + '%;width:' + width + '%"></span></div></div>';
    }
    $('gantt').innerHTML = rows + '<div class="lp-row lp-axis"><div class="lp-label"></div><div class="lp-track">' + ticks + '</div></div>';
    $('gantt').setAttribute('aria-label', 'Gantt chart. Total ' + fmt(sch.total) + ' weeks. Critical path: ' + sch.criticalPath.join(', '));
  }

  function renderSteps(list, sch) {
    const byId = Object.fromEntries(list.map(s => [s.id, s]));
    $('steps').innerHTML = sch.order.map(id => {
      const s = byId[id], r = sch.steps[id];
      const deps = (s.depends_on || []).map(d => byId[d].name).join(', ') || 'Nothing, can start on day one';
      return '<article class="lp-step' + (r.critical ? ' is-crit' : '') + '">' +
        '<div class="lp-step-main"><h3>' + esc(s.name) + ' ' + basisBadge(s) + (r.critical ? ' <span class="lp-badge is-crit">critical</span>' : '') + '</h3>' +
        '<p class="lp-meta">' + esc(s.owner) + '. After: ' + esc(deps) + '.</p>' +
        '<p class="lp-note">' + esc(s.note) + (s.source && !s.edited ? ' Source: ' + srcLink(s.source) + '.' : '') + (s.basis === 'assumption' && !s.edited ? ' <em>Assumption, replace with your own data.</em>' : '') + '</p></div>' +
        '<div class="lp-inputs"><label>Fast<input type="number" inputmode="decimal" min="0" max="260" step="0.5" data-id="' + esc(id) + '" data-k="low" value="' + s.low + '"></label>' +
        '<label>Slow<input type="number" inputmode="decimal" min="0" max="260" step="0.5" data-id="' + esc(id) + '" data-k="high" value="' + s.high + '"></label><span>weeks</span></div>' +
        '</article>';
    }).join('');
  }

  function renderSnags(list, sch) {
    const ids = new Set(list.map(s => s.id));
    const byId = Object.fromEntries(list.map(s => [s.id, s]));
    const items = DATA.snags.filter(n => ids.has(n.step));
    $('snags').innerHTML = items.map(n => {
      const crit = sch.steps[n.step].critical;
      return '<li><div class="lp-snag-top"><strong>' + esc(n.title) + '</strong><span class="lp-badge ' + (n.source ? 'is-sourced' : 'is-assumption') + '">' + esc(n.kind) + '</span></div>' +
        '<p>' + esc(n.note) + '</p>' +
        '<p class="lp-meta">Hits: ' + esc(byId[n.step].name) + (crit ? ' (on the critical path now)' : ' (has slack now)') + (n.source ? '. Source: ' + srcLink(n.source) : '. Not sourced; an open question.') + '</p></li>';
    }).join('');
  }

  function renderReal(list) {
    const real = [
      'Base sells as a licensed retail provider: ' + srcLink('base-agents') + '.',
      'Base pitches utility partnerships: "deploy capacity in months, not years", 3 metros and 6 utilities in 12 months, 100 MW in 3 to 6 months vs 2 to 4 years for utility-scale storage. These are Base\'s own claims: ' + srcLink('base-utilities') + '.',
      'Install scheduling queue went from about 4 weeks to a few days: ' + srcLink('base-scheduling') + '.',
      'Field connectivity can fall back to unreliable 4G; commands persist until they expire: ' + srcLink('base-telemetry') + '.',
      'Footprint: Texas operating, Illinois operating in ComEd, Georgia announced (Central Georgia EMC, installs planned for 2027), Connecticut hiring: ' + srcLink('expansion-map') + '.'
    ];
    for (const s of list) if (s.basis !== 'assumption' && !s.edited) real.push(esc(s.name) + ' (' + esc(ui.abbr) + '): ' + fmt(s.low) + ' to ' + fmt(s.high) + ' weeks. ' + srcLink(s.source) + '.');
    const assumed = list.filter(s => s.basis === 'assumption' && !s.edited).map(s => esc(s.name) + ': ' + fmt(s.low) + ' to ' + fmt(s.high) + ' weeks');
    const partly = list.filter(s => s.basis === 'partly' && !s.edited).map(s => esc(s.name) + ': the fast case');
    $('real-list').innerHTML = real.map(x => '<li>' + x + '</li>').join('');
    $('assumed-list').innerHTML = assumed.concat(partly).map(x => '<li>' + x + '</li>').join('') +
      '<li>The step list and dependencies themselves. They are a reasonable outline, not Base\'s actual process.</li>' +
      '<li>Permit speed and home-battery interconnection time: no public data was found.</li>' +
      (list.some(s => s.edited) ? '<li>Your edits: ' + list.filter(s => s.edited).map(s => esc(s.name)).join(', ') + '.</li>' : '');
  }

  function renderSources() {
    $('sources').innerHTML = Object.values(DATA.sources).map(s =>
      '<li><a href="' + esc(s.url) + '"' + (s.url.startsWith('http') ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.title) + '</a>. Retrieved ' + esc(s.retrieved) + '. <span class="lp-quote">' + esc(s.quote) + '</span></li>').join('');
  }

  function setPressed(segId, attr, val) {
    for (const b of $(segId).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === val));
  }

  function writeHash() {
    try { history.replaceState(null, '', '#' + ui.abbr + '/' + ui.path); } catch (e) { /* ignore */ }
  }

  function selectState(abbr, keepPath) {
    ui.abbr = abbr;
    if (!keepPath) ui.path = L.suggestPath(state()).path;
    $('state').value = abbr;
    setPressed('path-seg', 'path', ui.path);
    renderWhy(); render(); writeHash();
  }

  function wire() {
    $('state').addEventListener('change', e => selectState(e.target.value, false));
    $('path-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-path]'); if (!b) return;
      ui.path = b.dataset.path; setPressed('path-seg', 'path', ui.path); renderWhy(); render(); writeHash();
    });
    $('case-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-case]'); if (!b) return;
      ui.kase = b.dataset.case; setPressed('case-seg', 'case', ui.kase); render();
    });
    $('steps').addEventListener('change', e => {
      const t = e.target; if (!t.matches('input[data-id]')) return;
      const v = parseFloat(t.value);
      if (!Number.isFinite(v) || v < 0) { t.value = ''; return; }
      const ed = currentEdits(), cur = ed[t.dataset.id] || {};
      const base = L.resolveSteps(DATA, ui.path, ui.abbr).find(s => s.id === t.dataset.id);
      cur[t.dataset.k] = Math.min(v, 260);
      if (t.dataset.k === 'low' && cur.high == null && cur.low > base.high) cur.high = cur.low;
      if (t.dataset.k === 'high' && cur.low == null && cur.high < base.low) cur.low = cur.high;
      if (cur.low != null && cur.high != null && cur.high < cur.low) { if (t.dataset.k === 'low') cur.high = cur.low; else cur.low = cur.high; }
      ed[t.dataset.id] = cur;
      const focusId = t.dataset.id, focusK = t.dataset.k;
      render();
      const again = $('steps').querySelector('input[data-id="' + focusId + '"][data-k="' + focusK + '"]');
      if (again) again.focus({ preventScroll: true });
    });
    $('reset').addEventListener('click', () => { ui.edits[editKey()] = {}; render(); });
  }

  async function init() {
    try {
      const [d, m] = await Promise.all([
        fetch('/data/launch-steps.json').then(r => { if (!r.ok) throw new Error('launch-steps.json ' + r.status); return r.json(); }),
        fetch('/data/expansion-map.json').then(r => { if (!r.ok) throw new Error('expansion-map.json ' + r.status); return r.json(); })
      ]);
      DATA = d; MAP = m;
      STATES = Object.fromEntries(MAP.states.map(s => [s.abbr, s]));
      $('state').innerHTML = MAP.states.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map(s => '<option value="' + esc(s.abbr) + '">' + esc(s.name) + (s.footprint ? ' (' + esc(s.footprint.label) + ')' : '') + '</option>').join('');
      renderSources();
      wire();
      const m2 = (location.hash || '').match(/^#([A-Z]{2})(?:\/(retail|utility))?$/);
      if (m2 && STATES[m2[1]]) {
        ui.abbr = m2[1];
        ui.path = m2[2] || L.suggestPath(STATES[m2[1]]).path;
        selectState(ui.abbr, true);
      } else {
        selectState('GA', false);
      }
    } catch (e) {
      $('err').hidden = false;
      $('err').textContent = 'Could not load planner data: ' + e.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
