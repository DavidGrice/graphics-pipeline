#!/usr/bin/env node
/**
 * S3-H #146 — `npm run restore -- <dir> [--force]`
 * Refuses non-empty WB_DATA_ROOT unless --force (exit 2 CONFIG_INVALID).
 * Verifies every sha256 before writing anything. Path escape / mismatch → exit 2, nothing written.
 * Never follows symlinks. No absolute paths in output.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const srcArg = args.find((a) => !a.startsWith("-"));
if (!srcArg) {
  console.error("usage: npm run restore -- <dir> [--force]");
  process.exit(2);
}

function die(msg) {
  console.error(`ERROR CONFIG_INVALID: ${msg}`);
  process.exit(2);
}

const backupRoot = path.resolve(srcArg);
const dataRoot = path.resolve(process.env.WB_DATA_ROOT || path.join(process.cwd(), "data"));
const manifestPath = path.join(backupRoot, "manifest.json");
if (!fs.existsSync(manifestPath)) die("manifest.json missing");

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  die("manifest.json unreadable");
}
if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.files)) die("manifest.json invalid");

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function isNonEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).some((n) => n !== "." && n !== "..");
  } catch {
    return false;
  }
}

if (isNonEmptyDir(dataRoot) && !force) {
  die("WB_DATA_ROOT is not empty (pass --force to overwrite)");
}

// Validate every entry before writing anything
const planned = [];
for (const f of manifest.files) {
  if (!f || typeof f.path !== "string" || typeof f.sha256 !== "string") die("manifest entry invalid");
  const rel = f.path.replace(/\\/g, "/");
  if (path.isAbsolute(rel) || rel.split("/").includes("..") || rel.startsWith("../") || rel.includes("\0")) {
    die("manifest path escapes root");
  }
  const src = path.join(backupRoot, rel);
  const resolved = path.resolve(src);
  if (!resolved.startsWith(path.resolve(backupRoot) + path.sep) && resolved !== path.resolve(backupRoot)) {
    die("manifest path escapes root");
  }
  if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink() || !fs.statSync(src).isFile()) {
    die(`missing file ${rel}`);
  }
  const hash = sha256File(src);
  if (hash !== f.sha256) die(`sha256 mismatch for ${rel}`);
  if (typeof f.bytes === "number" && fs.statSync(src).size !== f.bytes) die(`size mismatch for ${rel}`);
  planned.push({ rel, src });
}

// All good — write
fs.mkdirSync(dataRoot, { recursive: true });
for (const { rel, src } of planned) {
  const dst = path.join(dataRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
console.log(`restore: ${planned.length} files → data root`);
