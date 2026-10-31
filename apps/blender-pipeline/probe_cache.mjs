/**
 * S3-E #134 — content-addressed probe cache (R1 §3, D2 §3).
 * key   = sha256(GLB bytes) + PROBE_VERSION
 * value = the probeGlb() result (clips, rig flags, clipDurations, clipMotion, armatureCount …)
 * where = DATA_ROOT/cache/probe/<sha256>.json via resolveUnder (gitignored), tmp + rename.
 * Entries are never trusted: unparsable / schema-invalid / version- or sha-mismatched → re-probe
 * and overwrite. Only successful single-armature probes are written (GLB_CORRUPT and
 * MULTI_ARMATURE are re-evaluated every time). PROBE_CACHE=0 disables read and write.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { probeGlb } from "./probe_glb.mjs";
import { resolveUnder } from "../world-builder/server/src/pathGuard.js";

/** Bump whenever probeGlb()'s output shape or semantics change. */
export const PROBE_VERSION = 1;

/** PROBE_CACHE: unset/""/1 → on, 0 → off, anything else → CONFIG_INVALID (fail-closed). */
export function probeCacheEnabled(env = process.env) {
  const v = String(env.PROBE_CACHE ?? "").trim();
  if (v === "" || v === "1") return true;
  if (v === "0") return false;
  const err = new Error("CONFIG_INVALID: PROBE_CACHE must be 0 or 1");
  err.code = "CONFIG_INVALID";
  throw err;
}

export function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;

/** Strict shape check of a cached probe — anything off means "miss". */
export function validProbe(p) {
  if (!isObj(p)) return false;
  if (!Array.isArray(p.clips) || !p.clips.every((c) => typeof c === "string")) return false;
  if (typeof p.hasArmature !== "boolean" || typeof p.hasWeights !== "boolean") return false;
  if (!isInt(p.boneCount) || !isInt(p.armatureCount) || p.armatureCount > 1) return false;
  if (!Array.isArray(p.jointNames) || !p.jointNames.every((c) => typeof c === "string")) return false;
  if (!isObj(p.clipDurations) || !Object.values(p.clipDurations).every(isInt)) return false;
  if (!isObj(p.clipMotion)) return false;
  for (const c of p.clips) {
    if (!isInt(p.clipDurations[c])) return false;
    const m = p.clipMotion[c];
    if (m !== null && (!isObj(m) || typeof m.static !== "boolean")) return false;
  }
  return true;
}

function entryPath(dataRoot, sha) {
  return resolveUnder(dataRoot, `cache/probe/${sha}.json`);
}

function readEntry(file, sha) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isObj(j) || j.probeVersion !== PROBE_VERSION || j.sha256 !== sha || !validProbe(j.probe)) return null;
    return j.probe;
  } catch {
    return null;
  }
}

function writeEntry(file, sha, probe) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ probeVersion: PROBE_VERSION, sha256: sha, probe }) + "\n");
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Probe through the cache. Throws whatever probeGlb throws (GLB_CORRUPT …) — nothing cached then.
 * @returns {{ probed: object, probeCache: "hit"|"miss"|"off", sha256: string|null }}
 */
export function cachedProbe(glbAbs, { dataRoot, env = process.env, probe = probeGlb } = {}) {
  if (!probeCacheEnabled(env)) return { probed: probe(glbAbs), probeCache: "off", sha256: null };
  const sha = sha256File(glbAbs);
  let file = null;
  try {
    file = entryPath(dataRoot, sha);
  } catch {
    file = null; // containment failure → behave as uncached, never write outside DATA_ROOT
  }
  if (file && fs.existsSync(file)) {
    const hit = readEntry(file, sha);
    if (hit) return { probed: hit, probeCache: "hit", sha256: sha };
  }
  const probed = probe(glbAbs);
  if (file && (probed?.armatureCount ?? 0) <= 1 && validProbe(probed)) {
    try {
      writeEntry(file, sha, probed);
    } catch (err) {
      console.warn(`WARN probe cache write skipped: ${err?.code || "write failed"}`);
    }
  }
  return { probed, probeCache: "miss", sha256: sha };
}
