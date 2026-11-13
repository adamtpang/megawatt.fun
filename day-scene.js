/* The house on the homepage stage. Loads /models/house-suburban.glb (Blender export, see docs/models.md) on a
   transparent canvas, so the backdrop behind it is the page's own. window.Stage.set({ glow, daylight, ground }) tints the
   wall battery (mesh "Battery") and dims the sun: glow is a hex color or null, daylight runs 0 (night) to 1.
   No WebGL, a blocked three.js module or a missing model keeps the flat drawing already on the page.
   prefers-reduced-motion draws still frames only. */
const canvas = document.getElementById('stage-canvas');
const fallback = document.getElementById('stage-fallback');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { glow: null, daylight: 1, ground: null, apply: null };
window.Stage = {
  set(next) {
    state.glow = next.glow || null;
    state.ground = next.ground || null;
    state.daylight = Math.max(0, Math.min(1, next.daylight));
    if (fallback) { fallback.dataset.glow = next.name || 'idle'; fallback.style.setProperty('--glow', next.glow || 'transparent'); }
    if (state.apply) state.apply();
  },
};

if (window.StagePending) window.Stage.set(window.StagePending); // the page may have drawn an hour before this module ran

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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(10, 16, 8);
  scene.add(ambient, sun);
  const fill = new THREE.HemisphereLight(0xffffff, 0xb9c0cb, 0.55); // lifts the roof and the shaded walls
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0xd3d9e1, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  scene.add(ground);
  const lamp = new THREE.PointLight(0xffffff, 0, 14);
  scene.add(lamp);

  let house;
  try { house = (await new GLTFLoader().loadAsync('/models/house-suburban.glb')).scene; }
  catch (err) { console.warn('House model not loaded:', err); return showFallback(); }
  const battery = house.getObjectByName('Battery');
  let mesh = battery;
  if (mesh && !mesh.material) mesh.traverse((o) => { if (!mesh.material && o.material) mesh = o; });
  if (mesh && mesh.material) { mesh.material = mesh.material.clone(); mesh.userData.base = mesh.material.color.getHex(); }
  scene.add(house);

  const look = new THREE.Vector3(0, 2, 0);
  // Frame the house with the battery wall (+X) toward the camera. Models are in meters; front is +Z.
  function frame() {
    const box = new THREE.Box3().setFromObject(house), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const aspect = (canvas.clientWidth || 640) / Math.max(canvas.clientHeight || 420, 1);
    const vFov = camera.fov * Math.PI / 180, hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = Math.max((Math.max(size.x, size.z) * 0.5) / Math.tan(hFov / 2), (size.y * 0.8) / Math.tan(vFov / 2));
    // A tall canvas (the desktop stage) leaves sky above the roof, so aim higher to sit the house lower in the frame.
    look.set(center.x + size.x * 0.12, size.y * (aspect < 1.3 ? 0.62 : 0.34), center.z * 0.05);
    camera.position.set(look.x + dist, size.y * 0.55 + 1.4, look.z + dist * 0.72);
    camera.aspect = aspect; camera.near = Math.max(0.05, dist / 200); camera.far = dist * 12; camera.updateProjectionMatrix();
    ground.geometry.dispose();
    ground.geometry = new THREE.CircleGeometry(Math.max(Math.hypot(size.x, size.z) * 0.66, 8), 72);
    if (battery) { const b = new THREE.Box3().setFromObject(battery).getCenter(new THREE.Vector3()); lamp.position.set(b.x + 1.2, b.y + 0.4, b.z); }
  }

  const dayGround = new THREE.Color(0xd3d9e1), nightGround = new THREE.Color(0x2c3648), gnd = new THREE.Color(0xd3d9e1), gndTo = new THREE.Color(0xd3d9e1);
  let light = 1, lightTo = 1, glow = 0, glowTo = 0;
  function apply() {
    lightTo = state.daylight;
    if (state.ground) gndTo.set(state.ground); else gndTo.copy(nightGround).lerp(dayGround, state.daylight);
    glowTo = state.glow ? 1 : 0;
    if (state.glow) lamp.color.set(state.glow);
    if (mesh && mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (state.glow) mat.color.set(state.glow); else mat.color.setHex(mesh.userData.base);
      mat.emissive = mat.emissive || new THREE.Color();
      mat.emissive.set(state.glow || '#000000');
    }
    if (reduced) { light = lightTo; gnd.copy(gndTo); glow = glowTo; draw(0); }
  }
  state.apply = apply;

  function size() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 240, pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); frame(); }
  }
  function draw(now) {
    size();
    const k = reduced ? 1 : 0.14;
    light += (lightTo - light) * k; glow += (glowTo - glow) * k; gnd.lerp(gndTo, k);
    ambient.intensity = 0.4 + 0.4 * light; sun.intensity = 0.3 + 0.9 * light; fill.intensity = 0.25 + 0.4 * light;
    ground.material.color.copy(gnd);
    const pulse = reduced ? 1 : 0.78 + 0.22 * Math.sin(now / 420); // a slow pulse so the eye finds the battery
    lamp.intensity = glow * (10 + 18 * (1 - light)) * pulse;
    if (mesh && mesh.material) { const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; mat.emissiveIntensity = glow * 0.6 * pulse; }
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
