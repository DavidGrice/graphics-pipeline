/**
 * S3-E #66 — per-asset timings.json (R1 §4). Fixed shape, integer ms, never in goldens/git:
 *   { "stages": { "export": ms|null, "probe": ms, "copy": ms, "register": ms },
 *     "totalMs": ms, "probeCache": "hit"|"miss"|"off"|null }
 * `export` is omitted when no matching pipeline sidecar exists.
 * pipeline.sh writes a per-GLB sidecar `<name>.timings.json` = { glb, sha256, stages: { export } };
 * register_asset.mjs uses its export ms only when BOTH the GLB name and sha256 match (tip1.1
 * ruling), then writes the full form as `timings.json` inside the asset dir (one asset per dir).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TIMING_STAGES = ["export", "probe", "copy", "register"];
export const TIMINGS_FILE = "timings.json";

const ms = (v) => (v == null ? null : Math.max(0, Math.round(v)));

export function buildTimings({ export: exp = null, probe, copy, register }, probeCache = null) {
  const stages = {
    ...(exp != null ? { export: ms(exp) } : {}),
    probe: ms(probe),
    copy: ms(copy),
    register: ms(register),
  };
  const totalMs = TIMING_STAGES.reduce((a, k) => a + (stages[k] ?? 0), 0);
  return { stages, totalMs, probeCache };
}

/** pipeline.sh sidecar for one exported GLB: `<dir>/<name>.timings.json` (name = basename − .glb). */
export function exportTimingsPath(glbAbs) {
  return path.join(path.dirname(glbAbs), `${path.basename(glbAbs).replace(/\.glb$/i, "")}.timings.json`);
}

/**
 * Export ms from the pipeline sidecar, only when its `glb` equals this GLB's file name AND its
 * `sha256` equals this GLB's bytes. Missing / malformed / mismatched → null (never trusted).
 * @param {string} glbAbs
 * @param {string} [glbSha] sha256 of glbAbs if already known (probe cache computed it)
 */
export function readExportMs(glbAbs, glbSha) {
  try {
    const j = JSON.parse(fs.readFileSync(exportTimingsPath(glbAbs), "utf8"));
    if (!j || j.glb !== path.basename(glbAbs) || typeof j.sha256 !== "string") return null;
    const sha = glbSha || crypto.createHash("sha256").update(fs.readFileSync(glbAbs)).digest("hex");
    if (j.sha256 !== sha) return null;
    const v = j?.stages?.export;
    return Number.isInteger(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeTimings(dir, timings) {
  const f = path.join(dir, TIMINGS_FILE);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(timings) + "\n");
  fs.renameSync(tmp, f);
  return f;
}
