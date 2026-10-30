/* Original Megawatt scene. All stage metrics come from the credited DES engine. */
(() => {
  'use strict';
  const O = window.DeploymentOps, T = window.THREE, $ = id => document.getElementById(id);
  const film = new URLSearchParams(location.search).get('film') === '1';
  const positions = [[-24,-13],[0,-13],[24,-13],[24,14],[0,14],[-24,14]];
  const names = Object.fromEntries(O.STAGES.map(s => [s[0], s[1]]));
  let params = { ...O.DEFAULTS }, model, baseline = O.forecast(), forecast = baseline, selected = 'install', paused = false;
  let runStart = 0, elapsed = 0, lastUI = 0, scene, renderer, camera, orbit, stageGroups = [], routeDots = [], ready = false;
  const fmt = x => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(x);
  function reset() {
    params = { ...O.DEFAULTS }; model = O.create(params); model.sim.runUntil(2 * model.plan.daySec);
    model.sim.resetWindow(); runStart = model.sim.shipped; elapsed = 0; forecast = O.forecast(params); paused = false;
    sync(); paint();
  }
  function sync() {
    for (const [id, key, output] of [['crews','crews','crew-value'], ['commissioning','commissioning','commission-value'], ['install-hours','installHours','hours-value'], ['buffer','buffer','buffer-value']]) { $(id).value = params[key]; $(output).textContent = params[key]; }
    $('pause').textContent = paused ? 'Play' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused));
    $('add-crews').disabled = params.crews >= 24;
  }
  function change(patch) {
    params = O.parameters({ ...params, ...patch }); O.apply(model.sim, params); forecast = O.forecast(params);
    sync(); paint();
  }
  function paint() {
    const s = O.snapshot(model.sim), delta = forecast.perDay - baseline.perDay;
    $('forecast').textContent = fmt(forecast.perDay);
    $('comparison').textContent = `${delta >= 0 ? '+' : ''}${fmt(delta)} vs. ${fmt(baseline.perDay)} baseline · target ${params.target}`;
    $('completed').textContent = s.completed - runStart; $('wip').textContent = s.wip;
    $('bottleneck').textContent = names[forecast.bottleneck];
    $('decision').textContent = forecast.bottleneck === 'install' ? 'Installation is the constraint in this scenario.' : `Extra crews now wait on ${names[forecast.bottleneck].toLowerCase()}.`;
    const day = Math.floor(elapsed / model.plan.daySec) + 1, hour = 8 + elapsed % model.plan.daySec / 3600;
    $('sim-clock').textContent = `Shift ${day} · ${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor(hour%1*60)).padStart(2,'0')}`;
    for (const stage of s.stages) {
      const row = document.querySelector(`[data-stage="${stage.id}"]`);
      row.setAttribute('aria-pressed', String(selected === stage.id)); row.querySelector('.q').textContent = `${stage.queue} waiting`;
      ['busy','blocked','down'].forEach((key, i) => row.querySelectorAll('.bar i')[i].style.width = `${stage[key] * 100}%`);
    }
    const d = model.plan.byId[selected], st = s.stages.find(x => x.id === selected);
    $('inspect-name').textContent = names[selected]; $('inspect-note').textContent = d.note.replace('Synthetic assumption. ', '');
    $('inspect-metrics').textContent = `${st.servers} resources · ${fmt(model.sim.st[selected].ct / 3600)} h / job · ${Math.round(st.busy * 100)}% busy`;
    $('assumption-table').innerHTML = `<table><thead><tr><th>Stage</th><th>Resources</th><th>Hours / job</th><th>Source</th></tr></thead><tbody>${O.spec(params).stations.map(st => `<tr><td>${st.name}</td><td>${st.servers}</td><td>${fmt(st.ct/3600)}</td><td>Synthetic</td></tr>`).join('')}<tr><td>Each input queue</td><td>${params.buffer} jobs</td><td>—</td><td>Synthetic</td></tr><tr><td>Cycle variability</td><td>CV 10%</td><td>Lognormal</td><td>Synthetic</td></tr><tr><td>Install interruption</td><td>Mean 40 busy hours</td><td>Mean 1 h recovery</td><td>Synthetic; exponential</td></tr><tr><td>Yield / rework</td><td>100%</td><td>No rework</td><td>Excluded</td></tr><tr><td>Target / seed</td><td>${params.target} per shift / ${params.seed}</td><td>8 h shift</td><td>Synthetic</td></tr></tbody></table>`;
  }
  $('stage-list').innerHTML = O.STAGES.map(s => `<button data-stage="${s[0]}" aria-pressed="false"><span>${s[1]}</span><span class="q"></span><span class="bar"><i></i><i></i><i></i></span></button>`).join('');
  function select(id) { selected = id; paint(); }
  document.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => select(b.dataset.stage)));
  for (const [id,key] of [['crews','crews'],['commissioning','commissioning'],['install-hours','installHours'],['buffer','buffer']]) $(id).addEventListener('input', e => change({ [key]: Number(e.target.value) }));
  $('add-crews').addEventListener('click', () => change({ crews: Math.min(24, params.crews + 3) }));
  $('slow-visits').addEventListener('click', () => change({ installHours: 4.5 }));
  $('reset').addEventListener('click', reset);
  $('pause').addEventListener('click', () => { paused = !paused; sync(); });
  $('evidence-open').addEventListener('click', () => $('evidence').showModal());
  $('evidence-close').addEventListener('click', () => $('evidence').close());
  reset();

  const materials = {};
  function mat(color) { return materials[color] ||= new T.MeshStandardMaterial({ color, roughness: .8 }); }
  function box(g,w,h,d,color,x=0,y=0,z=0) {
    const m = new T.Mesh(new T.BoxGeometry(w,h,d), mat(color)); m.position.set(x,y+h/2,z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function cylinder(g,r,h,color,x,y,z) { const m = new T.Mesh(new T.CylinderGeometry(r,r,h,12),mat(color));m.position.set(x,y+h/2,z);m.castShadow=true;g.add(m);return m; }
  function label(g,text,x,y,z,size=9) {
    const c = document.createElement('canvas');c.width=512;c.height=80;
    const ctx=c.getContext('2d');ctx.fillStyle='#f7f8f3';ctx.fillRect(0,0,512,80);ctx.fillStyle='#344c38';ctx.font='500 28px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,50);
    const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:false,toneMapped:false}));sprite.position.set(x,y,z);sprite.scale.set(size,size*80/512,1);sprite.renderOrder=10;g.add(sprite);return sprite;
  }
  function battery(g,x,y,z,lit=false) { box(g,.55,1.2,.28,'#e8eadf',x,y,z);box(g,.26,.055,.02,lit?'#8eb968':'#465d46',x,y+.92,z+.151); }
  function person(g,x,z,color='#68785c') { cylinder(g,.13,.65,color,x,.12,z);const head=new T.Mesh(new T.SphereGeometry(.15,8,8),mat('#ba9f82'));head.position.set(x,.99,z);g.add(head); }
  function house(g,x,z,color='#c7c8b5',lit=false) {
    const h=new T.Group();h.position.set(x,0,z);g.add(h);box(h,4,2.6,3.3,color);
    const roof=new T.Mesh(new T.ConeGeometry(3.25,1.4,4),mat('#747d6c'));roof.position.y=3.25;roof.rotation.y=Math.PI/4;roof.scale.z=.83;h.add(roof);roof.castShadow=true;
    box(h,.65,1.7,.05,'#53644f',0,.02,1.68);
    for(const xx of [-1.25,1.25])box(h,.75,.7,.06,lit?'#e0c88a':'#6e8883',xx,1.1,1.7);
    battery(h,2.05,.1,.6,lit);box(h,1,.03,2,'#d7d6c9',0,.01,2.7);
  }
  function truck(g,x,z) {
    const v=new T.Group();g.add(v);v.position.set(x,0,z);box(v,1.8,1.65,3.8,'#f1efe5',0,.65,0);box(v,1.8,1.35,1.4,'#889d75',0,.5,2.55);box(v,1.5,.55,.05,'#6b888b',0,1.1,3.28);
    for(const xx of [-.92,.92])for(const zz of [-1.2,2.5]){const w=cylinder(v,.36,.18,'#35433c',0,0,0);w.rotation.z=Math.PI/2;w.position.set(xx,.4,zz);}return v;
  }
  function warehouse(g) {
    box(g,13,.2,9,'#d3d8cc');box(g,13,3,.3,'#c7d0bf',0,.2,-4.3);box(g,.3,3,9,'#c7d0bf',-6.35,.2,0);
    for(const xx of [-4,0,4]){box(g,2.4,.18,1.2,'#74826b',xx,1,-2);box(g,2.4,.18,1.2,'#74826b',xx,2,-2);for(let k=0;k<3;k++)battery(g,xx-.7+k*.7,.25,-2);}
    box(g,6,.2,1.6,'#889a79',1,1.1,1);person(g,1,2.4);
  }
  function initializeScene() {
    const canvas=$('ops-scene'); renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:film});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.setClearColor('#e9e9e2');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
    scene=new T.Scene();scene.add(new T.HemisphereLight('#ffffff','#8c9985',1.5));const sun=new T.DirectionalLight('#fff9ed',2);sun.position.set(-28,55,20);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-60,right:60,top:55,bottom:-55,far:180});sun.shadow.bias=-.001;scene.add(sun);
    camera=new T.PerspectiveCamera(36,1,.1,300);camera.position.set(78,90,97);camera.lookAt(0,0,0);
    orbit=new T.OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.maxPolarAngle=1.3;orbit.minDistance=35;orbit.maxDistance=150;orbit.target.set(0,0,0);orbit.saveState();
    box(scene,91,1.4,62,'#d7dcca',0,-1.5,0);box(scene,91,.12,7,'#9baba0',0,-.08,0);
    for(let xx=-42;xx<44;xx+=4)box(scene,1.8,.02,.1,'#dce1d6',xx,.06,0);
    for(const [i,[x,z]] of positions.entries()) {
      const id=O.STAGES[i][0],g=new T.Group();g.position.set(x,0,z);g.userData.stage=id;scene.add(g);
      const pad=box(g,19,.12,19,'#e5e7dc',0,-.05,0);
      const border=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(19.2,.2,19.2)),new T.LineBasicMaterial({color:'#ad5543'}));border.position.y=.12;g.add(border);
      if(id==='review'){box(g,10,3.3,6,'#d3d8c8',0,0,-1);box(g,10.7,.35,6.7,'#7f8e73',0,3.3,-1);for(const xx of [-3.4,-1.7,0,1.7,3.4])box(g,1.2,1.5,.1,'#7d9995',xx,1,.05+2);person(g,1,4);}
      else if(id==='prep')warehouse(g);
      else if(id==='delivery'){box(g,17,.05,12,'#bec8b8');for(const xx of [-5,0,5])truck(g,xx,-1);}
      else if(id==='install'){for(const xx of [-4,4])house(g,xx,-2);person(g,-1,1);person(g,3,3);truck(g,-5,5);}
      else if(id==='commission'){house(g,0,-1,'#c3cdbb');person(g,3,1);box(g,1.5,.9,.7,'#8da27c',4,0,3);cylinder(g,.07,6,'#63735d',-5,0,-4);box(g,2,.7,.3,'#8da27c',-5,4.8,-4);}
      else{for(const xx of [-4,4])for(const zz of [-3,4])house(g,xx,zz,'#cad4bd',true);}
      label(g,`${String(i+1).padStart(2,'0')}  ${names[id].toUpperCase()}`,0,7,-2,15);
      const queue=[];for(let k=0;k<12;k++){const pack=new T.Group();battery(pack,0,0,0,true);pack.position.set(-7.6+(k%6)*.9,0,7.3+Math.floor(k/6)*1.2);g.add(pack);queue.push(pack);}
      const workers=[];for(let k=0;k<24;k++){const personGroup=new T.Group();person(personGroup,0,0);personGroup.position.set(-7.8+(k%12)*1.35,0,-7.4+Math.floor(k/12)*1.2);g.add(personGroup);workers.push(personGroup);}
      stageGroups.push({id,g,border,queue,workers,pad});
      // A single moving job marker per busy server; its progress is from the engine.
      const markers=[];for(let k=0;k<24;k++){const m=new T.Mesh(new T.BoxGeometry(.45,.65,.35),mat('#456849'));scene.add(m);markers.push(m);}routeDots.push({id,markers,x,z});
    }
    for(let k=0;k<18;k++){const x=-43+(k%9)*10.5,z=k<9?-28:28;cylinder(scene,.14,1.7,'#978b70',x,0,z);const crown=new T.Mesh(new T.IcosahedronGeometry(1.4,1),mat(k%2?'#99ad7b':'#859b69'));crown.position.set(x,2.5,z);crown.castShadow=true;scene.add(crown);}
    $('camera-home').addEventListener('click',()=>orbit.reset());
    const ray=new T.Raycaster(),pointer=new T.Vector2();let down;
    canvas.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
    canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hits=ray.intersectObjects(stageGroups.map(s=>s.g),true);if(hits.length){let o=hits[0].object;while(o&&!o.userData.stage)o=o.parent;if(o)select(o.userData.stage);}});
    new ResizeObserver(resize).observe(canvas.parentElement);resize();ready=true;
  }
  function resize(){if(!renderer)return;const r=$('ops-scene').parentElement.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(r.width<500){camera.position.set(92,110,115);orbit.target.set(0,0,0);orbit.update();}}
  function render(){
    if(!ready)return;
    for(const stage of stageGroups){const s=model.sim.st[stage.id];stage.border.visible=stage.id===forecast.bottleneck;stage.pad.material=mat(stage.id===selected?'#d7e2c9':'#e5e7dc');const queue=Object.values(s.inputs).reduce((sum,a)=>sum+a.length,0);stage.queue.forEach((p,i)=>p.visible=i<queue);stage.workers.forEach((p,i)=>p.visible=i<s.servers.filter(v=>!v.retire).length);}
    for(const route of routeDots){const servers=model.sim.st[route.id].servers;route.markers.forEach((m,i)=>{const sv=servers[i];m.visible=!!sv&&sv.state==='busy';if(sv){const p=model.sim.progress(sv);m.position.set(route.x-7+p*14,.4,route.z+6-(i%3)*.75);}});}
    orbit.update();renderer.render(scene,camera);
  }
  try{initializeScene();}catch(error){$('scene-error').hidden=false;console.error(error);}
  function advance(dt){const seconds=dt*Number($('speed').value);elapsed+=seconds;model.sim.runUntil(model.sim.t+seconds);}
  let previous=performance.now();
  function tick(now){const dt=Math.min(.1,(now-previous)/1000);previous=now;if(!film&&!paused)advance(dt);if(now-lastUI>200){paint();lastUI=now;}render();requestAnimationFrame(tick);}
  if(!film)requestAnimationFrame(tick);else render();
  // Deterministic presentation of actual model changes, suitable for frame capture.
  let filmTime=-1;
  function filmFrame(t){
    if(!Number.isFinite(t)||t<0||t>60)throw Error('Film time must be 0–60 seconds.');
    if(t<filmTime||filmTime<0){reset();filmTime=0;}
    const events=[{t:8,p:{crews:9}},{t:20,p:{commissioning:3}}];
    for(const e of events){if(filmTime<e.t&&t>=e.t){advance(e.t-filmTime);filmTime=e.t;change(e.p);}}
    advance(t-filmTime);filmTime=t;
    selected=t<8?'install':t<20?'commission':'fleet';
    $('tour-caption').textContent=t<8?'Six crews. Installation sets the pace.':t<20?'Add three crews. Commissioning becomes the constraint.':'Add commissioning capacity. More homes reach the fleet.';
    if(ready){const az=.55+.13*Math.sin(t/11),dist=t<8?135:t<20?121:135;const target=t<8?new T.Vector3(2,0,3):t<20?new T.Vector3(7,0,5):new T.Vector3(0,0,0);camera.position.set(target.x+Math.sin(az)*dist*.65,dist*.7,target.z+Math.cos(az)*dist*.65);orbit.target.copy(target);camera.lookAt(target);}
    paint();render();return{t,forecast:forecast.perDay,bottleneck:forecast.bottleneck,completed:model.sim.shipped-runStart,ready};
  }
  window.opsFilm={frame:filmFrame};
  window.opsStudy={getState:()=>({params:{...params},forecast,baseline,snapshot:O.snapshot(model.sim),ready})};
})();
