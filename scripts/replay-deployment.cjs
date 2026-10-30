/* Offline reproduction: node scripts/replay-deployment.cjs */
const fs = require('node:fs');
const path = require('node:path');
const D = require('../deployment-core.js');
const M = require('../market-intelligence.js');
const prices = M.validateDataset(require('../data/deployment/prices.json'));
const sites = require('../data/deployment/sites.json');
const stacks = Object.fromEntries(Object.entries(prices.zones).map(([zone, data]) => [zone, M.valueStack(data)]));
const results = Object.fromEntries(Object.entries(stacks).map(([zone, stack]) => [zone, stack.backtest]));
const report = { methodVersion: 2, period: prices.period, parameters: D.DEFAULTS, results,
  residential: { default: D.rank(sites.sites, results, .7), alternative: D.rank(sites.sites, results, .3) },
  commercial: { default: D.rank(sites.sites, results, .7, 'commercial'), alternative: D.rank(sites.sites, results, .3, 'commercial') } };
const out = path.join(__dirname, '../demo/texas-deployment'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const market = Object.fromEntries(Object.entries(stacks).map(([point, { backtest, ...stack }]) => [point, stack]));
fs.writeFileSync(path.join(out, 'market-summary.json'), JSON.stringify({ period: prices.period, parameters: D.DEFAULTS, points: market }, null, 2) + '\n');
const csv = ['zone,month,energy_usd,wear_usd,net_usd,idle_usd,bought_kwh,sold_kwh,hours'];
for (const [zone, r] of Object.entries(results)) {
  for (const m of r.months) csv.push([zone, m.month, m.energy, m.wear, m.net, 0, m.bought, m.sold, m.hours].join(','));
  console.log(`${zone}: $${r.net.toFixed(2)}/year; ${r.months.filter(m => m.net < 0).length} losing months; ${r.residualKWh.toFixed(6)} residual kWh`);
}
fs.writeFileSync(path.join(out, 'monthly.csv'), csv.join('\n') + '\n');
console.log('70% energy:', report.residential.default.map(x => x.name).join(' -> '));
console.log('30% energy:', report.residential.alternative.map(x => x.name).join(' -> '));
