// Fetch PJM hourly metered load by zone for June to September (the months that set capacity and
// transmission tags) from PJM Data Miner 2 (hrl_load_metered). Writes analysis/cache/pjm/load-summer.json:
// { zone: [[beginEpt, mw], ...] } with load areas summed into PJM zones, plus RTO.
// Access as in fetch-pjm-prices.cjs: PJM_API_KEY if set, else PJM's published anonymous Data Miner key,
// at most 6 requests a minute. Usage: node scripts/fetch-pjm-peaks.cjs [year]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const YEAR = Number(process.argv[2] || 2026);
const OUT = path.join(__dirname, '..', 'analysis', 'cache', 'pjm');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Data Miner zone codes to the price-zone names used in pjm-value.json.
const ZONE = { AE: 'AECO', AEP: 'AEP', AP: 'APS', ATSI: 'ATSI', BC: 'BGE', CE: 'COMED', DAY: 'DAY', DEOK: 'DEOK', DOM: 'DOM', DPL: 'DPL', DUQ: 'DUQ', EKPC: 'EKPC', JC: 'JCPL', ME: 'METED', PE: 'PECO', PEP: 'PEPCO', PL: 'PPL', PN: 'PENELEC', PS: 'PSEG', RECO: 'RECO', RTO: 'RTO' };

async function key() {
  if (process.env.PJM_API_KEY) return process.env.PJM_API_KEY;
  const r = await fetch('https://dataminer2.pjm.com/config/settings.json');
  return (await r.json()).subscriptionKey;
}
async function getJSON(url, k) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': k, 'Accept-Encoding': 'gzip' } });
    if (r.status === 429) { await sleep(65000); continue; }
    if (!r.ok) throw new Error(url + ' returned ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    return JSON.parse(buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
  }
  throw new Error('Rate limited four times');
}
(async () => {
  const k = await key();
  const sums = {};
  for (const m of [6, 7, 8, 9]) {
    const last = new Date(Date.UTC(YEAR, m, 0)).getUTCDate();
    for (const [a, b] of [[1, 15], [16, last]]) {
      const range = `${m}/${a}/${YEAR} 00:00to${m}/${b}/${YEAR} 23:59`;
      const url = `https://api.pjm.com/api/v1/hrl_load_metered?rowCount=50000&startRow=1&datetime_beginning_ept=${encodeURIComponent(range)}&fields=datetime_beginning_ept,zone,load_area,mw`;
      const d = await getJSON(url, k);
      if (d.totalRows > d.items.length) throw new Error(range + ': truncated');
      for (const i of d.items) {
        const z = ZONE[i.zone]; if (!z) continue;
        const t = i.datetime_beginning_ept;
        sums[z] = sums[z] || {}; sums[z][t] = (sums[z][t] || 0) + i.mw;
      }
      console.log(range, d.items.length);
      await sleep(11000);
    }
  }
  const out = {};
  for (const [z, hours] of Object.entries(sums)) out[z] = Object.entries(hours).sort().map(([t, mw]) => [t, Math.round(mw * 10) / 10]);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'load-summer.json'), JSON.stringify({ year: YEAR, source: 'PJM Data Miner 2, hrl_load_metered, load areas summed by zone', fetched: new Date().toISOString().slice(0, 10), zones: out }));
  console.log('zones', Object.keys(out).length);
})().catch((e) => { console.error(e.message); process.exit(1); });
