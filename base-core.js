/* "Your battery today": pure logic, no DOM. Used by base.js in the browser and tests/base.test.cjs in Node.
   Planner mirrors the Go planner after the audit fix: one charge window before a boundary, one discharge
   window after it, and every kWh bought is only matched to a kWh sold when that pair makes money
   (marginal matching). The battery starts and ends the day at its backup reserve. */
(function (root) {
  'use strict';

  // Labeled assumptions. Shown on the page next to every number that depends on them.
  const ASSUMPTIONS = {
    batteryKwh: 39.2,        // Base Core, smaller size (pv magazine USA, 2026-08-04)
    batteryKw: 5,            // assumption: charge/discharge rate (same as the Go planner default)
    roundTripEff: 0.88,      // assumption: same default as the Go planner
    reservePct: 0.5,         // assumption: share of the battery always kept for backup
    monthlyKwh: 1096,        // EIA 2024 Table 5A: average Texas home
    staleAfterDays: 2,       // show a warning if the price day is older than this
  };

  // Assumption: typical home load shape, evening peak. Normalized so it sums to 24.
  const SHAPE_RAW = [0.7, 0.65, 0.62, 0.6, 0.62, 0.7, 0.85, 0.95, 0.9, 0.85, 0.85, 0.9, 0.95, 1.0, 1.05, 1.15, 1.3, 1.5, 1.6, 1.55, 1.4, 1.2, 1.0, 0.8];
  const SHAPE = (() => { const s = SHAPE_RAW.reduce((a, b) => a + b); return SHAPE_RAW.map((x) => x * 24 / s); })();

  function homeLoad(monthlyKwh) {
    const daily = monthlyKwh * 12 / 365;
    return SHAPE.map((x) => x * daily / 24);
  }

  function validPrices(p) {
    return Array.isArray(p) && p.length === 24 && p.every((x) => Number.isFinite(x));
  }

  // Best single cycle with marginal matching. Returns per-hour charge/discharge kWh (grid side for
  // charge, delivered side for discharge) and the energy cycled.
  function planDay(prices, bat) {
    if (!validPrices(prices)) throw new RangeError('need 24 finite hourly prices');
    const usable = bat.kwh * (1 - bat.reservePct);
    let best = { profit: 0, charge: new Array(24).fill(0), discharge: new Array(24).fill(0) };
    for (let t = 1; t < 24; t++) {
      const buys = [...Array(t).keys()].sort((a, b) => prices[a] - prices[b]);
      const sells = [...Array(24 - t).keys()].map((i) => i + t).sort((a, b) => prices[b] - prices[a]);
      const charge = new Array(24).fill(0), discharge = new Array(24).fill(0);
      const buyLeft = buys.map(() => bat.kw), sellLeft = sells.map(() => bat.kw);
      let stored = 0, profit = 0, bi = 0, si = 0;
      while (bi < buys.length && si < sells.length && stored < usable - 1e-9) {
        const b = buys[bi], s = sells[si];
        if (prices[s] * bat.eff <= prices[b]) break; // the fix: never take a losing marginal pair
        const e = Math.min(buyLeft[bi], sellLeft[si] / bat.eff, usable - stored); // kWh bought
        charge[b] += e; discharge[s] += e * bat.eff; stored += e;
        profit += (e * bat.eff * prices[s] - e * prices[b]) / 1000;
        buyLeft[bi] -= e; sellLeft[si] -= e * bat.eff;
        if (buyLeft[bi] <= 1e-9) bi++;
        if (sellLeft[si] <= 1e-9) si++;
      }
      if (profit > best.profit + 1e-12) best = { profit, charge, discharge };
    }
    return best;
  }

  // Split each hour's battery output between the home and the grid, and track the charge level.
  function simulateDay(prices, opts) {
    const a = Object.assign({}, ASSUMPTIONS, opts || {});
    const bat = { kwh: a.batteryKwh, kw: a.batteryKw, eff: a.roundTripEff, reservePct: a.reservePct };
    const load = homeLoad(a.monthlyKwh);
    const plan = planDay(prices, bat);
    const reserve = a.batteryKwh * a.reservePct;
    let soc = reserve;
    const hours = prices.map((p, h) => {
      soc += plan.charge[h] - plan.discharge[h] / bat.eff;
      const toHome = Math.min(plan.discharge[h], load[h]);
      const toGrid = plan.discharge[h] - toHome;
      const state = plan.charge[h] > 1e-9 ? 'charge' : plan.discharge[h] > 1e-9 ? 'discharge' : 'reserve';
      return { hourEnding: h + 1, price: p, load: load[h], charge: plan.charge[h], toHome, toGrid, soc, state };
    });
    return { hours, profit: plan.profit, reserveKwh: reserve, endSoc: soc, dailyKwh: load.reduce((x, y) => x + y), assumptions: a };
  }

  // Clock label for the hour that STARTS at h (hour ending h+1).
  function clock(h) { const x = ((h % 24) + 24) % 24; return (x % 12 || 12) + (x < 12 ? ' AM' : ' PM'); }

  function runs(hours, test) {
    const out = []; let start = null;
    hours.forEach((o, i) => { if (test(o)) { if (start === null) start = i; } else if (start !== null) { out.push([start, i]); start = null; } });
    if (start !== null) out.push([start, hours.length]);
    return out;
  }
  const span = ([a, b]) => `${clock(a)} to ${clock(b)}`;

  function summarize(day) {
    const ch = runs(day.hours, (o) => o.state === 'charge');
    const home = runs(day.hours, (o) => o.toHome > 1e-6);
    const grid = day.hours.filter((o) => o.toGrid > 1e-6);
    if (!ch.length) return 'Prices barely moved today, so your battery held its charge and stayed ready as backup.';
    let s = `Your battery charged from ${ch.map(span).join(' and ')}, when power was cheapest`;
    if (home.length) s += `, and powered your home from ${home.map(span).join(' and ')}`;
    if (grid.length) {
      const peak = grid.reduce((a, b) => (b.price > a.price ? b : a));
      s += `. It also sent extra power to the grid for ${grid.length} hour${grid.length > 1 ? 's' : ''}, most around ${clock(peak.hourEnding - 1)}`;
    }
    return s + '.';
  }

  function backupHours(socKwh, monthlyKwh) { return socKwh / (monthlyKwh * 12 / 365 / 24); }

  // Outage mode. Assumption: running watts for the essentials.
  const ESSENTIALS = [
    { name: 'Fridge', kw: 0.15 }, { name: 'Lights', kw: 0.15 }, { name: 'Wi-Fi and phones', kw: 0.05 }, { name: 'Fans', kw: 0.15 },
  ];
  const EXTRAS = [{ name: 'Air conditioning', kw: 3.0 }, { name: 'Electric oven', kw: 2.5 }, { name: 'Clothes dryer', kw: 3.0 }, { name: 'Pool pump', kw: 1.5 }];
  function outage(socKwh, withAC) {
    const essentials = ESSENTIALS.reduce((a, x) => a + x.kw, 0);
    return { essentialsHours: socKwh / essentials, withAcHours: socKwh / (essentials + EXTRAS[0].kw), essentials: ESSENTIALS, extras: EXTRAS, withAC };
  }

  // Data freshness. Returns which prices to show and what to tell the member.
  function pickPrices(live, cached, now) {
    const ok = (d) => d && validPrices(d.prices) && typeof d.date === 'string';
    const ageDays = (d) => (now - new Date(d.date + 'T12:00:00-05:00')) / 86400000;
    if (ok(live) && ageDays(live) <= ASSUMPTIONS.staleAfterDays) return { data: live, status: 'live', note: null };
    if (ok(cached)) return { data: cached, status: 'fallback', note: `We couldn't load today's prices, so this shows the last good day: ${cached.date}.` };
    return { data: null, status: 'none', note: 'Price data is unavailable right now.' };
  }

  // Battery telemetry. A real app would read this from the battery; here it is simulated,
  // and a missing report must never be filled with made-up numbers.
  function batteryView(report) {
    if (!report || !Number.isFinite(report.socKwh)) return { reachable: false, message: "We can't reach your battery right now." };
    return { reachable: true, socKwh: report.socKwh };
  }

  const api = { ASSUMPTIONS, homeLoad, planDay, simulateDay, summarize, backupHours, outage, pickPrices, batteryView, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BaseCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
