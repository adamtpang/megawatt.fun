/* The house on the homepage. Loads /models/house-suburban.glb (Blender export, see docs/models.md) and
   shows one moment of the battery's day: the wall cabinet (mesh "Battery") glows green while it charges
   and orange while it runs the home, and the sky colour follows the moment.
   A missing file, no WebGL, or a blocked three.js module keeps the flat drawing already on the page.
   prefers-reduced-motion draws still frames only. Colours are Base palette tokens. */
const canvas = document.getElementById('house-canvas');
const fallback = document.getElementById('house-fallback');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// mode -> sky, ground, battery glow.
const LOOK = {
  idle: { sky: 0xf0eeeb, ground: 0x77a45a, glow: 0x000000, body: null },
  night: { sky: 0x102a17, ground: 0x1e4d2b, glow: 0xb2dd79, body: 0xb2dd79 },
  evening: { sky: 0xfbe3d8, ground: 0x77a45a, glow: 0xed6c30, body: 0xed6c30 },
  peak: { sky: 0xfdf1d3, ground: 0x77a45a, glow: 0xed6c30, body: 0xed6c30 },
  outage: { sky: 0x292826, ground: 0x54524f, glow: 0xb2dd79, body: 0xb2dd79 },
};
const state = { mode: 'idle', apply: null };
window.PjmHouse = { set(mode) { state.mode = LOOK[mode] ? mode : 'idle'; if (fallback) fallback.dataset.mode = state.mode; if (state.apply) state.apply(); } };

function showFallback() { if (canvas) canvas.hidden = true; if (fallback) fallback.hidden = false; }
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

async function boot() {
  if (!canvas || !hasWebGL()) return showFallback();
  let THREE, GLTFLoader;
  try {
    THREE = await import('three');
    ({ GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'));
  } catch (err) { console.warn('3D house not loaded:', err); return showFallback(); }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(10, 16, 8);
  scene.add(ambient, sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: LOOK.idle.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  scene.add(ground);
  const lamp = new THREE.PointLight(0xb2dd79, 0, 14); // the battery's glow on the wall and ground
  scene.add(lamp);

  let house, battery, look = new THREE.Vector3(0, 2, 0);
  try {
    const gltf = await new GLTFLoader().loadAsync('/models/house-suburban.glb');
    house = gltf.scene;
  } catch (err) { console.warn('House model not loaded:', err); return showFallback(); }
  battery = house.getObjectByName('Battery');
  let mesh = battery;
  if (mesh && !mesh.material) mesh.traverse((o) => { if (!mesh.material && o.material) mesh = o; });
  if (mesh && mesh.material) { mesh.material = mesh.material.clone(); mesh.userData.base = mesh.material.color.getHex(); }
  scene.add(house);

  // Frame the house with the battery wall (+X) toward the camera. Models are in meters; front is +Z.
  function frame() {
    const box = new THREE.Box3().setFromObject(house), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const aspect = (canvas.clientWidth || 640) / Math.max(canvas.clientHeight || 420, 1);
    const vFov = camera.fov * Math.PI / 180, hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const span = Math.max(size.x, size.z);
    const dist = Math.max((span * 0.5) / Math.tan(hFov / 2), (size.y * 0.8) / Math.tan(vFov / 2));
    look.set(center.x + size.x * 0.12, size.y * 0.34, center.z * 0.05);
    camera.position.set(look.x + dist * 1.0, size.y * 0.55 + 1.4, look.z + dist * 0.72);
    camera.aspect = aspect; camera.near = Math.max(0.05, dist / 200); camera.far = dist * 12; camera.updateProjectionMatrix();
    ground.geometry.dispose();
    ground.geometry = new THREE.CircleGeometry(Math.max(Math.hypot(size.x, size.z) * 0.66, 8), 72);
    if (battery) { const b = new THREE.Box3().setFromObject(battery).getCenter(new THREE.Vector3()); lamp.position.set(b.x + 1.2, b.y + 0.4, b.z); }
  }

  const sky = new THREE.Color(LOOK.idle.sky), skyTo = new THREE.Color(LOOK.idle.sky);
  const gnd = new THREE.Color(LOOK.idle.ground), gndTo = new THREE.Color(LOOK.idle.ground);
  let glowTo = 0, glow = 0;
  function apply() {
    const L = LOOK[state.mode];
    skyTo.setHex(L.sky); gndTo.setHex(L.ground);
    glowTo = L.glow ? 1 : 0;
    if (L.glow) lamp.color.setHex(L.glow);
    const dark = state.mode === 'night' || state.mode === 'outage';
    ambient.intensity = dark ? 0.42 : 0.8; sun.intensity = dark ? 0.35 : 1.25;
    if (mesh && mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mat.color.setHex(L.body || mesh.userData.base);
      mat.emissive = mat.emissive || new THREE.Color();
      mat.emissive.setHex(L.glow || 0x000000);
    }
    canvas.dataset.mode = state.mode;
    if (reduced) { sky.copy(skyTo); gnd.copy(gndTo); glow = glowTo; draw(0); }
  }
  state.apply = apply;

  function size() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 300, pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); frame(); }
  }
  function draw(now) {
    size();
    sky.lerp(skyTo, reduced ? 1 : 0.12); gnd.lerp(gndTo, reduced ? 1 : 0.12); glow += (glowTo - glow) * (reduced ? 1 : 0.12);
    renderer.setClearColor(sky, 1); ground.material.color.copy(gnd);
    // A slow pulse on the battery so the eye finds it.
    const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(now / 420);
    lamp.intensity = glow * 26 * pulse;
    if (mesh && mesh.material) { const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; mat.emissiveIntensity = glow * 0.55 * pulse; }
    camera.lookAt(look);
    renderer.render(scene, camera);
  }
  function loop(now) { draw(now); requestAnimationFrame(loop); }

  frame();
  canvas.hidden = false; if (fallback) fallback.hidden = true;
  apply();
  if (reduced) { draw(0); addEventListener('resize', () => draw(0)); } else requestAnimationFrame(loop);
}

boot();
