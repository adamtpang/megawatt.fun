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

  /* Public links between Base and a specific utility row. Keyed by the EIA utility id plus state.
     partner: true means a publicly announced Base program with that utility (dated, sourced). A partner is never ranked
     as a cold "call first" prospect, and its pitch is framed as expanding the existing program.
     ComEd is listed for a retail license, not a utility contract, so it is not a partner. El Paso Electric also has an
     EIA row in New Mexico (5701-NM); its pilot is in the Texas service region, so only 5701-TX is marked. Checked 2026-11-04. */
  var KNOWN = {
    '5078-TX': {
      alias: 'CoServ Electric',
      aliasSource: { title: 'Texas PUC filing, Project 53385: "Denton County Electric Cooperative, Inc. d/b/a CoServ Electric"', url: 'https://interchange.puc.texas.gov/Documents/53385_1837_1373864.PDF', retrieved: '2026-10-30' },
      partner: true, program: 'residential battery program',
      note: "Base's Utilities page names CoServ as a partner and quotes Gary Franzen, CoServ's Chief Energy Resources Officer.",
      source: BASE_SOURCE
    },
    '1015-TX': {
      partner: true, program: 'home battery storage program',
      note: "Base's Utilities page names Austin Energy and its home battery storage program.",
      source: BASE_SOURCE
    },
    '1175-TX': {
      partner: true, since: '2025-03', program: 'Battery Storage Subscription Program',
      note: "Base and Bandera Electric Cooperative announced Base's first co-op partnership in March 2025: Base supplies the batteries for BEC's Battery Storage Subscription Program, which BEC can aggregate and dispatch.",
      source: { title: 'Base Power and Bandera Electric Cooperative Announce Industry-First Distributed Battery Storage Partnership (press release, 11 March 2025)', url: 'https://www.plantautomation-technology.com/pressreleases/base-power-and-bandera-electric-cooperative-announce-industry-first', retrieved: '2026-11-04' }
    },
    '6182-TX': {
      partner: true, since: '2025-12', program: '20 MW residential battery program',
      note: 'Farmers Electric Cooperative and Base launched a residential battery program in Northeast Texas in December 2025: 20 MW of dispatchable capacity from networked home batteries, used for peak shaving and energy arbitrage.',
      source: { title: 'pv magazine USA, 11 December 2025: Texas electric utility co-op taps networked residential batteries for outage protection', url: 'https://pv-magazine-usa.com/2025/12/11/texas-farmers-tap-networked-residential-batteries-for-outage-protection/', retrieved: '2026-11-04' }
    },
    '7752-TX': {
      partner: true, since: '2026-04', program: '50 MW residential battery program',
      note: 'Guadalupe Valley Electric Cooperative (GVEC) and Base expanded a 2 MW pilot to 50 MW across its whole territory on 13 April 2026, aiming for 20 MW online by the end of 2026.',
      source: { title: 'Utility Dive, 22 April 2026: Base Power partnership to mitigate price spikes, load peaks for South Texas co-op, CEO says', url: 'https://www.utilitydive.com/news/base-power-partnership-to-mitigate-price-spikes-load-peaks-for-south-tx-co-op-ceo-says/818221/', retrieved: '2026-11-04' }
    },
    '5701-TX': {
      partner: true, since: '2026-02', program: 'Residential Distributed Energy Storage Pilot Program (up to 10 MW)',
      note: 'El Paso Electric and Base launched a residential battery pilot on 10 February 2026, seeking up to 10 MW before the 2026 summer peak. El Paso Electric dispatches the fleet; Base installs and maintains it. El Paso is outside ERCOT.',
      source: { title: 'El Paso Electric news release, 10 February 2026: El Paso Electric and Base Power Launch Residential Distributed Energy Storage Program', url: 'https://www.epelectric.com/news/el-paso-electric-and-base-power-launch-residential-distributed-energy-storage-program-to-strengthen-grid-reliability', retrieved: '2026-11-04' }
    },
    '3248-GA': {
      partner: true, since: '2026-10', program: '50 MW residential battery program',
      note: "Central Georgia EMC and Base announced a 50 MW residential battery program on 13 October 2026, Base's first utility partnership outside Texas. First installations are scheduled for 2027.",
      source: { title: 'Business Wire, 13 October 2026: Central Georgia EMC and Base Power Launch Residential Battery Program', url: 'https://www.financialcontent.com/article/bizwire-2026-10-13-central-georgia-emc-and-base-power-launch-residential-battery-program-to-bring-affordable-whole-home-backup-to-georgia', retrieved: '2026-11-04' }
    },
    '4110-IL': {
      note: "Base Retail holds an Illinois supplier license for residential customers in ComEd territory (license 26-0121). That is a retail offer, not a utility contract.",
      source: { title: 'Base Retail Illinois supply agreement', url: 'https://www.basepowercompany.com/_bpc/files/ENC6_mP2RRd-de1nBi7v6w-esa-uds-v09302026-docx.pdf', retrieved: '2026-10-27' }
    }
  };

  var ERCOT_SOURCE = { title: 'ERCOT Grid Insights: Energy-Only Wholesale Market', url: 'https://www.ercot.com/files/docs/2025/10/16/ERCOT-Grid-Insights-Energy-Only-Wholesale-Market.pdf', retrieved: '2026-10-30' };

  // Own-key lookup. Text from a request ("constructor", "__proto__") must never reach Object.prototype.
  function own(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined; }
  function dict() { return Object.create(null); }

  /* Wires-only (delivery-only) utilities. They deliver power but do not buy it for their homes, so they
     are not a buyer for a capacity program. Detected from the data first, then a named fallback list. */
  var WIRES_SOURCES = {
    pura: { title: 'Texas Utilities Code, chapter 39 (PURA): unbundling of generation, retail and delivery, sec. 39.051', url: 'https://statutes.capitol.texas.gov/Docs/UT/htm/UT.39.htm', retrieved: '2026-11-03' },
    agents: { title: 'Base Power, agents.md: service areas, and Base Texas REP, LLC (PUCT license 10338)', url: 'https://www.basepowercompany.com/agents.md', retrieved: '2026-11-03' },
    il: { title: 'Illinois Power Agency, petition for approval of the 2026 Electricity Procurement Plan (20 ILCS 3855/1-75)', url: 'https://ipa.illinois.gov/content/dam/soi/en/web/ipa/documents/20250929-petition-for-approval-2026-electricity-procurement-plan-29-sept-2025.pdf', retrieved: '2026-11-03' },
    pa: { title: '52 Pa. Code sec. 54.186, default service procurement plans (66 Pa.C.S. sec. 2807(e))', url: 'https://www.law.cornell.edu/regulations/pennsylvania/52-Pa-Code-SS-54-186', retrieved: '2026-11-03' }
  };
  // ERCOT transmission cost allocation, for co-ops and city utilities that buy their own power.
  var TCOS_SOURCES = {
    rule: { title: 'PUCT 16 TAC sec. 25.192, Transmission Service Rates (4CP)', url: 'https://www.puc.texas.gov/agency/rulesnlaws/subrules/electric/25.192/25.192.pdf', retrieved: '2026-11-03' },
    // The Texas Register notice says "All comments should refer to Project Number 58000". Project 58484 is the earlier
    // SB 6 study (Evaluation of Transmission Cost Recovery, opened August 2025), not the rulemaking.
    proposal: { title: 'Texas Register, 24 July 2026: PUCT proposed amendments to 16 TAC sec. 25.192 replacing 4CP with 12CP, Project No. 58000', url: 'https://www.sos.texas.gov/texreg/archive/July242026/Proposed%20Rules/16.ECONOMIC%20REGULATION.html', retrieved: '2026-11-04' },
    project: { title: 'PUCT Interchange, Project No. 58000: Rulemaking to Update Wholesale and IOU Retail Transmission Cost Recovery in the ERCOT Region (follows the SB 6 study in Project No. 58484)', url: 'https://interchange.puc.texas.gov/search/filings/?UtilityType=A&ControlNumber=58000&ItemMatch=Equal&DocumentType=ALL&SortOrder=Ascending', retrieved: '2026-11-04' }
  };
  // Fallback: the ERCOT transmission and distribution utilities in the competitive area, by EIA id.
  // Base's agents.md names these four areas as power-to-choose areas.
  var KNOWN_TDSP = { '44372-TX': 'Oncor', '8901-TX': 'CenterPoint', '3278-TX': 'AEP Texas', '20404-TX': 'AEP Texas', '40051-TX': 'TNMP' };
  // States where an investor-owned utility with any retail-choice homes owns no plants and its default supply is
  // bought under a state-approved procurement plan. Only states checked here are listed.
  var DEFAULT_SUPPLY_STATES = {
    IL: { who: 'the Illinois Power Agency, under a plan the Illinois Commerce Commission approves', source: 'il' },
    PA: { who: 'competitive procurement under a plan the Pennsylvania PUC approves', source: 'pa' }
  };
  var RETAIL_ALL = 0.99; // EIA-861 delivery share at or above this: every home buys energy from a retail provider

  // Returns null for a utility that buys power, or { basis, reason, sources, baseRetail } for a wires-only one.
  function wiresOnly(u) {
    if (!u || !u.values) return null;
    var r = u.values.retail, id = u.id, name = shortName(u);
    var pct = isNum(r) ? Math.round(r * 100) + '%' : null;
    if ((isNum(r) && r >= RETAIL_ALL) || own(KNOWN_TDSP, id)) {
      var tx = u.state === 'TX';
      return {
        basis: isNum(r) && r >= RETAIL_ALL ? 'eia-retail-share' : 'named-tdsp',
        what: name + ' delivers power but does not buy it.',
        reason: (isNum(r) && r >= RETAIL_ALL
          ? 'EIA-861 2025 counts ' + pct + ' of its residential customers as buying energy from a retail provider.'
          : name + ' is a transmission and distribution utility in the ERCOT competitive area.') +
          (tx ? ' Texas law unbundled generation, retail sales and delivery in these areas (PURA chapter 39), so the wires company does not buy energy or capacity for homes.' : ''),
        sources: tx ? ['eia', 'pura'] : ['eia'],
        baseRetail: own(KNOWN_TDSP, id) ? 'Base sells to homes here as a retail electric provider: its agents.md lists the ' + own(KNOWN_TDSP, id) + ' area and Base Texas REP, LLC (PUCT license 10338).' : null,
        baseSource: own(KNOWN_TDSP, id) ? 'agents' : null
      };
    }
    var ds = own(DEFAULT_SUPPLY_STATES, u.state);
    if (ds && isNum(r) && r > 0) {
      var k = own(KNOWN, id);
      return {
        basis: 'state-default-supply',
        what: name + ' delivers power but does not own plants or choose what it buys.',
        reason: pct + ' of its residential customers already buy energy from a retail supplier (EIA-861 2025). The rest get default supply bought by ' + ds.who + '.',
        sources: ['eia', ds.source],
        baseRetail: k && /retail/i.test(k.note) ? k.note : null,
        baseSource: k && /retail/i.test(k.note) ? 'known' : null
      };
    }
    return null;
  }

  // Source objects by key, for the wires-only notice and the ERCOT transmission note.
  function extraSources(u, pick) {
    var out = [];
    if (pick && pick.wires) {
      pick.wires.sources.forEach(function (k) { var s = own(WIRES_SOURCES, k); if (s) out.push({ key: k, title: s.title, url: s.url, retrieved: s.retrieved }); });
      if (pick.wires.baseSource === 'agents') out.push({ key: 'agents', title: WIRES_SOURCES.agents.title, url: WIRES_SOURCES.agents.url, retrieved: WIRES_SOURCES.agents.retrieved });
    } else if (u && u.detail && isErcotOnly(u.detail.rtos)) {
      out.push({ key: 'tcos', title: TCOS_SOURCES.rule.title, url: TCOS_SOURCES.rule.url, retrieved: TCOS_SOURCES.rule.retrieved });
      out.push({ key: 'tcos12', title: TCOS_SOURCES.proposal.title, url: TCOS_SOURCES.proposal.url, retrieved: TCOS_SOURCES.proposal.retrieved });
      out.push({ key: 'tcos58000', title: TCOS_SOURCES.project.title, url: TCOS_SOURCES.project.url, retrieved: TCOS_SOURCES.project.retrieved });
    }
    return out;
  }

  var SIGNALS = ['saidi', 'saifi', 'storm', 'heat', 'demand_response'];
  var RELIABILITY_CUTOFF = 0.75; // assumption: top quartile of US utilities counts as a reliability problem
  var WHOLESALE_CUTOFF = 0.5;    // majority of residential customers in an ISO or RTO balancing authority
  var PUBLIC_RELIABILITY_CUTOFF = RELIABILITY_CUTOFF, PUBLIC_WHOLESALE_CUTOFF = WHOLESALE_CUTOFF;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function displayName(u) {
    if (!u) return '';
    var k = own(KNOWN, u.id);
    return k && k.alias ? k.alias + ' (' + u.name + ')' : u.name;
  }

  function shortName(u) {
    if (!u) return '';
    var k = own(KNOWN, u.id);
    return k && k.alias ? k.alias : u.name;
  }

  // Program sizing from Base's claimed 20 kW / 39.2 kWh unit, or a company's own terms.
  // Null when the size or a battery term is outside its TERMS range, so no huge input can reach the output as Infinity.
  function sizeProgram(mw, customers, terms) {
    if (!isNum(mw) || mw <= 0 || mw > TERMS_BY_KEY.programMw.max) return null;
    var kw = terms && isNum(terms.kwPerHome) ? terms.kwPerHome : SPEC.kw;
    var kwh = terms && isNum(terms.kwhPerHome) ? terms.kwhPerHome : SPEC.kwh;
    if (!inRange('kwPerHome', kw) || !inRange('kwhPerHome', kwh)) return null;
    var batteries = Math.ceil(mw * 1000 / kw - 1e-9);
    var mwh = batteries * kwh / 1000;
    var share = isNum(customers) && customers > 0 ? batteries / customers : null;
    // Whole batteries only, so the built nameplate can sit above the size asked for (0.0001 MW is still one battery).
    var nameplateMw = batteries * kw / 1000;
    var out = { mw: mw, batteries: batteries, mwh: mwh, hours: kwh / kw, share: share, kw: kw, kwh: kwh,
      nameplateMw: nameplateMw, roundedUp: nameplateMw - mw > 1e-9 * Math.max(1, mw) };
    if (terms && inRange('memberReservePct', terms.memberReservePct)) out.dispatchMwh = mwh * (1 - terms.memberReservePct / 100);
    return out;
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

  // What a peak kW is worth to an ERCOT utility that buys its own power. Sourced in TCOS_SOURCES; no number is claimed.
  var ERCOT_PEAK_VALUE = 'For a co-op or city utility that buys its own power, peak value here is mostly two things: transmission cost, which Texas allocates to each distribution utility by its share of the four summer coincident peaks (4CP, PUCT rule 25.192; the PUCT rulemaking in Project No. 58000, published in the Texas Register on 24 July 2026, proposes moving to 12CP), and the wholesale energy it buys in peak hours.';

  // Offer rule, in order. First match wins.
  function pickOffer(u, pcts, opts) {
    opts = opts || {};
    var RELIABILITY_CUTOFF = opts.terms && isNum(opts.terms.reliabilityCutoffPct) ? opts.terms.reliabilityCutoffPct / 100 : PUBLIC_RELIABILITY_CUTOFF;
    var WHOLESALE_CUTOFF = opts.terms && isNum(opts.terms.wholesaleCutoffPct) ? opts.terms.wholesaleCutoffPct / 100 : PUBLIC_WHOLESALE_CUTOFF;
    var steps = [];
    // Rule 0: a wires-only utility does not buy energy or capacity, so no capacity offer, whatever the other signals say.
    var w = wiresOnly(u);
    if (w) {
      var name = shortName(u);
      return { offer: opts.largeLoads ? OFFERS.speed : OFFERS.distribution, variant: 'wires', rule: 0, wires: w,
        reason: w.what + ' ' + w.reason + ' In its area a home-battery company reaches homes as a retail provider, so the useful conversation with ' + name + ' is about interconnection and distribution-level value' + (opts.largeLoads ? ', including how batteries can help large loads connect' : '') + ', not a capacity purchase.' };
    }
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
    var ws = u.values.wholesale;
    var rtos = (u.detail && u.detail.rtos) || '';
    if (isNum(ws) && ws >= WHOLESALE_CUTOFF) {
      var wsNote = WHOLESALE_CUTOFF === PUBLIC_WHOLESALE_CUTOFF ? '' : ' Your cutoff is ' + Math.round(WHOLESALE_CUTOFF * 100) + '%.';
      if (isErcotOnly(rtos)) {
        return { offer: OFFERS.bulk, variant: 'peak', rule: 3, reason: 'Most residential customers sit in ERCOT, which runs an energy-only wholesale market (ERCOT, Oct 2025). With no capacity auction to accredit into, the fit is the second half of the offer: peak shaving. ' + ERCOT_PEAK_VALUE + wsNote, source: ERCOT_SOURCE };
      }
      return { offer: OFFERS.bulk, variant: 'accredited', rule: 3, reason: Math.round(ws * 100) + '% of residential customers sit in an ISO or RTO (' + rtos + '). The fit is accredited capacity for resource adequacy.' + wsNote };
    }
    return { offer: OFFERS.bulk, variant: 'peak', rule: 4, reason: 'No ISO or RTO majority and no top-quartile outage signal. The default fit is peak shaving to reduce the capacity the utility must plan for.' };
  }

  function pctPhrase(p) { return 'higher than ' + Math.round(p * 100) + '% of US utilities'; }

  function fmtNum(v, digits) {
    if (!isNum(v)) return 'not published';
    return v.toLocaleString('en-US', { maximumFractionDigits: digits || 0, minimumFractionDigits: digits || 0 });
  }

  // Power and energy with enough precision for any program size: kW / kWh under 1 MW, else MW / MWh.
  function trimDigits(v, digits) { return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }); }
  function fmtPower(mw) {
    if (!isNum(mw)) return 'n/a';
    if (Math.abs(mw) < 1) { var kw = mw * 1000; return trimDigits(kw, kw < 1 ? 3 : kw < 10 ? 2 : 1) + ' kW'; }
    return trimDigits(mw, mw < 10 ? 2 : 1) + ' MW';
  }
  function fmtEnergy(mwh) {
    if (!isNum(mwh)) return 'n/a';
    if (Math.abs(mwh) < 1) { var kwh = mwh * 1000; return trimDigits(kwh, kwh < 10 ? 2 : 1) + ' kWh'; }
    return trimDigits(mwh, mwh < 10 ? 2 : 1) + ' MWh';
  }
  // Plain sentence when whole batteries push the nameplate above the size asked for. Null otherwise.
  function roundedUpNote(prog) {
    if (!prog || !prog.roundedUp) return null;
    return 'You asked for ' + fmtPower(prog.mw) + '. Batteries come whole, so this is ' + fmtNum(prog.batteries) + ' batter' + (prog.batteries === 1 ? 'y' : 'ies') +
      ' at ' + trimDigits(prog.kw, 2) + ' kW each: ' + fmtPower(prog.nameplateMw) + ' nameplate, rounded up.';
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

  // An existing Base partner (KNOWN with partner: true): an expansion conversation, never a cold prospect.
  function partnerOf(id) { var k = own(KNOWN, id); return k && k.partner === true ? k : null; }
  var PARTNER_LABEL = 'Already a Base partner';
  function partnerFrame(u) {
    var k = u && partnerOf(u.id);
    if (!k) return null;
    var name = shortName(u);
    return { label: PARTNER_LABEL, program: k.program, since: k.since || null,
      framing: name + ' already runs a ' + k.program + ' with Base, so this is not a cold pitch. Treat it as expanding the existing program: the size below is extra MW on top of it, and the first questions are about what the current program has shown.' };
  }

  // EIA "Adjustment" rows (id 99999-ST) are state totals no utility reported, not a utility to call.
  function isAdjustment(u) { return /^99999-/.test(String(u && u.id)); }
  function marketsOf(rtos) { return typeof rtos === 'string' ? rtos.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : []; }

  /* The market a state's ranking prefers. A program's value case is built on one market's rules (capacity accreditation,
     peak pricing, transmission cost allocation), so when one ISO or RTO holds at least MARKET_MAJORITY of a state's
     residential customers, utilities in it are ranked first and the rest follow, labeled as outside it. Otherwise
     (a split state, or a state mostly outside any ISO) every utility is ranked together. */
  var MARKET_MAJORITY = 0.8;
  var NO_ISO = 'No ISO balancing authority';
  function stateMarket(all, state) {
    var homes = dict(), total = 0;
    all.forEach(function (u) {
      if (u.state !== state || isAdjustment(u) || !u.values || !isNum(u.values.homes)) return;
      var k = (u.detail && u.detail.rtos) || '';
      homes[k] = (homes[k] || 0) + u.values.homes; total += u.values.homes;
    });
    var best = null;
    Object.keys(homes).forEach(function (k) { if (best === null || homes[k] > homes[best]) best = k; });
    var share = total && best !== null ? homes[best] / total : null;
    var applies = !!best && best !== NO_ISO && marketsOf(best).length === 1 && isNum(share) && share >= MARKET_MAJORITY;
    var pct = isNum(share) ? Math.round(share * 100) + '%' : null;
    var reason = applies
      ? best + ' holds ' + pct + ' of ' + state + ' residential customers in this file, and a program\'s value case is built on one market\'s rules (capacity accreditation, peak pricing, transmission cost allocation). Utilities in ' + best + ' are ranked first; utilities in other markets follow, labeled as outside ' + best + ', because different market rules change what a kW of peak is worth.' +
        (best === 'ERCOT' ? ' In Texas the peak-shaving case on this page (an energy-only market and 4CP transmission allocation) is ERCOT\'s rules, and Base\'s Texas co-op and city programs are in ERCOT.' : '')
      : 'No single ISO or RTO holds ' + Math.round(MARKET_MAJORITY * 100) + '% of ' + state + ' residential customers in this file, so utilities are ranked together and each row names its market.';
    return { market: applies ? best : null, largest: best, share: share, applies: applies, reason: reason };
  }

  // Row label for a utility outside the preferred market, or partly outside it. Null when inside or when no market is preferred.
  function marketNote(rtos, market) {
    if (!market) return null;
    var ms = marketsOf(rtos);
    if (ms.indexOf(market) < 0) return 'Outside ' + market + ' (' + (rtos === NO_ISO ? 'not in an ISO' : rtos || 'market not published') + '): different market rules';
    if (ms.length > 1) return 'Partly outside ' + market + ' (also ' + ms.filter(function (m) { return m !== market; }).join(', ') + ')';
    return null;
  }

  /* Who to call first. Cold prospects that buy power are ranked 1, 2, 3..., those in the state's preferred market
     (stateMarket) first. Existing Base partners follow, unranked (rank null, partner true): they are an expansion
     conversation, not a cold call. Wires-only utilities (wiresOnly) come last, unranked (rank null, wires true),
     because they are not a buyer for a program. EIA adjustment rows are left out. */
  function rankState(all, state, limit) {
    var mk = stateMarket(all, state).market;
    var rows = all.filter(function (u) { return u.state === state && !isAdjustment(u); }).map(function (u) {
      var rtos = (u.detail && u.detail.rtos) || '';
      var wires = !!wiresOnly(u), partner = !wires && !!partnerOf(u.id);
      var inMarket = mk ? marketsOf(rtos).indexOf(mk) >= 0 : null;
      return { u: u, score: callScore(u), wires: wires, partner: partner, rtos: rtos, inMarket: inMarket,
        group: wires ? 3 : partner ? 2 : inMarket === false ? 1 : 0 };
    });
    rows.sort(function (a, b) {
      if (a.group !== b.group) return a.group - b.group;
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      if (a.score !== b.score) return b.score - a.score;
      var ca = a.u.values.homes || 0, cb = b.u.values.homes || 0;
      if (ca !== cb) return cb - ca;
      return a.u.name < b.u.name ? -1 : a.u.name > b.u.name ? 1 : 0;
    });
    var n = 0;
    return rows.slice(0, limit || 10).map(function (r) {
      return { rank: r.wires || r.partner ? null : ++n, wires: r.wires, partner: r.partner, id: r.u.id, name: displayName(r.u), customers: r.u.values.homes, saidi: r.u.values.saidi, score: r.score,
        market: r.rtos, inMarket: r.inMarket, marketNote: marketNote(r.rtos, mk) };
    });
  }

  // Landed cost range for a program, using Base's claimed $/kWh. Result in US dollars.
  function landedCost(mwh, row) {
    if (!isNum(mwh) || !row) return null;
    return { low: mwh * 1000 * row.low, high: mwh * 1000 * row.high };
  }

  function questions(u, pick, terms) {
    var t = terms || publicTerms();
    var q = [];
    var rtos = (u.detail && u.detail.rtos) || '';
    if (pick.wires) {
      // A wires-only utility: no capacity, dispatch or enrollment questions, because it does not buy power or enroll homes.
      var nm = shortName(u);
      q.push('Interconnection: what does ' + nm + ' need before home batteries behind its meters can charge and discharge (notice, export limits, telemetry), and how long does that take?');
      q.push('Distribution value: which feeders or substations are near their limits, and can ' + nm + ' pay for relief from batteries under its tariff, or does that need its regulator?');
      if (pick.offer.id === 'speed') q.push('Large loads: which waiting connections are held up by local wires limits that batteries could ease?');
      q.push('Data access: interval meter data, feeder and circuit outage history, and hosting capacity, so targeting is not a guess.');
      q.push('Outages: which circuits drive the outage minutes, and would ' + nm + ' share restoration data so backup value can be shown to homes?');
      q.push('Retail side: homes here buy energy from a retail provider. Which retail providers already offer a battery plan in this area, and how does ' + nm + ' work with them?');
      q.push('Approval path: what does ' + nm + "'s regulator need to see before it treats batteries as a distribution resource, and on what timeline?");
      return q;
    }
    var pf = partnerFrame(u);
    if (pf) {
      q.push('Existing program: how many homes are enrolled in the ' + pf.program + ' today, how much has ' + shortName(u) + ' dispatched, and what has limited sign-ups?');
      q.push('Expansion: what would ' + shortName(u) + ' need to see from the current program to approve the next tranche, and who decides?');
    }
    if (pick.offer.id === 'bulk' && pick.variant === 'accredited') q.push('Accreditation: how does ' + rtos + ' count a fleet of roughly 2-hour home batteries toward resource adequacy, and at what share of nameplate?');
    if (isErcotOnly(rtos)) q.push('Value stack in ERCOT: what is a kW off the four summer coincident peaks (4CP transmission allocation) worth to ' + shortName(u) + ', against peak wholesale energy cost and ancillary services, and how would a move to 12CP change that?');
    if (rtos === 'No ISO balancing authority') q.push('Capacity planning: what peak does the utility or its power supplier plan to, and what is a kW of peak reduction worth in its next resource plan?');
    q.push('Dispatch windows: which hours and seasons matter, and how many of the ' + fmtNum(t.cyclesPerYear) + ' cycles a year ' + (t.cyclesPerYear === TERMS_BY_KEY.cyclesPerYear.value ? 'Base offers' : 'you offer') + ' would the utility actually call?');
    q.push(isNum(t.memberReservePct)
      ? 'Member reserve: you hold back ' + fmtNum(t.memberReservePct) + '% of each ' + fmtNum(t.kwhPerHome, t.kwhPerHome % 1 ? 1 : 0) + ' kWh battery for the home. Does the utility accept that dispatchable share?'
      : 'Member reserve: how much of each ' + fmtNum(t.kwhPerHome, t.kwhPerHome % 1 ? 1 : 0) + ' kWh battery stays held back for the home, and what is left to dispatch?');
    q.push('Data access: interval meter data, feeder and circuit outage history, and hosting capacity, so targeting is not a guess.');
    if (pick.offer.id === 'distribution') q.push('Circuit targeting: which feeders drive the outage minutes, and what upgrade would batteries defer?');
    q.push('Interconnection: Base says behind-the-meter systems avoid new interconnection agreements "in most cases". Which cases here are not most cases?');
    if (isNum(u.values.retail) && u.values.retail >= 0.5) q.push('Customer relationship: ' + Math.round(u.values.retail * 100) + '% of residential customers buy energy from a retail provider. Who enrolls the home and who bills it?');
    q.push('Approval path: who signs, the board, the city council, or a regulator, and on what timeline?');
    q.push('Enrollment: what share of eligible homes can realistically sign up, and how fast?');
    return q;
  }

  /* Bring your own data (yourdata.js). A company's offer terms and target list, on top of the public numbers.
     Pure and Node-testable. The public constants above are never changed; every result is a new object. */

  // Every number in the pitch that is Base's claim or a choice made here. basis: claim (Base's Utilities page),
  // assumption (made on this page), or none (the pitch assumes nothing; only your file can set it).
  var TERMS = [
    { key: 'programMw', label: 'Program size', unit: 'MW', value: 100, min: 1, max: 5000, basis: 'assumption' },
    { key: 'kwPerHome', label: 'Power per home battery', unit: 'kW', value: SPEC.kw, min: 1, max: 100, basis: 'claim' },
    { key: 'kwhPerHome', label: 'Energy per home battery', unit: 'kWh', value: SPEC.kwh, min: 1, max: 500, basis: 'claim' },
    { key: 'costLowPerKwh', label: 'Landed cost, low end', unit: '$/kWh', value: CLAIMS_TABLE[0].low, min: 1, max: 5000, basis: 'claim' },
    { key: 'costHighPerKwh', label: 'Landed cost, high end', unit: '$/kWh', value: CLAIMS_TABLE[0].high, min: 1, max: 5000, basis: 'claim' },
    { key: 'deployMonthsLow', label: 'Time to deploy 100 MW, low end', unit: 'months', value: 3, min: 0, max: 120, basis: 'claim' },
    { key: 'deployMonthsHigh', label: 'Time to deploy 100 MW, high end', unit: 'months', value: 6, min: 0, max: 120, basis: 'claim' },
    { key: 'cyclesPerYear', label: 'Dispatch cycles offered per year', unit: 'cycles/yr', value: 500, min: 1, max: 1000, basis: 'claim' },
    { key: 'availabilityPct', label: 'Fleet availability', unit: '%', value: 96, min: 1, max: 100, basis: 'claim' },
    { key: 'forcedOutagePct', label: 'Forced outage rate, at most', unit: '%', value: 5, min: 0, max: 100, basis: 'claim' },
    { key: 'reliabilityCutoffPct', label: 'Outage percentile that picks distribution grid support', unit: '%', value: RELIABILITY_CUTOFF * 100, min: 1, max: 100, basis: 'assumption' },
    { key: 'wholesaleCutoffPct', label: 'Share of homes in an ISO or RTO that picks accredited capacity', unit: '%', value: WHOLESALE_CUTOFF * 100, min: 1, max: 100, basis: 'assumption' },
    { key: 'tollPerKwYear', label: 'Your toll price to the utility', unit: '$/kW-year', value: null, min: 0, max: 1000, basis: 'none' },
    { key: 'termYears', label: 'Your contract term', unit: 'years', value: null, min: 1, max: 40, basis: 'none' },
    { key: 'memberReservePct', label: 'Share of each battery held back for the home', unit: '%', value: null, min: 0, max: 99, basis: 'none' }
  ];
  var TERMS_BY_KEY = dict();
  TERMS.forEach(function (t) { TERMS_BY_KEY[t.key] = t; });
  function inRange(key, v) { var t = own(TERMS_BY_KEY, key); return !!t && isNum(v) && v >= t.min && v <= t.max; }
  var TARGET_COLUMNS = ['utility', 'state', 'status', 'owner', 'note'];

  function publicTerms() {
    var o = {};
    TERMS.forEach(function (t) { o[t.key] = t.value; });
    return o;
  }

  // A number cell: a finite number, or a plain decimal string after dropping $ , % and spaces. Hex, arrays and booleans are NaN.
  var DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  function cellNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    var t = v.replace(/[$,%\s]/g, '');
    return DECIMAL.test(t) ? Number(t) : NaN;
  }
  function blank(v) { return String(v == null ? '' : v).trim() === ''; }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }

  // Edit distance, giving up once it must exceed max (returns max + 1). Cost is at most len(a) x len(b),
  // and names longer than MAX_NAME never get here.
  function lev(a, b, max) {
    if (a === b) return 0;
    if (max == null) max = Infinity;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j, rowMin;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Limits on user text before any matching, so no request can make the matcher slow.
  var MAX_NAME = 200;      // characters in a utility name, id or alias
  var MAX_TARGETS = 500;   // rows in a target list
  var MAX_SUGGEST = 25;    // unmatched target rows that get a "Did you mean" (the rest just say not found)
  // Shorten user text before echoing it in a message.
  function clip(s, n) {
    var t = String(s == null ? '' : s);
    n = n || 60;
    return t.length > n ? t.slice(0, n) + '... (' + t.length + ' characters)' : t;
  }

  /* Common short names for large utilities, used only to find a row (never shown as its name).
     Each id was checked against data/expansion-map.json on 2026-11-04. A short name on two rows
     (AEP Texas, Pepco, OG&E, SWEPCO, Dominion Energy) is ambiguous on purpose: add a state. */
  var SHORT_NAMES = {
    '5078-TX': ['CoServ'], '44372-TX': ['Oncor'], '8901-TX': ['CenterPoint', 'CenterPoint Houston'], '3278-TX': ['AEP Texas'], '20404-TX': ['AEP Texas'],
    '40051-TX': ['TNMP'], '16604-TX': ['CPS Energy', 'CPS'], '7752-TX': ['GVEC'], '1175-TX': ['Bandera Electric Cooperative', 'BEC'],
    '3248-GA': ['Central Georgia EMC'], '4110-IL': ['ComEd'], '14328-CA': ['PG&E'], '17609-CA': ['SCE'], '16609-CA': ['SDG&E', 'SDGE'],
    '11208-CA': ['LADWP'], '16534-CA': ['SMUD'], '6452-FL': ['FPL'], '18454-FL': ['TECO'], '4226-NY': ['Con Edison', 'ConEd'], '11171-NY': ['LIPA'],
    '15477-NJ': ['PSE&G', 'PSEG'], '9726-NJ': ['JCP&L', 'JCPL'], '1167-MD': ['BGE'], '15270-DC': ['Pepco'], '15270-MD': ['Pepco'],
    '14940-PA': ['PECO'], '14715-PA': ['PPL', 'PPL Electric'], '803-AZ': ['APS'], '16572-AZ': ['SRP'], '24211-AZ': ['TEP'],
    '19876-VA': ['Dominion Energy', 'Dominion Energy Virginia'], '19876-NC': ['Dominion Energy'], '5109-MI': ['DTE', 'DTE Energy'],
    '14063-OK': ['OG&E', 'OGE'], '14063-AR': ['OG&E', 'OGE'], '15474-OK': ['PSO'], '17698-TX': ['SWEPCO'], '17698-LA': ['SWEPCO'], '17698-AR': ['SWEPCO']
  };
  // A name without its trailing company form: "Commonwealth Edison Co" -> "commonwealth edison".
  function looseName(n) {
    var prev, t = n;
    do { prev = t; t = t.replace(/\s(co|inc|llc|corp|corporation|company|ltd|lp)$/, ''); } while (t !== prev && t);
    return t;
  }

  /* Lookup for any utility text: EIA id ("5078-TX"), "Name, ST", plain name, a public alias (CoServ Electric),
     a common short name (Oncor, ComEd), or the name without Co / Inc / LLC. Exact names win over the looser keys. */
  function utilityIndex(utilities) {
    var byId = dict(), byName = dict(), byLoose = dict();
    function add(map, k, u) {
      if (!k) return;
      map[k] = map[k] || [];
      if (map[k].indexOf(u) < 0) map[k].push(u);
    }
    utilities.forEach(function (u) {
      byId[u.id.toLowerCase()] = u;
      var full = norm(u.name), bare = norm(u.name.replace(/\s*-\s*\([A-Z]{2}\)\s*$/, ''));
      add(byName, full, u);
      add(byName, bare, u);
      var k = own(KNOWN, u.id);
      if (k && k.alias) add(byName, norm(k.alias), u);
      add(byLoose, looseName(full), u);
      add(byLoose, looseName(bare), u);
      (own(SHORT_NAMES, u.id) || []).forEach(function (s) { add(byLoose, norm(s), u); });
    });
    var keys = [];
    Object.keys(byName).forEach(function (n) { keys.push([n, byName[n]]); });
    Object.keys(byLoose).forEach(function (n) { if (!own(byName, n)) keys.push([n, byLoose[n]]); });
    return { byId: byId, byName: byName, byLoose: byLoose, names: Object.keys(byName), keys: keys, states: utilities.reduce(function (s, u) { s[u.state] = true; return s; }, dict()) };
  }

  /* One matcher for the page, the API and target rows. Returns { u }, { ambiguous: [...] },
     { stateMismatch, state }, { tooLong: true }, or { suggestion } (null when nothing is close).
     opts.suggest === false skips the closest-name search. Text over MAX_NAME characters is never matched. */
  function matchUtility(idx, text, st, opts) {
    var raw = String(text == null ? '' : text).trim();
    if (raw.length > MAX_NAME) return { tooLong: true, suggestion: null };
    var state = String(st == null ? '' : st).trim().toUpperCase();
    var hit = own(idx.byId, raw.toLowerCase());
    if (hit) return state && hit.state !== state ? { stateMismatch: hit, state: state } : { u: hit };
    var m = /^(.*),\s*([A-Za-z]{2})$/.exec(raw);
    if (m && !state) { raw = m[1]; state = m[2].toUpperCase(); }
    var key = norm(raw);
    var pick = function (map) {
      var list = own(map, key) || [];
      return state ? list.filter(function (u) { return u.state === state; }) : list;
    };
    var list = pick(idx.byName);
    if (!list.length && idx.byLoose) list = pick(idx.byLoose);
    if (list.length === 1) return { u: list[0] };
    if (list.length > 1) return { ambiguous: list };
    return { suggestion: opts && opts.suggest === false ? null : suggest(idx, raw, state) };
  }

  // Closest public name, when one is close enough to be a likely typo.
  function suggest(idx, raw, state) {
    var q = norm(raw);
    if (!q || q.length > MAX_NAME) return null;
    var limit = Math.max(2, q.length * 0.4);
    var best = null;
    (idx.keys || idx.names.map(function (n) { return [n, idx.byName[n]]; })).forEach(function (pair) {
      var n = pair[0];
      var us = pair[1].filter(function (u) { return !state || u.state === state; });
      if (!us.length) return;
      var d = n.indexOf(q) === 0 || q.indexOf(n) === 0 ? Math.abs(n.length - q.length) * 0.25 : lev(q, n, Math.floor(best ? Math.min(limit, best.d) : limit));
      if (!best || d < best.d) best = { d: d, u: us[0] };
    });
    return best && best.d <= limit ? best.u : null;
  }

  /* One loader for both parts. parsed is yourdata.js parseText output.
     CSV: rows with a key are offer terms, rows with a utility are targets; one file may hold both.
     JSON: { key: value } (terms only), { terms: { key: value }, targets: [{ utility, status, owner, note }] },
     or an array of row objects shaped like the CSV. */
  function loadYourData(parsed, utilities) {
    var errors = [], warnings = [], termRows = [], targetRows = [];
    var data = parsed && parsed.data;
    var isCsv = parsed && parsed.kind === 'csv';
    function rowName(i) { return isCsv ? 'Row ' + (i + 2) + ': ' : 'Item ' + (i + 1) + ': '; }
    // Column names are matched trimmed and in any case ("Utility", " STATUS "). Unknown columns are a warning, once each.
    var KNOWN_COLS = dict(), unknownCols = [];
    TEMPLATE_COLUMNS.forEach(function (c) { KNOWN_COLS[c] = true; });
    function columns(r) {
      var o = dict();
      Object.keys(r).forEach(function (k) {
        var c = String(k).trim().toLowerCase();
        if (!own(KNOWN_COLS, c)) { if (unknownCols.indexOf(k) < 0 && unknownCols.length < 20) unknownCols.push(k); return; }
        o[c] = r[k];
      });
      return o;
    }
    // Text cells must be text. A list or object in a JSON row is an error naming the row, never "[object Object]".
    function textOk(r, cols, where) {
      var bad = cols.filter(function (c) { var v = r[c]; return v != null && typeof v !== 'string' && !(typeof v === 'number' && c !== 'utility' && c !== 'state'); });
      bad.forEach(function (c) { var v = r[c]; errors.push(where + c + ' must be text, got ' + (Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : typeof v) + '.'); });
      return !bad.length;
    }
    function splitRows(rows, label) {
      rows.forEach(function (r0, i) {
        var where = label ? label(i) : rowName(i);
        if (!r0 || typeof r0 !== 'object' || Array.isArray(r0)) { errors.push(where + 'not a row object.'); return; }
        var r = columns(r0);
        if (!textOk(r, ['key', 'utility', 'state', 'status', 'owner', 'note'], where)) return;
        var hasKey = !blank(r.key), hasUtil = !blank(r.utility);
        if (hasKey && hasUtil) errors.push(where + 'has both a key and a utility. Put offer terms and targets on separate rows.');
        else if (hasKey) termRows.push({ key: r.key, value: r.value, where: where });
        else if (hasUtil) targetRows.push({ r: r, where: where });
        else if (Object.keys(r).some(function (k) { return !blank(r[k]); })) errors.push(where + 'has no key and no utility, so it is neither an offer term nor a target.');
      });
    }
    if (Array.isArray(data)) splitRows(data);
    else if (data && typeof data === 'object') {
      var hasParts = 'terms' in data || 'targets' in data;
      var termObj = hasParts ? data.terms : data;
      if (Array.isArray(termObj)) splitRows(termObj, function (i) { return 'terms item ' + (i + 1) + ': '; });
      else if (termObj && typeof termObj === 'object') {
        Object.keys(termObj).forEach(function (k) { termRows.push({ key: k, value: termObj[k], where: '' }); });
      }
      if (hasParts && data.targets != null) {
        if (!Array.isArray(data.targets)) errors.push('targets must be a list of { utility, status, owner, note } objects.');
        else if (data.targets.length > MAX_TARGETS) errors.push('targets has ' + data.targets.length + ' items. The limit is ' + MAX_TARGETS + ' per request; split the list.');
        else data.targets.forEach(function (r0, i) {
          var where = 'targets item ' + (i + 1) + ': ';
          if (!r0 || typeof r0 !== 'object' || Array.isArray(r0)) { errors.push(where + 'not a { utility, status, owner, note } object.'); return; }
          var r = columns(r0);
          if (!textOk(r, TARGET_COLUMNS, where)) return;
          if (blank(r.utility)) errors.push(where + 'missing utility.');
          else targetRows.push({ r: r, where: where });
        });
      }
    }
    if (unknownCols.length) warnings.push('Ignored unknown column' + (unknownCols.length === 1 ? '' : 's') + ' ' + unknownCols.map(function (c) { return '"' + clip(c, 40) + '"'; }).join(', ') + '. Known columns: ' + TEMPLATE_COLUMNS.join(', ') + '.');
    if (targetRows.length > MAX_TARGETS) { errors.push('The target list has ' + targetRows.length + ' rows. The limit is ' + MAX_TARGETS + '; split the file.'); targetRows = []; }
    if (!termRows.length && !targetRows.length && !errors.length) errors.push('No rows found. Offer terms need key and value columns; a target list needs a utility column. Download a template for the shape.');

    // Offer terms
    var terms = publicTerms(), changed = [], seen = dict();
    termRows.forEach(function (p) {
      if (p.key != null && typeof p.key !== 'string') { errors.push(p.where + 'key must be text.'); return; }
      var key = String(p.key).trim();
      var t = own(TERMS_BY_KEY, key);
      if (!t) { errors.push(p.where + 'unknown key "' + clip(key, 40) + '". Download the template for the full list.'); return; }
      if (blank(p.value)) {
        if (t.value != null) warnings.push(p.where + key + ' is blank, so the public value stays.');
        return;
      }
      var v = cellNum(p.value);
      if (!isFinite(v)) { errors.push(p.where + key + ' is not a number: ' + (typeof p.value === 'string' ? '"' + clip(p.value, 40) + '"' : Array.isArray(p.value) ? 'a list' : typeof p.value === 'object' ? 'an object' : String(p.value)) + '.'); return; }
      if (v < t.min || v > t.max) { errors.push(p.where + key + ' must be between ' + t.min + ' and ' + t.max + ' ' + t.unit + '. Got ' + v + '.'); return; }
      if (seen[key]) warnings.push(p.where + key + ' appears twice. The later value wins.');
      seen[key] = true;
      terms[key] = v;
    });
    if (terms.costLowPerKwh > terms.costHighPerKwh) errors.push('costLowPerKwh (' + terms.costLowPerKwh + ') is above costHighPerKwh (' + terms.costHighPerKwh + ').');
    if (terms.deployMonthsLow > terms.deployMonthsHigh) errors.push('deployMonthsLow (' + terms.deployMonthsLow + ') is above deployMonthsHigh (' + terms.deployMonthsHigh + ').');
    if (isNum(terms.termYears) && !isNum(terms.tollPerKwYear)) warnings.push('termYears is set without tollPerKwYear, so no contract value is shown.');
    TERMS.forEach(function (t) { if (terms[t.key] !== t.value) changed.push(t.key); });

    // Target list. Unmatched names are warnings, never a failed file.
    var targets = dict(), unmatched = 0;
    if (targetRows.length) {
      var idx = utilityIndex(utilities || []);
      var suggested = 0;
      targetRows.forEach(function (p) {
        var r = p.r;
        var asked = String(r.utility).trim();
        if (asked.length > MAX_NAME) { errors.push(p.where + 'utility is ' + asked.length + ' characters. The limit is ' + MAX_NAME + '.'); return; }
        if (r.state != null && String(r.state).length > MAX_NAME) { errors.push(p.where + 'state is longer than ' + MAX_NAME + ' characters.'); return; }
        var res = matchUtility(idx, asked, r.state, { suggest: suggested < MAX_SUGGEST });
        var shown = clip(asked);
        if (res.stateMismatch) {
          unmatched++;
          warnings.push(p.where + '"' + shown + '" is ' + displayName(res.stateMismatch) + ' in ' + res.stateMismatch.state + ', not ' + clip(res.state, 10) + '. Fix the state or leave it blank. Skipped.');
          return;
        }
        if (res.ambiguous) {
          unmatched++;
          warnings.push(p.where + '"' + shown + '" matches ' + res.ambiguous.length + ' utilities (' + res.ambiguous.slice(0, 10).map(function (u) { return u.id; }).join(', ') + (res.ambiguous.length > 10 ? ', ...' : '') + '). Use the id or add a state. Skipped.');
          return;
        }
        if (!res.u) {
          unmatched++;
          suggested++;
          var s = res.suggestion;
          warnings.push(p.where + 'no utility called "' + shown + '"' + (s ? '. Did you mean ' + displayName(s) + ', ' + s.state + ' (id ' + s.id + ')?' : '.') + ' Skipped.');
          return;
        }
        var status = String(r.status == null ? '' : r.status).trim();
        if (status.length > 60) { errors.push(p.where + 'status is longer than 60 characters.'); return; }
        if (!status) { status = 'target'; warnings.push(p.where + 'no status for ' + displayName(res.u) + ', so it shows as "target".'); }
        if (own(targets, res.u.id)) warnings.push(p.where + displayName(res.u) + ' is listed twice. The later row wins.');
        targets[res.u.id] = { id: res.u.id, status: status, owner: String(r.owner == null ? '' : r.owner).trim(), note: String(r.note == null ? '' : r.note).trim(), input: asked };
      });
    }
    // List problems in file order: numbered rows first, by row, then whole-file checks.
    function rowOf(m) { var x = /^(?:Row|Item) (\d+):/.exec(m); return x ? Number(x[1]) : Infinity; }
    function inOrder(list) { return list.map(function (m, i) { return [rowOf(m), i, m]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; }); }
    errors = inOrder(errors); warnings = inOrder(warnings);
    return { terms: terms, changed: changed, given: Object.keys(seen), targets: targets, targetCount: Object.keys(targets).length, unmatched: unmatched, termRows: termRows.length, errors: errors, warnings: warnings };
  }

  // "Who to call first": your targets first, then everyone else. Public rank order kept inside each group.
  function orderWithTargets(rows, targets) {
    var t = targets || {};
    return rows.filter(function (r) { return own(t, r.id); }).concat(rows.filter(function (r) { return !own(t, r.id); }));
  }

  // Template rows: every offer term with its public value, plus empty target columns so one file can hold both.
  function templateRows() {
    return TERMS.map(function (t) {
      return { key: t.key, value: t.value == null ? '' : t.value, unit: t.unit, label: t.label,
        public_basis: t.basis === 'claim' ? "Base's claim, " + BASE_SOURCE.url : t.basis === 'assumption' ? 'assumption on this page' : 'none: the public pitch assumes nothing here',
        min: t.min, max: t.max, utility: '', state: '', status: '', owner: '', note: '' };
    });
  }
  var TEMPLATE_COLUMNS = ['key', 'value', 'unit', 'label', 'public_basis', 'min', 'max'].concat(TARGET_COLUMNS);

  // Offer economics from your own toll price. Null when no price is set.
  function tollValue(terms, mw) {
    if (!terms || !isNum(terms.tollPerKwYear) || !isNum(mw) || mw <= 0) return null;
    var perYear = mw * 1000 * terms.tollPerKwYear;
    return { perYear: perYear, total: isNum(terms.termYears) ? perYear * terms.termYears : null };
  }

  var api = {
    BASE_SOURCE: BASE_SOURCE, ERCOT_SOURCE: ERCOT_SOURCE, SPEC: SPEC, OFFERS: OFFERS, CLAIMS_TABLE: CLAIMS_TABLE, KNOWN: KNOWN, SIGNALS: SIGNALS,
    RELIABILITY_CUTOFF: RELIABILITY_CUTOFF, WHOLESALE_CUTOFF: WHOLESALE_CUTOFF,
    isNum: isNum, displayName: displayName, shortName: shortName, sizeProgram: sizeProgram, percentile: percentile,
    signalPercentiles: signalPercentiles, strongestSignal: strongestSignal, pickOffer: pickOffer, headline: headline,
    WIRES_SOURCES: WIRES_SOURCES, TCOS_SOURCES: TCOS_SOURCES, KNOWN_TDSP: KNOWN_TDSP, DEFAULT_SUPPLY_STATES: DEFAULT_SUPPLY_STATES, ERCOT_PEAK_VALUE: ERCOT_PEAK_VALUE,
    wiresOnly: wiresOnly, extraSources: extraSources, known: function (id) { return own(KNOWN, id); }, own: own, inRange: inRange,
    partnerOf: partnerOf, partnerFrame: partnerFrame, PARTNER_LABEL: PARTNER_LABEL, stateMarket: stateMarket, marketNote: marketNote, MARKET_MAJORITY: MARKET_MAJORITY, isAdjustment: isAdjustment,
    callScore: callScore, rankState: rankState, landedCost: landedCost, questions: questions, fmtNum: fmtNum,
    TERMS: TERMS, TERMS_BY_KEY: TERMS_BY_KEY, TARGET_COLUMNS: TARGET_COLUMNS, TEMPLATE_COLUMNS: TEMPLATE_COLUMNS, publicTerms: publicTerms,
    loadYourData: loadYourData, orderWithTargets: orderWithTargets, templateRows: templateRows, tollValue: tollValue, utilityIndex: utilityIndex, matchUtility: matchUtility,
    MAX_NAME: MAX_NAME, MAX_TARGETS: MAX_TARGETS, SHORT_NAMES: SHORT_NAMES, clip: clip, fmtPower: fmtPower, fmtEnergy: fmtEnergy, roundedUpNote: roundedUpNote
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PitchCore = api;
})(typeof window !== 'undefined' ? window : null);
