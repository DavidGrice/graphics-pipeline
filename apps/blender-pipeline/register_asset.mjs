#!/usr/bin/env node
/**
 * After png_to_glb / import_fbx: copy preview, probe GLB, POST metadata to Express.
 * Usage:
 *   node register_asset.mjs --id <uuid> --slug hero-billboard --glb path --preview path [--api http://127.0.0.1:8787]
 *   [--mode billboard|rigged]  (hint only — GLB probe wins for clips/rig)
 *   [--import-meta path.json]  (S2-D-E2 — include importMeta; probe still wins)
 * Exit codes: 0 ok · 1 validation/POST failure · 2 bad MAX_GLB_MB · 4 GLB_TOO_LARGE · 5 GLB_CORRUPT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { probeGlb, assertSingleArmature, IDLE_TPOSE_SUSPECT, GLB_CORRUPT } from "./probe_glb.mjs";
import { premultWarningForPng } from "./png_alpha.mjs";
import { parseMaxGlbMb, maxGlbBytes } from "@graphics-pipeline/asset-schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
// S3-D: WB_DATA_ROOT mirrors the API override (hermetic tests); default repo data/.
const DATA_DIR = process.env.WB_DATA_ROOT ? path.resolve(process.env.WB_DATA_ROOT) : path.join(REPO, "data");

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

// S3-D #76 — size cap BEFORE probe (probe reads the whole file). Exit 4 = GLB_TOO_LARGE.
{
  let mb;
  try {
    mb = parseMaxGlbMb(process.env.MAX_GLB_MB);
  } catch (err) {
    console.error(`ERROR ${err.message}`);
    process.exit(2);
  }
  const sizeBytes = fs.statSync(glbAbs).size;
  const maxBytes = maxGlbBytes(mb);
  if (sizeBytes > maxBytes) {
    console.error(`ERROR GLB_TOO_LARGE: ${sizeBytes} bytes > ${maxBytes} (MAX_GLB_MB=${mb}) — not probed, not registered`);
    process.exit(4);
  }
}

// S3-D tip1.1 NIT-1 — truncated / bad-magic / unparsable GLB → one clean line, exit 5.
let probed;
try {
  probed = probeGlb(glbAbs);
} catch (err) {
  const reason = err?.code === GLB_CORRUPT ? err.reason : "unreadable GLB";
  console.error(`ERROR ${GLB_CORRUPT}: ${path.basename(glbAbs)}: ${reason} — not registered`);
  process.exit(5);
}
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

// S3-D #49/#97 — warn-only findings → importMeta.warnings[] (never block register,
// except the existing humanoid gate when its only idle is a static pose).
/** @type {{ code: string, message?: string, detail?: Record<string, unknown>, clip?: string }[]} */
const warnings = [];
const pngForAlpha = sourceSrc || previewSrc;
if (pngForAlpha && fs.existsSync(pngForAlpha)) {
  const w = premultWarningForPng(path.resolve(pngForAlpha));
  if (w) {
    warnings.push(w);
    console.warn(`WARN ${w.code}: ${w.message}`);
  }
}
// #97 (R1 rev2 §5): idle candidates = clip named "idle" + actionMap sources mapped to idle.
const idleCandidates = new Set(probed.clips.includes("idle") ? ["idle"] : []);
for (const [src, dst] of Object.entries(importMeta?.actionMap ?? {})) {
  if (dst === "idle" && probed.clips.includes(src)) idleCandidates.add(src);
}
const tposeClips = [...idleCandidates].filter((c) => probed.clipMotion?.[c]?.static === true);
for (const c of tposeClips) {
  const m = probed.clipMotion[c];
  warnings.push({
    code: IDLE_TPOSE_SUSPECT,
    clip: c,
    message: `clip "${c}" looks like a static/T-pose idle (max bone rotation ${m.maxRotDeg}° < 0.5°) — excluded from the default idle slot`,
    detail: { maxRotDeg: m.maxRotDeg, maxPosDelta: m.maxPosDelta },
  });
  console.warn(`WARN ${IDLE_TPOSE_SUSPECT}: clip "${c}" max rotation ${m.maxRotDeg}°`);
}
const idleExcluded = tposeClips.length > 0;
// Existing S2-D humanoid gate: the idle slot must be filled by a non-T-pose clip.
if (characterType === "humanoid" && idleExcluded && [...idleCandidates].every((c) => tposeClips.includes(c))) {
  console.error(
    `ERROR: register validation failed:\n - characterType "humanoid" requires clips idle and walk (idle slot empty: ${IDLE_TPOSE_SUSPECT} on ${tposeClips.join(", ")})`,
  );
  process.exit(1);
}

const assetDir = path.join(DATA_DIR, "assets", id);
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
    // S3-D #141 — sourcePng is only recorded when it really lives under data/inbox
    sourcePng: (() => {
      const src = sourceSrc || previewSrc;
      if (!src || !fs.existsSync(src)) return undefined;
      const inboxDir = path.join(DATA_DIR, "inbox");
      if (!fs.existsSync(inboxDir)) return undefined;
      const inbox = fs.realpathSync(inboxDir);
      const real = fs.realpathSync(path.resolve(src));
      if (!real.startsWith(inbox + path.sep)) {
        console.warn("sourcePng omitted: source PNG is outside data/inbox");
        return undefined;
      }
      return `inbox/${path.relative(inbox, real).replace(/\\/g, "/")}`;
    })(),
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
if (warnings.length) {
  importMeta = importMeta ?? { source: pngForAlpha ? "png_pipeline" : "unknown" };
  importMeta.warnings = warnings;
}
if (idleExcluded) {
  // R1 §5: T-pose idle stays in clips but never fills the default / actionMap idle slot.
  if (tposeClips.includes("idle")) {
    const fallback = ["walk", ...probed.clips].find((c) => !tposeClips.includes(c) && probed.clips.includes(c));
    if (fallback) body.clipUx = { defaultClip: fallback };
  }
  if (importMeta?.actionMap) {
    for (const [src, dst] of Object.entries(importMeta.actionMap)) {
      if (dst === "idle" && tposeClips.includes(src)) delete importMeta.actionMap[src];
    }
  }
}
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
