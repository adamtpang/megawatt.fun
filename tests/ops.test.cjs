const {test}=require('node:test'), assert=require('node:assert/strict'),O=require('../ops-core');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('forecast is deterministic and the modeled constraint moves with capacity',()=>{
  const a=O.forecast(),b=O.forecast({crews:9}),c=O.forecast({crews:9,commissioning:3});
  assert.deepEqual(a,O.forecast());assert.equal(a.bottleneck,'install');assert.equal(b.bottleneck,'commission');
  assert.ok(b.perDay>a.perDay);assert.ok(c.perDay>b.perDay);near(a.perDay,15.6);near(b.perDay,21.3);
  for(const r of [a,b,c]){assert.equal(r.completed,r.perDay*r.days);for(const s of Object.values(r.st))near(s.busy+s.blocked+s.idle+s.down,1);}
});
test('slower visits reduce throughput; surplus upstream capacity cannot bypass commissioning',()=>{
  assert.ok(O.forecast({installHours:4.5}).perDay<O.forecast().perDay);
  const r=O.forecast({crews:24,commissioning:1});assert.equal(r.bottleneck,'commission');assert.ok(r.perDay<12);
});
test('jobs are conserved through queues, interruptions and live resource changes',()=>{
  const {sim}=O.create();
  for(let hour=1;hour<=240;hour++){
    sim.runUntil(hour*3600);
    if(hour===80)O.apply(sim,{crews:9,commissioning:3});
    if(hour===160)O.apply(sim,{crews:3,commissioning:1});
    assert.equal(sim.started,sim.shipped+sim.scrapped+sim.wip());
    for(const s of sim.list){for(const queue of Object.values(s.inputs))assert.ok(queue.length<=s.cap);for(const sv of s.servers)assert.ok(sim.progress(sv)>=0&&sim.progress(sv)<=1);}
  }
  assert.ok(sim.st.install.failures>0);
});
test('exact deterministic serial fixture respects capacity and blocked buffers',()=>{
  const spec=O.spec();spec.stations=spec.stations.slice(0,2).map(s=>({...s,ct:3600,cv:0,servers:1,buffer:1,mtbf:0,mttr:0}));
  const plan=globalThis.FactorySkill.plan(spec),sim=new globalThis.FactorySkill.Sim(plan);
  sim.runUntil(8*3600);assert.equal(sim.shipped,7);assert.equal(sim.started,sim.shipped+sim.wip());
});
test('snapshot matches actual queue and server state; invalid settings fail',()=>{
  const {sim}=O.create();sim.runUntil(86400);const snap=O.snapshot(sim);
  assert.equal(snap.completed,sim.shipped);assert.equal(snap.wip,sim.wip());
  for(const s of snap.stages)assert.equal(s.busyCount,sim.st[s.id].servers.filter(v=>v.state==='busy').length);
  for(const p of [{crews:0},{crews:1.2},{installHours:NaN},{commissioning:99},{buffer:-1},{seed:0},{hidden:1}])assert.throws(()=>O.create(p));
  assert.throws(()=>O.forecast({},0));
});
test('shrinking a buffer preserves existing jobs and applies backpressure',()=>{
  const {sim}=O.create();sim.runUntil(20*3600);const before=sim.started;
  O.apply(sim,{buffer:1});assert.equal(sim.started,before);assert.equal(sim.started,sim.shipped+sim.wip());
  sim.runUntil(200*3600);
  for(const s of sim.list)for(const queue of Object.values(s.inputs))assert.ok(queue.length<=1);
  assert.equal(sim.started,sim.shipped+sim.wip());
});
