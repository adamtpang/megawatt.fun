/* The data center site on /twin. Drawn in code, no model file: four data halls, a battery yard, a substation and the
   line to the grid, on a transparent canvas. It is a diagram, not a survey: nothing here is to scale.
   window.Site.set({ boxes, soc, state, gridFlow, battFlow, peak, daylight }) shows one hour of the engine's record:
     boxes     how many battery boxes to draw (0 for no battery)
     soc       0 to 1, how many of them are lit
     state     'run' | 'charge' | 'idle'
     gridFlow  0 to 1, how hard the site pulls on the grid line
     battFlow  -1 to 1, power out of the battery (+) or into it (-)
     peak      true in one of the four peak hours
     daylight  0 (night) to 1
   No WebGL or a blocked three.js module keeps the flat drawing already on the page.
   prefers-reduced-motion draws still frames only. */
const canvas = document.getElementById('site-canvas');
const fallback = document.getElementById('site-fallback');
const labelBox = document.getElementById('site-labels');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { boxes: 0, soc: 0, state: 'idle', gridFlow: 1, battFlow: 0, peak: false, daylight: 1, apply: null };
window.Site = {
  set(next) {
    Object.assign(state, next);
    if (fallback) { fallback.dataset.s = state.state; fallback.dataset.peak = state.peak ? '1' : '0'; }
    if (state.apply) state.apply();
  },
};
if (window.SitePending) window.Site.set(window.SitePending); // the page may have drawn an hour before this module ran

const C = { charge: 0x009d9a, run: 0xff832b, peak: 0xda1e28, blue: 0x0f62fe, wire: 0x525252, empty: 0xc6c6c6, hall: 0xffffff, roof: 0x8d8d8d, steel: 0x6f6f6f };
const MAX_BOXES = 48, COLS = 6;

function showFallback() { if (canvas) canvas.hidden = true; if (fallback) fallback.hidden = false; if (labelBox) labelBox.hidden = true; }
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

