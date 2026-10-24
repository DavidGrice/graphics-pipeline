#!/usr/bin/env node
/**
 * DEMO ONLY — minimal glTF 2.0 binary (.glb) with a plane mesh + "spin" animation.
 * Used when Blender is not on PATH. Production path: png_to_glb.py via Blender.
 *
 * No three.js / DOM required.
 */
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node make_demo_glb.mjs <out.glb>");
  process.exit(1);
}

// Unit plane (XY), two triangles
const positions = new Float32Array([
  -0.5, -0.5, 0,  0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0,
]);
const normals = new Float32Array([
  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
]);
const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

// spin: rotation Y 0 → 90° as quaternion keyframes (times in seconds)
// q = [x,y,z,w]; Y rot θ → (0, sin(θ/2), 0, cos(θ/2))
const t0 = 0;
const t1 = 40 / 24; // match bpy frame 40 @ 24fps
const half = Math.PI / 4; // 90° / 2
const quat = new Float32Array([
  0, 0, 0, 1,
  0, Math.sin(half), 0, Math.cos(half),
]);
const times = new Float32Array([t0, t1]);

function align4(n) {
  return (n + 3) & ~3;
}

function concatBuffers(parts) {
  const total = parts.reduce((s, p) => s + align4(p.byteLength), 0);
  const buf = new ArrayBuffer(total);
  const view = new Uint8Array(buf);
  const offsets = [];
  let o = 0;
  for (const p of parts) {
    offsets.push(o);
    view.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o);
    o = align4(o + p.byteLength);
  }
  return { buf, offsets, total };
}

const { buf: binBuf, offsets, total: binLen } = concatBuffers([
  indices,
  positions,
  normals,
  uvs,
  times,
  quat,
]);

const [
  offIdx,
  offPos,
  offNrm,
  offUv,
  offTime,
  offQuat,
] = offsets;

const gltf = {
  asset: { version: "2.0", generator: "graphics-pipeline/make_demo_glb (DEMO)" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    {
      name: "BillboardPlane",
      mesh: 0,
      rotation: [0, 0, 0, 1],
    },
  ],
  meshes: [
    {
      name: "Plane",
      primitives: [
        {
          attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
          indices: 0,
          mode: 4,
        },
      ],
    },
  ],
  animations: [
    {
      name: "spin",
      channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
      samplers: [{ input: 4, interpolation: "LINEAR", output: 5 }],
    },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5123,
      count: 6,
      type: "SCALAR",
      max: [3],
      min: [0],
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 4,
      type: "VEC3",
      max: [0.5, 0.5, 0],
      min: [-0.5, -0.5, 0],
    },
    {
      bufferView: 2,
      componentType: 5126,
      count: 4,
      type: "VEC3",
      max: [0, 0, 1],
      min: [0, 0, 1],
    },
    {
      bufferView: 3,
      componentType: 5126,
      count: 4,
      type: "VEC2",
    },
    {
      bufferView: 4,
      componentType: 5126,
      count: 2,
      type: "SCALAR",
      max: [t1],
      min: [0],
    },
    {
      bufferView: 5,
      componentType: 5126,
      count: 2,
      type: "VEC4",
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: offIdx, byteLength: indices.byteLength, target: 34963 },
    { buffer: 0, byteOffset: offPos, byteLength: positions.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offNrm, byteLength: normals.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offUv, byteLength: uvs.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offTime, byteLength: times.byteLength },
    { buffer: 0, byteOffset: offQuat, byteLength: quat.byteLength },
  ],
  buffers: [{ byteLength: binLen }],
};

const json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (json.length % 4)) % 4;
const jsonChunk = Buffer.concat([
  json,
  Buffer.alloc(jsonPad, 0x20), // spaces
]);
const binPad = (4 - (binLen % 4)) % 4;
const binChunk = Buffer.concat([
  Buffer.from(binBuf),
  Buffer.alloc(binPad, 0),
]);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // BIN\0

const totalLength =
  12 + jsonHeader.length + jsonChunk.length + binHeader.length + binChunk.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);

const glb = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, glb);
console.log(`OK DEMO GLB wrote ${out} (${glb.length} bytes, Action=spin)`);
console.log("NOTE: replace with blender png_to_glb.py for production MVP.");
