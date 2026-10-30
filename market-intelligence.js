/* Public evidence boundary: runtime-validated data, independent of rendering. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./deployment-core.js'));
  else root.MarketIntelligence = factory(root.Deployment);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';
  const caches = new WeakMap();
  const FACTORS = Object.freeze({
    energy: { label: 'Energy cashflow', direction: 'higher', unit: '$/battery/year' },
    installedCost: { label: 'Installed cost', direction: 'lower', unit: '$/battery' },
    usableArea: { label: 'Usable site area', direction: 'higher', unit: 'm²' },
    headroom: { label: 'Feeder spare capacity', direction: 'higher', unit: 'kW' },
  });
  const DEFAULT_WEIGHTS = Object.freeze({ energy: 40, installedCost: 20, usableArea: 20, headroom: 20 });
  function expectedKeys(period) {
    const { start, endExclusive: end } = period;
    const valid = value => /^\d{4}-\d{2}-01$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(start) || !valid(end) || Number(end.slice(0, 4)) !== Number(start.slice(0, 4)) + 1 || end.slice(4) !== start.slice(4)) throw new Error('Expected twelve complete calendar months.');
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    const keys = [], seen = new Set();
    for (let utc = Date.parse(start) - 86400000; utc < Date.parse(end) + 86400000; utc += 3600000) {
      const part = Object.fromEntries(formatter.formatToParts(utc).map(p => [p.type, p.value]));
      const date = `${part.year}-${part.month}-${part.day}`;
      if (date < start || date >= end) continue;
      const key = `${date}/${Number(part.hour) + 1}`;
      keys.push(`${key}/${seen.has(key) ? 'Y' : 'N'}`); seen.add(key);
    }
    return new Set(keys);
  }
  function validateDataset(data) {
    if (!data || data.schemaVersion !== 2 || !data.period || !data.zones || !Array.isArray(data.sources)) throw new Error('Unsupported ERCOT dataset.');
    if (JSON.stringify(data.columns) !== JSON.stringify(['date', 'hourEnding', 'repeated', 'dam', 'rtm'])) throw new Error('Unknown price columns.');
    const expected = expectedKeys(data.period);
    if (data.period.timezone !== 'America/Chicago' || data.period.expectedHours !== expected.size) throw new Error('Invalid physical-hour coverage declaration.');
    if (!Object.keys(data.zones).length) throw new Error('No settlement points.');
    for (const [name, series] of Object.entries(data.zones)) {
      const kinds = { LZ: 'load-zone', HU: 'hub', SH: 'hub-average', AH: 'hub-average' };
      if (!/^(HB|LZ)_[A-Z]+$/.test(name) || kinds[series.settlementType] !== series.kind || (name.startsWith('LZ_') !== (series.kind === 'load-zone'))) throw new Error(`Invalid settlement point: ${name}`);
      D.validateRows(series.rows);
      if (series.rows.length !== expected.size || series.rows.some(r => !expected.has(`${r[0]}/${r[1]}/${r[2]}`))) throw new Error(`Incomplete physical-hour coverage: ${name}`);
      if (series.rtIntervals !== expected.size * 4 || !Array.isArray(series.spikeIntervalsByHour) || series.spikeIntervalsByHour.length !== 24 || series.spikeThresholdPerMWh !== 100) throw new Error(`Invalid spike metadata: ${name}`);
      const exposure = Array(24).fill(0); series.rows.forEach(r => exposure[r[1] - 1] += 4);
      if (series.spikeIntervalsByHour.some((n, h) => !Number.isInteger(n) || n < 0 || n > exposure[h])) throw new Error(`Invalid spike count: ${name}`);
    }
    return data;
  }
  async function loadPrices({ url = '/data/deployment/prices.json', fetcher = globalThis.fetch, refresh = false } = {}) {
    let cache = caches.get(fetcher);
    if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
    if (refresh) cache.delete(url);
    if (!cache.has(url)) {
      const pending = (async () => {
        const response = await fetcher(url);
        if (!response.ok) throw new Error(`Price load failed: HTTP ${response.status}`);
        return validateDataset(await response.json());
      })();
      cache.set(url, pending);
      pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
    }
    return cache.get(url);
  }
  function valueStack(series, battery = {}) {
    const diagnostics = D.diagnostics(series.rows), backtest = D.backtest(series.rows, battery);
    const counts = series.spikeIntervalsByHour, total = counts.reduce((a, b) => a + b, 0);
    const exposure = Array(24).fill(0); series.rows.forEach(r => exposure[r[1] - 1] += 4);
    const spikeHours = counts.map((count, hour) => ({ hour, count,
      share: total ? count / total : 0, rate: exposure[hour] ? count / exposure[hour] : 0 }));
    const top = [...spikeHours].sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, 3);
    return { diagnostics, backtest, spikeHours, spikeThresholdPerMWh: series.spikeThresholdPerMWh,
      spikeIntervals: total, topThreeHourShare: total ? top.reduce((sum, x) => sum + x.count, 0) / total : 0,
      topHours: total ? top.filter(x => x.count > 0).map(x => x.hour) : [],
      energy: backtest.net, ancillary: null, reliability: null, total: null };
  }
  function normalizedWeights(input = DEFAULT_WEIGHTS) {
    if (Object.keys(input).some(key => !Object.hasOwn(FACTORS, key))) throw new Error('Unknown scoring factor.');
    for (const key of Object.keys(FACTORS)) if (!Number.isFinite(input[key]) || input[key] < 0 || input[key] > 100) throw new Error(`Weight ${key} must be 0–100.`);
    const total = Object.values(input).reduce((a, b) => a + b, 0);
    if (!total) throw new Error('At least one weight must be positive.');
    return Object.fromEntries(Object.keys(FACTORS).map(key => [key, input[key] / total]));
  }
  function scoreCandidates(candidates, results, input = DEFAULT_WEIGHTS) {
    const weights = normalizedWeights(input), ids = new Set();
    const rows = candidates.map(candidate => {
      if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) throw new Error('Candidate IDs must be nonempty and unique.');
      ids.add(candidate.id);
      if (![true, false, null].includes(candidate.eligible)) throw new Error('Eligibility must be true, false or null.');
      const values = { energy: results[candidate.zone]?.net ?? null,
        installedCost: candidate.property?.installedCostUsd ?? null,
        usableArea: candidate.property?.usableAreaM2 ?? null,
        // Regional screening proxy, NOT this battery's approved export limit.
        headroom: candidate.grid?.headroomKw ?? null };
      for (const [key, value] of Object.entries(values)) if (value !== null && (!Number.isFinite(value) || (key !== 'energy' && value < 0))) throw new Error(`Invalid ${key} for ${candidate.id}.`);
      const missing = Object.keys(weights).filter(key => weights[key] > 0 && values[key] === null);
      if (candidate.eligible === null) missing.unshift('eligibility');
      if (!results[candidate.zone]) missing.unshift('price series');
      return { ...candidate, values, missing, score: null, breakdown: {}, status: candidate.eligible === false ? 'excluded' : missing.length ? 'missing-inputs' : 'scored' };
    });
    const usable = rows.filter(row => row.status === 'scored');
    for (const key of Object.keys(weights)) {
      if (!weights[key] || !usable.length) continue;
      const min = Math.min(...usable.map(row => row.values[key])), max = Math.max(...usable.map(row => row.values[key]));
      for (const row of usable) {
        let normalized = min === max ? .5 : (row.values[key] - min) / (max - min);
        if (FACTORS[key].direction === 'lower') normalized = 1 - normalized;
        row.breakdown[key] = { value: row.values[key], normalized, weight: weights[key], points: 100 * weights[key] * normalized };
      }
    }
    for (const row of usable) row.score = Object.values(row.breakdown).reduce((sum, x) => sum + x.points, 0);
    return rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.id.localeCompare(b.id));
  }
  return { FACTORS, DEFAULT_WEIGHTS, validateDataset, loadPrices, valueStack, normalizedWeights, scoreCandidates };
});
