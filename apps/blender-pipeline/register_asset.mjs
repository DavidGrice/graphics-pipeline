#!/usr/bin/env node
/**
 * After png_to_glb / import_fbx: copy preview, probe GLB, POST metadata to Express.
 * Usage:
 *   node register_asset.mjs --id <uuid> --slug hero-billboard --glb path --preview path [--api http://127.0.0.1:8787]
 *   [--mode billboard|rigged]  (hint only — GLB probe wins for clips/rig)
 *   [--import-meta path.json]  (S2-D-E2 — include importMeta; probe still wins)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { probeGlb, assertSingleArmature } from "./probe_glb.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

function arg(name, fallback) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

function validateProbed({ stage, clips, hasArmature, hasWeights, formatsGlb }) {
  const errors = [];
  if (stage === "rigged") {
    if (!clips.includes("idle") || !clips.includes("walk") || !clips.includes("run")) {
      errors.push('stage=rigged requires clips idle, walk, and run');
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

/** Strip fields that are not part of ImportMetaSchema before POST. */
function sanitizeImportMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (typeof raw.source === "string") out.source = raw.source;
  if (typeof raw.originalFilename === "string") {
    out.originalFilename = raw.originalFilename;
  }
  if (raw.actionMap && typeof raw.actionMap === "object") {
    out.actionMap = { ...raw.actionMap };
  }
  if (typeof raw.boneMapStub === "string") out.boneMapStub = raw.boneMapStub;
  if (typeof raw.characterTypeHint === "string") {
    out.characterTypeHint = raw.characterTypeHint;
  }
  if (typeof raw.humanoidPngApproved === "boolean") {
    out.humanoidPngApproved = raw.humanoidPngApproved;
  }
  if (!out.source) return null;
  return out;
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
const importMetaPath = arg("import-meta", "");

if (!glbSrc) {
  console.error(
    "Usage: register_asset.mjs --glb <model.glb> [--slug …] [--preview …] [--mode billboard|rigged] [--import-meta path.json]",
  );
  process.exit(1);
}

const glbAbs = path.resolve(glbSrc);
if (!fs.existsSync(glbAbs)) {
  console.error(`ERROR: GLB not found: ${glbAbs}`);
  process.exit(1);
}

let importMeta = null;
if (importMetaPath) {
  const metaAbs = path.resolve(importMetaPath);
  if (!fs.existsSync(metaAbs)) {
    console.error(`ERROR: --import-meta not found: ${metaAbs}`);
    process.exit(1);
  }
  try {
    importMeta = sanitizeImportMeta(JSON.parse(fs.readFileSync(metaAbs, "utf8")));
  } catch (err) {
    console.error(`ERROR: failed to parse --import-meta: ${err}`);
    process.exit(1);
  }
  if (!importMeta) {
    console.error("ERROR: --import-meta missing required source field");
    process.exit(1);
  }
}

const probed = probeGlb(glbAbs);
console.log(
  `probe: clips=${JSON.stringify(probed.clips)} armature=${probed.hasArmature} weights=${probed.hasWeights} boneCount=${probed.boneCount}`,
);

// S3-C #19: one armature per GLB — reject before any copy/POST.
try {
  assertSingleArmature(probed);
} catch (err) {
  console.error(`ERROR ${err.message}`);
  process.exit(1);
}

// Derive stage from probe (caller --mode is hint only).
let stage = "mvp-billboard";
let characterType = "billboard";
const riggedGates =
  probed.hasArmature &&
  probed.hasWeights &&
  probed.clips.includes("idle") &&
  probed.clips.includes("walk") &&
  probed.clips.includes("run");

if (riggedGates) {
  stage = "rigged";
  // PNG path stays prop/billboard; Mixamo/FBX may claim humanoid when gates ok.
  const src = importMeta?.source;
  if (src === "mixamo" || src === "fbx") {
    characterType = "humanoid";
  } else if (importMeta?.humanoidPngApproved === true) {
    characterType = "humanoid";
  } else {
    characterType = "prop";
  }
} else if (modeHint === "rigged") {
  console.error(
    "ERROR: --mode=rigged but GLB probe missing armature/weights/idle/walk/run — refusing dishonest register",
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
  tags: ["sprint2d", stage],
  clips: probed.clips,
  clipDurations: probed.clipDurations,
  license: arg("license", "MIT"),
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
    boneCount: probed.boneCount,
    armatureCount: probed.armatureCount,
    blenderVersionTested: process.env.BLENDER_VERSION_TESTED || "5.2.3",
  },
  createdAt: now,
  updatedAt: now,
};
if (importMeta) {
  body.importMeta = importMeta;
}

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
  `OK registered ${id} stage=${stage} characterType=${characterType} clips=${probed.clips.join(",")} → ${glbDest}`,
);
