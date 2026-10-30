/**
 * GLB JSON-chunk probe helpers (S3-A unique joint count).
 */
import fs from "node:fs";

/** S3-D tip1.1 NIT-1 — stable code for unreadable GLBs (register_asset exits 5). */
export const GLB_CORRUPT = "GLB_CORRUPT";

/** Error with `.code = GLB_CORRUPT`; message never contains a filesystem path. */
export function glbCorrupt(reason) {
  const err = new Error(`${GLB_CORRUPT}: ${reason}`);
  err.code = GLB_CORRUPT;
  err.reason = reason;
  return err;
}

/** Minimal GLB JSON-chunk probe (no deps). Throws glbCorrupt(...) on bad/truncated input. */
export function probeGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "glTF") {
    throw glbCorrupt("bad magic (not a GLB)");
  }
  if (buf.length < 20) throw glbCorrupt(`truncated (${buf.length} bytes, no chunk header)`);
  if (buf.readUInt32LE(8) > buf.length) {
    throw glbCorrupt(`truncated (header length ${buf.readUInt32LE(8)} > ${buf.length} bytes)`);
  }
  let offset = 12;
  let jsonChunk = null;
  let binChunk = null;
  const total = buf.readUInt32LE(8);
  while (offset + 8 <= total && offset + 8 <= buf.length) {
    const clen = buf.readUInt32LE(offset);
    const ctype = buf.toString("utf8", offset + 4, offset + 8);
    offset += 8;
    const chunk = buf.subarray(offset, offset + clen);
    offset += clen;
    if (offset > buf.length) throw glbCorrupt(`truncated ${ctype.replace(/\0/g, "")} chunk`);
    if (ctype === "JSON" && !jsonChunk) {
      try {
        jsonChunk = JSON.parse(chunk.toString("utf8"));
      } catch {
        throw glbCorrupt("JSON chunk is not valid JSON");
      }
    } else if (ctype === "BIN\0" && !binChunk) {
      binChunk = chunk;
    }
  }
  if (!jsonChunk) throw glbCorrupt("missing JSON chunk");
  const animations = (jsonChunk.animations || []).map((a) => a.name || "unnamed");
  const skins = jsonChunk.skins || [];
  let hasWeights = false;
  for (const mesh of jsonChunk.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const attrs = prim.attributes || {};
      if (
        Object.keys(attrs).some(
          (k) => k.startsWith("JOINTS") || k.startsWith("WEIGHTS"),
        )
      ) {
        hasWeights = true;
      }
    }
  }
  // Unique joint names across skins (not duplicate skin joint indices).
  const nodes = jsonChunk.nodes || [];
  const jointNames = new Set();
  for (const skin of skins) {
    for (const jointIdx of skin.joints || []) {
      const node = nodes[jointIdx];
      const name =
        node && typeof node.name === "string" && node.name.length > 0
          ? node.name
          : `joint_${jointIdx}`;
      jointNames.add(name);
    }
  }
  // S3-B #8 — duration_ms from accessor max on animation sampler inputs
  const accessors = jsonChunk.accessors || [];
  /** @type {Record<string, number>} */
  const clipDurations = {};
  for (const anim of jsonChunk.animations || []) {
    let maxT = 0;
    for (const s of anim.samplers || []) {
      const acc = accessors[s.input];
      if (acc && Array.isArray(acc.max) && typeof acc.max[0] === "number") {
        maxT = Math.max(maxT, acc.max[0]);
      }
    }
    const name = anim.name || "unnamed";
    clipDurations[name] = Math.round(maxT * 1000);
  }

  return {
    clips: animations,
    hasArmature: skins.length > 0,
    armatureCount: countArmatures(jsonChunk),
    hasWeights,
    boneCount: jointNames.size,
    jointNames: [...jointNames],
    clipDurations,
    // S3-D #97 — per-clip motion stats; register picks the idle candidates (named/mapped idle)
    clipMotion: Object.fromEntries(animations.map((n) => [n, clipMotion(jsonChunk, binChunk, n)])),
  };
}

// ---------------------------------------------------------------------------
// S3-D #97 — static-pose (T-pose) idle detection. R1 §5 thresholds.
// ---------------------------------------------------------------------------
export const IDLE_TPOSE_SUSPECT = "IDLE_TPOSE_SUSPECT";
/** R1 rev2 §5: max per-bone rotation delta (degrees) below which idle counts as a static pose */
export const IDLE_MAX_ROT_DEG = 0.5;
/** R1 rev2 §5: max translation delta (scene units) below which idle counts as a static pose */
export const IDLE_MAX_POS = 1e-4;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const CT = {
  5126: { size: 4, read: (b, o) => b.readFloatLE(o) },
  5120: { size: 1, read: (b, o) => Math.max(b.readInt8(o) / 127, -1) },
  5121: { size: 1, read: (b, o) => b.readUInt8(o) / 255 },
  5122: { size: 2, read: (b, o) => Math.max(b.readInt16LE(o) / 32767, -1) },
  5123: { size: 2, read: (b, o) => b.readUInt16LE(o) / 65535 },
};

