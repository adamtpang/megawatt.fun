const fs=require('node:fs'),path=require('node:path'),O=require('../ops-core');
const cases={baseline:{},moreCrews:{crews:9},moreCrewsAndCommissioning:{crews:9,commissioning:3},longerVisits:{installHours:4.5}};
const out={basis:'Synthetic operating assumptions; not Base data or forecasts',method:'30 eight-hour production shifts after warm-up; seeded discrete-event simulation',engine:'AirsupHQ/factory-skill 9fde7554e6a30e77ea1008dec08f2ba8d8d37f27 (MIT); Megawatt aggregates full-horizon counters',cases:{}};
for(const [name,input]of Object.entries(cases)){const parameters=O.parameters(input),result=O.forecast(input);out.cases[name]={parameters,result};console.log(`${name}: ${result.perDay.toFixed(2)} homes/shift; constraint ${result.bottleneck}`);}
const folder=path.join(__dirname,'../demo/deployment-ops');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(out,null,2)+'\n');
