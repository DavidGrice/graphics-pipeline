#!/usr/bin/env node
/**
 * S3-B #135 — Export asset pack zip (pack.json + LICENSE + assets/<slug>.glb).
 * Usage:
 *   node apps/blender-pipeline/pack_assets.mjs --out pack.zip --slug hero --slug npc
 *   node apps/blender-pipeline/pack_assets.mjs --out pack.zip --id <uuid>
 * Requires world-builder API (default http://127.0.0.1:8787) OR --from-dir data/assets (offline).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./zip_store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");

function argsAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === `--${name}` && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
      out.push(process.argv[++i]);
    } else if (a.startsWith(`--${name}=`)) out.push(a.slice(name.length + 3));
  }
  return out;
}
function arg(name, fallback) {
  const all = argsAll(name);
  return all[0] ?? fallback;
}

const outPath = arg("out");
const slugs = argsAll("slug");
const ids = argsAll("id");
const api = arg("api", process.env.WORLD_API || "http://127.0.0.1:8787");
const packLicense = arg("pack-license", "MIT");

if (!outPath) {
  console.error("Usage: pack_assets.mjs --out pack.zip (--slug s | --id uuid)+");
  process.exit(1);
}
if (!slugs.length && !ids.length) {
  console.error("Empty selection — pass --slug and/or --id");
  process.exit(1);
}

async function loadAssets() {
  try {
    const r = await fetch(`${api}/api/assets`);
    if (!r.ok) throw new Error(`API ${r.status}`);
    return await r.json();
  } catch (err) {
    console.error(`API unavailable (${err.message}); cannot export without register list`);
    process.exit(1);
  }
}

function resolveGlb(asset) {
  const rel = asset.formats?.glb;
  if (!rel) return null;
  const abs = path.join(DATA, rel.replace(/^data\//, ""));
  return fs.existsSync(abs) ? abs : null;
}

const list = await loadAssets();
const selected = [];
for (const a of list) {
  if (ids.includes(a.id) || slugs.includes(a.slug)) selected.push(a);
}
if (!selected.length) {
  console.error("No matching assets for selection");
  process.exit(1);
}

const files = [];
const manifestAssets = [];
for (const a of selected) {
  if (a.stage === "scene") {
    const childIds = (a.scene?.nodes || []).map((n) => n.assetId);
    const missing = childIds.filter(
      (cid) => !selected.some((s) => s.id === cid || s.slug === cid),
    );
    if (missing.length) {
      console.error(
        `Scene "${a.slug}" rejected: children not all selected: ${missing.join(",")}`,
      );
      process.exit(1);
    }
  }
  const glbAbs = resolveGlb(a);
  if (!glbAbs && a.stage !== "scene") {
    console.error(`Missing GLB for ${a.slug}`);
    process.exit(1);
  }
  const glbRel = glbAbs ? `assets/${a.slug}.glb` : undefined;
  if (glbAbs) {
    files.push({ name: glbRel, data: fs.readFileSync(glbAbs) });
  }
  const entry = {
    slug: a.slug,
    name: a.name,
    stage: a.stage,
    characterType: a.characterType,
    license: a.license,
    glb: glbRel,
    assetSchemaVersion: a.assetSchemaVersion,
  };
  if (a.stage === "scene" && a.scene) entry.scene = a.scene;
  if (a.clipDurations) entry.clipDurations = a.clipDurations;
  if (a.importMeta) entry.importMeta = a.importMeta;
  if (a.tags) entry.tags = a.tags;
  if (a.clips) entry.clips = a.clips;
  if (a.rig) entry.rig = a.rig;
  if (a.clipTags) entry.clipTags = a.clipTags;
  if (a.clipRequires) entry.clipRequires = a.clipRequires; // S3-F #11
  if (a.clipUx) entry.clipUx = a.clipUx;
  if (a.formats) entry.formats = { ...a.formats, glb: glbRel };
  if (a.id) entry.id = a.id;
  manifestAssets.push(entry);
}

const packJson = {
  packSchemaVersion: 1,
  createdAt: new Date().toISOString(),
  license: packLicense,
  assets: manifestAssets,
};

files.push({
  name: "pack.json",
  data: Buffer.from(JSON.stringify(packJson, null, 2) + "\n", "utf8"),
});
files.push({
  name: "LICENSE",
  data: Buffer.from(`${packLicense}\n`, "utf8"),
});

// Deterministic order
files.sort((a, b) => a.name.localeCompare(b.name));
const zip = zipStore(files);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, zip);
console.log(`OK packed ${manifestAssets.length} assets → ${outPath} (${zip.length} bytes)`);
