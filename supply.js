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
    } catch (e) {
      $('status').textContent = 'Could not load supply data: ' + e.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
