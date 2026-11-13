/* The homepage's math: one average day of one home battery, the sky for each hour, a large load's yearly
   bill, and the inputs that feed one battery's yearly value into the debt model (finance-core.js).
   Pure: no DOM, no network. Used by day.js in the browser (window.DayCore) and the Node tests. */
(function (root) {
  'use strict';

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

  // Sky colors through the day: [hour, top, bottom]. Blended between stops.
  const SKY = [[0, '#0b1430', '#1b2a55'], [4.5, '#141f47', '#3a3a6e'], [6.5, '#f3a877', '#ffdcae'], [9, '#7fc2f5', '#d6eeff'],
    [15, '#74bbf2', '#d0eaff'], [18.5, '#ef8344', '#ffd08a'], [20.5, '#28295c', '#6b4b7f'], [24, '#0b1430', '#1b2a55']];
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
  // Top and bottom sky color for the middle of hour h (0 to 23).
  function sky(h) {
    const t = h + 0.5;
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] <= t) i++;
    const a = SKY[i], b = SKY[i + 1], k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    return [mix(a[1], b[1], k), mix(a[2], b[2], k)];
  }
  // 0 at night, 1 in full daylight.
  const daylight = (h) => Math.max(0, Math.min(1, Math.sin(((h + 0.5 - 5) / 15) * Math.PI) * 1.7));

  /* One average day. The battery follows the fixed clock in data/pjm-value.json: it charges in the cheap
     hours and runs the home, at homeKw, in the evening hours. Each hour reports its state, how full the
     battery is at the end of it, and the cash so far (negative while it is buying). */
  /* Two ways to run it, matching the two yearly models on the site:
     - opts.homeKw (PJM): the battery only covers the home's own load, homeKw, through the evening window,
       and refills evenly through the cheap window. Exports are not counted there.
     - opts.exportKw (Texas): it charges and discharges at up to exportKw until full, then until the backup
       reserve, the way scripts/zone-value.cjs does. The evening kWh are sold at the zone price.
     A zone with no peak-hour data (Texas) has peakHour null. */
  function day(zone, schedule, spec, opts) {
    const h = zone.hourlyAvgRt, c0 = schedule.charge[0], c1 = schedule.charge[1], r0 = schedule.discharge[0], r1 = schedule.discharge[1];
    const cap = spec.capacity, eff = spec.efficiency, exporting = opts.exportKw != null;
    const kw = exporting ? opts.exportKw : opts.homeKw;
    const out = exporting ? Math.min(kw * (r1 - r0), cap * (1 - spec.reserve)) : kw * (r1 - r0);
    const peaks = zone.peaks && zone.peaks.rtoFiveCP;
    const peakHour = peaks ? peaks[0].localStart : null;
    const low = 1 - out / cap;
    let soc = low, cash = 0, toStore = out, toSell = out;
    const hours = h.map((price, i) => {
      let state = 'idle';
      if (i >= c0 && i < c1 && toStore > 1e-9) {
        const stored = exporting ? Math.min(kw * eff, toStore) : out / (c1 - c0);
        state = 'charge'; toStore -= stored; soc += stored / cap; cash -= (stored / eff) * price / 1000;
      } else if (i >= r0 && i < r1 && toSell > 1e-9) {
        const sold = Math.min(kw, toSell);
        state = 'run'; toSell -= sold; soc -= sold / cap; cash += sold * price / 1000;
      }
      return { i, price, state, peak: i === peakHour, soc: Math.max(0, Math.min(1, soc)), cash };
    });
    return { hours, kw, exporting, out, low, peakHour, c0, c1, r0, r1, night: mean(h.slice(c0, c1)), evening: mean(h.slice(r0, r1)), top: Math.max.apply(null, h),
      peakMissed: peakHour != null && (peakHour < r0 || peakHour >= r1), allPeaksSameHour: !!peaks && peaks.every((p) => p.localStart === peakHour) };
  }

  /* A large load's yearly power bill from the same public rates. Where transmission is nonbypassable
     (Ohio) it is still paid, but cutting peak load does not lower it. */
  function load(zone, capacityUsdPerMwDay, mw, loadFactor) {
    // Texas: no capacity market (rate is null), and the transmission rate is not in the data (null, not zero).
    const capPerMw = capacityUsdPerMwDay == null ? null : capacityUsdPerMwDay * 365;
    const txPerMw = zone.nitsUsdPerMwYear == null ? null : zone.nitsUsdPerMwYear;
    const txFixed = !!(zone.transmission && zone.transmission.bypassable === false);
    const energy = mw * zone.avgRtUsdPerMwh * 8760 * loadFactor;
    return { mw, energy, capPerMw, txPerMw, txFixed, capacity: capPerMw == null ? null : mw * capPerMw, transmission: txPerMw == null ? null : mw * txPerMw,
      total: energy + mw * ((capPerMw || 0) + (txPerMw || 0)), avoidedPerMw: (capPerMw || 0) + (txFixed ? 0 : (txPerMw || 0)) };
  }

  /* Raw inputs for FinanceCore: the debt model's defaults, then the published-figures preset, then the
     reader's changes, with one battery's yearly value (PjmCore.valueZone) as the revenue. */
  function fundRaw(defaults, value, over) {
    const raw = {};
    defaults.groups.forEach((g) => g.fields.forEach((f) => { raw[f.key] = f.value; }));
    defaults.presets.base_published.values.forEach((x) => { raw[x.key] = x.value; });
    Object.assign(raw, over || {});
    raw.revenueCase = 'stacked';
    raw.arbPerYear = value.energy;                                     // buying low, using high
    raw.tollPerKwYear = (value.capacity + value.transmission) / raw.kw; // peak charges avoided, carried on the per-kW line
    raw.ancPerKwYear = 0;
    raw.retailMarginMonthly = 0;                                        // no public PJM retail margin: left out
    return raw;
  }
  function fund(Finance, defaults, value, over) { return Finance.sizeDebt(Finance.normalize(fundRaw(defaults, value, over))); }
  // Highest installed cost, $ a kWh, at which the loan covers everything the credit and the install payment do not.
  function fundedCost(Finance, defaults, value, over) {
    let lo = 0, hi = 3000;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fund(Finance, defaults, value, Object.assign({}, over, { capexPerKwh: mid })).equity < 0.5) lo = mid; else hi = mid;
    }
    return lo;
  }
  // The four inputs the page lets a reader change, at their starting values.
  function fundBase(defaults) {
    const raw = fundRaw(defaults, { energy: 0, capacity: 0, transmission: 0 });
    return { capexPerKwh: raw.capexPerKwh, ratePct: raw.ratePct, tenorYears: raw.tenorYears, dscr: raw.dscr };
  }

  const api = { sky, daylight, day, load, fundRaw, fund, fundedCost, fundBase, LOAD_FACTOR: 0.9 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DayCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
