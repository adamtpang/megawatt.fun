/* 3D house for the ROI tool. Loads /models/house-<preset>.glb (see docs/models.md).
   A missing file or a failed WebGL context falls back to the drawing already on the page.
   prefers-reduced-motion keeps a still frame. */
const canvas = document.getElementById('house-canvas');
const fallback = document.getElementById('house-fallback');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ROI = { good: 0xb2dd79, mixed: 0xf7c33c, poor: 0xbf5249, idle: 0xd8d7d5 };
const MODE = { charge: 0xb2dd79, discharge: 0xed6c30, idle: 0x54524f };

function showFallback() {
  if (canvas) canvas.hidden = true;
  if (fallback) fallback.hidden = false;
}

function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (err) {
    return false;
  }
}

const pending = { preset: 'suburban', roi: 'idle', clock: null, day: null, ready: false };

window.HomeHouse = {
  setState(state) {
    Object.assign(pending, state || {});
    if (pending.apply) pending.apply();
  },
};

async function boot() {
  if (!canvas || !hasWebGL()) return showFallback();
  let THREE;
  let GLTFLoader;
  try {
    THREE = await import('three');
    ({ GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'));
  } catch (err) {
    console.error(err);
    return showFallback();
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0xf0eeeb, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(16, 7, 12);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(8, 14, 6);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(12, 48),
    new THREE.MeshStandardMaterial({ color: ROI.idle, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const loader = new GLTFLoader();
  const look = new THREE.Vector3(0, 2, 0);
  let current = null;
  let battery = null;
  let preset = '';

  // Models stay in meters. The camera backs up so a 9 m bungalow, an 18 m suburban
  // house, and a 21 m ranch each fill the frame. Front is +Z. The battery is on +X.
  function frameHouse(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = (canvas.clientWidth || 640) / Math.max(canvas.clientHeight || 380, 1);
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const span = Math.max(size.x, size.z);
    const dist = Math.max((span * 0.62) / Math.tan(hFov / 2), (size.y * 0.85) / Math.tan(vFov / 2));
    look.set(center.x * 0.08, size.y * 0.38, center.z * 0.05);
    camera.position.set(look.x + dist * 0.72, size.y * 0.55 + 1.4, look.z + dist);
    camera.near = Math.max(0.05, dist / 200);
    camera.far = dist * 12;
    camera.updateProjectionMatrix();
    ground.geometry.dispose();
    ground.geometry = new THREE.CircleGeometry(Math.max(Math.hypot(size.x, size.z) * 0.62, 8), 64);
    ground.position.y = -0.02;
  }

  let loading = null;
  async function loadPreset(id) {
    if (preset === id && current) return true;
    if (loading && loading.id === id) return loading.promise;
    preset = id;
    const promise = (async () => {
      if (current) scene.remove(current);
      current = null;
      battery = null;
      const gltf = await loader.loadAsync('/models/house-' + id + '.glb');
      if (preset !== id) return false;
      current = gltf.scene;
      battery = current.getObjectByName('Battery');
      if (battery && battery.material) {
        battery.material = battery.material.clone();
        battery.userData.baseColor = battery.material.color.getHex();
      }
      scene.add(current);
      frameHouse(current);
      return true;
    })();
    loading = { id, promise };
    try {
      return await promise;
    } catch (err) {
      console.error(err);
      showFallback();
      return false;
    } finally {
      if (loading && loading.promise === promise) loading = null;
    }
  }

  let hour = 0;
  let last = 0;
  function modeAt(index) {
    const clock = pending.clock;
    if (!clock) return 'idle';
    const he = index + 1;
    if (clock.charge.includes(he)) return 'charge';
    if (clock.discharge.includes(he)) return 'discharge';
    return 'idle';
  }

  function apply() {
    const id = pending.preset || 'suburban';
    loadPreset(id);
    ground.material.color.setHex(ROI[pending.roi] || ROI.idle);
    let mesh = battery;
    if (mesh && !mesh.material) mesh.traverse((obj) => { if (!mesh.material && obj.material) mesh = obj; });
    const mode = modeAt(hour);
    if (canvas) canvas.dataset.battery = mode;
    if (mesh && mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const tint = mode === 'idle' ? (mesh.userData.baseColor || MODE.charge) : MODE[mode];
      mat.color.setHex(tint);
      mat.emissive = mat.emissive || new THREE.Color();
      mat.emissive.setHex(mode === 'idle' ? 0x000000 : MODE[mode]);
      mat.emissiveIntensity = mode === 'idle' ? 0 : 0.35;
    }
  }
  pending.apply = apply;

  function frame(now) {
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 280;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      if (current) frameHouse(current);
    }
    if (!reduced && pending.day && now - last > 700) {
      last = now;
      hour = (hour + 1) % 24;
      apply();
    }
    camera.lookAt(look);
    renderer.render(scene, camera);
    if (!reduced) requestAnimationFrame(frame);
  }

  const loaded = await loadPreset(pending.preset || 'suburban');
  if (!loaded) return;
  canvas.hidden = false;
  fallback.hidden = true;
  apply();
  if (reduced) {
    renderer.setSize(canvas.clientWidth || 320, canvas.clientHeight || 280, false);
    camera.aspect = (canvas.clientWidth || 320) / Math.max(canvas.clientHeight || 280, 1);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  } else {
    requestAnimationFrame(frame);
  }
}

boot();
