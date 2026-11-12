/**
 * S3-I #59 — vendored Draco decoder (ruling c): pinned to the `three` release in the lockfile and
 * checksummed. Copies three's own decoder (wasm + wrapper) into public/draco/ and refuses to serve
 * anything whose sha256 differs from public/draco/manifest.json. Never fetches a CDN.
 * Runs from vite (dev + build) via dracoVendorPlugin(); `node draco-vendor.mjs` runs it by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DRACO_DIR = path.join(HERE, "public", "draco");
export const MANIFEST_PATH = path.join(DRACO_DIR, "manifest.json");
export const DRACO_CHECKSUM = "DRACO_CHECKSUM";

const sha256 = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const fail = (msg) => Object.assign(new Error(`${DRACO_CHECKSUM}: ${msg}`), { code: DRACO_CHECKSUM });

export const readManifest = (p = MANIFEST_PATH) => JSON.parse(fs.readFileSync(p, "utf8"));

/** Locate the installed three package root (walks up from this folder; three's exports hide package.json). */
export function threeRoot(from = HERE) {
  for (let d = from; ; d = path.dirname(d)) {
    const c = path.join(d, "node_modules", "three");
    if (fs.existsSync(path.join(c, "package.json"))) return c;
    if (path.dirname(d) === d) throw fail("three is not installed (npm ci first)");
  }
}

/** Throws DRACO_CHECKSUM unless every manifest file in `dir` matches its pinned sha256. */
export function verifyDraco(dir = DRACO_DIR, manifest = readManifest()) {
  for (const [name, want] of Object.entries(manifest.files)) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) throw fail(`${name} missing in ${path.basename(dir)}/`);
    const got = sha256(p);
    if (got !== want) throw fail(`${name} sha256 ${got} != pinned ${want}`);
  }
  return Object.keys(manifest.files);
}

/** Copy the pinned decoder from three into `dir` (only when absent or stale), then verify. */
export function vendorDraco({ dir = DRACO_DIR, manifest = readManifest(), three = threeRoot() } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(three, "package.json"), "utf8")).version;
  if (version !== manifest.three) throw fail(`three ${version} installed, decoder pinned to ${manifest.three}`);
  const src = path.join(three, ...manifest.source.split("/").slice(1));
  verifyDraco(src, manifest);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, want] of Object.entries(manifest.files)) {
    const out = path.join(dir, name);
    if (!fs.existsSync(out) || sha256(out) !== want) fs.copyFileSync(path.join(src, name), out);
  }
  return verifyDraco(dir, manifest);
}

/** Vite plugin: vendor + verify before dev serve and before every build. */
export const dracoVendorPlugin = () => ({
  name: "gp-draco-vendor",
  buildStart() {
    vendorDraco();
  },
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`OK draco: ${vendorDraco().join(", ")} (three ${readManifest().three})`);
}
