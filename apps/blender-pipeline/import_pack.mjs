#!/usr/bin/env node
/**
 * S3-B #136 — Import pack zip (inverse of pack_assets).
 * Usage: node apps/blender-pipeline/import_pack.mjs --zip pack.zip [--force] [--outdir /tmp/gp-import]
 * Probe wins: re-probes each GLB. Default slug collision → reject.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { unzipStore } from "./zip_store.mjs";
import { probeGlb } from "./probe_glb.mjs";

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

const zipPath = arg("zip");
const api = arg("api", process.env.WORLD_API || "http://127.0.0.1:8787");
const force = flag("force");
const outdir = arg("outdir", path.join(os.tmpdir(), "gp-pack-import"));

if (!zipPath || !fs.existsSync(zipPath)) {
  console.error("Usage: import_pack.mjs --zip pack.zip [--force] [--outdir /tmp/...]");
  process.exit(1);
}

const entries = unzipStore(fs.readFileSync(zipPath));
for (const e of entries) {
  const n = e.name.replace(/\\/g, "/");
  if (n.includes("..") || path.isAbsolute(n) || n.startsWith("/")) {
    console.error(`Zip escape rejected: ${e.name}`);
    process.exit(1);
  }
}

const byName = Object.fromEntries(entries.map((e) => [e.name.replace(/\\/g, "/"), e]));
const packEntry = byName["pack.json"];
if (!packEntry) {
  console.error("pack.json missing");
  process.exit(1);
}
const pack = JSON.parse(packEntry.data.toString("utf8"));
if (pack.packSchemaVersion !== 1) {
  console.error(`Unknown packSchemaVersion ${pack.packSchemaVersion}`);
  process.exit(1);
}
if (!byName["LICENSE"]) {
  console.error("LICENSE file required in pack");
  process.exit(1);
}

fs.mkdirSync(outdir, { recursive: true });

let existing = [];
try {
  const r = await fetch(`${api}/api/assets`);
  if (r.ok) existing = await r.json();
} catch {
  console.warn("API down — collision check limited");
}

for (const meta of pack.assets || []) {
  const hit = existing.find((a) => a.slug === meta.slug);
  if (hit && !force) {
    console.error(`Slug collision "${meta.slug}" — pass --force to overwrite`);
    process.exit(1);
  }
  let probed = { clips: [], hasArmature: false, hasWeights: false, boneCount: 0, clipDurations: {} };
  let glbRel = meta.glb;
  if (glbRel) {
    const file = byName[glbRel];
    if (!file) {
      console.error(`Missing zip entry ${glbRel}`);
      process.exit(1);
    }
    const dest = path.join(outdir, path.basename(glbRel));
    fs.writeFileSync(dest, file.data);
    probed = probeGlb(dest);
    // Copy into data/assets for register if API up — use gitignored path
    const id = meta.id && force && hit ? hit.id : randomUUID();
    const assetDir = path.join(REPO, "data", "assets", id);
    fs.mkdirSync(assetDir, { recursive: true });
    const glbDest = path.join(assetDir, "model.glb");
    fs.copyFileSync(dest, glbDest);
    glbRel = `assets/${id}/model.glb`;

    const body = {
      id,
      slug: meta.slug,
      name: meta.name || meta.slug,
      characterType: meta.characterType || "unknown",
      stage: meta.stage || "mvp-billboard",
      tags: meta.tags || [],
      clips: probed.clips,
      clipDurations: probed.clipDurations,
      license: meta.license,
      importMeta: meta.importMeta,
      clipTags: meta.clipTags,
      clipUx: meta.clipUx,
      scene: meta.scene,
      formats: {
        glb: glbRel,
        preview: `assets/${id}/preview.png`,
      },
      rig: {
        hasArmature: probed.hasArmature,
        hasWeights: probed.hasWeights,
        boneCount: probed.boneCount,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Scene: trust graph but stage honesty via schema
    if (meta.stage === "scene") {
      body.clips = [];
      body.clipDurations = undefined;
      body.rig = { hasArmature: false, hasWeights: false };
      body.scene = meta.scene;
      body.formats = { preview: `assets/${id}/preview.png`, glb: glbRel };
    }
    const res = await fetch(`${api}/api/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Register failed ${meta.slug}: ${res.status} ${text}`);
      process.exit(1);
    }
    console.log(`Imported ${meta.slug} → ${id}`);
  } else if (meta.stage === "scene") {
    console.error(`Scene ${meta.slug} without supporting files — skip/fail`);
    process.exit(1);
  }
}
console.log("OK import complete");
