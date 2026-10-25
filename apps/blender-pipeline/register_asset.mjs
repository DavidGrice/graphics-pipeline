#!/usr/bin/env node
/**
 * After png_to_glb: copy preview, probe GLB, POST metadata to Express.
 * Usage:
 *   node register_asset.mjs --id <uuid> --slug hero-billboard --glb path --preview path [--api http://127.0.0.1:8787]
 *   [--mode billboard|rigged]  (hint only — GLB probe wins for clips/rig)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

/** Minimal GLB JSON-chunk probe (no deps). */
function probeGlb(filePath) {
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
  return {
    clips: animations,
    hasArmature: skins.length > 0,
    hasWeights,
  };
}

function validateProbed({ stage, clips, hasArmature, hasWeights, formatsGlb }) {
  const errors = [];
  if (stage === "rigged") {
    if (!clips.includes("idle") || !clips.includes("walk")) {
      errors.push('stage=rigged requires clips idle and walk');
    }
    if (!hasArmature || !hasWeights) {
      errors.push("stage=rigged requires hasArmature and hasWeights true");
    }
    if (!formatsGlb) {
      errors.push("stage=rigged requires formats.glb");
    }
  }
  if (stage === "mvp-billboard") {
    if (hasArmature || hasWeights) {
      errors.push("mvp-billboard must not claim armature/weights");
    }
  }
  if (clips.length > 0 && !formatsGlb) {
    errors.push("clips require formats.glb");
  }
  return errors;
}

const id = arg("id", randomUUID());
const slug = arg("slug", "hero-billboard");
const name = arg("name", slug);
const glbSrc = arg("glb");
const previewSrc = arg("preview");
const sourceSrc = arg("source");
const api = arg("api", "http://127.0.0.1:8787");
const modeHint = (arg("mode", process.env.MODE || process.env.SMOKE_MODE || "") || "")
  .trim()
  .toLowerCase();

if (!glbSrc) {
  console.error(
    "Usage: register_asset.mjs --glb <model.glb> [--slug …] [--preview …] [--mode billboard|rigged]",
  );
  process.exit(1);
}

const glbAbs = path.resolve(glbSrc);
if (!fs.existsSync(glbAbs)) {
  console.error(`ERROR: GLB not found: ${glbAbs}`);
  process.exit(1);
}

const probed = probeGlb(glbAbs);
console.log(
  `probe: clips=${JSON.stringify(probed.clips)} armature=${probed.hasArmature} weights=${probed.hasWeights}`,
);

// Derive stage from probe (caller --mode is hint only).
let stage = "mvp-billboard";
let characterType = "billboard";
if (
  probed.hasArmature &&
  probed.hasWeights &&
  probed.clips.includes("idle") &&
  probed.clips.includes("walk")
) {
  stage = "rigged";
  characterType = "prop";
} else if (modeHint === "rigged") {
  console.error(
    "ERROR: --mode=rigged but GLB probe missing armature/weights/idle/walk — refusing dishonest register",
  );
  process.exit(1);
} else if (probed.clips.includes("spin") || probed.clips.length > 0) {
  stage = "mvp-billboard";
  characterType = "billboard";
}

// Optional CLI overrides still fail-closed against probe.
if (flag("armature") && !probed.hasArmature) {
  console.error("ERROR: --armature set but GLB has no skins");
  process.exit(1);
}
if (flag("weights") && !probed.hasWeights) {
  console.error("ERROR: --weights set but GLB has no JOINTS/WEIGHTS");
  process.exit(1);
}

const errs = validateProbed({
  stage,
  clips: probed.clips,
  hasArmature: probed.hasArmature,
  hasWeights: probed.hasWeights,
  formatsGlb: true,
});
if (errs.length) {
  console.error("ERROR: register validation failed:\n - " + errs.join("\n - "));
  process.exit(1);
}

const assetDir = path.join(REPO, "data", "assets", id);
fs.mkdirSync(assetDir, { recursive: true });
const glbDest = path.join(assetDir, "model.glb");
fs.copyFileSync(glbAbs, glbDest);

let previewDest = path.join(assetDir, "preview.png");
if (previewSrc && fs.existsSync(previewSrc)) {
  fs.copyFileSync(path.resolve(previewSrc), previewDest);
} else if (previewSrc) {
  console.warn("preview missing, skipping copy");
  previewDest = null;
} else {
  previewDest = null;
}

const now = new Date().toISOString();
const body = {
  id,
  slug,
  name,
  characterType,
  stage,
  tags: ["sprint2c", stage],
  clips: probed.clips,
  formats: {
    glb: `assets/${id}/model.glb`,
    preview: previewDest
      ? `assets/${id}/preview.png`
      : `assets/${id}/model.glb`,
    sourcePng:
      sourceSrc || previewSrc
        ? path
            .relative(
              path.join(REPO, "data"),
              path.resolve(sourceSrc || previewSrc),
            )
            .replace(/\\/g, "/")
        : undefined,
  },
  rig: {
    hasArmature: probed.hasArmature,
    hasWeights: probed.hasWeights,
    blenderVersionTested: process.env.BLENDER_VERSION_TESTED || "5.2.3",
  },
  createdAt: now,
  updatedAt: now,
};

const res = await fetch(`${api}/api/assets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error("POST failed", res.status, text);
  process.exit(1);
}
console.log(text);
console.log(
  `OK registered ${id} stage=${stage} clips=${probed.clips.join(",")} → ${glbDest}`,
);
