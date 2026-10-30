/* /pitch page controller. Pure logic lives in pitch-core.js (window.PitchCore). */
(function () {
  'use strict';
  var P = window.PitchCore;
  var DEFAULT_ID = '5078-TX'; // CoServ, a member-owned co-op Base names publicly
  var state = { data: null, market: null, byLabel: {}, byId: {}, selected: null, built: false };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function num(v, d) { return P.fmtNum(v, d); }
  function pctText(v) { return P.isNum(v) ? Math.round(v * 100) + '%' : 'not published'; }
  function share(v) {
    if (!P.isNum(v)) return 'not published';
    var p = v * 100;
    return (p < 1 ? p.toFixed(2) : p.toFixed(1)) + '%';
  }
  function money(x) {
    if (!P.isNum(x)) return 'n/a';
    var m = x / 1e6;
    if (m >= 1000) return '$' + (m / 1000).toFixed(1) + 'B';
    return '$' + (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US')) + 'M';
  }
  function ratio(a, b) { return P.isNum(a) && P.isNum(b) && b > 0 ? (a / b).toFixed(1) + 'x' : null; }
  function label(u) { return P.displayName(u) + ', ' + u.state; }
  function link(src, text) { return '<a href="' + esc(src.url) + '" rel="noopener">' + esc(text || src.title) + '</a>'; }

  function init() {
    Promise.all([
      fetch('/data/expansion-map.json').then(function (r) { return r.json(); }),
      fetch('/data/market-states.json').then(function (r) { return r.json(); })
    ]).then(function (res) {
      state.data = res[0];
      state.market = res[1];
      var list = $('utility-list');
      var frag = document.createDocumentFragment();
      state.data.utilities.slice().sort(function (a, b) { return label(a) < label(b) ? -1 : 1; }).forEach(function (u) {
        var l = label(u);
        state.byLabel[l.toLowerCase()] = u;
        state.byId[u.id] = u;
        var o = document.createElement('option');
        o.value = l;
        frag.appendChild(o);
      });
      list.appendChild(frag);
      var start = state.byId[DEFAULT_ID] || state.data.utilities[0];
      select(start);
      $('status').textContent = 'Ready. Data: ' + state.data.vintage.split('.')[0] + '.';
    }).catch(function () {
      $('status').textContent = 'Could not load the public data files. Reload to try again.';
    });

    $('controls').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = matchInput();
      if (!u) { $('status').textContent = 'Pick a utility from the list.'; return; }
      state.selected = u;
      state.built = true;
      $('print').disabled = false;
      render();
      $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('utility').addEventListener('input', function () {
      var u = matchInput();
      if (u) { state.selected = u; if (state.built) render(); }
    });
    $('mw').addEventListener('input', function () { if (state.built) render(); });
    $('largeloads').addEventListener('change', function () { if (state.built) render(); });
    $('print').addEventListener('click', function () { window.print(); });
    $('ranking').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      select(state.byId[b.getAttribute('data-id')]);
      render();
      $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function matchInput() {
    var v = $('utility').value.trim().toLowerCase();
    return state.byLabel[v] || null;
  }

  function select(u) {
    if (!u) return;
    state.selected = u;
    $('utility').value = label(u);
  }

  function sourcesFor(u, pick) {
    var d = state.data, m = state.market;
    var find = function (prefix) { return d.sources.filter(function (s) { return s.title.indexOf(prefix) === 0; })[0]; };
    var eia = find('EIA Form 861'), fema = find('FEMA National Risk Index');
    var list = [
      { key: 'eia', title: eia.title, url: eia.url, date: 'released 7 Oct 2026; compiled in /data/expansion-map.json on ' + d.generated },
      { key: 'fema', title: fema.title, url: fema.url, date: 'version December 2025, queried 2026-10-27' },
      { key: 'epa', title: m.sources.reliability.title, url: m.sources.reliability.url, date: 'years 2024 and 2025, retrieved ' + m.retrieved },
      { key: 'price', title: m.sources.price.title, url: m.sources.price.url, date: 'year 2024, retrieved ' + m.retrieved },
      { key: 'base', title: P.BASE_SOURCE.title, url: P.BASE_SOURCE.url, date: 'retrieved ' + P.BASE_SOURCE.retrieved }
    ];
    if (pick.source) list.push({ key: 'ercot', title: pick.source.title, url: pick.source.url, date: 'retrieved ' + pick.source.retrieved });
    var k = P.KNOWN[u.id];
    if (k && k.aliasSource) list.push({ key: 'alias', title: k.aliasSource.title, url: k.aliasSource.url, date: 'retrieved ' + k.aliasSource.retrieved });
    if (k && k.source && k.source.url !== P.BASE_SOURCE.url) list.push({ key: 'known', title: k.source.title, url: k.source.url, date: k.source.retrieved });
    list.forEach(function (s, i) { s.n = i + 1; });
    return list;
  }

  function ref(sources, key) {
    var s = sources.filter(function (x) { return x.key === key; })[0];
    return s ? '<sup class="pt-ref"><a href="#src-' + s.n + '">[' + s.n + ']</a></sup>' : '';
  }

  function render() {
    var u = state.selected;
    if (!u || !state.data) return;
    var d = state.data, m = state.market;
    var st = d.states.filter(function (s) { return s.abbr === u.state; })[0] || { name: u.state, values: {} };
    var ms = m.states.filter(function (s) { return s.name === st.name; })[0] || {};
    var mw = parseFloat($('mw').value);
    var prog = P.sizeProgram(mw, u.values.homes);
    var pcts = P.signalPercentiles(u, d.utilities);
    var sig = P.strongestSignal(pcts);
    var pick = P.pickOffer(u, pcts, { largeLoads: $('largeloads').checked });
    var src = sourcesFor(u, pick);
    var r = function (k) { return ref(src, k); };
    var name = P.shortName(u);
    var today = new Date().toISOString().slice(0, 10);
    var known = P.KNOWN[u.id];
    var h = [];

    h.push('<p class="pt-sheet-meta">Outside view from public data. Prepared ' + today + '. Not affiliated with Base Power.</p>');
    h.push('<h2 class="pt-headline">' + esc(P.headline(u, sig)) + '</h2>');
    h.push('<p class="pt-sub">' + esc(P.displayName(u)) + ', ' + esc(st.name) + '. ' + num(u.values.homes) + ' residential customers' + r('eia') + '. Balancing authority: ' + esc(u.detail.rtos) + r('eia') + '.</p>');
    if (known) h.push('<p class="pt-known"><strong>Public link to Base:</strong> ' + esc(known.note) + ' ' + (known.source.url === P.BASE_SOURCE.url ? r('base') : r('known')) + (known.aliasSource ? ' EIA lists CoServ under its legal name, Denton County Electric Cooperative.' + r('alias') : '') + '</p>');

    // Program
    if (prog) {
      h.push('<section class="pt-block"><h3>The program</h3><dl class="pt-stats">' +
        stat(num(prog.mw, prog.mw % 1 ? 1 : 0) + ' MW', 'nameplate, your input') +
        stat(num(prog.batteries), 'home batteries at 20 kW each' + r('base')) +
        stat(num(prog.mwh, 1) + ' MWh', 'at 39.2 kWh each' + r('base')) +
        stat(share(prog.share), 'of residential customers would need to enroll') +
        '</dl><p class="pt-note">About ' + prog.hours.toFixed(2) + ' hours at full output, derived from Base\'s claimed spec. Nameplate is not accredited capacity, and each home keeps a backup reserve, so the dispatchable share is a question below.' +
        (P.isNum(prog.share) && prog.share > 1 ? ' <strong>This program needs more batteries than the utility has residential customers.</strong>' : '') + '</p></section>');
    } else {
      h.push('<section class="pt-block"><h3>The program</h3><p class="pt-note">Enter a program size above zero.</p></section>');
    }

    // Problem
    var rows = [
      ['Outage minutes per customer (SAIDI, 2025, with major events)', num(u.values.saidi, 0), num(st.values.saidi, 0), num(m.us.saidi_2025, 0) + r('epa'), pcts.saidi, 'eia'],
      ['Outages per customer (SAIFI, 2025, with major events)', num(u.values.saifi, 2), num(st.values.saifi, 2), 'not in this file', pcts.saifi, 'eia'],
      ['Storm risk (FEMA NRI score, 0 to 100)', num(u.values.storm, 1), num(st.values.storm, 1), 'n/a', pcts.storm, 'fema'],
      ['Heat-wave risk (FEMA NRI score, 0 to 100)', num(u.values.heat, 1), num(st.values.heat, 1), 'n/a', pcts.heat, 'fema'],
      ['Demand-response enrollments per 1,000 homes', num(u.values.demand_response, 1), num(st.values.demand_response, 1), 'n/a', pcts.demand_response, 'eia'],
      ['Net-metered home batteries per 1,000 homes', num(u.values.batteries, 2), num(st.values.batteries, 2), 'n/a', pcts.batteries, 'eia'],
      ['Dynamic-pricing enrollments per 1,000 homes', num(u.values.dynamic_pricing, 1), num(st.values.dynamic_pricing, 1), 'n/a', pcts.dynamic_pricing, 'eia'],
      ['Residential customers in an ISO or RTO', pctText(u.values.wholesale), pctText(st.values.wholesale), 'n/a', null, 'eia'],
      ['Residential customers on a retail provider', pctText(u.values.retail), pctText(st.values.retail), 'n/a', null, 'eia']
    ];
    var t = '<div class="pt-table-wrap"><table class="pt-table pt-problem"><thead><tr><th scope="col">Signal</th><th scope="col">' + esc(name) + '</th><th scope="col">' + esc(st.name) + '</th><th scope="col">US</th><th scope="col">Rank among US utilities</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var p = row[4];
      var rank = p && P.isNum(p.pct) ? 'higher than ' + Math.round(p.pct * 100) + '% of ' + num(p.n) : (p ? 'not published' : '');
      t += '<tr><th scope="row">' + esc(row[0]) + r(row[5]) + '</th><td data-label="' + esc(name) + '">' + row[1] + '</td><td data-label="' + esc(st.name) + '">' + row[2] + '</td><td data-label="US">' + row[3] + '</td><td data-label="Rank">' + rank + '</td></tr>';
    });
    t += '</tbody></table></div>';
    var said = [];
    var rs = ratio(u.values.saidi, st.values.saidi), ru = ratio(u.values.saidi, m.us.saidi_2025);
    if (rs && ru) said.push('Outage minutes run ' + rs + ' the ' + esc(st.name) + ' total and ' + ru + ' the US figure.');
    if (P.isNum(ms.cents_kwh)) said.push(esc(st.name) + ' homes paid ' + ms.cents_kwh.toFixed(2) + ' cents/kWh and $' + ms.bill_usd.toFixed(2) + ' a month on average in 2024, against ' + m.us.cents_kwh.toFixed(2) + ' cents and $' + m.us.bill_usd.toFixed(2) + ' for the US' + r('price') + '. That is a state average, not this utility\'s tariff.');
    h.push('<section class="pt-block"><h3>The problem, in its own numbers</h3>' + (said.length ? '<p>' + said.join(' ') + '</p>' : '') + t +
      '<p class="pt-note">Utility and state SAIDI come from EIA-861 2025. The US figure comes from EIA\'s Electric Power Annual, a different table, so treat the US comparison as rough. Utility reporting method: ' + esc(u.detail.note) + '. Storm and heat scores are population-weighted over the counties EIA lists in the service territory.</p></section>');

    // Offer
    var others = ['bulk', 'distribution', 'speed'].filter(function (k) { return k !== pick.offer.id; }).map(function (k) { return P.OFFERS[k]; });
    h.push('<section class="pt-block pt-offer"><h3>The offer that fits: ' + esc(pick.offer.name) + '</h3>' +
      '<blockquote>"' + esc(pick.offer.quote) + '"' + r('base') + '</blockquote>' +
      '<p><strong>Why, by rule ' + pick.rule + ':</strong> ' + esc(pick.reason) + (pick.source ? r('ercot') : '') + '</p>' +
      '<p class="pt-note">Also on Base\'s menu: ' + others.map(function (o) { return esc(o.name); }).join(' and ') + '. Speed to power is picked only when you mark a large-load queue, because no public file here shows one.</p></section>');

    // Speed and cost
    var ct = '<div class="pt-table-wrap"><table class="pt-table pt-claims"><thead><tr><th scope="col">Option</th><th scope="col">Time to deploy 100 MW</th><th scope="col">Landed cost of storage</th><th scope="col">This program at that cost</th></tr></thead><tbody>';
    P.CLAIMS_TABLE.forEach(function (row) {
      var c = prog ? P.landedCost(prog.mwh, row) : null;
      var range = c ? (c.low === c.high ? money(c.low) : money(c.low) + ' to ' + money(c.high)) : 'n/a';
      ct += '<tr><th scope="row">' + esc(row.option) + '</th><td data-label="Time, 100 MW">' + esc(row.time) + '</td><td data-label="Cost">' + esc(row.cost) + '</td><td data-label="This program">' + range + '</td></tr>';
    });
    ct += '</tbody></table></div>';
    h.push('<section class="pt-block"><h3>Speed and cost, as Base states them</h3>' +
      '<p><span class="pt-tag pt-tag-claimed">Base\'s claim</span> The first three columns are Base\'s own comparison table, which Base attributes to EnergySage, Lazard and Wood Mackenzie' + r('base') + '. The last column multiplies those $/kWh figures by this program\'s ' + (prog ? num(prog.mwh, 1) : 'n/a') + ' MWh. It is arithmetic on a claim, not a quote.</p>' + ct +
      '<p class="pt-note">Base also claims: deployment across 3 metros and 6 utilities in the last 12 months, an in-house deployment factory, dispatch up to 500 cycles a year, 96% fleet availability, and a field-demonstrated forced outage rate under 5%' + r('base') + '.</p></section>');

    // Deal structure
    h.push('<section class="pt-block"><h3>Deal structure</h3><div class="pt-deals">' +
      '<div><h4>Toll</h4><p>Base owns the batteries. The utility pays for performance' + r('base') + '.</p><p class="pt-note">To settle: term, the performance metric, and penalties for shortfall.</p></div>' +
      '<div><h4>Build-transfer</h4><p>Base builds the fleet and the utility takes ownership' + r('base') + '.</p><p class="pt-note">To settle: who operates the fleet after transfer, and how the asset is financed and approved.</p></div>' +
      '</div><p class="pt-note">Either way, Base says the utility keeps full dispatch rights 24/7/365 and members always keep a minimum backup reserve' + r('base') + '.</p></section>');

    // Questions
    h.push('<section class="pt-block"><h3>Questions to answer together</h3><ol class="pt-questions">' +
      P.questions(u, pick).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></section>');

    // Real vs claimed vs assumed
    h.push('<section class="pt-block pt-rca"><h3>Real vs claimed vs assumed</h3><div class="pt-rca-grid">' +
      '<div class="pt-rca-real"><h4><span class="pt-tag pt-tag-real">Real</span> Public data</h4><ul>' +
        '<li>Customers, SAIDI, SAIFI, ISO share, retail share, batteries, demand response and dynamic pricing: EIA-861 2025' + r('eia') + '.</li>' +
        '<li>Storm and heat-wave risk: FEMA National Risk Index' + r('fema') + '.</li>' +
        '<li>US SAIDI and state prices and bills: EIA' + r('epa') + r('price') + '.</li>' +
        (known ? '<li>' + esc(known.note) + '</li>' : '') +
      '</ul></div>' +
      '<div class="pt-rca-claimed"><h4><span class="pt-tag pt-tag-claimed">Claimed</span> Base\'s marketing</h4><ul>' +
        '<li>20 kW / 39.2 kWh per home battery.</li><li>3 to 6 months to deploy 100 MW; ~$300 to $400/kWh landed.</li>' +
        '<li>Up to 500 cycles a year, 96% fleet availability, under 5% forced outage rate.</li>' +
        '<li>No new interconnection agreements or substation upgrades "in most cases".</li>' +
        '<li>Utility keeps full dispatch rights; members keep a backup reserve.' + r('base') + '</li>' +
      '</ul></div>' +
      '<div class="pt-rca-assumed"><h4><span class="pt-tag pt-tag-assumed">Assumed</span> Choices made here</h4><ul>' +
        '<li>Program size: ' + (prog ? num(prog.mw) : 'n/a') + ' MW nameplate, every battery a full 20 kW unit.</li>' +
        '<li>Offer cutoffs: top 25% of US utilities for outages; half of customers in an ISO or RTO.</li>' +
        '<li>Large-load queue: ' + ($('largeloads').checked ? 'marked by you' : 'not marked') + '.</li>' +
        '<li>Call ranking: residential customers x SAIDI as a stand-in for customer minutes interrupted.</li>' +
        '<li>No enrollment rate, accreditation share, or price per kW-year is assumed. Those are questions.</li>' +
      '</ul></div></div></section>');

    // Sources
    h.push('<section class="pt-block pt-sources"><h3>Sources</h3><ol>' + src.map(function (s) {
      return '<li id="src-' + s.n + '">' + link(s) + '. <span class="pt-note">' + esc(s.date) + '.</span></li>';
    }).join('') + '</ol></section>');

    $('sheet').innerHTML = h.join('');
    $('sheet').hidden = false;
    renderRanking(u, st);
  }

  function stat(v, l) { return '<div><dt>' + l + '</dt><dd>' + v + '</dd></div>'; }

  function renderRanking(u, st) {
    var all = P.rankState(state.data.utilities, u.state, Infinity);
    var top = all.slice(0, 10);
    var mine = all.filter(function (x) { return x.id === u.id; })[0];
    if (mine && mine.rank > 10) top.push(mine);
    $('ranking-title').textContent = 'Who to call first in ' + st.name;
    $('ranking-help').textContent = all.length + ' utilities in ' + st.name + ' in this file. Ranked by residential customers x SAIDI minutes (EIA-861 2025). Pick one to rebuild the pitch.';
    var t = '<thead><tr><th scope="col">#</th><th scope="col">Utility</th><th scope="col">Residential customers</th><th scope="col">SAIDI min</th><th scope="col">Customer-minutes (millions)</th></tr></thead><tbody>';
    top.forEach(function (row) {
      var cur = row.id === u.id;
      t += '<tr' + (cur ? ' class="is-current" aria-current="true"' : '') + '><td data-label="#">' + row.rank + '</td><td data-label="Utility"><button type="button" class="pt-link" data-id="' + esc(row.id) + '">' + esc(row.name) + '</button></td>' +
        '<td data-label="Customers">' + num(row.customers) + '</td><td data-label="SAIDI">' + num(row.saidi, 0) + '</td><td data-label="Cust-min (M)">' + (P.isNum(row.score) ? num(row.score / 1e6, 1) : 'not published') + '</td></tr>';
    });
    $('ranking').innerHTML = t + '</tbody>';
    $('ranking-panel').hidden = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
