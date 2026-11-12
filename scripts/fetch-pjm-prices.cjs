// Fetch 12 months of PJM hourly zone prices (real-time and day-ahead LMP) from PJM Data Miner 2.
// Writes analysis/cache/pjm/prices.json in the same row shape as data/deployment/prices.json:
// [date, hourEnding, repeat, dayAheadUsdPerMwh, realTimeUsdPerMwh], prevailing Eastern time.
//
// Access: set PJM_API_KEY to your own Data Miner 2 key (free at https://apiportal.pjm.com/).
// Without it, the script uses the key PJM publishes for anonymous Data Miner 2 use
// (https://dataminer2.pjm.com/config/settings.json) and stays under PJM's non-member limit of
// 6 requests a minute. The cache folder is git-ignored; only derived results are committed.
// Usage: node scripts/fetch-pjm-prices.cjs [startYYYY-MM-DD] [endExclusiveYYYY-MM-DD]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const START = process.argv[2] || '2025-10-01', END = process.argv[3] || '2026-10-01';
const OUT = path.join(__dirname, '..', 'analysis', 'cache', 'pjm');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 11000; // 6 requests a minute, with room to spare

async function key() {
  if (process.env.PJM_API_KEY) return process.env.PJM_API_KEY;
  const r = await fetch('https://dataminer2.pjm.com/config/settings.json');
  if (!r.ok) throw new Error('Could not read the public Data Miner settings: ' + r.status);
  return (await r.json()).subscriptionKey;
}
async function getJSON(url, k) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': k, 'Accept-Encoding': 'gzip' } });
    if (r.status === 429) { await sleep(65000); continue; }
    if (!r.ok) throw new Error(url + ' returned ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return JSON.parse(text);
  }
  throw new Error('Rate limited four times: ' + url);
}
function months(start, end) {
  const out = []; let d = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (d < e) {
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const last = new Date(Math.min(n, e) - 86400000);
    const f = (x) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}/${x.getUTCFullYear()}`;
    out.push({ from: f(d), to: f(last) }); d = n;
  }
  return out;
}
async function series(feed, field, k) {
  const rows = [];
  for (const m of months(START, END)) {
    const url = `https://api.pjm.com/api/v1/${feed}?rowCount=50000&startRow=1&type=ZONE&row_is_current=1` +
      `&datetime_beginning_ept=${encodeURIComponent(`${m.from} 00:00to${m.to} 23:59`)}&fields=datetime_beginning_ept,pnode_name,${field}`;
    const d = await getJSON(url, k);
    if (d.totalRows > d.items.length) throw new Error(`${feed} ${m.from}: ${d.totalRows} rows but only ${d.items.length} returned`);
    d.items.forEach((i) => rows.push([i.pnode_name, i.datetime_beginning_ept, i[field]]));
    console.log(feed, m.from, d.items.length);
    await sleep(GAP_MS);
  }
  return rows;
}
(async () => {
  const k = await key();
  const rt = await series('rt_hrl_lmps', 'total_lmp_rt', k);
  const da = await series('da_hrl_lmps', 'total_lmp_da', k);
  // Key each zone hour by its Eastern begin time. The fall-back hour appears twice; the second copy is repeat "Y".
  const build = (rows) => {
    const z = {};
    for (const [zone, t, v] of rows) {
      const list = (z[zone] = z[zone] || new Map());
      const k2 = list.has(t + 'N') ? t + 'Y' : t + 'N';
      list.set(k2, v);
    }
    return z;
  };
  const R = build(rt), A = build(da), zones = {};
  for (const zone of Object.keys(R)) {
    const out = [];
    for (const [k3, rtv] of R[zone]) {
      const dav = A[zone] && A[zone].get(k3);
      if (!Number.isFinite(dav) || !Number.isFinite(rtv)) continue;
      const t = k3.slice(0, -1), rep = k3.slice(-1);
      const date = t.slice(0, 10), he = Number(t.slice(11, 13)) + 1;
      out.push([date, he, rep, Math.round(dav * 1e4) / 1e4, Math.round(rtv * 1e4) / 1e4]);
    }
    out.sort((a, b) => (a[0] + String(a[1]).padStart(2, '0') + a[2] < b[0] + String(b[1]).padStart(2, '0') + b[2] ? -1 : 1));
    zones[zone] = { rows: out };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prices.json'), JSON.stringify({
    period: { start: START, endExclusive: END, timezone: 'America/New_York', fetched: new Date().toISOString().slice(0, 10) },
    columns: ['date', 'hourEnding', 'repeat', 'dayAheadUsdPerMwh', 'realTimeUsdPerMwh'],
    source: 'PJM Data Miner 2, rt_hrl_lmps and da_hrl_lmps, type ZONE, row_is_current',
    zones,
  }));
  console.log('zones', Object.keys(zones).length, Object.entries(zones).map(([z, v]) => z + ':' + v.rows.length).join(' '));
})().catch((e) => { console.error(e.message); process.exit(1); });
