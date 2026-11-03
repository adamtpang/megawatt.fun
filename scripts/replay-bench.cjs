/* Reproduce the public experiment. No network or dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('../dispatch-bench-core.js');
const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'data/ercot-dam-houston.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const prices = source.hours.map(h => h.usd_mwh);
const scenarios = [
  {name:'clean',fault:'none',forecast:'known'},
  {name:'forecast-timing-error',fault:'none',forecast:'shift'},
  {name:'duplicate-delivery',fault:'duplicate',forecast:'known'},
  {name:'stale-telemetry',fault:'stale',forecast:'known'},
  {name:'late-delivery',fault:'late',forecast:'known'},
  {name:'multiple-failures',fault:'mixed',forecast:'known'},
];
const results = scenarios.map(({name,...options}) => ({ name, runs:D.compare(prices,options).map(({trace,matrix,...r})=>r) }));
const output = path.join(root,'demo/dispatch-bench');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({ model:'dispatch-bench-v1', source, sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), scenarios:results },null,2)+'\n');
const keys=['policy','cash','inventoryMark','markedValue','purchased','sold','reserveBreaches','endSoc','rejected','duplicates','balanceError'];
fs.writeFileSync(path.join(output,'results.csv'),'scenario,'+keys.join(',')+'\n'+results.flatMap(s=>s.runs.map(r=>s.name+','+keys.map(k=>typeof r[k]==='number'?r[k].toFixed(8):r[k]).join(','))).join('\n')+'\n');
fs.writeFileSync(path.join(output,'guarded-trace.csv'),D.csv(D.run(prices,{},'guarded')));
console.log('Reproduced six scenarios, four policies each. Results and default guarded trace saved.');
for (const s of results) console.log(s.name,s.runs.map(r=>`${r.policy}: $${r.markedValue.toFixed(2)} adjusted proxy, ${r.reserveBreaches} reserve breaches`).join('; '));
