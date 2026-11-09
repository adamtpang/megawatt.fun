/* Placeholder house models for /models/house-<preset>.glb.
   Units are meters. Origin is the ground center of the footprint. Y is up. The front faces +Z.
   A node named Battery sits against a wall. Blender exports should follow docs/models.md.
   Run: node scripts/build-house-glb.js
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRESETS = {
  bungalow: {
    walls: { w: 8, h: 3.2, d: 7, x: 0, z: 0 },
    roof: { w: 8.6, h: 1.3, d: 7.6 },
    garage: null,
    battery: { w: 1.1, h: 1.7, d: 0.55, x: 4.6, z: 1.2 },
  },
  suburban: {
    walls: { w: 8, h: 6.2, d: 8, x: 0.6, z: 0 },
    roof: { w: 8.8, h: 1.5, d: 8.8 },
    garage: { w: 3.6, h: 2.8, d: 6.2, x: -4.6, z: 0.6 },
    battery: { w: 1.15, h: 1.8, d: 0.7, x: 5.2, z: 1.4 },
  },
  ranch: {
    walls: { w: 14, h: 3.3, d: 7, x: -1, z: 0 },
    roof: { w: 14.6, h: 1.2, d: 7.6 },
    garage: { w: 4.2, h: 2.8, d: 6.4, x: 8.2, z: 0.2 },
    battery: { w: 1.15, h: 1.8, d: 0.55, x: 11.0, z: 0.2 },
  },
};

const COLORS = {
  walls: [0.941, 0.933, 0.922, 1],
  roof: [0.118, 0.302, 0.169, 1],
  garage: [0.847, 0.843, 0.831, 1],
  battery: [0.698, 0.867, 0.475, 1],
};

function boxVerts(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [
    [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z], [1, 0, 0]],
    [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z], [-1, 0, 0]],
    [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], [0, 1, 0]],
    [[-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z], [0, -1, 0]],
    [[-x, -y, z], [-x, y, z], [x, y, z], [x, -y, z], [0, 0, 1]],
    [[x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, -z], [0, 0, -1]],
  ];
  const pos = [];
  const nor = [];
  const idx = [];
  faces.forEach((face) => {
    const base = pos.length / 3;
    const n = face[4];
    for (let i = 0; i < 4; i++) {
      pos.push(face[i][0], face[i][1], face[i][2]);
      nor.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

function pad4(n) { return (n + 3) & ~3; }

function build(presetId) {
  const spec = PRESETS[presetId];
  const parts = [];
  const wallTop = spec.walls.h;
  parts.push({ name: 'Walls', color: 'walls', mesh: boxVerts(spec.walls.w, spec.walls.h, spec.walls.d), at: [spec.walls.x, spec.walls.h / 2, spec.walls.z] });
  const roofY = wallTop + spec.roof.h / 2;
  parts.push({ name: 'Roof', color: 'roof', mesh: boxVerts(spec.roof.w, spec.roof.h, spec.roof.d), at: [spec.walls.x, roofY, spec.walls.z] });
  if (spec.garage) {
    parts.push({ name: 'Garage', color: 'garage', mesh: boxVerts(spec.garage.w, spec.garage.h, spec.garage.d), at: [spec.garage.x, spec.garage.h / 2, spec.garage.z] });
  }
  parts.push({ name: 'Battery', color: 'battery', mesh: boxVerts(spec.battery.w, spec.battery.h, spec.battery.d), at: [spec.battery.x, spec.battery.h / 2, spec.battery.z] });

  const bins = [];
  let byteLength = 0;
  const views = [];
  const accessors = [];
  const meshes = [];
  const nodes = [{ name: 'House', children: parts.map((_, i) => i + 1) }];

  function pushArray(array, target) {
    const offset = byteLength;
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    bins.push(bytes);
    const pad = (4 - (bytes.length % 4)) % 4;
    if (pad) bins.push(Buffer.alloc(pad));
    const viewIndex = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    byteLength += bytes.length + pad;
    return viewIndex;
  }

  parts.forEach((part) => {
    const pView = pushArray(part.mesh.pos, 34962);
    const nView = pushArray(part.mesh.nor, 34962);
    const iView = pushArray(part.mesh.idx, 34963);
    const pAcc = accessors.length;
    accessors.push({ bufferView: pView, componentType: 5126, count: part.mesh.pos.length / 3, type: 'VEC3', min: min3(part.mesh.pos), max: max3(part.mesh.pos) });
    const nAcc = accessors.length;
    accessors.push({ bufferView: nView, componentType: 5126, count: part.mesh.nor.length / 3, type: 'VEC3' });
    const iAcc = accessors.length;
    accessors.push({ bufferView: iView, componentType: 5123, count: part.mesh.idx.length, type: 'SCALAR' });
    const meshIndex = meshes.length;
    meshes.push({ primitives: [{ attributes: { POSITION: pAcc, NORMAL: nAcc }, indices: iAcc, material: COLORS[part.color] ? materialIndex(part.color) : 0 }] });
    nodes.push({ name: part.name, mesh: meshIndex, translation: part.at });
  });

  const materials = ['walls', 'roof', 'garage', 'battery'].map((key) => ({
    name: key,
    pbrMetallicRoughness: { baseColorFactor: COLORS[key], metallicFactor: 0, roughnessFactor: 0.85 },
    doubleSided: true,
  }));
  function materialIndex(key) { return ['walls', 'roof', 'garage', 'battery'].indexOf(key); }

  // materialIndex is used above before materials exist, but the function closes over the array order. Rebuild primitives now that the helper exists.
  meshes.forEach((mesh, i) => {
    mesh.primitives[0].material = materialIndex(parts[i].color);
  });

  const bin = Buffer.concat(bins);
  if (bin.length !== byteLength) throw new Error('buffer length drift');
  const json = {
    asset: {
      version: '2.0',
      generator: 'megawatt scripts/build-house-glb.js',
      extras: { preset: presetId, units: 'meters', up: 'Y', origin: 'ground center of the footprint', front: '+Z', batteryNode: 'Battery' },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20);
  const binPad = Buffer.alloc(pad4(bin.length) - bin.length, 0);
  const jsonChunk = Buffer.concat([jsonBuf, jsonPad]);
  const binChunk = Buffer.concat([bin, binPad]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jHead = Buffer.alloc(8);
  jHead.writeUInt32LE(jsonChunk.length, 0);
  jHead.write('JSON', 4);
  const bHead = Buffer.alloc(8);
  bHead.writeUInt32LE(binChunk.length, 0);
  bHead.write('BIN\0', 4);
  return Buffer.concat([header, jHead, jsonChunk, bHead, binChunk]);
}

function min3(arr) {
  let x = Infinity, y = Infinity, z = Infinity;
  for (let i = 0; i < arr.length; i += 3) { x = Math.min(x, arr[i]); y = Math.min(y, arr[i + 1]); z = Math.min(z, arr[i + 2]); }
  return [x, y, z];
}
function max3(arr) {
  let x = -Infinity, y = -Infinity, z = -Infinity;
  for (let i = 0; i < arr.length; i += 3) { x = Math.max(x, arr[i]); y = Math.max(y, arr[i + 1]); z = Math.max(z, arr[i + 2]); }
  return [x, y, z];
}

const outDir = path.join(__dirname, '..', 'models');
fs.mkdirSync(outDir, { recursive: true });
for (const id of Object.keys(PRESETS)) {
  const buf = build(id);
  const file = path.join(outDir, 'house-' + id + '.glb');
  fs.writeFileSync(file, buf);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const names = json.nodes.map((n) => n.name);
  if (!names.includes('Battery')) throw new Error(id + ' has no Battery node');
  console.log(file, buf.length, names.join(', '));
}
