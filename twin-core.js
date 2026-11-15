/* The twin: an hour-by-hour simulation of one real year on the Texas grid. Pure: no DOM, no network.
   Two machines are simulated on the same clock:
     battery()     one home battery (a Base-style unit) trading at its load zone's real-time price
     dataCenter()  a large load with a battery on site, trying to stay off the grid when the grid peaks
   Every hour is one tick. Prices are ERCOT's hourly real-time settlement prices (data/deployment/LZ_*.csv)
   and system demand is ERCOT's hourly native load (data/twin-ercot-load.json). Nothing here is random: the
   same inputs always give the same year. Used by twin.js (window.TwinCore) and the Node tests.

   Physics, the same as deployment-core.js so the two agree to the cent: power is uniform inside an hour,
   the round-trip loss is split evenly (sqrt) between charging and discharging, and the reserve is a hard
   floor on the state of charge in normal running. Only an outage may go below it. */
(function (root) {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  // "date,hourEnding,repeated,dam,rtm" text -> rows { date, he, h (clock hour 0-23), price ($/MWh, real-time) }.
  function parsePrices(csv) {
    const rows = [];
    const lines = csv.trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const price = Number(c[4]);
      if (c.length < 5 || !Number.isFinite(price)) throw new Error('Price file: bad line ' + (i + 1));
      rows.push({ date: c[0], he: Number(c[1]), h: Number(c[1]) - 1, price });
    }
    return rows;
  }
  // Attach system demand (MW) to each price row. Both are in hour order within a day.
  function withLoad(rows, load) {
    const at = {};
    return rows.map((r) => {
      const k = at[r.date] = (at[r.date] || 0) + 1;
      const day = load.days[r.date];
      if (!day || day[k - 1] == null) throw new Error('No grid demand for ' + r.date + ' hour ' + k);
      return Object.assign({}, r, { gridMw: day[k - 1] });
    });
  }
  function byDay(rows) {
    const days = [];
    let cur = null;
    rows.forEach((r, i) => { if (!cur || cur.date !== r.date) { cur = { date: r.date, start: i, rows: [] }; days.push(cur); } cur.rows.push(r); });
    return days;
  }

  /* ---------------------------------------------------------------- the home battery */

  const SPEC = { capacity: 39.2, power: 20, efficiency: 0.88, reserve: 0.2 };
  const POLICIES = {
    clock: 'A fixed clock: charge 10 AM to 2 PM, sell 7 PM to 9 PM, every day. Needs no forecast.',
    watch: 'Watches the last week of prices: charges when the price is in the cheapest quarter of that week, sells when it is in the dearest tenth. Needs no forecast.',
    hindsight: 'The best two charging hours and best two selling hours of each day, picked after the fact. Nobody can run this: it is the ceiling.',
  };
  function spec(raw) {
    const r = raw || {}, n = (k, lo, hi) => { const v = Number(r[k]); return Number.isFinite(v) ? clamp(v, lo, hi) : SPEC[k]; };
    return { capacity: n('capacity', 1, 1000), power: n('power', 0.1, 1000), efficiency: n('efficiency', 0.5, 1), reserve: n('reserve', 0, 0.9) };
  }
  const percentile = (sorted, p) => sorted[clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1)];

  // For each day, what the policy wants in each hour: +1 charge, -1 sell, 0 hold. Decided before the hour runs.
  function plan(days, policy, sp) {
    const kind = policy.kind || 'clock';
    if (kind === 'clock') {
      const c = policy.charge || [10, 14], d = policy.discharge || [19, 21];
      return days.map((day) => day.rows.map((r) => (r.h >= c[0] && r.h < c[1] ? 1 : r.h >= d[0] && r.h < d[1] ? -1 : 0)));
    }
    if (kind === 'watch') {
      // Thresholds come only from the seven days before this one, so the policy never sees the future.
      const back = policy.lookbackDays || 7, lowP = policy.lowPct == null ? 0.25 : policy.lowPct, highP = policy.highPct == null ? 0.9 : policy.highPct;
      return days.map((day, i) => {
        if (i < back) return day.rows.map(() => 0);
        const past = [];
        for (let k = i - back; k < i; k++) days[k].rows.forEach((r) => past.push(r.price));
        past.sort((a, b) => a - b);
        const lo = percentile(past, lowP), hi = percentile(past, highP);
        return day.rows.map((r) => (r.price >= hi && hi > lo ? -1 : r.price <= lo ? 1 : 0));
      });
    }
    if (kind === 'hindsight') {
      // Best charge block followed by best sell block, each as long as the battery needs at full power.
      const eta = Math.sqrt(sp.efficiency), usable = sp.capacity * (1 - sp.reserve);
      const lc = Math.max(1, Math.ceil(usable / eta / sp.power)), ld = Math.max(1, Math.ceil(usable * eta / sp.power));
      return days.map((day) => {
        const p = day.rows.map((r) => r.price), n = p.length, out = p.map(() => 0);
        let best = 0, pick = null;
        for (let a = 0; a + lc <= n; a++) {
          const cost = sum(p.slice(a, a + lc));
          for (let b = a + lc; b + ld <= n; b++) {
            const gain = sum(p.slice(b, b + ld)) * eta * eta - cost; // per unit of grid energy bought, roughly
            if (gain > best) { best = gain; pick = [a, b]; }
          }
        }
        if (pick) { for (let k = 0; k < lc; k++) out[pick[0] + k] = 1; for (let k = 0; k < ld; k++) out[pick[1] + k] = -1; }
        return out;
      });
    }
    throw new Error('Unknown policy: ' + kind);
  }

  /* Run one battery through the year. options.outage = { date, hour, hours, homeKw } cuts the grid for that
     many hours: no trading, and the home runs on the battery, which may go below the reserve. */
  function battery(rows, rawSpec, policy, options) {
    const sp = spec(rawSpec), o = options || {}, eta = Math.sqrt(sp.efficiency), floor = sp.capacity * sp.reserve;
    const days = byDay(rows), wants = plan(days, policy || { kind: 'clock' }, sp);
    let soc = floor, cash = 0, bought = 0, sold = 0, atFloor = 0;
    const trace = [], dayRows = [], months = {};
    const out = o.outage ? { start: null, served: 0, unservedHours: 0, hours: 0, socAtStart: null, homeKw: o.outage.homeKw } : null;
    let outLeft = 0;
    days.forEach((day, di) => {
      let dayCash = 0, daySold = 0;
      day.rows.forEach((r, hi) => {
        let charge = 0, discharge = 0, state = 'idle', served = 0;
        if (out && out.start == null && r.date === o.outage.date && r.h === o.outage.hour) { out.start = trace.length; out.socAtStart = soc / sp.capacity; outLeft = o.outage.hours; }
        if (outLeft > 0) {
          // Grid is down. The home draws from the battery until it is empty.
          served = Math.min(o.outage.homeKw, sp.power, soc * eta);
          soc -= served / eta;
          out.served += served; out.hours += 1;
          if (served < o.outage.homeKw - 1e-9) out.unservedHours += 1;
          outLeft -= 1; state = 'outage';
        } else {
          const want = wants[di][hi];
          if (want > 0) charge = Math.min(sp.power, (sp.capacity - soc) / eta);
          else if (want < 0) discharge = Math.min(sp.power, Math.max(0, soc - floor) * eta);
          soc += charge * eta - discharge / eta;
          if (charge > 1e-9) state = 'charge'; else if (discharge > 1e-9) state = 'run';
        }
        const money = (discharge - charge) * r.price / 1000;
        cash += money; bought += charge; sold += discharge; dayCash += money; daySold += discharge;
        if (soc <= floor + 1e-9 && state !== 'outage') atFloor += 1;
        const m = months[r.date.slice(0, 7)] = months[r.date.slice(0, 7)] || { month: r.date.slice(0, 7), cash: 0, sold: 0 };
        m.cash += money; m.sold += discharge;
        trace.push({ date: r.date, h: r.h, price: r.price, state, charge, discharge, served, soc: soc / sp.capacity, cash });
      });
      dayRows.push({ date: day.date, start: day.start, hours: day.rows.length, cash: dayCash, sold: daySold });
    });
    const usable = sp.capacity * (1 - sp.reserve);
    return {
      spec: sp, policy: (policy && policy.kind) || 'clock', hours: rows.length,
      cashUsd: cash, boughtKwh: bought, soldKwh: sold, cycles: usable > 0 ? sold / (usable * eta) : 0,
      hoursAtReserve: atFloor, finalSoc: soc / sp.capacity, days: dayRows, months: Object.keys(months).sort().map((k) => months[k]), trace,
      outage: out && out.start != null ? Object.assign(out, { backupHours: out.hours - out.unservedHours, held: out.unservedHours === 0 }) : null,
    };
  }

  /* ---------------------------------------------------------------- the data center */

  const DC = { mw: 100, runPct: 90, batteryMw: 0, batteryHours: 2, efficiency: 0.88, rule: 'chase', gridTriggerMw: 85000, chasePct: 97, windowStart: 15, windowEnd: 19, priceTriggerUsd: 0 };
  const RULES = {
    level: 'Run the battery in any hour that demand on the grid is at or above a fixed level. Simple, and it can empty the battery before the peak arrives.',
    chase: 'On summer afternoons only, run the battery when demand on the grid comes within a few percent of the highest it has been so far that month. This is how sites chase the four peaks without a forecast.',
  };
  function dcConfig(raw) {
    const r = raw || {}, n = (k, lo, hi) => { const v = Number(r[k]); return Number.isFinite(v) ? clamp(v, lo, hi) : DC[k]; };
    const c = { mw: n('mw', 1, 5000), runPct: n('runPct', 1, 100), batteryMw: n('batteryMw', 0, 5000), batteryHours: n('batteryHours', 0.25, 12),
      efficiency: n('efficiency', 0.5, 1), rule: r.rule === 'level' ? 'level' : 'chase', gridTriggerMw: n('gridTriggerMw', 0, 200000), chasePct: n('chasePct', 80, 100),
      windowStart: Math.round(n('windowStart', 0, 23)), windowEnd: Math.round(n('windowEnd', 1, 24)), priceTriggerUsd: n('priceTriggerUsd', 0, 100000) };
    if (c.windowEnd <= c.windowStart) c.windowEnd = Math.min(24, c.windowStart + 1);
    return c;
  }

  /* The site draws the same power every hour. Its battery carries as much of the site as it can whenever its
     rule fires (see RULES; or the price is at or above priceTriggerUsd, when that is set), and refills between
     midnight and 8 AM. Both rules use only what is known in that hour: the grid's demand now, and its demand
     earlier in the same month. Neither knows which hour will turn out to be the month's peak.
     tariff: { per4cpKwMonthUsd, perBillingKwMonthUsd, customerMonthUsd, meteringMonthUsd } or null.
     peaks: [{ date, hourEnding }] the four hours that set the transmission bill. */
  function dataCenter(rows, raw, tariff, peaks) {
    const c = dcConfig(raw), eta = Math.sqrt(c.efficiency), demand = c.mw * c.runPct / 100;
    const cap = c.batteryMw * c.batteryHours;       // MWh
    const isPeak = {};
    (peaks || []).forEach((p) => { isPeak[p.date + '|' + p.hourEnding] = true; });
    let soc = cap, energyUsd = 0, baseEnergyUsd = 0, gridMwh = 0, ranHours = 0, dischargedMwh = 0, triggerHours = 0, shortHours = 0, maxGrid = 0;
    const peakRows = [], trace = [], dayRows = [];
    let cur = null, month = '', monthHigh = 0;
    rows.forEach((r) => {
      if (r.date.slice(0, 7) !== month) { month = r.date.slice(0, 7); monthHigh = 0; }
      const summer = r.date.slice(5, 7) >= '06' && r.date.slice(5, 7) <= '09';
      const near = summer && r.h >= c.windowStart && r.h < c.windowEnd && r.gridMw >= Math.max(monthHigh, r.gridMw) * c.chasePct / 100;
      const byGrid = c.rule === 'level' ? (c.gridTriggerMw > 0 && r.gridMw >= c.gridTriggerMw) : near;
      const trigger = byGrid || (c.priceTriggerUsd > 0 && r.price >= c.priceTriggerUsd);
      if (r.gridMw > monthHigh) monthHigh = r.gridMw;
      let discharge = 0, charge = 0, state = 'idle';
      if (trigger) {
        triggerHours += 1;
        discharge = Math.min(c.batteryMw, demand, soc * eta);
        if (discharge > 1e-9) { state = 'run'; ranHours += 1; }
        if (c.batteryMw > 0 && discharge < Math.min(c.batteryMw, demand) - 1e-9) shortHours += 1; // called on, but empty
      } else if (r.h < 8 && soc < cap - 1e-9) {
        charge = Math.min(c.batteryMw, (cap - soc) / eta); state = 'charge';
      }
      soc += charge * eta - discharge / eta;
      const grid = demand - discharge + charge;
      energyUsd += grid * r.price; baseEnergyUsd += demand * r.price; gridMwh += grid; dischargedMwh += discharge;
      if (grid > maxGrid) maxGrid = grid;
      if (isPeak[r.date + '|' + r.he]) peakRows.push({ date: r.date, hourEnding: r.he, gridMw: r.gridMw, siteMw: grid, coveredMw: discharge, triggered: trigger });
      if (!cur || cur.date !== r.date) { cur = { date: r.date, start: trace.length, ran: 0, triggered: 0, savedUsd: 0, peak: false }; dayRows.push(cur); }
      if (state === 'run') cur.ran += 1;
      if (trigger) cur.triggered += 1;
      if (isPeak[r.date + '|' + r.he]) cur.peak = true;
      cur.savedUsd += (demand - grid) * r.price;
      trace.push({ date: r.date, h: r.h, price: r.price, gridMw: r.gridMw, state, siteMw: grid, discharge, charge, soc: cap > 0 ? soc / cap : 0, trigger });
    });
    const n = peakRows.length || 1;
    const peakSiteMw = sum(peakRows.map((p) => p.siteMw)) / n;        // the site's average draw in the peak hours
    const t = tariff || null;
    const transmission = t ? peakSiteMw * 1000 * t.per4cpKwMonthUsd * 12 : null;
    const baseTransmission = t ? demand * 1000 * t.per4cpKwMonthUsd * 12 : null;
    const fixed = t ? Math.max(c.mw, maxGrid) * 1000 * t.perBillingKwMonthUsd * 12 + (t.customerMonthUsd + t.meteringMonthUsd) * 12 : 0;
    const baseFixed = t ? c.mw * 1000 * t.perBillingKwMonthUsd * 12 + (t.customerMonthUsd + t.meteringMonthUsd) * 12 : 0;
    const total = energyUsd + (transmission || 0) + fixed, base = baseEnergyUsd + (baseTransmission || 0) + baseFixed;
    return {
      config: c, demandMw: demand, batteryMwh: cap, hours: rows.length,
      energyUsd, transmissionUsd: transmission, fixedUsd: fixed, totalUsd: total,
      baseline: { energyUsd: baseEnergyUsd, transmissionUsd: baseTransmission, fixedUsd: baseFixed, totalUsd: base },
      savedUsd: base - total, energySavedUsd: baseEnergyUsd - energyUsd, transmissionSavedUsd: t ? baseTransmission - transmission : null,
      peaks: peakRows, peakSiteMw, peaksCovered: peakRows.filter((p) => p.coveredMw >= Math.min(c.batteryMw, demand) - 1e-6 && c.batteryMw > 0).length,
      peaksFullyOff: peakRows.filter((p) => p.siteMw <= 1e-6).length,
      triggerHours, ranHours, shortHours, dischargedMwh, cycles: cap > 0 ? dischargedMwh / (cap * eta) : 0, gridMwh, days: dayRows, trace,
    };
  }

  /* ---------------------------------------------------------------- the ramp test */

  // Run the same year once for each value of one lever, and report where the result first holds.
  function ramp(values, runOne, holds) {
    const points = values.map((v) => { const r = runOne(v); return { value: v, result: r, holds: !!holds(r) }; });
    const first = points.find((p) => p.holds);
    return { points, holdsFrom: first ? first.value : null };
  }

  const api = { parsePrices, withLoad, byDay, battery, dataCenter, ramp, plan, spec, dcConfig, SPEC, DC, POLICIES, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TwinCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
