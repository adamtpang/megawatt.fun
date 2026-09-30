/* The persistent 3D layer: an Earth whose night-side lights follow the page, zooming out toward the Sun for Type II+.
   Procedural (no textures to download). Falls back to a CSS planet when WebGL is missing or motion is reduced. */
const canvas = document.getElementById('earth');
const fallback = document.getElementById('fallback');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function useFallback() {
  canvas.hidden = true;
  fallback.hidden = false;
  window.addEventListener('mw:scene', (e) => fallback.style.setProperty('--lights', String(0.15 + e.detail.lights * 0.85)));
}

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

async function boot() {
  if (reduced || !hasWebGL()) return useFallback();
  let THREE;
  try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js'); }
  catch { return useFallback(); }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x070d16);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);

  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uLights: { value: 0.5 }, uSun: { value: new THREE.Vector3(-0.55, 0.2, -1).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uLights; uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s=0.0,a=0.5; for(int k=0;k<5;k++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 p = normalize(vP);
        float land = smoothstep(0.50, 0.56, fbm(p*1.8));
        float day = clamp(dot(vN, uSun)*1.4+0.15, 0.0, 1.0);
        vec3 ocean = vec3(0.03,0.08,0.15), ground = vec3(0.10,0.16,0.12);
        vec3 col = mix(ocean, ground, land) * (0.18 + 0.9*day);
        float cities = smoothstep(0.62 - 0.22*uLights, 0.80, fbm(p*14.0)) * land;
        float spark = step(0.985 - 0.05*uLights, h(floor(p*220.0))) * land;
        float glow = (cities*0.9 + spark*0.6) * uLights * (1.0 - day);
        col += vec3(1.0,0.77,0.42) * glow * 1.6;
        float rim = pow(1.0 - abs(dot(vN, vec3(0,0,1))), 3.0);
        col += vec3(0.62,0.85,0.93) * rim * 0.25;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat);
  earth.rotation.x = 0.35;
  scene.add(earth);

  // Stars
  const starGeo = new THREE.BufferGeometry(), N = 1800, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 300 + Math.random() * 600, t = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u); pos.set([r * s * Math.cos(t), r * s * Math.sin(t), r * u], i * 3); }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe3ef, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  // The Sun, only visible once the reader pushes past Type I
  const sun = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  sun.position.set(22, 6, -60);
  scene.add(sun);
  const swarm = new THREE.Mesh(new THREE.TorusGeometry(9, 0.08, 6, 120), new THREE.MeshBasicMaterial({ color: 0x9fd8ec, transparent: true, opacity: 0 }));
  swarm.position.copy(sun.position); swarm.rotation.x = 1.2;
  scene.add(swarm);

  let target = { lights: 0.5, zoom: 0 }, cur = { lights: 0.5, zoom: 0 };
  window.addEventListener('mw:scene', (e) => { target = { ...target, ...e.detail }; });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    // Mobile: Earth sits lower and smaller so text stays on top of dark sky
    earth.position.set(w < 700 ? 0.45 : 1.15, w < 700 ? 0.2 : 0, 0); earth.scale.setScalar(w < 700 ? 1.45 : 1);
  }
  addEventListener('resize', resize); resize();

  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(tick); });
  let last = performance.now();
  function tick(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    cur.lights += (target.lights - cur.lights) * Math.min(1, dt * 2.5);
    cur.zoom += (target.zoom - cur.zoom) * Math.min(1, dt * 1.5);
    earthMat.uniforms.uLights.value = cur.lights;
    earth.rotation.y += dt * 0.04;
    const dist = 3.4 + cur.zoom * cur.zoom * 140;
    camera.position.set(0, cur.zoom * 8, dist);
    camera.lookAt(0, 0, 0);
    const sunVis = Math.min(1, Math.max(0, (cur.zoom - 0.1) * 3));
    sun.material.opacity = sunVis; swarm.material.opacity = sunVis * 0.6;
    swarm.rotation.z += dt * 0.1;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
boot();
