/* /pitch page controller. Pure logic lives in pitch-core.js (window.PitchCore). */
(function () {
  'use strict';
  var P = window.PitchCore;
  var DEFAULT_ID = '5078-TX'; // CoServ, a member-owned co-op Base names publicly
  var state = { data: null, market: null, idx: null, byLabel: Object.create(null), byId: Object.create(null), selected: null, built: false, terms: P.publicTerms(), changed: {}, targets: {} };
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
    if (Math.abs(x) < 1e6) return '$' + Math.round(x).toLocaleString('en-US');
    var m = x / 1e6;
    if (m >= 1000) return '$' + (m / 1000).toFixed(1) + 'B';
    return '$' + (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US')) + 'M';
  }
  function ratio(a, b) { return P.isNum(a) && P.isNum(b) && b > 0 ? (a / b).toFixed(1) + 'x' : null; }
  function label(u) { return P.displayName(u) + ', ' + u.state; }
  // "Yours" tag for a number that came from the company's own file (yourdata.js).
  var YOURS = '<span class="badge badge-solid">Yours</span>';
  function yours(key) { return state.changed[key] ? ' ' + YOURS : ''; }
  function dec(v) { return v % 1 ? 1 : 0; }
  function months(lo, hi) { return lo === hi ? num(lo, dec(lo)) + ' months' : num(lo, dec(lo)) + ' to ' + num(hi, dec(hi)) + ' months'; }
  function link(src, text) { return '<a href="' + esc(src.url) + '" rel="noopener">' + esc(text || src.title) + '</a>'; }

  // Status line under the controls. kind: '' (plain) or 'error' (red notice).
  function setStatus(text, kind) {
    var el = $('status');
    el.className = 'pt-status' + (kind === 'error' ? ' notice notice-red' : '');
    el.textContent = text;
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
  }

  function load() {
    $('controls').setAttribute('aria-busy', 'true');
    $('build').disabled = true;
    setStatus('Loading public data...');
    Promise.all([
      getJSON('/data/expansion-map.json'),
      getJSON('/data/market-states.json')
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
      list.textContent = '';
      list.appendChild(frag);
      state.idx = P.utilityIndex(state.data.utilities);
      var start = state.byId[DEFAULT_ID] || state.data.utilities[0];
      select(start);
      $('controls').removeAttribute('aria-busy');
      $('build').disabled = false;
      setStatus('Ready. Data: ' + state.data.vintage.split('.')[0] + '.');
      if (!yourDataMounted) { yourDataMounted = true; mountYourData(); }
    }).catch(function () {
      state.data = null;
      $('controls').removeAttribute('aria-busy');
      setStatus('Could not load the public data files. Check your connection, then ', 'error');
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-outline btn-sm pt-retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', load);
      $('status').appendChild(retry);
    });
  }

  var yourDataMounted = false;

  function init() {
    load();

    $('controls').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!state.data) return;
      var res = matchInput();
      if (!res.u) { noMatch(res); return; }
      build(res.u);
    });
    $('utility').addEventListener('input', function () {
      if (!state.data) return;
      var res = matchInput();
      if (res.u) { state.selected = res.u; if (state.built) { setReady(); render(); } }
    });
    // "Did you mean" and "pick one" buttons in the status line.
    $('status').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      var u = P.own(state.byId, b.getAttribute('data-id'));
      if (u) { select(u); build(u); }
    });
    $('mw').addEventListener('input', function () { if (state.built) render(); });
    $('largeloads').addEventListener('change', function () { if (state.built) render(); });
    $('print').addEventListener('click', function () { window.print(); });
    $('ranking-panel').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      select(P.own(state.byId, b.getAttribute('data-id')));
      render();
      $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function setReady() { setStatus('Ready. Data: ' + state.data.vintage.split('.')[0] + '.'); }

  function build(u) {
    setReady();
    state.selected = u;
    state.built = true;
    $('print').disabled = false;
    render();
    $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* The same matcher as the API: a list label, an EIA id, a name, "Name, ST", an alias or a short name
     (CoServ, Oncor, ComEd), in any case. Returns PitchCore.matchUtility's result shape. */
  function matchInput() {
    var v = $('utility').value.trim();
    if (!v) return { empty: true };
    var hit = P.own(state.byLabel, v.toLowerCase());
    if (hit) return { u: hit };
    // A bare state code, as the placeholder invites: no single utility, so offer that state's top-ranked one.
    if (/^[A-Za-z]{2}$/.test(v) && P.own(state.idx.states, v.toUpperCase())) {
      var top = P.rankState(state.data.utilities, v.toUpperCase(), 1).filter(function (x) { return x.rank !== null; })[0];
      return { stateOnly: v.toUpperCase(), suggestion: top ? P.own(state.byId, top.id) : null };
    }
    return P.matchUtility(state.idx, v, null);
  }

  // A failed Build: say why, offer the closest utility, and mark any sheet already on screen as stale.
  function noMatch(res) {
    var typed = P.clip($('utility').value.trim(), 60);
    var msg = res.empty ? 'Type a utility name, an EIA id such as 5078-TX, or a state.'
      : res.tooLong ? 'That name is longer than ' + P.MAX_NAME + ' characters. Type a utility name or an EIA id such as 5078-TX.'
      : res.stateOnly ? res.stateOnly + ' is a state. Pick one of its utilities from the list.'
      : res.ambiguous ? '"' + typed + '" matches ' + res.ambiguous.length + ' utilities. Pick one:'
      : res.stateMismatch ? '"' + typed + '" is in ' + res.stateMismatch.state + ', not ' + res.state + '.'
      : 'No utility called "' + typed + '".';
    setStatus(msg + ' ', 'error');
    var choices = res.ambiguous ? res.ambiguous.slice(0, 6) : res.stateMismatch ? [res.stateMismatch] : res.suggestion ? [res.suggestion] : [];
    if (!res.ambiguous && choices.length) $('status').appendChild(document.createTextNode(res.stateOnly ? 'Top of its call ranking: ' : 'Did you mean '));
    choices.forEach(function (u) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-outline btn-sm pt-retry';
      b.setAttribute('data-id', u.id);
      b.textContent = label(u);
      $('status').appendChild(b);
    });
    if (state.built && !$('sheet').hidden) {
      $('sheet').classList.add('pt-stale');
      $('print').disabled = true;
      if (!$('stale-note')) {
        var n = document.createElement('p');
        n.id = 'stale-note';
        n.className = 'notice notice-red pt-stale-note';
        n.setAttribute('role', 'note');
        $('sheet').insertBefore(n, $('sheet').firstChild);
      }
      $('stale-note').textContent = 'Out of date: this sheet is still for ' + label(state.selected) + ', not "' + typed + '". Pick a utility and build again.';
    }
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
    P.extraSources(u, pick).forEach(function (s) { list.push({ key: s.key, title: s.title, url: s.url, date: 'retrieved ' + s.retrieved }); });
    var k = P.known(u.id);
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
    var T = state.terms;
    var prog = P.sizeProgram(mw, u.values.homes, T);
    var pcts = P.signalPercentiles(u, d.utilities);
    var sig = P.strongestSignal(pcts);
    var pick = P.pickOffer(u, pcts, { largeLoads: $('largeloads').checked, terms: T });
    var src = sourcesFor(u, pick);
    var r = function (k) { return ref(src, k); };
    var name = P.shortName(u);
    var today = new Date().toISOString().slice(0, 10);
    var known = P.known(u.id);
    var target = P.own(state.targets, u.id);
    var wires = pick.wires;
    var nYours = Object.keys(state.changed).length;
    var costYours = state.changed.costLowPerKwh || state.changed.costHighPerKwh, timeYours = state.changed.deployMonthsLow || state.changed.deployMonthsHigh;
    var h = [];

    h.push('<p class="pt-sheet-meta">Outside view from public data. Prepared ' + today + '. Not affiliated with Base Power.' +
      (nYours ? ' ' + nYours + ' number' + (nYours === 1 ? '' : 's') + ' from your own file, tagged Yours.' : '') + '</p>');
    h.push('<h2 class="pt-headline">' + esc(P.headline(u, sig)) + '</h2>');
    h.push('<p class="pt-sub">' + esc(P.displayName(u)) + ', ' + esc(st.name) + '. ' + num(u.values.homes) + ' residential customers' + r('eia') + '. Balancing authority: ' + esc(u.detail.rtos) + r('eia') + '.</p>');
    if (target) h.push('<p class="pt-target">' + YOURS + ' <strong>Your target list:</strong> ' + esc(target.status) +
      (target.owner ? '. Owner: ' + esc(target.owner) : '') + (target.note ? '. ' + esc(target.note) : '') + '</p>');
    // Wires-only: say so first, before any number, so nobody pitches a capacity buy to a company that does not buy power.
    if (wires) {
      var wref = function (keys) { return keys.map(function (k) { return r(k); }).join(''); };
      h.push('<div class="notice pt-wires" role="note"><p><strong>Wires-only utility.</strong> ' + esc(wires.what) + ' ' + esc(wires.reason) + wref(wires.sources) + '</p>' +
        '<p>In its area a home-battery company reaches homes as a retail provider.' + (wires.baseRetail ? ' ' + esc(wires.baseRetail) + r(wires.baseSource) : '') +
        ' So the useful conversation with ' + esc(name) + ' is about interconnection and distribution-level value, not a capacity purchase.</p></div>');
    }
    var partner = P.partnerFrame(u);
    if (known) h.push('<p class="notice notice-green pt-known"><strong>' + (partner ? esc(partner.label) + ':' : 'Public link to Base:') + '</strong> ' + esc(known.note) + ' ' + (known.source.url === P.BASE_SOURCE.url ? r('base') : r('known')) + (known.aliasSource ? ' EIA lists CoServ under its legal name, Denton County Electric Cooperative.' + r('alias') : '') +
      (partner ? ' ' + esc(partner.framing) : '') + '</p>');

    // Program
    if (prog) {
      h.push('<section class="pt-block"><h3>The program</h3><dl class="pt-stats">' +
        stat(P.fmtPower(prog.roundedUp ? prog.nameplateMw : prog.mw), prog.roundedUp ? 'nameplate, rounded up to whole batteries from your ' + esc(P.fmtPower(prog.mw)) : 'nameplate, your input' + (prog.mw === T.programMw ? yours('programMw') : '')) +
        stat(num(prog.batteries), 'home batter' + (prog.batteries === 1 ? 'y' : 'ies') + ' at ' + num(prog.kw, dec(prog.kw)) + ' kW each' + (yours('kwPerHome') || r('base'))) +
        stat(P.fmtEnergy(prog.mwh), 'at ' + num(prog.kwh, dec(prog.kwh)) + ' kWh each' + (yours('kwhPerHome') || r('base'))) +
        stat(share(prog.share), 'of residential customers would need to enroll') +
        '</dl>' + (prog.roundedUp ? '<p class="pt-note pt-rounded">' + esc(P.roundedUpNote(prog)) + '</p>' : '') + '<p class="pt-note">About ' + prog.hours.toFixed(2) + ' hours at full output, derived from ' + (state.changed.kwPerHome || state.changed.kwhPerHome ? 'your battery spec' : 'Base\'s claimed spec') + '. Nameplate is not accredited capacity, and each home keeps a backup reserve, so the dispatchable share is a question below.' +
        (P.isNum(prog.dispatchMwh) ? ' With ' + num(T.memberReservePct) + '% held back for each home, about ' + P.fmtEnergy(prog.dispatchMwh) + ' is left to dispatch.' + yours('memberReservePct') : '') +
        (P.isNum(prog.share) && prog.share > 1 ? ' <strong>This program needs more batteries than the utility has residential customers.</strong>' : '') + '</p></section>');
    } else {
      h.push('<section class="pt-block"><h3>The program</h3><p class="pt-note">Enter a program size above 0 and at most 5,000 MW.</p></section>');
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
    var t = '<div class="pt-table-wrap"><table class="ds-table pt-table pt-problem"><thead><tr><th scope="col">Signal</th><th scope="col" class="num">' + esc(name) + '</th><th scope="col" class="num">' + esc(st.name) + '</th><th scope="col" class="num">US</th><th scope="col">Rank among US utilities</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var p = row[4];
      var rank = p && P.isNum(p.pct) ? 'higher than ' + Math.round(p.pct * 100) + '% of ' + num(p.n) : (p ? 'not published' : '');
      t += '<tr><th scope="row">' + esc(row[0]) + r(row[5]) + '</th><td class="num" data-label="' + esc(name) + '">' + row[1] + '</td><td class="num" data-label="' + esc(st.name) + '">' + row[2] + '</td><td class="num" data-label="US">' + row[3] + '</td><td data-label="Rank">' + rank + '</td></tr>';
    });
    t += '</tbody></table></div>';
    var said = [];
    var rs = ratio(u.values.saidi, st.values.saidi), ru = ratio(u.values.saidi, m.us.saidi_2025);
    if (rs && ru) said.push('Outage minutes run ' + rs + ' the ' + esc(st.name) + ' total and ' + ru + ' the US figure.');
    if (P.isNum(ms.cents_kwh)) said.push(esc(st.name) + ' homes paid ' + ms.cents_kwh.toFixed(2) + ' cents/kWh and $' + ms.bill_usd.toFixed(2) + ' a month on average in 2024, against ' + m.us.cents_kwh.toFixed(2) + ' cents and $' + m.us.bill_usd.toFixed(2) + ' for the US' + r('price') + '. That is a state average, not this utility\'s tariff.');
    h.push('<section class="pt-block"><h3>The problem, in its own numbers</h3>' + (said.length ? '<p>' + said.join(' ') + '</p>' : '') + t +
      '<p class="pt-note">Utility and state SAIDI come from EIA-861 2025. The US figure comes from EIA\'s Electric Power Annual, a different table, so treat the US comparison as rough. Utility reporting method: ' + esc(u.detail.note) + '. Storm and heat scores are population-weighted over the counties EIA lists in the service territory.</p></section>');

    // Offer
    var others = ['bulk', 'distribution', 'speed'].filter(function (k) { return k !== pick.offer.id && !(wires && k === 'bulk'); }).map(function (k) { return P.OFFERS[k]; });
    var ercotRefs = pick.source ? r('ercot') + r('tcos') + r('tcos12') : '';
    h.push('<section class="pt-block pt-offer"><h3>' + (wires ? 'The conversation that fits: ' : 'The offer that fits: ') + esc(pick.offer.name) + '</h3>' +
      '<blockquote>"' + esc(pick.offer.quote) + '"' + r('base') + '</blockquote>' +
      (wires
        ? '<p><strong>Why, by rule 0:</strong> ' + esc(wires.what) + ' A capacity offer needs a buyer for capacity, so this pitch makes none. Batteries behind its meters can still relieve its circuits' + (pick.offer.id === 'speed' ? ' and help large loads connect' : '') + ', which is a wires question.</p>' +
          '<p class="pt-note">Not on the table here: Bulk peaking capacity, because ' + esc(name) + ' does not buy capacity. Also on Base\'s menu: ' + others.map(function (o) { return esc(o.name); }).join(' and ') + '.</p>'
        : '<p><strong>Why, by rule ' + pick.rule + ':</strong> ' + esc(pick.reason) + ercotRefs +
          (pick.rule === 2 ? yours('reliabilityCutoffPct') : pick.rule === 3 ? yours('wholesaleCutoffPct') : '') + '</p>' +
          '<p class="pt-note">Also on Base\'s menu: ' + others.map(function (o) { return esc(o.name); }).join(' and ') + '. Speed to power is picked only when you mark a large-load queue, because no public file here shows one.</p>') +
      '</section>');

    // Speed and cost
    var ct = '<div class="pt-table-wrap"><table class="ds-table pt-table pt-claims"><thead><tr><th scope="col">Option</th><th scope="col">Time to deploy 100 MW</th><th scope="col">Landed cost of storage</th><th scope="col">This program at that cost</th></tr></thead><tbody>';
    P.CLAIMS_TABLE.forEach(function (row, i) {
      var time = esc(row.time), cost = esc(row.cost), tag = '';
      if (i === 0 && (costYours || timeYours)) {
        // Base's own row, with the company's numbers in place of the public claim. CLAIMS_TABLE itself is not changed.
        row = { option: row.option, low: T.costLowPerKwh, high: T.costHighPerKwh };
        if (timeYours) time = months(T.deployMonthsLow, T.deployMonthsHigh) + (yours('deployMonthsLow') || yours('deployMonthsHigh'));
        if (costYours) cost = (T.costLowPerKwh === T.costHighPerKwh ? '$' + num(T.costLowPerKwh) : '$' + num(T.costLowPerKwh) + ' to $' + num(T.costHighPerKwh)) + '/kWh' + (yours('costLowPerKwh') || yours('costHighPerKwh'));
        tag = ' (your numbers)';
      }
      var c = prog ? P.landedCost(prog.mwh, row) : null;
      var range = c ? (c.low === c.high ? money(c.low) : money(c.low) + ' to ' + money(c.high)) : 'n/a';
      ct += '<tr><th scope="row">' + esc(row.option) + tag + '</th><td data-label="Time, 100 MW">' + time + '</td><td data-label="Cost">' + cost + '</td><td data-label="This program">' + range + '</td></tr>';
    });
    ct += '</tbody></table></div>';
    h.push('<section class="pt-block"><h3>Speed and cost, as Base states them</h3>' +
      '<p><span class="badge badge-white">Base\'s claim</span> The first three columns are Base\'s own comparison table, which Base attributes to EnergySage, Lazard and Wood Mackenzie' + r('base') + '. The last column multiplies those $/kWh figures by this program\'s ' + (prog ? P.fmtEnergy(prog.mwh) : 'n/a') + '. It is arithmetic on a claim, not a quote.</p>' + ct +
      (costYours || timeYours ? '<p class="pt-note">The Base row uses your own ' + (costYours && timeYours ? 'time and cost' : costYours ? 'cost' : 'time') + ' from your file. Base\'s public claim is 3 to 6 months and ~$300 to $400/kWh' + r('base') + '.</p>' : '') +
      '<p class="pt-note">Base also claims: deployment across 3 metros and 6 utilities in the last 12 months, an in-house deployment factory, dispatch up to 500 cycles a year, 96% fleet availability, and a field-demonstrated forced outage rate under 5%' + r('base') + '.' +
      (state.changed.cyclesPerYear || state.changed.availabilityPct || state.changed.forcedOutagePct ? ' Your file says: up to ' + num(T.cyclesPerYear) + ' cycles a year' + yours('cyclesPerYear') + ', ' + num(T.availabilityPct, dec(T.availabilityPct)) + '% fleet availability' + yours('availabilityPct') + ', forced outage rate under ' + num(T.forcedOutagePct, dec(T.forcedOutagePct)) + '%' + yours('forcedOutagePct') + '.' : '') + '</p></section>');

    // Deal structure
    h.push('<section class="pt-block"><h3>Deal structure</h3><div class="pt-deals">' +
      '<div><h4>Toll</h4><p>Base owns the batteries. The utility pays for performance' + r('base') + '.</p><p class="pt-note">To settle: term, the performance metric, and penalties for shortfall.</p></div>' +
      '<div><h4>Build-transfer</h4><p>Base builds the fleet and the utility takes ownership' + r('base') + '.</p><p class="pt-note">To settle: who operates the fleet after transfer, and how the asset is financed and approved.</p></div>' +
      '</div>' + yourOffer(prog, T) + '<p class="pt-note">Either way, Base says the utility keeps full dispatch rights 24/7/365 and members always keep a minimum backup reserve' + r('base') + '.</p></section>');

    // Questions
    h.push('<section class="pt-block"><h3>Questions to answer together</h3><ol class="pt-questions">' +
      P.questions(u, pick, T).map(function (q) { return '<li>' + esc(q) + (/^Value stack in ERCOT/.test(q) ? r('tcos') + r('tcos12') : '') + '</li>'; }).join('') + '</ol></section>');

    // Real vs claimed vs assumed
    h.push('<section class="pt-block pt-rca"><h3>Real vs claimed vs assumed</h3><div class="pt-rca-grid">' +
      '<div class="pt-rca-real"><h4><span class="badge badge-green">Real</span> Public data</h4><ul>' +
        '<li>Customers, SAIDI, SAIFI, ISO share, retail share, batteries, demand response and dynamic pricing: EIA-861 2025' + r('eia') + '.</li>' +
        '<li>Storm and heat-wave risk: FEMA National Risk Index' + r('fema') + '.</li>' +
        '<li>US SAIDI and state prices and bills: EIA' + r('epa') + r('price') + '.</li>' +
        (known ? '<li>' + esc(known.note) + '</li>' : '') +
        (wires ? '<li>Wires-only: ' + esc(wires.what) + wires.sources.map(function (k) { return r(k); }).join('') + '</li>' : '') +
      '</ul></div>' +
      '<div class="pt-rca-claimed"><h4><span class="badge badge-white">Claimed</span> Base\'s marketing</h4><ul>' +
        '<li>20 kW / 39.2 kWh per home battery.' + (state.changed.kwPerHome || state.changed.kwhPerHome ? ' This pitch uses yours: ' + num(T.kwPerHome, dec(T.kwPerHome)) + ' kW / ' + num(T.kwhPerHome, dec(T.kwhPerHome)) + ' kWh.' + (yours('kwPerHome') || yours('kwhPerHome')) : '') + '</li>' +
        '<li>3 to 6 months to deploy 100 MW; ~$300 to $400/kWh landed.' + (costYours || timeYours ? ' This pitch uses yours. ' + YOURS : '') + '</li>' +
        '<li>Up to 500 cycles a year, 96% fleet availability, under 5% forced outage rate.</li>' +
        '<li>No new interconnection agreements or substation upgrades "in most cases".</li>' +
        '<li>Utility keeps full dispatch rights; members keep a backup reserve.' + r('base') + '</li>' +
      '</ul></div>' +
      '<div class="pt-rca-assumed"><h4><span class="badge badge-yellow">Assumed</span> Choices made here</h4><ul>' +
        '<li>Program size: ' + (prog ? P.fmtPower(prog.nameplateMw) : 'n/a') + ' nameplate, every battery a full ' + num(T.kwPerHome, dec(T.kwPerHome)) + ' kW unit.</li>' +
        '<li>Offer cutoffs: outages higher than ' + num(T.reliabilityCutoffPct) + '% of US utilities' + yours('reliabilityCutoffPct') + '; ' + num(T.wholesaleCutoffPct) + '% of customers in an ISO or RTO' + yours('wholesaleCutoffPct') + '.</li>' +
        '<li>Large-load queue: ' + ($('largeloads').checked ? 'marked by you' : 'not marked') + '.</li>' +
        '<li>Call ranking: residential customers x SAIDI as a stand-in for customer minutes interrupted.</li>' +
        (P.isNum(T.tollPerKwYear) ? '<li>Price per kW-year: $' + num(T.tollPerKwYear, T.tollPerKwYear % 1 ? 2 : 0) + ', from your file.' + yours('tollPerKwYear') + ' No enrollment rate or accreditation share is assumed.</li>' : '<li>No enrollment rate, accreditation share, or price per kW-year is assumed. Those are questions.</li>') +
      '</ul></div></div></section>');

    // Sources
    h.push('<section class="pt-block pt-sources"><h3>Sources</h3><ol>' + src.map(function (s) {
      return '<li id="src-' + s.n + '">' + link(s) + '. <span class="pt-note">' + esc(s.date) + '.</span></li>';
    }).join('') + '</ol></section>');

    $('sheet').innerHTML = h.join('');
    $('sheet').classList.remove('pt-stale');
    $('sheet').hidden = false;
    $('print').disabled = false;
    renderRanking(u, st);
  }

  function stat(v, l) { return '<div><dt>' + l + '</dt><dd>' + v + '</dd></div>'; }

  // The company's own price, when its file sets one. Arithmetic on its numbers, never public data.
  function yourOffer(prog, T) {
    var tv = prog ? P.tollValue(T, prog.mw) : null;
    if (!tv) return '';
    return '<p class="pt-yours-offer"><strong>Your offer:</strong> $' + num(T.tollPerKwYear, T.tollPerKwYear % 1 ? 2 : 0) + ' per kW-year' + yours('tollPerKwYear') +
      ' on ' + P.fmtPower(prog.mw) + ' is ' + money(tv.perYear) + ' a year' +
      (P.isNum(tv.total) ? ', ' + money(tv.total) + ' over ' + num(T.termYears) + ' years' + yours('termYears') : '') + '. From your file, not public data.</p>';
  }

  function renderRanking(u, st) {
    var all = P.rankState(state.data.utilities, u.state, Infinity);
    var tg = state.targets;
    var hasTargets = Object.keys(tg).length > 0;
    // Your targets first (all of them in this state), then the public top 10. Public rank order inside each group.
    var ordered = P.orderWithTargets(all, tg);
    var nMine = all.filter(function (x) { return P.own(tg, x.id); }).length;
    // Then existing Base partners, unranked: an expansion conversation, not a cold call.
    var partnerRows = all.filter(function (x) { return x.partner; });
    var top = ordered.slice(0, nMine).concat(ordered.slice(nMine).filter(function (x) { return x.rank !== null && x.rank <= 10; }), partnerRows.filter(function (x) { return !P.own(tg, x.id); }));
    var wiresRows = all.filter(function (x) { return x.wires; });
    var mine = all.filter(function (x) { return x.id === u.id; })[0];
    if (mine && top.indexOf(mine) < 0) top.push(mine);
    var mkt = P.stateMarket(state.data.utilities, u.state);
    $('ranking-title').textContent = 'Who to call first in ' + st.name;
    $('ranking-help').textContent = all.length + ' utilities in ' + st.name + ' in this file. Ranked by residential customers x SAIDI minutes (EIA-861 2025). ' + mkt.reason +
      (partnerRows.length ? ' ' + partnerRows.length + ' already ' + (partnerRows.length === 1 ? 'is a Base partner' : 'are Base partners') + ', so ' + (partnerRows.length === 1 ? 'it is' : 'they are') + ' listed after the ranking, unranked, as an expansion conversation: ' + partnerRows.map(function (x) { return x.name; }).join(', ') + '.' : '') +
      (wiresRows.length ? ' ' + wiresRows.length + ' wires-only utilit' + (wiresRows.length === 1 ? 'y delivers' : 'ies deliver') + ' power but do' + (wiresRows.length === 1 ? 'es' : '') + ' not buy it, so ' + (wiresRows.length === 1 ? 'it is' : 'they are') + ' not ranked: ' + wiresRows.map(function (x) { return x.name; }).join(', ') + '.' : '') +
      (nMine ? ' Your ' + nMine + ' target' + (nMine === 1 ? '' : 's') + ' in ' + st.name + ' come first, still in public rank order.' : '') + ' Pick one to rebuild the pitch.';
    var t = '<thead><tr><th scope="col">#</th><th scope="col">Utility</th>' + (hasTargets ? '<th scope="col">Your status</th>' : '') + '<th scope="col" class="num">Residential customers</th><th scope="col" class="num">SAIDI min</th><th scope="col" class="num">Customer-minutes (millions)</th></tr></thead><tbody>';
    if (!top.length) t += '<tr><td colspan="' + (hasTargets ? 6 : 5) + '">No utilities in ' + esc(st.name) + ' publish enough data to rank.</td></tr>';
    top.forEach(function (row) {
      var cur = row.id === u.id;
      var mt = P.own(tg, row.id);
      var cls = [cur ? 'is-current' : '', mt ? 'is-target' : ''].join(' ').trim();
      t += '<tr' + (cls ? ' class="' + cls + '"' : '') + (cur ? ' aria-current="true"' : '') + '><td data-label="#">' + (row.wires ? '<span class="badge badge-white" title="Delivers power but does not buy it">Wires only</span>' : row.partner ? '<span class="badge badge-green" title="' + esc(P.PARTNER_LABEL) + ': expand the existing program, not a cold call">Base partner</span>' : row.rank) + '</td><td data-label="Utility"><span class="pt-utilcell"><button type="button" class="pt-link" data-id="' + esc(row.id) + '">' + esc(row.name) + '</button>' +
        (row.partner ? '<span class="pt-rowtag">' + esc(P.PARTNER_LABEL) + ': expand the program, not a cold call</span>' : '') + (row.marketNote ? '<span class="pt-rowtag pt-outside">' + esc(row.marketNote) + '</span>' : '') + '</span></td>' +
        (hasTargets ? '<td data-label="Your status">' + (mt ? '<span class="pt-statuscell"><span class="badge badge-solid pt-status-chip">' + esc(mt.status) + '</span>' + (mt.owner ? ' <span class="pt-owner">' + esc(mt.owner) + '</span>' : '') + '</span>' : '') + '</td>' : '') +
        '<td class="num" data-label="Customers">' + num(row.customers) + '</td><td class="num" data-label="SAIDI">' + num(row.saidi, 0) + '</td><td class="num" data-label="Cust-min (M)">' + (P.isNum(row.score) ? num(row.score / 1e6, 1) : 'not published') + '</td></tr>';
    });
    $('ranking').innerHTML = t + '</tbody>';
    // Targets in other states, so a national list is one tap away.
    var elsewhere = Object.keys(tg).map(function (id) { return P.own(state.byId, id); }).filter(function (x) { return x && x.state !== u.state; })
      .sort(function (a, b) { return label(a) < label(b) ? -1 : 1; });
    var box = $('targets-elsewhere');
    if (!box) {
      box = document.createElement('div');
      box.id = 'targets-elsewhere';
      box.className = 'pt-elsewhere';
      $('ranking-panel').appendChild(box);
    }
    box.innerHTML = elsewhere.length ? '<p class="pt-help">Your targets in other states:</p><ul>' + elsewhere.map(function (x) {
      return '<li><button type="button" class="pt-link" data-id="' + esc(x.id) + '">' + esc(label(x)) + '</button> <span class="badge badge-solid pt-status-chip">' + esc(tg[x.id].status) + '</span></li>';
    }).join('') + '</ul>' : '';
    box.hidden = !elsewhere.length;
    $('ranking-panel').hidden = false;
  }

  // Bring your own data: offer terms and a target list (yourdata.js, PitchCore.loadYourData). Public data never changes.
  function useYourData(r) {
    var prevMw = state.terms.programMw;
    state.terms = r ? r.terms : P.publicTerms();
    state.targets = r ? r.targets : {};
    state.changed = {};
    if (r) r.changed.forEach(function (k) { state.changed[k] = true; });
    // Move the program size input only if it still shows the previous file or public value.
    if (parseFloat($('mw').value) === prevMw) $('mw').value = state.terms.programMw;
    if (state.built) render();
  }

  // Starter target list: the public top 5 to call in the selected utility's state.
  function targetTemplate() {
    var u = state.selected || state.byId[DEFAULT_ID];
    var rows = P.rankState(state.data.utilities, u.state, Infinity).filter(function (x) { return x.rank !== null; }).slice(0, 5).map(function (x) {
      return { utility: x.id, state: u.state, status: 'not contacted', owner: '', note: state.byId[x.id].name };
    });
    return window.YourData.toCSV(rows, P.TARGET_COLUMNS);
  }

  function mountYourData() {
    if (!window.YourData || !$('yourdata')) return;
    window.YourData.mount({
      el: $('yourdata'),
      tool: 'pitch',
      what: 'your own offer terms and target list',
      docs: '/plug-and-play#pitch',
      templates: [
        { name: 'pitch-offer-terms.csv', label: 'Offer terms template', text: function () { return window.YourData.toCSV(P.templateRows(), P.TEMPLATE_COLUMNS); } },
        { name: 'pitch-targets.csv', label: 'Target list template', text: targetTemplate }
      ],
      load: function (parsed) {
        var r = P.loadYourData(parsed, state.data.utilities);
        var parts = [];
        if (r.termRows) parts.push(r.changed.length + ' offer number' + (r.changed.length === 1 ? '' : 's') + ' changed, tagged Yours');
        if (r.targetCount || r.unmatched) parts.push(r.targetCount + ' target utilit' + (r.targetCount === 1 ? 'y' : 'ies') + ' matched' + (r.unmatched ? ', ' + r.unmatched + ' not matched (listed below)' : ''));
        return {
          errors: r.errors,
          warnings: r.warnings,
          summary: parts.join('; ') + '.' + (state.built ? '' : ' Build the pitch to see it.'),
          apply: function () { useYourData(r); }
        };
      },
      reset: function () { useYourData(null); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
