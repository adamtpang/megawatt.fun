/* Where power comes from: the math behind /generation. Pure: no DOM, no network.
   Input is data/supply-ercot.json (scripts/supply-ercot.py). Used by generation.js (window.GenerationCore)
   and the Node tests. Nothing here invents a number; it only sums, ranks and compares what the file holds. */
(function (root) {
  'use strict';

  const CLEAN = ['wind', 'solar', 'hydro', 'nuclear'];        // make no carbon dioxide when running
  const WEATHER = ['wind', 'solar'];                           // output follows the weather, not the operator

  const byId = (data, id) => data.sources.find((s) => s.id === id);
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  // Sources by share of the year's energy, largest first, with the shares the page quotes.
  function year(data) {
    const ranked = data.sources.slice().sort((a, b) => b.gwh - a.gwh);
    const share = (ids) => sum(ids.map((id) => byId(data, id).share));
    const capTotal = sum(data.sources.map((s) => s.capacityMw || 0));
    return {
      ranked,
      totalTwh: data.totalGwh / 1000,
      weatherShare: share(WEATHER),
      cleanShare: share(CLEAN),
      capacityTotalMw: capTotal,
      // Share of installed capacity, among the sources that have a capacity figure. Null where ERCOT gives none.
      capacityShare: (id) => { const s = byId(data, id); return s.capacityMw ? s.capacityMw / capTotal : null; },
    };
  }

  // One hour of the average day: each source's average output in MW, the total, and the hub price.
  function hour(data, h) {
    const parts = data.sources.map((s) => ({ id: s.id, name: s.name, mw: s.avgMwByHour[h] }));
    return { h, parts, totalMw: sum(parts.map((p) => p.mw)), priceUsdPerMwh: data.priceByHourUsdPerMwh[h],
      chargingMw: data.storage.chargingAvgMwByHour[h] };
  }

  // The shape of the day the page describes in words.
  function day(data) {
    const hours = []; for (let h = 0; h < 24; h++) hours.push(hour(data, h));
    const at = (id) => byId(data, id).avgMwByHour;
    const argmax = (a) => a.indexOf(Math.max.apply(null, a)), argmin = (a) => a.indexOf(Math.min.apply(null, a));
    const solar = at('solar'), gas = at('gas'), price = data.priceByHourUsdPerMwh;
    const solarPeak = argmax(solar), gasLow = argmin(gas.slice(6, 18)) + 6, gasPeak = argmax(gas), pricePeak = argmax(price), priceLow = argmin(price);
    return {
      hours, maxTotalMw: Math.max.apply(null, hours.map((x) => x.totalMw)),
      solarPeakHour: solarPeak, solarPeakMw: solar[solarPeak],
      gasLowHour: gasLow, gasLowMw: gas[gasLow], gasPeakHour: gasPeak, gasPeakMw: gas[gasPeak],
      pricePeakHour: pricePeak, pricePeak: price[pricePeak], priceLowHour: priceLow, priceLow: price[priceLow],
      chargePeakHour: argmax(data.storage.chargingAvgMwByHour),
    };
  }

  // Months in order, each with its total, for the seasonal chart.
  function months(data) {
    return data.months.map((m) => ({ month: m.month, settlement: m.settlement, gwh: m.gwh, totalGwh: sum(Object.keys(m.gwh).map((k) => m.gwh[k])) }));
  }

  const api = { year, hour, day, months, CLEAN, WEATHER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GenerationCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