/** Read accessor as array of tuples from the GLB BIN chunk (buffer 0 only). null if unsupported. */
export function readAccessor(json, bin, index) {
  const acc = json?.accessors?.[index];
  if (!acc || !bin || acc.sparse) return null;
  const view = json.bufferViews?.[acc.bufferView];
  const comp = COMPONENTS[acc.type];
  const ct = CT[acc.componentType];
  if (!view || !comp || !ct || (view.buffer ?? 0) !== 0) return null;
  const elem = comp * ct.size;
  const stride = view.byteStride || elem;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  if (base + stride * (acc.count - 1) + elem > bin.length) return null;
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const t = [];
    for (let k = 0; k < comp; k++) t.push(ct.read(bin, base + i * stride + k * ct.size));
    out.push(t);
  }
  return out;
}

/** Angle (deg) between two quaternions [x,y,z,w]. */
export function quatAngleDeg(a, b) {
  const na = Math.hypot(...a) || 1;
  const nb = Math.hypot(...b) || 1;
  const dot = Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (na * nb));
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Max per-channel rotation (deg) and translation delta vs each channel's first key.
 * @returns {{ maxRotDeg: number, maxPosDelta: number, channels: number, static: boolean } | null}
 */
export function clipMotion(json, bin, clipName, thresholds = { rotDeg: IDLE_MAX_ROT_DEG, posDelta: IDLE_MAX_POS }) {
  const anim = (json?.animations || []).find((a) => (a.name || "unnamed") === clipName);
  if (!anim) return null;
  let maxRotDeg = 0;
  let maxPosDelta = 0;
  let channels = 0;
  for (const ch of anim.channels || []) {
    const pathName = ch?.target?.path;
    if (pathName !== "rotation" && pathName !== "translation") continue;
    const sampler = anim.samplers?.[ch.sampler];
    const vals = sampler ? readAccessor(json, bin, sampler.output) : null;
    if (!vals) return null; // unreadable → unknown, never a false "static"
    channels++;
    // CUBICSPLINE stores [inTangent, value, outTangent] triplets — compare values only.
    const keys = sampler.interpolation === "CUBICSPLINE" ? vals.filter((_, i) => i % 3 === 1) : vals;
    const k0 = keys[0];
    for (const k of keys) {
      if (pathName === "rotation") maxRotDeg = Math.max(maxRotDeg, quatAngleDeg(k0, k));
      else maxPosDelta = Math.max(maxPosDelta, ...k.map((v, i) => Math.abs(v - k0[i])));
    }
  }
  return {
    maxRotDeg: Number(maxRotDeg.toFixed(4)),
    maxPosDelta: Number(maxPosDelta.toExponential(3)),
    channels,
    static: maxRotDeg < thresholds.rotDeg && maxPosDelta < thresholds.posDelta,
  };
}

/** Count unique skin joint names from a glTF JSON chunk (S3-A #13). */
export function countUniqueSkinJoints(jsonChunk) {
  const skins = jsonChunk?.skins || [];
  const nodes = jsonChunk?.nodes || [];
  const jointNames = new Set();
  for (const skin of skins) {
    for (const jointIdx of skin.joints || []) {
      const node = nodes[jointIdx];
      const name =
        node && typeof node.name === "string" && node.name.length > 0
          ? node.name
          : `joint_${jointIdx}`;
      jointNames.add(name);
    }
  }
  return jointNames.size;
}


/** S3-C #19 named error code (also emitted by asset-schema refinement). */
export const MULTI_ARMATURE = "MULTI_ARMATURE";

/**
 * Count distinct armatures (skin roots) in a glTF JSON chunk (S3-C #19).
 * Root per skin = skin.skeleton if set, else the parent of the top-most joint
 * (Blender's Armature object node), else the top-most joint itself.
 * Multiple skins bound to the same armature count once.
 */
export function countArmatures(jsonChunk) {
  const skins = jsonChunk?.skins || [];
  const nodes = jsonChunk?.nodes || [];
  /** @type {Map<number, number>} child → parent */
  const parentOf = new Map();
  nodes.forEach((n, i) => {
    for (const c of n?.children || []) parentOf.set(c, i);
  });
  const roots = new Set();
  for (const skin of skins) {
    if (typeof skin.skeleton === "number") {
      roots.add(skin.skeleton);
      continue;
    }
    const joints = new Set(skin.joints || []);
    if (joints.size === 0) continue;
    // top-most joint(s): joints whose parent is not a joint of this skin
    for (const j of joints) {
      const p = parentOf.get(j);
      if (p === undefined || !joints.has(p)) {
        roots.add(p === undefined ? j : p);
      }
    }
  }
  return roots.size;
}

/** Throws Error(MULTI_ARMATURE: …) with .code when probe saw > 1 armature. */
export function assertSingleArmature(probed) {
  const n = probed?.armatureCount ?? 0;
  if (n > 1) {
    const err = new Error(`${MULTI_ARMATURE}: one armature per GLB (got ${n}) — split into separate GLBs`);
    err.code = MULTI_ARMATURE;
    throw err;
  }
}
