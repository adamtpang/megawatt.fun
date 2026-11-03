// What one Base Core earns from energy arbitrage in each ERCOT load zone over 12 real months.
// Uses deployment-core.js's tested fixed-clock backtest with the solarEvening clock:
// charge 10:00 to 14:00 (HE11 to HE14), discharge 19:00 to 21:00 (HE20 to HE21), Central.
// The clock was picked from public ERCOT reasoning (midday solar trough, net-load peak after
// sunset) and the battery's ~1.5 hours of usable discharge at full power, not by searching the
// test-year prices. See the comment above SCHEDULES in deployment-core.js.
// Homes settle at load zone (LZ_) prices, so only load zones are ranked. Trading hubs (HB_) are
// kept in a separate "hubs" list for reference and are never ranked or offered as a zone.
// Usage: node scripts/zone-value.cjs  -> writes data/zone-value.json
const fs = require('fs'), path = require('path');
const D = require('../deployment-core.js');
const prices = require('../data/deployment/prices.json');
const spec = { capacity: 39.2, power: 20, efficiency: 0.88, reserve: 0.2, wear: 0 };
const scheduleName = 'solarEvening';
const schedule = D.schedule(scheduleName);
const all = Object.entries(prices.zones).map(([id, z]) => {
  const r = D.backtest(z.rows, spec, { schedule });
  return { id, kind: id.startsWith('HB_') ? 'hub' : 'load zone', usdPerYear: Math.round(r.net * 100) / 100, mwhSold: Math.round(r.sold / 10) / 100 };
}).sort((a, b) => b.usdPerYear - a.usdPerYear);
const zones = all.filter((z) => z.kind === 'load zone');
const hubs = all.filter((z) => z.kind === 'hub');
const out = {
  built: new Date().toISOString().slice(0, 10),
  period: prices.period,
  spec: { ...spec, label: 'Base Core: 20 kW / 39.2 kWh (Base utilities page); 88% round trip and 20% backup reserve are assumptions' },
  schedule: { name: scheduleName, ...schedule, label: 'Charge 10 AM to 2 PM, discharge 7 to 9 PM, Central time, every day' },
  method: 'Fixed daily clock from deployment-core.js (solarEvening): charge at up to 20 kW from 10 AM to 2 PM (hours ending 11 to 14) until full, then discharge at up to 20 kW from 7 PM to 9 PM (hours ending 20 and 21) until the 20% reserve, settled at the load zone real-time price. About 31 kWh is usable, so each day it buys about 33 kWh from 10 AM to noon (losses included) and sells 20 kWh from 7 to 8 PM and about 9 kWh from 8 to 9 PM. The clock was chosen from public ERCOT reasoning (solar holds midday prices down; the net-load peak now falls after sunset) and the battery\'s duration, not by searching these prices. Only load zones are ranked: homes settle at load zone prices. Hubs are trading points, listed under "hubs" for reference only. Energy arbitrage only: no capacity, ancillary, tolling or retail revenue. Not Base revenue.',
  sources: ['https://www.ercot.com/mktinfo/prices', 'https://www.basepowercompany.com/utilities', '/data/deployment/manifest.json'],
  zones,
  hubs: { about: 'ERCOT trading hubs and hub averages. A home battery does not settle here, so these are not ranked and are not a place one battery earns. Same clock, for reference only.', points: hubs },
};
fs.writeFileSync(path.join(__dirname, '../data/zone-value.json'), JSON.stringify(out, null, 1));
console.log(zones.map((z) => `${z.id} $${z.usdPerYear}`).join('\n'));
