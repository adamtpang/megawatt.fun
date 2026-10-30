const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dispatch-bench-core.js');
const data = require('../data/ercot-dam-houston.json');
const prices = data.hours.map(h => h.usd_mwh);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const device = soc => ({ soc, applied:new Set(),charged:0,discharged:0 });

test('adapter conserves physical stored energy with split losses and closed healthy cycles', () => {
  for (const efficiency of [.5,.88,1]) for (const reserve of [0,.3,1]) {
    const r = D.run(prices,{efficiency,reserve,fault:'none'},'guarded');
    close(r.endSoc,r.initialSoc); close(r.balanceError,0);
    close(r.sold,r.purchased*efficiency); assert.equal(r.reserveBreaches,0);
  }
});
test('applied command retry is idempotent; a rejected delivery does not poison valid retry', () => {
  const o=D.config({}), d=device(20), c={id:'a',hour:17,expires:18,kind:'discharge',kwh:2};
  assert.equal(D.applyCommand(d,c,17,o,true,3).reason,'stale telemetry');
  const first=D.applyCommand(d,c,17,o,true,0), retry=D.applyCommand(d,c,17,o,true,0);
  close(first.discharge,2); close(retry.discharge,0); assert.equal(retry.reason,'duplicate ignored');
});
test('expired commands cannot mutate state even with fresh telemetry', () => {
  const o=D.config({}), d=device(20), c={id:'a',hour:17,expires:18,kind:'discharge',kwh:2};
  assert.equal(D.applyCommand(d,c,19,o,true,0).reason,'expired command'); close(d.soc,20);
});
test('local reserve clamp preserves backup while unguarded retries consume it', () => {
  const o=D.config({capacity:10,reserve:.5,power:5,efficiency:1});
  const c={id:'a',hour:17,expires:18,kind:'discharge',kwh:3};
  const guarded=device(6), naive=device(6);
  close(D.applyCommand(guarded,c,17,o,true,0).discharge,1);
  close(D.applyCommand(naive,c,17,o,false,0).discharge,3);
  close(guarded.soc,5); close(naive.soc,3);
});
test('negative prices, faults and extreme reserves preserve physical accounting and guarded safety', () => {
  const rand=D.rngForTest || (()=>{let i=0;return ()=>((++i*73)%211)/211;})();
  for(let i=0;i<30;i++) {
    const p=Array.from({length:24},()=>rand()*300-60);
    for (const fault of ['none','duplicate','stale','late','mixed']) {
      const r=D.run(p,{fleet:4,affected:1,efficiency:.5+rand()*.5,reserve:rand(),fault,forecast:'shift'},'guarded');
      close(r.balanceError,0); assert.equal(r.reserveBreaches,0);
      for(const row of r.trace) { assert.ok(row.socAfter>=r.config.capacity*r.config.reserve-1e-8);assert.ok(row.socAfter<=r.config.capacity+1e-8); }
      for(const h of r.hours) assert.ok(Math.abs(h.delivered)<=r.config.power*r.config.fleet+1e-8);
    }
  }
});
test('real snapshot replay is deterministic and healthy guarded/unguarded schedules agree', () => {
  const a=D.run(prices,{},'guarded'), b=D.run(prices,{},'guarded');
  assert.deepEqual(a,b);
  const clean=D.compare(prices,{fault:'none'});
  close(clean[2].cash,clean[3].cash); close(clean[2].sold,clean[3].sold);
  const losses=D.compare(prices,{fault:'duplicate',affected:1});
  assert.ok(losses[2].reserveBreaches>0); assert.equal(losses[3].reserveBreaches,0); assert.ok(losses[3].duplicates>0);
});
test('invalid inputs are rejected rather than yielding convincing bogus results', () => {
  for(const bad of [{fleet:1.5},{reserve:-.1},{efficiency:NaN},{forecast:'magic'},{fault:'unknown'}]) assert.throws(()=>D.run(prices,bad,'guarded'),RangeError);
  assert.throws(()=>D.run(prices.slice(0,23),{},'guarded'),RangeError);
  const d=device(10), o=D.config({});
  assert.throws(()=>D.applyCommand(d,{id:'bad',hour:1,expires:2,kind:'charge',kwh:NaN},1,o,true,0),RangeError);
  close(d.soc,10);
});
