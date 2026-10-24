#!/usr/bin/env node
/**
 * After png_to_glb: copy preview, POST metadata to Express.
 * Usage:
 *   node register_asset.mjs --id <uuid> --slug hero-billboard --glb path --preview path [--api http://127.0.0.1:8787]
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

const id = arg("id", randomUUID());
const slug = arg("slug", "hero-billboard");
const name = arg("name", slug);
const glbSrc = arg("glb");
const previewSrc = arg("preview");
const sourceSrc = arg("source");
const api = arg("api", "http://127.0.0.1:8787");
const hasArmature = flag("armature");
const hasWeights = flag("weights");

if (!glbSrc) {
  console.error("Usage: register_asset.mjs --glb <model.glb> [--slug …] [--preview …]");
  process.exit(1);
}

const assetDir = path.join(REPO, "data", "assets", id);
fs.mkdirSync(assetDir, { recursive: true });
const glbDest = path.join(assetDir, "model.glb");
fs.copyFileSync(path.resolve(glbSrc), glbDest);

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
  characterType: "billboard",
  stage: "mvp-billboard",
  tags: ["sprint1", "demo"],
  clips: ["spin"],
  formats: {
    glb: `assets/${id}/model.glb`,
    preview: previewDest ? `assets/${id}/preview.png` : `assets/${id}/model.glb`,
    sourcePng: (sourceSrc || previewSrc)
      ? path.relative(path.join(REPO, "data"), path.resolve(sourceSrc || previewSrc)).replace(/\\/g, "/")
      : undefined,
  },
  rig: {
    hasArmature: hasArmature,
    hasWeights: hasWeights,
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
console.log(`OK registered ${id} → ${glbDest}`);
