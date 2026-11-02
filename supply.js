/* /supply page: renders data/supply.json. No logic beyond display. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One sourced fact: value, then publisher, date and link, with quality flags.
  function fact(f) {
    if (!f || !f.value) return '<p class="sp-none">Not found in public sources.</p>';
    const flags = [];
    if (f.stale) flags.push('<span class="sp-badge is-stale">older than 18 months</span>');
    if (f.source_quality) flags.push('<span class="sp-badge is-weak">' + esc(f.source_quality) + '</span>');
    if (f.basis === 'inference') flags.push('<span class="sp-badge is-read">inference</span>');
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
      (q.date ? ', ' + esc(q.date) : '') + (q.source_quality ? ' <span class="sp-badge is-weak">' + esc(q.source_quality) + '</span>' : '') + '</span></li>';
  }

  function part(p) {
    const alts = (p.alternatives || []).map(a => '<li><strong>' + esc(a.name) + '</strong>: ' + esc(a.note) +
      (a.url ? ' <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Source</a>' : '') + '</li>').join('');
    return '<article class="sp-card sp-part" id="part-' + esc(p.id) + '">' +
      '<div class="sp-part-head"><h2>' + esc(p.name) + '</h2><span class="sp-badge is-read">Our read: ' + esc(p.our_read.label) + '</span></div>' +
      '<p class="sp-what">' + esc(p.what_it_does) + '</p>' +
      '<p class="sp-risk">' + esc(p.risk_note) + '</p>' +
      '<div class="sp-grid">' + row('Lead time', p.lead_time) + row('Price trend', p.price_trend) + row('Where it comes from', p.concentration) + '</div>' +
      (p.policy && p.policy.length ? '<h3>US rules in 2026</h3><ul class="sp-list">' + p.policy.map(policy).join('') + '</ul>' : '') +
      (alts ? '<h3>Other suppliers or ways around it</h3><ul class="sp-list">' + alts + '</ul>' : '') +
      '</article>';
  }

  // Your bill of materials (yourdata.js + supply-core.js). Rendered above the public
  // watch list; the public research below is never changed.
  const usd = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const wk = n => n == null ? '' : (Math.round(n * 10) / 10) + ' wk';

  function bomCard(res, partNames) {
    const t = res.totals;
    const flagClass = { 'Will run short': 'is-short', 'Single source': 'is-single', 'Tariff 25%+': 'is-tariff' };
    const rows = res.rows.map(r => {
      const pub = partNames[r.category];
      return '<tr' + (r.gap > 0 ? ' class="is-short"' : '') + '>' +
        '<td data-label="Part"><strong>' + esc(r.part) + '</strong>' +
        (pub ? '<br><a class="sp-small" href="#part-' + esc(r.category) + '">Public research: ' + esc(pub) + '</a>' : '<br><span class="sp-small">' + esc(r.category) + '</span>') +
        (r.note ? '<br><span class="sp-small">' + esc(r.note) + '</span>' : '') + '</td>' +
        '<td data-label="Supplier">' + esc(r.supplier || 'Not given') + (r.country ? '<br><span class="sp-small">' + esc(r.country) + '</span>' : '') + '</td>' +
        '<td data-label="Lead time" class="num">' + wk(r.lead_time_weeks) + '</td>' +
        '<td data-label="Cover" class="num">' + (r.on_hand_weeks == null ? '<span class="sp-small">none given</span>' : wk(r.on_hand_weeks)) + '</td>' +
        '<td data-label="Gap" class="num"><strong>' + (r.gap > 0 ? '+' : '') + wk(r.gap) + '</strong></td>' +
        '<td data-label="Flags">' + (r.flags.length ? r.flags.map(f => '<span class="sp-badge sp-flagb ' + flagClass[f] + '">' + esc(f) + '</span>').join(' ') : '<span class="sp-small">None</span>') + '</td></tr>';
    }).join('');
    const longest = t.longest && t.longest.gap > 0 ? ' Longest gap: ' + esc(t.longest.part) + ', ' + wk(t.longest.gap) + '.' : '';
    const tariff = t.tariffParts ? ' Tariff cost per battery: ' + usd(t.tariffPerBattery) + ' across ' + t.tariffParts + ' part' + (t.tariffParts === 1 ? '' : 's') + ' with cost, quantity and tariff.' : ' Add unit_cost_usd, qty_per_unit and tariff_pct to see tariff cost per battery.';
    const sec = document.createElement('section');
    sec.className = 'sp-card sp-yd';
    sec.id = 'bom-wrap';
    sec.setAttribute('aria-labelledby', 'bom-title');
    sec.innerHTML = '<div class="sp-part-head"><h2 id="bom-title">Your bill of materials</h2><span class="sp-badge sp-yours">Your data</span></div>' +
      '<p class="sp-small">From your file, read in this browser only. Not public research. Gap is lead time minus weeks of cover (inventory plus open orders); a missing cover counts as zero.</p>' +
      '<p class="sp-yd-sum"><strong>' + t.atRisk + ' of ' + t.parts + ' part' + (t.parts === 1 ? '' : 's') + ' will run short.</strong>' +
      (t.singleSource ? ' ' + t.singleSource + ' single sourced.' : '') + longest + tariff + '</p>' +
      '<div class="sp-yd-scroll"><table class="sp-yd-table"><thead><tr><th>Part</th><th>Supplier</th><th class="num">Lead time</th><th class="num">Cover</th><th class="num">Gap</th><th>Flags</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return sec;
  }

  function showBom(res, partNames) {
    hideBom();
    const at = $('status');
    at.parentNode.insertBefore(bomCard(res, partNames), at);
  }

  function hideBom() {
    const old = $('bom-wrap');
    if (old) old.remove();
  }

  function mountYourData(d) {
    const S = window.SupplyCore, Y = window.YourData;
    if (!S || !Y || !$('yourdata')) return;
    const ids = d.parts.map(p => p.id);
    const partNames = Object.fromEntries(d.parts.map(p => [p.id, p.name]));
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

  async function init() {
    try {
      const r = await fetch('/data/supply.json');
      if (!r.ok) throw new Error('supply.json ' + r.status);
      const d = await r.json();
      $('order').innerHTML = d.parts.map(p => '<li><a href="#part-' + esc(p.id) + '">' + esc(p.name) + '</a> <span class="sp-badge is-read">' + esc(p.our_read.label) + '</span><br><span class="sp-small">' + esc(p.our_read.why) + '</span></li>').join('');
      $('parts').innerHTML = d.parts.map(part).join('');
      $('base').innerHTML = d.base_public.map(b => '<li>' + esc(b.claim) + ' <span class="sp-src">' +
        (b.url ? '<a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.publisher) + '</a>' : esc(b.publisher || '')) +
        (b.date ? ', ' + esc(b.date) : '') + (b.stale ? ' <span class="sp-badge is-stale">older than 18 months</span>' : '') +
        (b.source_quality ? ' <span class="sp-badge is-weak">' + esc(b.source_quality) + '</span>' : '') + '</span></li>').join('');
      $('gaps').innerHTML = d.gaps.map(g => '<li>' + esc(g) + '</li>').join('');
      for (const id of ['order-wrap', 'base-wrap', 'gaps-wrap']) $(id).hidden = false;
      $('status').hidden = true;
      mountYourData(d);
    } catch (e) {
      $('status').textContent = 'Could not load supply data: ' + e.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