async function boot() {
  if (!canvas || !hasWebGL()) return showFallback();
  let THREE;
  try { THREE = await import('three'); } catch (err) { console.warn('3D site not loaded:', err); return showFallback(); }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(6, 18, 10);
  const fill = new THREE.HemisphereLight(0xffffff, 0xb9c0cb, 0.5);
  scene.add(ambient, sun, fill);

  const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9 }, extra || {}));
  const box = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); (parent || scene).add(o); return o; };
  const flat = (w, d, m, x, z, y) => box(w, 0.04, d, m, x, y == null ? 0.02 : y, z);

  // Ground, pads and the buried bus that ties the three parts together.
  const groundMat = mat(0xe0e0e0, { roughness: 1 }), padMat = mat(0xc6c6c6, { roughness: 1 });
  flat(46, 34, groundMat, 4, 0, -0.03);
  flat(9, 7, padMat, 13.5, -9);    // substation pad
  const yardPad = flat(9.4, 11, padMat, 13.5, 4.5);
  const busMat = mat(C.wire), battBusMat = mat(C.wire);
  flat(0.35, 19, busMat, 4, 0, 0.05);            // main bus, in front of the hall ends
  flat(5.2, 0.35, busMat, 6.6, -9, 0.05);        // substation to bus
  const battBus = flat(5.2, 0.35, battBusMat, 6.6, 4.5, 0.05); // battery yard to bus

  // Four data halls with cooling units on the roof and a status strip on the end wall.
  const hallMat = mat(C.hall), roofMat = mat(C.roof), stripMat = mat(C.blue, { emissive: C.blue, emissiveIntensity: 0.25 });
  const hallZ = [-7.5, -2.5, 2.5, 7.5];
  hallZ.forEach((z) => {
    box(15, 2.4, 3.6, hallMat, -5.5, 1.2, z);
    box(15.2, 0.12, 3.8, roofMat, -5.5, 2.46, z);
    for (let i = 0; i < 7; i++) box(1.1, 0.5, 1.6, roofMat, -11.6 + i * 2.03, 2.77, z);
    box(0.08, 0.5, 3.0, stripMat, 2.05, 1.5, z);
    flat(2, 0.25, busMat, 3, z, 0.05);
  });

  // Substation: three transformers, a gantry, then two towers carrying the line off the site.
  const steel = mat(C.steel), trMat = mat(0x8d8d8d);
  [-10.6, -9, -7.4].forEach((z) => { box(1.3, 1.4, 1.1, trMat, 12, 0.7, z); box(0.5, 0.5, 0.5, steel, 12, 1.65, z); });
  box(0.18, 3.4, 0.18, steel, 15.5, 1.7, -11.2); box(0.18, 3.4, 0.18, steel, 15.5, 1.7, -6.8); box(0.18, 0.18, 4.6, steel, 15.5, 3.4, -9);
  const towers = [[20.5, -9], [26, -9]];
  towers.forEach(([x, z]) => {
    box(0.2, 6, 0.2, steel, x, 3, z);
    box(0.16, 0.16, 3.6, steel, x, 5.6, z); box(0.16, 0.16, 2.6, steel, x, 4.6, z);
  });
  const wireMat = new THREE.LineBasicMaterial({ color: C.wire });
  const wirePts = (dz, y0) => [new THREE.Vector3(15.5, 3.4, -9 + dz * 0.6), new THREE.Vector3(20.5, y0, -9 + dz), new THREE.Vector3(26, y0, -9 + dz), new THREE.Vector3(31, y0 - 0.4, -9 + dz)];
  [[-1.7, 5.6], [0, 5.6], [1.7, 5.6]].forEach(([dz, y0]) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wirePts(dz, y0)), wireMat)));
  box(0.12, 0.12, 3.6, steel, 13.6, 2.2, -9); // drop from the gantry to the transformers

  // Battery yard: up to 48 boxes. The page says how much energy one box stands for.
  const boxGeo = new THREE.BoxGeometry(1.15, 0.8, 0.85);
  const cells = [];
  for (let i = 0; i < MAX_BOXES; i++) {
    const m = mat(C.empty, { emissive: 0x000000 });
    const o = new THREE.Mesh(boxGeo, m);
    o.position.set(9.9 + (i % COLS) * 1.44, 0.42, 0.2 + Math.floor(i / COLS) * 1.22);
    o.visible = false; scene.add(o); cells.push(o);
  }

  // Dots that move along a path show which way power is flowing, and how much.
  const dotGeo = new THREE.SphereGeometry(0.22, 12, 8);
  function flow(points, count) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); lens.push(l); total += l; }
    const m = new THREE.MeshBasicMaterial({ color: C.wire });
    const dots = Array.from({ length: count }, () => { const d = new THREE.Mesh(dotGeo, m); d.visible = false; scene.add(d); return d; });
    return {
      mat: m,
      // amount 0 to 1 sets how many dots show; dir is +1 along the path or -1 against it.
      draw(t, amount, dir) {
        const n = amount <= 0.004 ? 0 : Math.max(1, Math.round(count * Math.min(1, amount)));
        dots.forEach((d, k) => {
          d.visible = k < n;
          if (!d.visible) return;
          let u = ((k / n) + (reduced ? 0 : t * 0.00016 * dir)) % 1; if (u < 0) u += 1;
          let s = u * total, i = 0;
          while (i < lens.length - 1 && s > lens[i]) { s -= lens[i]; i++; }
          d.position.lerpVectors(pts[i], pts[i + 1], Math.min(1, s / lens[i]));
        });
      },
    };
  }
  const gridFlow = flow([[31, 5.2, -9], [26, 5.6, -9], [20.5, 5.6, -9], [15.5, 3.4, -9], [13.6, 2.2, -9], [9.2, 0.3, -9], [4, 0.3, -9], [4, 0.3, 8]], 16);
  const battFlow = flow([[9.2, 0.3, 4.5], [4, 0.3, 4.5]], 5);

  // Labels are HTML, placed over the canvas from each part's position.
  const anchors = { halls: new THREE.Vector3(-5.5, 3.6, -7.5), sub: new THREE.Vector3(12, 4.3, -9), grid: new THREE.Vector3(26, 7, -9), yard: new THREE.Vector3(13.5, 1.8, 0) };
  const labels = {};
  if (labelBox) labelBox.querySelectorAll('[data-at]').forEach((el) => { labels[el.dataset.at] = el; });

  const dir = new THREE.Vector3(0.62, 0.52, 0.74).normalize(), look = new THREE.Vector3(8, 0, -1), v = new THREE.Vector3();
  function frame() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 240, aspect = w / Math.max(h, 1);
    camera.position.copy(look).addScaledVector(dir, 60); camera.up.set(0, 1, 0); camera.lookAt(look); camera.updateMatrixWorld();
    // Fit the whole site: project its corners into the camera's own axes and size the box around them.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [[-13.5, 0, -10], [-13.5, 3.2, 10], [2, 0, 10.5], [18.5, 0, 10.5], [18.5, 0, -12], [30, 6.4, -9], [-13.5, 3.2, -9.5], [14, 0, 10.5], [15.5, 3.6, -11.5]].forEach((p) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let halfW = (maxX - minX) / 2 * 1.06, halfH = (maxY - minY) / 2 * 1.12;
    if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
    camera.left = cx - halfW; camera.right = cx + halfW; camera.top = cy + halfH; camera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
  }
  function placeLabels(w, h) {
    Object.keys(labels).forEach((k) => {
      v.copy(anchors[k]).project(camera);
      labels[k].style.left = ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      labels[k].style.top = ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
    });
  }

  const dayGround = new THREE.Color(0xe0e0e0), nightGround = new THREE.Color(0x2a2f38), dayPad = new THREE.Color(0xc6c6c6), nightPad = new THREE.Color(0x3a404b);
  const dayHall = new THREE.Color(0xffffff), nightHall = new THREE.Color(0x8a93a3);
  let light = 1, lightTo = 1, shown = -1;
  function apply() {
    lightTo = Math.max(0, Math.min(1, state.daylight));
    const n = Math.max(0, Math.min(MAX_BOXES, Math.round(state.boxes))), lit = Math.round(n * Math.max(0, Math.min(1, state.soc)));
    const live = state.state === 'run' ? C.run : state.state === 'charge' ? C.charge : C.blue;
    cells.forEach((o, i) => {
      o.visible = i < n;
      const on = i < lit;
      o.material.color.setHex(on ? live : C.empty);
      o.material.emissive.setHex(on && state.state !== 'idle' ? live : 0x000000);
      o.material.emissiveIntensity = 0.45;
    });
    yardPad.visible = battBus.visible = n > 0;
    if (labels.yard) labels.yard.hidden = n === 0;
    if (n !== shown) { shown = n; }
    const lineColor = state.peak ? C.peak : state.gridFlow > 0.004 ? C.wire : 0xa8a8a8;
    wireMat.color.setHex(lineColor); gridFlow.mat.color.setHex(state.peak ? C.peak : C.blue);
    battFlow.mat.color.setHex(state.battFlow > 0 ? C.run : C.charge);
    battBusMat.color.setHex(state.battFlow > 0.004 ? C.run : state.battFlow < -0.004 ? C.charge : C.wire);
    if (labels.grid) labels.grid.dataset.peak = state.peak ? '1' : '0';
    if (reduced) { light = lightTo; draw(0); }
  }
  state.apply = apply;

  let lastW = 0, lastH = 0;
  function draw(now) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // the tab is hidden
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); frame(); lastW = 0; }
    light += (lightTo - light) * (reduced ? 1 : 0.14);
    ambient.intensity = 0.38 + 0.42 * light; sun.intensity = 0.25 + 0.95 * light; fill.intensity = 0.22 + 0.3 * light;
    groundMat.color.copy(nightGround).lerp(dayGround, light); padMat.color.copy(nightPad).lerp(dayPad, light);
    hallMat.color.copy(nightHall).lerp(dayHall, light);
    stripMat.emissiveIntensity = 0.25 + 0.9 * (1 - light);
    gridFlow.draw(now, state.gridFlow, 1);
    battFlow.draw(now, Math.abs(state.battFlow), state.battFlow >= 0 ? 1 : -1);
    renderer.render(scene, camera);
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; placeLabels(w, h); }
  }
  function loop(now) { draw(now); requestAnimationFrame(loop); }

  canvas.hidden = false; if (fallback) fallback.hidden = true; if (labelBox) labelBox.hidden = false;
  apply();
  if (reduced) { draw(0); addEventListener('resize', () => draw(0)); new ResizeObserver(() => draw(0)).observe(canvas); } else requestAnimationFrame(loop);
}

boot();
