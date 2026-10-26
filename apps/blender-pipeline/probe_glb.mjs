/**
 * GLB JSON-chunk probe helpers (S3-A unique joint count).
 */
import fs from "node:fs";

/** Minimal GLB JSON-chunk probe (no deps). */
export function probeGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 20 || buf.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(`not a GLB: ${filePath}`);
  }
  let offset = 12;
  let jsonChunk = null;
  const total = buf.readUInt32LE(8);
  while (offset + 8 <= total && offset + 8 <= buf.length) {
    const clen = buf.readUInt32LE(offset);
    const ctype = buf.toString("utf8", offset + 4, offset + 8);
    offset += 8;
    const chunk = buf.subarray(offset, offset + clen);
    offset += clen;
    if (ctype === "JSON") {
      jsonChunk = JSON.parse(chunk.toString("utf8"));
      break;
    }
  }
  if (!jsonChunk) throw new Error("GLB missing JSON chunk");
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
    hasWeights,
    boneCount: jointNames.size,
    jointNames: [...jointNames],
    clipDurations,
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

