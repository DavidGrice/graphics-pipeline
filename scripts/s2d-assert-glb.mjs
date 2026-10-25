#!/usr/bin/env node
/**
 * S2-D-E4 — assert GLB clips / skins / weights from env keys.
 * Env: S2D_CLIP_EXPECT, S2D_EXPECT_ARMATURE, S2D_EXPECT_WEIGHTS, S2D_STAGE_EXPECT (informational)
 * Args: <path.glb>
 */
import fs from "node:fs";

const glbPath = process.argv[2];
if (!glbPath || !fs.existsSync(glbPath)) {
  console.error(`ERROR: GLB missing: ${glbPath ?? "(none)"}`);
  process.exit(1);
}

function probe(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 20 || buf.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("not a GLB");
  }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const clips = (json.animations || []).map((a) => a.name || "unnamed");
  const skins = json.skins || [];
  let hasWeights = false;
  for (const m of json.meshes || []) {
    for (const prim of m.primitives || []) {
      if (
        prim.attributes &&
        prim.attributes.JOINTS_0 != null &&
        prim.attributes.WEIGHTS_0 != null
      ) {
        hasWeights = true;
      }
    }
  }
  return {
    clips,
    hasArmature: skins.length > 0,
    hasWeights,
  };
}

const expectClips = (process.env.S2D_CLIP_EXPECT || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const expectArm = process.env.S2D_EXPECT_ARMATURE;
const expectW = process.env.S2D_EXPECT_WEIGHTS;
const stageExpect = process.env.S2D_STAGE_EXPECT || "";

if (!expectClips.length) {
  console.error("ERROR: S2D_CLIP_EXPECT required (comma-separated)");
  process.exit(1);
}
if (expectArm !== "0" && expectArm !== "1") {
  console.error("ERROR: S2D_EXPECT_ARMATURE must be 0 or 1");
  process.exit(1);
}
if (expectW !== "0" && expectW !== "1") {
  console.error("ERROR: S2D_EXPECT_WEIGHTS must be 0 or 1");
  process.exit(1);
}

const probed = probe(glbPath);
const missing = expectClips.filter((c) => !probed.clips.includes(c));
const errors = [];
if (missing.length) {
  errors.push(
    `missing clips ${missing.join(",")} (have ${JSON.stringify(probed.clips)})`,
  );
}
if (probed.hasArmature !== (expectArm === "1")) {
  errors.push(
    `armature expected=${expectArm} got=${probed.hasArmature ? 1 : 0}`,
  );
}
if (probed.hasWeights !== (expectW === "1")) {
  errors.push(`weights expected=${expectW} got=${probed.hasWeights ? 1 : 0}`);
}

// Soft stage derivation (matches register_asset probe rules for S2-D).
let stage = "mvp-billboard";
if (
  probed.hasArmature &&
  probed.hasWeights &&
  probed.clips.includes("idle") &&
  probed.clips.includes("walk") &&
  probed.clips.includes("run")
) {
  stage = "rigged";
} else if (probed.clips.includes("spin") || probed.clips.length > 0) {
  stage = "mvp-billboard";
}
if (stageExpect && stage !== stageExpect) {
  errors.push(`stage expected=${stageExpect} derived=${stage}`);
}

console.log(
  JSON.stringify({
    glbPath,
    probed,
    stage,
    stageExpect: stageExpect || null,
    SMOKE_MODE: process.env.SMOKE_MODE || process.env.MODE || null,
    BLENDER_BIN: process.env.BLENDER_BIN || null,
  }),
);

if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log("OK s2d-assert-glb");
