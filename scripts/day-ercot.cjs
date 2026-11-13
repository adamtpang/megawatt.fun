// Builds data/day-ercot.json: the Texas (ERCOT) load zones for the homepage's "one battery, one day".
// Usage: node scripts/day-ercot.cjs
// Inputs, both already in the repo: data/deployment/LZ_*.csv (hourly ERCOT load zone prices, twelve months,
// provenance in data/deployment/manifest.json) and data/zone-value.json (one battery's yearly value per zone
// on the fixed Texas clock, from scripts/zone-value.cjs). Nothing is fetched and no number is invented.
const fs = require('node:fs');
const path = require('node:path');

const root = (f) => path.join(__dirname, '..', f);
const ZV = JSON.parse(fs.readFileSync(root('data/zone-value.json'), 'utf8'));

// Plain names for ERCOT's load zones. Four are competitive retail areas; four are city utilities and co-ops.
const NAMES = {
  LZ_NORTH: 'North Texas', LZ_HOUSTON: 'Houston', LZ_SOUTH: 'South Texas', LZ_WEST: 'West Texas',
  LZ_AEN: 'Austin Energy', LZ_CPS: 'CPS Energy, San Antonio', LZ_LCRA: 'LCRA', LZ_RAYBN: 'Rayburn Electric',
};

function hourly(id) {
  const rows = fs.readFileSync(root('data/deployment/' + id + '.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const sum = new Array(24).fill(0), n = new Array(24).fill(0);
  let total = 0;
  for (const line of rows) {
    const [, hourEnding, , , rtm] = line.split(',');
    const h = Number(hourEnding) - 1, p = Number(rtm);
    if (!(h >= 0 && h < 24) || !Number.isFinite(p)) throw new Error(id + ': bad row ' + line);
    sum[h] += p; n[h] += 1; total += p;
  }
  return { hours: rows.length, avg: total / rows.length, byHour: sum.map((s, i) => Math.round((s / n[i]) * 100) / 100) };
}

const zones = ZV.zones.map((z) => {
  if (!NAMES[z.id]) throw new Error('no name for ' + z.id);
  const h = hourly(z.id);
  return {
    id: z.id, utility: NAMES[z.id], states: ['TX'], timezone: 'Central',
    choice: z.market === 'retail choice' ? 'open' : 'none', market: z.market, who: z.who,
    energyUsdPerYear: z.usdPerYear, hours: h.hours,
    avgRtUsdPerMwh: Math.round(h.avg * 100) / 100, hourlyAvgRt: h.byHour,
  };
});

const out = {
  built: new Date().toISOString().slice(0, 10),
  period: ZV.period,
  spec: ZV.spec,
  schedule: ZV.schedule,
  pricesSource: { title: 'ERCOT load zone settlement point prices, real-time, twelve months', url: 'https://www.ercot.com/mktinfo/prices' },
  valueSource: 'data/zone-value.json, built ' + ZV.built + ' by scripts/zone-value.cjs',
  markets: ZV.markets,
  note: 'Texas has no capacity market. Transmission cost for large loads is set by four summer peak intervals (4CP); those intervals and rates are not in this file.',
  zones,
};
fs.writeFileSync(root('data/day-ercot.json'), JSON.stringify(out, null, 1) + '\n');
console.log(zones.map((z) => z.id + ' ' + z.avgRtUsdPerMwh + ' $' + z.energyUsdPerYear).join('\n'));
