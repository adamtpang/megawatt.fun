/* Pure functions for /pitch. No DOM. Works in Node (module.exports) and the browser (window.PitchCore).
   Every rule here is also written out in plain words on the page, under "How the rules work". */
(function (root) {
  'use strict';

  var BASE_SOURCE = { title: 'Base Power, Utilities page', url: 'https://www.basepowercompany.com/utilities', retrieved: '2026-10-29' };

  // Base's own published hardware spec (claimed, not measured here).
  var SPEC = { kw: 20, kwh: 39.2 };

  // Base's three utility offers, quoted from its Utilities page.
  var OFFERS = {
    bulk: { id: 'bulk', name: 'Bulk peaking capacity', quote: 'Deliver accredited capacity to meet resource adequacy or peak shave to reduce capacity requirements' },
    speed: { id: 'speed', name: 'Speed to power', quote: 'Accelerate interconnection of large loads while providing affordability benefits to communities' },
    distribution: { id: 'distribution', name: 'Distribution grid support', quote: 'Deploy batteries on targeted circuits to relieve local grid constraints' }
  };

  // Base's comparison table. Base attributes it to EnergySage, Lazard and Wood Mackenzie.
  var CLAIMS_TABLE = [
    { option: 'Base', time: '3 to 6 months', cost: '~$300 to $400/kWh', low: 300, high: 400 },
    { option: 'Utility-scale storage', time: '2 to 4 years', cost: '~$200 to $400/kWh', low: 200, high: 400 },
    { option: 'Traditional battery VPPs', time: '2+ years', cost: '~$1,100/kWh', low: 1100, high: 1100 }
  ];

  // Public links between Base and a specific utility row. Keyed by the EIA utility id plus state.
  var KNOWN = {
    '5078-TX': {
      alias: 'CoServ Electric',
      aliasSource: { title: 'Texas PUC filing, Project 53385: "Denton County Electric Cooperative, Inc. d/b/a CoServ Electric"', url: 'https://interchange.puc.texas.gov/Documents/53385_1837_1373864.PDF', retrieved: '2026-10-30' },
      note: "Base's Utilities page names CoServ as a partner and quotes Gary Franzen, CoServ's Chief Energy Resources Officer.",
      source: BASE_SOURCE
    },
    '1015-TX': {
      note: "Base's Utilities page names Austin Energy and its home battery storage program.",
      source: BASE_SOURCE
    },
    '3248-GA': {
      note: 'A secondary report attributes a 50 MW Base project with Central Georgia EMC, installing in 2027, to Utility Dive and energytech.com.',
      source: { title: 'Grid & Generation, Georgia partnership report', url: 'https://gridandgeneration.com/news/base-power-expands-georgia-mw-residential-battery-network/', retrieved: '2026-10-21 (publication date)' }
    },
    '4110-IL': {
      note: "Base Retail holds an Illinois supplier license for residential customers in ComEd territory (license 26-0121). That is a retail offer, not a utility contract.",
      source: { title: 'Base Retail Illinois supply agreement', url: 'https://www.basepowercompany.com/_bpc/files/ENC6_mP2RRd-de1nBi7v6w-esa-uds-v09302026-docx.pdf', retrieved: '2026-10-27' }
    }
  };

  var ERCOT_SOURCE = { title: 'ERCOT Grid Insights: Energy-Only Wholesale Market', url: 'https://www.ercot.com/files/docs/2025/10/16/ERCOT-Grid-Insights-Energy-Only-Wholesale-Market.pdf', retrieved: '2026-10-30' };

  var SIGNALS = ['saidi', 'saifi', 'storm', 'heat', 'demand_response'];
  var RELIABILITY_CUTOFF = 0.75; // assumption: top quartile of US utilities counts as a reliability problem
  var WHOLESALE_CUTOFF = 0.5;    // majority of residential customers in an ISO or RTO balancing authority

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function displayName(u) {
    if (!u) return '';
    var k = KNOWN[u.id];
    return k && k.alias ? k.alias + ' (' + u.name + ')' : u.name;
  }

  function shortName(u) {
    if (!u) return '';
    var k = KNOWN[u.id];
    return k && k.alias ? k.alias : u.name;
  }

  // Program sizing from Base's claimed 20 kW / 39.2 kWh unit.
  function sizeProgram(mw, customers) {
    if (!isNum(mw) || mw <= 0) return null;
    var batteries = Math.ceil(mw * 1000 / SPEC.kw - 1e-9);
    var mwh = batteries * SPEC.kwh / 1000;
    var share = isNum(customers) && customers > 0 ? batteries / customers : null;
    return { mw: mw, batteries: batteries, mwh: mwh, hours: SPEC.kwh / SPEC.kw, share: share };
  }

  // Share of utilities with a published value strictly below v. Null in, null out.
  function percentile(values, v) {
    if (!isNum(v)) return null;
    var n = 0, below = 0;
    for (var i = 0; i < values.length; i++) {
      if (!isNum(values[i])) continue;
      n++;
      if (values[i] < v) below++;
    }
    return n ? below / n : null;
  }

  function signalPercentiles(u, all) {
    var out = {};
    var keys = SIGNALS.concat(['batteries', 'dynamic_pricing']);
    keys.forEach(function (k) {
      var vals = all.map(function (x) { return x.values[k]; });
      var n = vals.filter(isNum).length;
      out[k] = { value: isNum(u.values[k]) ? u.values[k] : null, pct: percentile(vals, u.values[k]), n: n };
    });
    return out;
  }

  // Highest national percentile among the five signals. Ties keep SIGNALS order.
  function strongestSignal(pcts) {
    var best = null;
    SIGNALS.forEach(function (k) {
      var p = pcts[k] && pcts[k].pct;
      if (!isNum(p)) return;
      if (!best || p > best.pct) best = { id: k, pct: p, value: pcts[k].value, n: pcts[k].n };
    });
    return best;
  }

  function isErcotOnly(rtos) { return typeof rtos === 'string' && rtos.trim() === 'ERCOT'; }

  // Offer rule, in order. First match wins.
  function pickOffer(u, pcts, opts) {
    opts = opts || {};
    var steps = [];
    if (opts.largeLoads) {
      return { offer: OFFERS.speed, variant: null, rule: 1, reason: 'You marked that large loads are waiting to connect. That is your input, not public data.' };
    }
    steps.push('Rule 1 skipped: no large-load queue was marked.');
    var rel = [pcts.saidi && pcts.saidi.pct, pcts.saifi && pcts.saifi.pct].filter(isNum);
    if (rel.length) {
      var top = Math.max.apply(null, rel);
      if (top >= RELIABILITY_CUTOFF) {
        return { offer: OFFERS.distribution, variant: null, rule: 2, reliability: top,
          reason: 'Outage duration or frequency is higher than ' + Math.round(top * 100) + '% of US utilities, at or above the ' + Math.round(RELIABILITY_CUTOFF * 100) + '% cutoff.' };
      }
      steps.push('Rule 2 skipped: outage percentile ' + Math.round(top * 100) + '% is below the ' + Math.round(RELIABILITY_CUTOFF * 100) + '% cutoff.');
    } else {
      steps.push('Rule 2 skipped: outage duration and frequency are not published for this utility.');
    }
    var w = u.values.wholesale;
    var rtos = (u.detail && u.detail.rtos) || '';
    if (isNum(w) && w >= WHOLESALE_CUTOFF) {
      if (isErcotOnly(rtos)) {
        return { offer: OFFERS.bulk, variant: 'peak', rule: 3, reason: 'Most residential customers sit in ERCOT, which runs an energy-only wholesale market (ERCOT, Oct 2025). With no capacity auction to accredit into, the fit is the second half of the offer: peak shaving.', source: ERCOT_SOURCE };
      }
      return { offer: OFFERS.bulk, variant: 'accredited', rule: 3, reason: Math.round(w * 100) + '% of residential customers sit in an ISO or RTO (' + rtos + '). The fit is accredited capacity for resource adequacy.' };
    }
    return { offer: OFFERS.bulk, variant: 'peak', rule: 4, reason: 'No ISO or RTO majority and no top-quartile outage signal. The default fit is peak shaving to reduce the capacity the utility must plan for.' };
  }

  function pctPhrase(p) { return 'higher than ' + Math.round(p * 100) + '% of US utilities'; }

  function fmtNum(v, digits) {
    if (!isNum(v)) return 'not published';
    return v.toLocaleString('en-US', { maximumFractionDigits: digits || 0, minimumFractionDigits: digits || 0 });
  }

  function headline(u, signal) {
    var name = shortName(u);
    if (!signal) return name + ': the public outage and risk data is thin, so the case starts with questions.';
    var p = pctPhrase(signal.pct);
    switch (signal.id) {
      case 'saidi': return name + ' customers averaged ' + fmtNum(signal.value) + ' outage minutes in 2025, ' + p + '.';
      case 'saifi': return name + ' customers averaged ' + fmtNum(signal.value, 2) + ' outages each in 2025, ' + p + '.';
      case 'storm': return 'Storm risk across ' + name + "'s territory is " + p + '.';
      case 'heat': return 'Heat-wave risk across ' + name + "'s territory is " + p + '.';
      case 'demand_response': return name + ' already enrolls ' + fmtNum(signal.value, 1) + ' homes per 1,000 in demand response, ' + p + '.';
    }
    return name;
  }

  // Ranking score: residential customers x SAIDI minutes, a residential-only stand-in for customer minutes interrupted.
  function callScore(u) {
    var c = u.values.homes, s = u.values.saidi;
    return isNum(c) && isNum(s) ? c * s : null;
  }

  function rankState(all, state, limit) {
    var rows = all.filter(function (u) { return u.state === state; }).map(function (u) { return { u: u, score: callScore(u) }; });
    rows.sort(function (a, b) {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      if (a.score !== b.score) return b.score - a.score;
      var ca = a.u.values.homes || 0, cb = b.u.values.homes || 0;
      if (ca !== cb) return cb - ca;
      return a.u.name < b.u.name ? -1 : a.u.name > b.u.name ? 1 : 0;
    });
    return rows.slice(0, limit || 10).map(function (r, i) { return { rank: i + 1, id: r.u.id, name: displayName(r.u), customers: r.u.values.homes, saidi: r.u.values.saidi, score: r.score }; });
  }

  // Landed cost range for a program, using Base's claimed $/kWh. Result in US dollars.
  function landedCost(mwh, row) {
    if (!isNum(mwh) || !row) return null;
    return { low: mwh * 1000 * row.low, high: mwh * 1000 * row.high };
  }

  function questions(u, pick) {
    var q = [];
    var rtos = (u.detail && u.detail.rtos) || '';
    if (pick.offer.id === 'bulk' && pick.variant === 'accredited') q.push('Accreditation: how does ' + rtos + ' count a fleet of roughly 2-hour home batteries toward resource adequacy, and at what share of nameplate?');
    if (isErcotOnly(rtos)) q.push('Value stack in ERCOT: which value counts most here, peak shaving against transmission cost allocation, energy prices, or ancillary services?');
    if (rtos === 'No ISO balancing authority') q.push('Capacity planning: what peak does the utility or its power supplier plan to, and what is a kW of peak reduction worth in its next resource plan?');
    q.push('Dispatch windows: which hours and seasons matter, and how many of the 500 cycles a year Base offers would the utility actually call?');
    q.push('Member reserve: how much of each 39.2 kWh battery stays held back for the home, and what is left to dispatch?');
    q.push('Data access: interval meter data, feeder and circuit outage history, and hosting capacity, so targeting is not a guess.');
    if (pick.offer.id === 'distribution') q.push('Circuit targeting: which feeders drive the outage minutes, and what upgrade would batteries defer?');
    q.push('Interconnection: Base says behind-the-meter systems avoid new interconnection agreements "in most cases". Which cases here are not most cases?');
    if (isNum(u.values.retail) && u.values.retail >= 0.5) q.push('Customer relationship: ' + Math.round(u.values.retail * 100) + '% of residential customers buy energy from a retail provider. Who enrolls the home and who bills it?');
    q.push('Approval path: who signs, the board, the city council, or a regulator, and on what timeline?');
    q.push('Enrollment: what share of eligible homes can realistically sign up, and how fast?');
    return q;
  }

  var api = {
    BASE_SOURCE: BASE_SOURCE, ERCOT_SOURCE: ERCOT_SOURCE, SPEC: SPEC, OFFERS: OFFERS, CLAIMS_TABLE: CLAIMS_TABLE, KNOWN: KNOWN, SIGNALS: SIGNALS,
    RELIABILITY_CUTOFF: RELIABILITY_CUTOFF, WHOLESALE_CUTOFF: WHOLESALE_CUTOFF,
    isNum: isNum, displayName: displayName, shortName: shortName, sizeProgram: sizeProgram, percentile: percentile,
    signalPercentiles: signalPercentiles, strongestSignal: strongestSignal, pickOffer: pickOffer, headline: headline,
    callScore: callScore, rankState: rankState, landedCost: landedCost, questions: questions, fmtNum: fmtNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PitchCore = api;
})(typeof window !== 'undefined' ? window : null);
