/* ZIP card on /launch. Reads data/zip-launch.json in the browser and renders ZipLaunch.lookup. */
(function () {
  'use strict';
  const Z = window.ZipLaunch;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let DATA = null;
  let lastZip = '';

  function link(src) {
    if (!src) return '';
    const external = String(src.url || '').startsWith('http');
    const dated = src.dated ? ', dated ' + esc(src.dated) : '';
    return '<a href="' + esc(src.url) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(src.title) + '</a> (retrieved ' + esc(src.retrieved) + dated + ')';
  }

  function srcById(id) {
    return DATA && DATA.sources ? DATA.sources[id] : null;
  }

  function pct(n) {
    if (n == null || !Number.isFinite(Number(n))) return 'unknown';
    return (Math.round(Number(n) * 1000) / 10) + '%';
  }

  function fact(label, value, extra) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + value + (extra ? '<small>' + extra + '</small>' : '') + '</dd></div>';
  }

  function render(out) {
    const box = $('zip-result');
    if (out.errors && out.errors.length) {
      box.innerHTML = '<p class="notice notice-red">' + out.errors.map(esc).join('<br>') + '</p>';
      return;
    }
    const r = out.result;
    const warns = (out.warnings || []).map((w) => '<p class="lp-small">' + esc(w) + '</p>').join('');
    if (!r.covered) {
      box.innerHTML = warns + '<dl class="lp-facts">' +
        fact('Wires utility', esc(Z.UNKNOWN)) +
        fact('Permit office', esc(Z.UNKNOWN)) +
        fact('Interconnection path', esc(Z.UNKNOWN)) +
        fact('Days to first install', esc(Z.UNKNOWN)) +
        '</dl><p class="lp-small">This ZIP is not in the file. ' + esc(r.coverage_note) + '</p>';
      return;
    }
    const utils = r.utilities.length
      ? r.utilities.map((u) => '<div class="lp-zip-util"><strong>' + esc(u.name) + '</strong> <span class="badge badge-green">sourced</span><br><span class="lp-small">EIA ' + esc(u.eia_id) + '. ' + esc(u.ownership) + '. ' + esc(u.service_type) + '. ' + esc(u.path.label) + '.</span><p class="lp-small">' + esc(u.path.detail) + '</p></div>').join('')
      : '<p><strong>' + esc(Z.UNKNOWN) + '</strong></p>';
    const ahj = r.ahj;
    const solar = r.solarapp;
    const days = r.days_to_first_install;
    const inputs = days.inputs.map((i) => '<li><code>' + esc(i.id) + '</code>: <strong>' + esc(i.display) + '</strong>. ' + esc(i.detail) + '</li>').join('');
    const clocks = days.clocks.length
      ? days.clocks.map((c) => '<li><strong>' + esc(c.display) + '</strong> <span class="badge badge-green">sourced</span><p>' + esc(c.about) + '</p><p class="lp-small">"' + esc(c.quote) + '" ' + link(srcById(c.source)) + '.</p></li>').join('')
      : '<li>No published clock matches this utility. The interconnection input stays <strong>unknown</strong>.</li>';
    const solarBits = solar.on_list
      ? 'Yes. PV ' + (solar.pv ? 'yes' : 'no') + ', solar plus storage ' + (solar.solar_plus_storage ? 'yes' : 'no') + (solar.subtitle ? '. ' + solar.subtitle : '') + '.'
      : (solar.display === 'no' ? 'No.' : 'unknown');
    box.innerHTML = warns +
      '<dl class="lp-facts">' +
      fact('Wires utility', r.utilities.length ? esc(r.utilities.map((u) => u.name).join('; ')) : esc(Z.UNKNOWN), r.utilities.length ? '' : '') +
      fact('Permit office', esc(ahj.name), esc(ahj.kind === 'city' ? 'City' : 'County') + ', ' + esc(pct(ahj.land_share)) + ' of this ZIP\'s census land') +
      fact('Interconnection path', esc(r.interconnection_path.label)) +
      fact('SolarAPP+', esc(solarBits)) +
      fact('Days to first install', esc(days.display), days.display === 'unknown' ? 'calendar days' : 'calendar days') +
      '</dl>' +
      '<h3>Who the file names</h3>' + utils +
      '<p class="lp-small"><span class="badge badge-yellow">This site\'s rule</span> ' + esc(ahj.rule) + '</p>' +
      '<p>' + esc(r.interconnection_path.detail) + '</p>' +
      '<p class="lp-small">' + esc(solar.note) + (solar.file_modified ? ' List file date ' + esc(solar.file_modified) + '.' : '') + (solar.url ? ' <a href="' + esc(solar.url) + '" target="_blank" rel="noopener">Jurisdiction page</a>.' : '') + '</p>' +
      '<h3>Days</h3>' +
      '<p><code>' + esc(days.formula) + '</code></p>' +
      '<p class="lp-small">' + esc(days.rule) + '</p>' +
      '<ul class="lp-snags">' + inputs + '</ul>' +
      '<h3>Published clocks for this ZIP</h3><ul class="lp-snags">' + clocks + '</ul>';
  }

  function go(zip) {
    lastZip = zip;
    $('zip-input').value = zip;
    render(Z.lookup(DATA, zip));
  }

  function renderFileNotes() {
    $('zip-explainer').textContent = DATA.explainer;
    $('zip-coverage').textContent = DATA.coverage.note;
    const gaps = (DATA.coverage.gaps || []).map((g) => '<li>' + esc(g) + '</li>').join('');
    const clocks = (DATA.clocks || []).map((c) => '<li><strong>' + esc(c.display) + '</strong>. ' + esc(c.about) + ' <span class="lp-small">' + link(srcById(c.source)) + '.</span></li>').join('');
    $('zip-gaps').innerHTML = '<ul>' + gaps + '</ul>';
    $('zip-all-clocks').innerHTML = '<ul>' + clocks + '</ul>';
  }

  async function init() {
    if (!Z || !$('zip-form')) return;
    try {
      const res = await fetch('/data/zip-launch.json');
      if (!res.ok) throw new Error('zip-launch.json ' + res.status);
      DATA = await res.json();
      renderFileNotes();
      $('zip-form').addEventListener('submit', (e) => {
        e.preventDefault();
        go($('zip-input').value);
      });
      $('zip-examples').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-zip]');
        if (!b) return;
        go(b.dataset.zip);
      });
      go('78704');
    } catch (e) {
      $('zip-explainer').textContent = 'The ZIP lookup could not load its data.';
      $('zip-result').innerHTML = '<p class="notice notice-red">' + esc(e.message) + '</p>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
