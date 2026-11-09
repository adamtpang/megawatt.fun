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
  camera.position.set(12, 8, 16);
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
  let current = null;
  let battery = null;
  let preset = '';

  function fit(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 11 / Math.max(size.x, size.y, size.z, 0.001);
    object.scale.setScalar(scale);
    object.position.sub(center.multiplyScalar(scale));
    object.position.y -= box.min.y * scale;
  }

  async function loadPreset(id) {
    if (preset === id && current) return;
    preset = id;
    if (current) scene.remove(current);
    current = null;
    battery = null;
    try {
      const gltf = await loader.loadAsync('/models/house-' + id + '.glb');
      current = gltf.scene;
      battery = current.getObjectByName('Battery');
      fit(current);
      scene.add(current);
      return true;
    } catch (err) {
      console.error(err);
      showFallback();
      return false;
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
    if (mesh && mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mat.color.setHex(MODE[modeAt(hour)] || MODE.idle);
      mat.emissive = mat.emissive || new THREE.Color();
      mat.emissive.setHex(MODE[modeAt(hour)] || 0);
      mat.emissiveIntensity = modeAt(hour) === 'idle' ? 0 : 0.35;
    }
  }
  pending.apply = apply;

  function frame(now) {
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 280;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    }
    if (!reduced && pending.day && now - last > 700) {
      last = now;
      hour = (hour + 1) % 24;
      apply();
    }
    if (current && !reduced) current.rotation.y += 0.002;
    camera.lookAt(0, 2, 0);
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
