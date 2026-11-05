/* /supply page: renders data/supply.json. No logic beyond display. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SRC = '/data/supply.json';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One sourced fact: value, then publisher, date and link, with quality flags.
  function fact(f) {
    if (!f || !f.value) return '<p class="sp-none">Not found in public sources.</p>';
    const flags = [];
    if (f.stale) flags.push('<span class="badge badge-orange">older than 18 months</span>');
    if (f.source_quality) flags.push('<span class="badge badge-white">' + esc(f.source_quality) + '</span>');
    if (f.basis === 'inference') flags.push('<span class="badge badge-yellow">inference</span>');
    return '<p>' + esc(f.value) + '</p>' +
      (f.quote ? '<p class="sp-quote">"' + esc(f.quote) + '"</p>' : '') +
      '<p class="sp-src">' + (f.url ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.publisher || 'Source') + '</a>' : esc(f.publisher || '')) +
      (f.date ? ', ' + esc(f.date) : ', undated') + (flags.length ? ' ' + flags.join(' ') : '') + '</p>';
  }

  function row(label, f) {
    return '<div class="sp-row"><h4>' + esc(label) + '</h4>' + fact(f) + '</div>';
  }

  function policy(q) {
    return '<li><strong>' + esc(q.name) + '</strong>' + (q.value ? ': ' + esc(q.value) : '') +
      (q.status ? '<br><span class="sp-small">Status: ' + esc(q.status) + '</span>' : '') +
      '<br><span class="sp-src">' + (q.url ? '<a href="' + esc(q.url) + '" target="_blank" rel="noopener">' + esc(q.publisher || 'Source') + '</a>' : '') +
      (q.date ? ', ' + esc(q.date) : '') + (q.source_quality ? ' <span class="badge badge-white">' + esc(q.source_quality) + '</span>' : '') + '</span></li>';
  }

  // A sourced list item: bold title, note or value, verbatim quote, then publisher, date and link.
  function sourced(title, text, s) {
    const src = s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher || 'Source') + '</a>' : esc(s.publisher || '');
    return '<li><strong>' + esc(title) + '</strong>' + (text ? ': ' + esc(text) : '') +
      (s.quote ? '<br><span class="sp-quote">"' + esc(s.quote) + '"</span>' : '') +
      '<br><span class="sp-src">' + src + (s.date ? (src ? ', ' : '') + esc(s.date) : '') +
      (s.basis === 'inference' ? ' <span class="badge badge-yellow">inference</span>' : '') + '</span>' +
      (s.more || []).map(x => '<br><span class="sp-quote">"' + esc(x.quote) + '"</span><br><span class="sp-src">' +
        (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.publisher || 'Source') + '</a>' : esc(x.publisher || '')) +
        (x.date ? ', ' + esc(x.date) : '') + '</span>').join('') + '</li>';
  }

  // Optional deeper sections (used by the memory card): which parts, end-of-life notices, what to do about it.
  function extras(p) {
    const sec = (title, a, fn) => Array.isArray(a) && a.length ? '<h3>' + esc(title) + '</h3><ul class="sp-list">' + a.map(fn).join('') + '</ul>' : '';
    return sec('Which parts', p.memory_parts, x => sourced(x.part, x.note, x)) +
      sec('End of life and allocation', p.eol, x => sourced(x.who, x.value, x)) +
      sec('What to do about it', p.mitigations, x => sourced(x.name, x.note, x));
  }

  function part(p) {
    const alts = (p.alternatives || []).map(a => '<li><strong>' + esc(a.name) + '</strong>: ' + esc(a.note) +
      (a.url ? ' <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Source</a>' : '') + '</li>').join('');
    return '<article class="card sp-card sp-part" id="part-' + esc(p.id) + '">' +
      '<div class="sp-part-head"><h2>' + esc(p.name) + '</h2><span class="badge badge-yellow">Our read: ' + esc(p.our_read.label) + '</span></div>' +
      '<p class="sp-what">' + esc(p.what_it_does) + '</p>' +
      '<p class="sp-risk">' + esc(p.risk_note) + '</p>' +
      '<div class="sp-grid">' + row('Lead time', p.lead_time) + row('Price trend', p.price_trend) + row('Where it comes from', p.concentration) + '</div>' +
      extras(p) +
      (p.policy && p.policy.length ? '<h3>US rules in 2026</h3><ul class="sp-list">' + p.policy.map(policy).join('') + '</ul>' : '') +
      (alts ? '<h3>Other suppliers or ways around it</h3><ul class="sp-list">' + alts + '</ul>' : '') +
      '</article>';
  }

  // Your bill of materials (yourdata.js + supply-core.js). Rendered above the public
  // watch list; the public research below is never changed.
  // Shared with the API, so a short part never reads as "0 wk" and the summary names only what is missing.
  const wk = (n, d) => window.SupplyCore.weeksText(n, d);

  function bomCard(res, partNames) {
    // Risk flags use the shared badge mapping: shortage and single source are risks (red), tariff is neutral.
    const flagClass = { 'Will run short': 'badge-red', 'Single source': 'badge-red', 'Tariff 25%+': '' };
    const rows = res.rows.map(r => {
      const pub = partNames.get(r.category);
      return '<tr' + (r.gap > 0 ? ' class="is-short"' : '') + '>' +
        '<td data-label="Part"><strong>' + esc(r.part) + '</strong>' +
        (pub ? '<br><a class="sp-small" href="#part-' + esc(r.category) + '">Public research: ' + esc(pub) + '</a>' : '<br><span class="sp-small">' + esc(r.category) + '</span>') +
        (r.note ? '<br><span class="sp-small">' + esc(r.note) + '</span>' : '') + '</td>' +
        '<td data-label="Supplier">' + esc(r.supplier || 'Not given') + (r.country ? '<br><span class="sp-small">' + esc(r.country) + '</span>' : '') + '</td>' +
        '<td data-label="Lead time" class="num">' + wk(r.lead_time_weeks, r.digits) + '</td>' +
        '<td data-label="Cover" class="num">' + (r.on_hand_weeks == null ? '<span class="sp-small">none given</span>' : wk(r.on_hand_weeks, r.digits)) + '</td>' +
        '<td data-label="Gap" class="num"><strong>' + (r.gap > 0 && !/^under/.test(wk(r.gap, r.digits)) ? '+' : '') + wk(r.gap, r.digits) + '</strong></td>' +
        '<td data-label="Flags">' + (r.flags.length ? r.flags.map(f => '<span class="badge sp-flagb' + (flagClass[f] ? ' ' + flagClass[f] : '') + '">' + esc(f) + '</span>').join(' ') : '<span class="sp-small">None</span>') + '</td></tr>';
    }).join('');
    const sum = window.SupplyCore.summary(res);
    const sec = document.createElement('section');
    sec.className = 'card sp-card sp-yd';
    sec.id = 'bom-wrap';
    sec.setAttribute('aria-labelledby', 'bom-title');
    sec.innerHTML = '<div class="sp-part-head"><h2 id="bom-title">Your bill of materials</h2><span class="badge badge-solid">Your data</span></div>' +
      '<p class="sp-small">From your file, read in this browser only. Not public research. Gap is lead time minus weeks of cover (inventory plus open orders); a missing cover counts as zero.</p>' +
      '<p class="sp-yd-sum"><strong>' + esc(sum.head) + '</strong>' + esc(sum.rest) + '</p>' +
      '<div class="sp-yd-scroll"><table class="ds-table sp-yd-table"><thead><tr><th>Part</th><th>Supplier</th><th class="num">Lead time</th><th class="num">Cover</th><th class="num">Gap</th><th>Flags</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return sec;
  }

  function showBom(res, partNames) {
    hideBom();
    $('bom-slot').appendChild(bomCard(res, partNames));
  }

  function hideBom() {
    const old = $('bom-wrap');
    if (old) old.remove();
  }

  function mountYourData(d) {
    const S = window.SupplyCore, Y = window.YourData;
    if (!S || !Y || !$('yourdata')) return;
    const ids = d.parts.map(p => p.id);
    const partNames = new Map(d.parts.map(p => [p.id, p.name])); // a Map: categories from a file never reach Object.prototype
    Y.mount({
      el: $('yourdata'),
      tool: 'supply',
      what: 'your own bill of materials: parts, suppliers, lead times and stock',
      docs: '/plug-and-play#supply',
      templates: [{ name: 'supply-bom.csv', label: 'Download CSV template', text: () => Y.toCSV(S.templateRows(ids), S.COLUMNS) }],
      load(parsed) {
        const v = S.validate(parsed, ids);
        const res = v.errors.length ? null : S.analyze(v.rows);
        return {
          errors: v.errors,
          warnings: v.warnings,
          summary: res ? res.totals.parts + ' part' + (res.totals.parts === 1 ? '' : 's') + ', ' + res.totals.atRisk + ' will run short. See "Your bill of materials" below.' : '',
          apply: () => showBom(res, partNames),
        };
      },
      reset: hideBom,
    });
  }

  const empty = msg => '<li class="sp-none">' + esc(msg) + '</li>';
  const list = (a, fn, msg) => Array.isArray(a) && a.length ? a.map(fn).join('') : empty(msg);

  async function init() {
    const st = $('status');
    st.className = 'sp-status';
    st.hidden = false;
    st.textContent = 'Loading supply data...';
    try {
      const r = await fetch(SRC);
      if (!r.ok) throw new Error('supply.json ' + r.status);
      const d = await r.json();
      if (!d || !Array.isArray(d.parts)) throw new Error('supply.json has no parts list');
      $('order').innerHTML = list(d.parts, p => '<li><a href="#part-' + esc(p.id) + '">' + esc(p.name) + '</a> <span class="badge badge-yellow">' + esc(p.our_read.label) + '</span><br><span class="sp-small">' + esc(p.our_read.why) + '</span></li>', 'No parts in the data yet.');
      $('parts').innerHTML = d.parts.map(part).join('');
      $('base').innerHTML = list(d.base_public, b => '<li>' + esc(b.claim) + ' <span class="sp-src">' +
        (b.url ? '<a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.publisher) + '</a>' : esc(b.publisher || '')) +
        (b.date ? ', ' + esc(b.date) : '') + (b.stale ? ' <span class="badge badge-orange">older than 18 months</span>' : '') +
        (b.source_quality ? ' <span class="badge badge-white">' + esc(b.source_quality) + '</span>' : '') + '</span></li>', 'No public statements from Base found yet.');
      $('gaps').innerHTML = list(d.gaps, g => '<li>' + esc(g) + '</li>', 'No known gaps listed.');
      for (const id of ['order-wrap', 'base-wrap', 'gaps-wrap']) $(id).hidden = false;
      st.hidden = true;
      mountYourData(d);
    } catch (e) {
      st.className = 'notice notice-red sp-status';
      st.innerHTML = 'Could not load supply data (' + esc(e.message) + '). Check your connection, then ' +
        '<button type="button" class="btn btn-outline btn-sm" id="retry">Try again</button>';
      $('retry').addEventListener('click', init);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
