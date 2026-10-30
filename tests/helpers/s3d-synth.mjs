/**
 * S3-D test helpers — synthesize PNG/GLB bytes in memory (no media in git) and run a
 * private, hermetic world-builder API (tmp WB_DATA_ROOT, in-memory store, free port).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA8 PNG from a pixel callback (x,y) → [r,g,b,a]. Uses filter type 1 (Sub) on odd rows. */
export function makePng(width, height, px) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const raw = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) raw.set(px(x, y), x * 4);
    if (y % 2 === 1) {
      const f = Buffer.alloc(width * 4);
      for (let i = 0; i < f.length; i++) f[i] = (raw[i] - (i >= 4 ? raw[i - 4] : 0)) & 0xff;
      rows.push(Buffer.from([1]), f);
    } else rows.push(Buffer.from([0]), raw);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- GLB ----------
function quatY(deg) {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}
/**
 * Minimal skinned GLB: armature node 0 → joint chain 1..bones; JOINTS_0/WEIGHTS_0 attributes;
 * each clip rotates joint 1 about Y from 0° to `clips[name]` degrees over 1s.
 * @param {{ bones?: number, clips?: Record<string, number> }} o
 */
export function makeRiggedGlb({ bones = 2, clips = { idle: 8, walk: 10, run: 10 } } = {}) {
  const bin = [];
  let byteLen = 0;
  const bufferViews = [];
  const accessors = [];
  const pushFloats = (arr, type, count, minmax) => {
    const b = Buffer.alloc(arr.length * 4);
    arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
    bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: b.length });
    bin.push(b);
    byteLen += b.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type, ...(minmax || {}) });
    return accessors.length - 1;
  };
  const times = pushFloats([0, 1], "SCALAR", 2, { min: [0], max: [1] });
  const pos = pushFloats([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", 3, { min: [0, 0, 0], max: [1, 1, 0] });
  // renderable skin attributes (three.js SkinnedMesh): JOINTS_0 u16 VEC4 → bone 0, WEIGHTS_0 VEC4 = 1
  const jointsBuf = Buffer.alloc(3 * 4 * 2);
  bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: jointsBuf.length });
  bin.push(jointsBuf);
  byteLen += jointsBuf.length;
  accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: 3, type: "VEC4" });
  const joints = accessors.length - 1;
  const weights = pushFloats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4", 3);
  const animations = Object.entries(clips).map(([name, deg]) => {
    const out = pushFloats([...quatY(0), ...quatY(deg)], "VEC4", 2);
    return {
      name,
      samplers: [{ input: times, output: out, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
    };
  });
  const nodes = [{ name: "Armature", children: [1, bones + 1] }];
  for (let j = 1; j <= bones; j++) nodes.push({ name: `bone_${j}`, ...(j < bones ? { children: [j + 1] } : {}) });
  nodes.push({ name: "Body", mesh: 0, skin: 0 });
  const json = {
    asset: { version: "2.0", generator: "s3d-synth" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: pos, JOINTS_0: joints, WEIGHTS_0: weights } }] }],
    skins: [{ joints: Array.from({ length: bones }, (_, i) => i + 1) }],
    animations,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteLen }],
  };
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binBuf = pad(Buffer.concat(bin), 0);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.write(type, 4, "latin1");
    return b;
  };
  return Buffer.concat([header, ch(jsonBuf.length, "JSON"), jsonBuf, ch(binBuf.length, "BIN\0"), binBuf]);
}

// ---------- private API ----------
export async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export function tmpDataRoot(prefix = "s3d-data-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "inbox"), { recursive: true });
  return dir;
}

/**
 * Start a hermetic API. Returns { url, dataRoot, stop }. Mongo is forced off (memory store).
 * @param {Record<string,string>} [env]
 */
export async function startApi(env = {}) {
  const port = await freePort();
  const dataRoot = env.WB_DATA_ROOT || tmpDataRoot();
  const child = spawn(process.execPath, [path.join(ROOT, "apps/world-builder/server/src/index.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      WB_DATA_ROOT: dataRoot,
      MONGO_URI: "mongodb://127.0.0.1:1",
      KRITA_HEALTH_MODE: "off",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`API exited ${child.exitCode}: ${log}`);
    try {
      const r = await fetch(`${url}/api/assets`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`API did not start: ${log}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    dataRoot,
    log: () => log,
    stop: async () => {
      if (child.exitCode == null) {
        child.kill();
        await new Promise((r) => child.once("exit", r));
      }
      if (!env.WB_DATA_ROOT) fs.rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

/** Minimal valid billboard asset body for POST. */
export function billboardBody(id, slug, formats = {}) {
  const now = "2026-10-30T20:00:00.000Z";
  return {
    id,
    slug,
    name: slug,
    characterType: "billboard",
    stage: "mvp-billboard",
    tags: [],
    clips: [],
    formats: { glb: `assets/${id}/model.glb`, preview: `assets/${id}/model.glb`, ...formats },
    rig: { hasArmature: false, hasWeights: false },
    license: "MIT",
    createdAt: now,
    updatedAt: now,
  };
}

/** Transpile a client TS module (no JSX) and import it. */
export async function loadClientTs(rel) {
  const ts = createRequire(import.meta.url)("typescript");
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3d-ts-"));
  const mod = path.join(dir, path.basename(rel).replace(/\.tsx?$/, ".mjs"));
  fs.writeFileSync(mod, out);
  try {
    return await import(pathToFileURL(mod).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Browser gate shared by S3-D UI checks: returns { chromium, exe, UI, API } or a SKIP_* reason.
 * Every skip reason starts with a SKIP_* code (#104).
 */
export function browserEnv() {
  const UI = process.env.UI_URL;
  if (!UI) return { skip: "SKIP_NO_UI_URL: set UI_URL (vite) + WORLD_API for the browser check" };
  let chromium;
  try {
    ({ chromium } = createRequire(path.join(process.env.PLAYWRIGHT_CORE_DIR || ROOT, "/"))("playwright-core"));
  } catch {
    return { skip: "SKIP_PLATFORM: playwright-core not resolvable (set PLAYWRIGHT_CORE_DIR)" };
  }
  const exe = process.env.CHROME_BIN || "/usr/bin/google-chrome";
  if (!fs.existsSync(exe)) return { skip: `SKIP_PLATFORM: Chrome not found at ${exe}` };
  return { chromium, exe, UI, API: process.env.WORLD_API || "http://127.0.0.1:8787" };
}

export const CHROME_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"];

/** Unique-per-run UUID derived from a tag (tests must never reuse a slug with a new id: #127). */
const RUN_SALT = `${process.pid}-${Date.now()}`;
export function runId(tag) {
  const h = createHash("sha1").update(`${RUN_SALT}:${tag}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
