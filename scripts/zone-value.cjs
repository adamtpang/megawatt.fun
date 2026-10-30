// What one Base Core earns from energy arbitrage in each ERCOT zone over 12 real months.
// Uses deployment-core.js's tested fixed-clock backtest (charge 1-5 AM, discharge 5-9 PM).
// Usage: node scripts/zone-value.cjs  -> writes data/zone-value.json
const fs = require('fs'), path = require('path');
const D = require('../deployment-core.js');
const prices = require('../data/deployment/prices.json');
const spec = { capacity: 39.2, power: 20, efficiency: 0.88, reserve: 0.2, wear: 0 };
const zones = Object.entries(prices.zones).map(([id, z]) => {
  const r = D.backtest(z.rows, spec);
  return { id, kind: id.startsWith('HB_') ? 'hub' : 'load zone', usdPerYear: Math.round(r.net * 100) / 100, mwhSold: Math.round(r.sold / 10) / 100 };
}).sort((a, b) => b.usdPerYear - a.usdPerYear);
const out = {
  built: new Date().toISOString().slice(0, 10),
  period: prices.period,
  spec: { ...spec, label: 'Base Core: 20 kW / 39.2 kWh (Base utilities page); 88% round trip and 20% backup reserve are assumptions' },
  method: 'Fixed daily clock from deployment-core.js: charge 1 to 5 AM, discharge 5 to 9 PM, settled at the zone price. Energy arbitrage only: no capacity, ancillary, tolling or retail revenue. Not Base revenue.',
  sources: ['https://www.ercot.com/mktinfo/prices', 'https://www.basepowercompany.com/utilities', '/data/deployment/manifest.json'],
  zones,
};
fs.writeFileSync(path.join(__dirname, '../data/zone-value.json'), JSON.stringify(out, null, 1));
console.log(zones.map((z) => `${z.id} $${z.usdPerYear}`).join('\n'));
