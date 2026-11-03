/* Shared, deterministic model. Browser + Node. Prices in $/MWh; energy in kWh. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Deployment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ capacity: 25, power: 5, efficiency: 0.88, reserve: 0.2, wear: 0 });
  function finite(value, name, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  }
  function parameters(input = {}) {
    const p = Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, input[key] === undefined ? fallback : input[key]]));
    finite(p.capacity, 'Capacity', 0.1, 10000); finite(p.power, 'Power', 0.01, 10000);
    finite(p.efficiency, 'Efficiency', 0.01, 1); finite(p.reserve, 'Reserve', 0, 1);
    finite(p.wear, 'Wear cost', 0, 10);
    return p;
  }
  function validateRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Price series is missing.');
    let previous = '';
    for (const row of rows) {
      const [date, hour, repeat, da, rt] = row;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour) || hour < 1 || hour > 24 || !['N', 'Y'].includes(repeat)) throw new Error('Invalid settlement interval.');
      const key = `${date}-${String(hour).padStart(2, '0')}-${repeat}`;
      if (key <= previous) throw new Error('Duplicate or out-of-order settlement interval.');
      if (!Number.isFinite(da) || !Number.isFinite(rt)) throw new Error('Price is missing; no imputation.');
      previous = key;
    }
  }
  // Fixed daily clocks, chosen without looking at the prices they are scored on.
  // Each window is [start, end) in clock hours, Central time: hour h runs h:00 to
  // h+1:00, which is ERCOT hour ending h+1. Inside a window the battery charges or
  // discharges at full power until it is full or at its reserve, so a short battery
  // can empty before its discharge window ends.
  //  overnight: charge 01:00 to 05:00 (HE2 to HE5), discharge 17:00 to 21:00 (HE18
  //    to HE21). The original clock, and still the backtest default so /deploy and
  //    its 4-hour (25 kWh / 5 kW) battery keep their numbers. A 2-hour battery at
  //    full power empties around 18:30 on this clock and misses HE20 and HE21.
  //  solarEvening: charge 10:00 to 14:00 (HE11 to HE14), discharge 19:00 to 21:00
  //    (HE20 to HE21). For a battery of about 2 hours, such as a Base Core (20 kW /
  //    39.2 kWh). Chosen from public ERCOT reasoning, not fitted to the test year:
  //    solar output holds midday prices down, and the net-load peak (load minus wind
  //    and solar) now comes after sunset, so the battery buys at midday and waits
  //    until 19:00 to sell, so it is not empty before the latest high-price hours.
  // Pass options.schedule as a name above or { charge: [start, end], discharge: [start, end] }.
  const SCHEDULES = Object.freeze({
    overnight: Object.freeze({ charge: Object.freeze([1, 5]), discharge: Object.freeze([17, 21]) }),
    solarEvening: Object.freeze({ charge: Object.freeze([10, 14]), discharge: Object.freeze([19, 21]) }),
  });
  const DEFAULT_SCHEDULE = 'overnight';
  function schedule(input = DEFAULT_SCHEDULE) {
    const s = typeof input === 'string' ? SCHEDULES[input] : input;
    if (!s || typeof s !== 'object') throw new Error(`Unknown schedule: ${input}.`);
    const window = (w, name) => {
      if (!Array.isArray(w) || w.length !== 2 || !w.every(Number.isInteger) || w[0] < 0 || w[1] > 24 || w[0] >= w[1])
        throw new Error(`${name} window must be [start, end] hours with 0 <= start < end <= 24.`);
      return [w[0], w[1]];
    };
    const charge = window(s.charge, 'Charge'), discharge = window(s.discharge, 'Discharge');
    if (charge[0] < discharge[1] && discharge[0] < charge[1]) throw new Error('Charge and discharge windows overlap.');
    return { charge, discharge };
  }
  // Uniform AC power within each physical hour. Equal sqrt(RTE) charge/discharge
  // losses. Reserve is a hard SOC floor.
  function backtest(rows, input = {}, options = {}) {
    validateRows(rows);
    const p = parameters(input), eta = Math.sqrt(p.efficiency);
    const clock = schedule(options.schedule);
    const inWindow = (h, w) => h >= w[0] && h < w[1];
    const floor = p.capacity * p.reserve;
    let soc = floor, bought = 0, sold = 0, cash = 0, wear = 0;
    const months = {}, trace = options.trace ? [] : null;
    const tariff = options.tariff;
    if (tariff) {
      finite(tariff.annualUsage, 'Annual usage', 0, 1e8);
      finite(tariff.offPeak, 'Off-peak rate', 0, 10); finite(tariff.peak, 'Peak rate', 0, 10);
      if (!['flat', 'evening', 'daytime'].includes(tariff.profile)) throw new Error('Unknown usage profile.');
    }
    const loadWeights = Array.from({ length: 24 }, (_, h) => !tariff || tariff.profile === 'flat' ? 1 :
      tariff.profile === 'evening' ? (h >= 17 && h < 21 ? 3 : 1) : (h >= 8 && h < 17 ? 3 : 1));
    const weightTotal = rows.reduce((sum, r) => sum + loadWeights[r[1] - 1], 0);
    for (const row of rows) {
      const [date, he, repeated, , price] = row, h = he - 1;
      const month = date.slice(0, 7);
      months[month] ||= { month, energy: 0, wear: 0, net: 0, bought: 0, sold: 0, hours: 0 };
      const m = months[month]; m.hours++;
      let charge = 0, discharge = 0;
      if (!options.idle && inWindow(h, clock.charge)) charge = Math.min(p.power, (p.capacity - soc) / eta);
      if (!options.idle && inWindow(h, clock.discharge)) {
        discharge = Math.min(p.power, Math.max(0, soc - floor) * eta);
        if (tariff) discharge = Math.min(discharge, tariff.annualUsage * loadWeights[h] / weightTotal);
      }
      soc += charge * eta - discharge / eta;
      const revenue = tariff ? discharge * tariff.peak - charge * tariff.offPeak : (discharge - charge) * price / 1000;
      const degradation = discharge * p.wear;
      cash += revenue; wear += degradation; bought += charge; sold += discharge;
      m.energy += revenue; m.wear += degradation; m.net += revenue - degradation; m.bought += charge; m.sold += discharge;
      if (trace) trace.push({ date, hourEnding: he, repeated, price, charge, discharge, soc, cashflow: revenue - degradation });
    }
    return { energy: cash, wear, net: cash - wear, bought, sold, initialSOC: floor, finalSOC: soc,
      residualKWh: soc - floor, months: Object.values(months), trace, hours: rows.length,
      baseline: 0, parameters: p, schedule: clock, mode: tariff ? 'retail' : 'wholesale' };
  }
  function diagnostics(rows) {
    validateRows(rows);
    const rt = rows.map(r => r[4]), da = rows.map(r => r[3]);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const average = mean(rt);
    return { meanRT: average, meanDA: mean(da), meanDASpread: mean(rows.map(r => r[3] - r[4])),
      meanAbsoluteSpread: mean(rows.map(r => Math.abs(r[3] - r[4]))),
      volatility: Math.sqrt(mean(rt.map(x => (x - average) ** 2))),
      negativeHours: rt.filter(x => x < 0).length, last: rows.at(-1) };
  }
  function rank(sites, zoneResults, energyWeight = 0.7, segment = 'residential') {
    finite(energyWeight, 'Energy weighting', 0, 1);
    const rows = sites.filter(s => s.segment === segment).map(s => ({ ...s,
      annualEnergy: zoneResults[s.zone]?.net ?? null }));
    const usable = rows.filter(s => Number.isFinite(s.annualEnergy) && Number.isFinite(s.scale));
    const extent = key => [Math.min(...usable.map(s => s[key])), Math.max(...usable.map(s => s[key]))];
    const [emin, emax] = extent('annualEnergy'), [smin, smax] = extent('scale');
    const norm = (x, min, max) => max === min ? 0.5 : (x - min) / (max - min);
    return rows.map(s => ({ ...s, score: usable.includes(s) ?
      100 * (energyWeight * norm(s.annualEnergy, emin, emax) + (1-energyWeight) * norm(s.scale, smin, smax)) : null }))
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.id.localeCompare(b.id));
  }
  function economics(result, input = {}) {
    const optional = (value, name, max = 1e9) => value === null || value === undefined || value === '' ? null : finite(Number(value), name, 0, max);
    const cost = optional(input.cost, 'Installed cost'), share = optional(input.operatorShare, 'Operator share', 100);
    const ancillary = optional(input.ancillary, 'Ancillary value'), reliability = optional(input.reliability, 'Reliability value');
    const annualCost = optional(input.annualCost, 'Annual costs');
    const known = [share, ancillary, reliability, annualCost].every(x => x !== null);
    // User-entered AS/reliability are scenarios only, not revenue inferred from SPP.
    const total = known ? (result.energy + ancillary) * (1-share/100) + reliability - result.wear - annualCost : null;
    return { energy: result.energy, ancillary, reliability, wear: result.wear, annualCost, operatorShare: share,
      total, payback: cost !== null && total > 0 ? cost / total : null, cost,
      status: !known ? 'missing-inputs' : total <= 0 ? 'no-positive-return' : cost === null ? 'missing-cost' : 'scenario' };
  }
  return { DEFAULTS, SCHEDULES, DEFAULT_SCHEDULE, schedule, parameters, validateRows, backtest, diagnostics, rank, economics };
});
