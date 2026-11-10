#!/usr/bin/env node
/**
 * S3-H #146 — `npm run backup -- <dir>`
 * Copies WB_DATA_ROOT files (assets/, scenes/, activity*.jsonl) + optional Mongo export,
 * writes manifest.json {version:1, createdAt, files:[{path, sha256, bytes}]} with relative paths only.
 * Never follows symlinks. No absolute paths in output.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const destArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!destArg) {
  console.error("usage: npm run backup -- <dir>");
  process.exit(2);
}
const dataRoot = path.resolve(process.env.WB_DATA_ROOT || path.join(process.cwd(), "data"));
const destRoot = path.resolve(destArg);
fs.mkdirSync(destRoot, { recursive: true });

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

/** Walk without following symlinks; yields relative posix paths of regular files. */
function* walkFiles(root, rel = "") {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkFiles(root, childRel);
    else if (e.isFile()) yield childRel.replace(/\\/g, "/");
  }
}

const files = [];
const copyRel = (rel) => {
  const src = path.join(dataRoot, rel);
  const dst = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const st = fs.statSync(dst);
  files.push({ path: rel, sha256: sha256File(dst), bytes: st.size });
};

// assets/ + scenes/ trees
for (const top of ["assets", "scenes"]) {
  const abs = path.join(dataRoot, top);
  if (!fs.existsSync(abs) || fs.lstatSync(abs).isSymbolicLink()) continue;
  for (const rel of walkFiles(abs)) copyRel(`${top}/${rel}`);
}
// activity*.jsonl at data root
try {
  for (const e of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (e.isSymbolicLink() || !e.isFile()) continue;
    if (/^activity(\.\d+)?\.jsonl$/.test(e.name)) copyRel(e.name);
  }
} catch {
  /* empty root */
}

// Mongo export when mongodump available and MONGO_URI looks usable
const mongoUri = process.env.MONGO_URI || "";
if (mongoUri && !/127\.0\.0\.1:1\b/.test(mongoUri) && !/localhost:1\b/.test(mongoUri)) {
  const dumpDir = path.join(destRoot, "mongo");
  fs.mkdirSync(dumpDir, { recursive: true });
  const r = spawnSync("mongodump", [`--uri=${mongoUri}`, `--out=${dumpDir}`], { encoding: "utf8" });
  if (r.status === 0) {
    for (const rel of walkFiles(dumpDir)) {
      const full = path.join(dumpDir, rel);
      const st = fs.statSync(full);
      files.push({ path: `mongo/${rel}`.replace(/\\/g, "/"), sha256: sha256File(full), bytes: st.size });
    }
  }
}

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  files,
};
fs.writeFileSync(path.join(destRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`backup: ${files.length} files → ${destRoot}`);
