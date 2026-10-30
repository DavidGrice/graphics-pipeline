/**
 * S3-E #66 — per-asset timings.json (R1 §4). Fixed shape, integer ms, never in goldens/git:
 *   { "stages": { "export": ms|null, "probe": ms, "copy": ms, "register": ms },
 *     "totalMs": ms, "probeCache": "hit"|"miss"|"off"|null }
 * pipeline.sh writes the export-only form beside its GLB; register_asset.mjs fills the rest.
 */
import fs from "node:fs";
import path from "node:path";

export const TIMING_STAGES = ["export", "probe", "copy", "register"];
export const TIMINGS_FILE = "timings.json";

const ms = (v) => (v == null ? null : Math.max(0, Math.round(v)));

export function buildTimings({ export: exp = null, probe, copy, register }, probeCache = null) {
  const stages = { export: ms(exp), probe: ms(probe), copy: ms(copy), register: ms(register) };
  const totalMs = TIMING_STAGES.reduce((a, k) => a + (stages[k] ?? 0), 0);
  return { stages, totalMs, probeCache };
}

/**
 * Export ms from pipeline.sh's timings.json beside `glbAbs`, only when it is at least as new as
 * the GLB (a stale file from an earlier export is ignored). Malformed → null (never trusted).
 */
export function readExportMs(glbAbs) {
  const f = path.join(path.dirname(glbAbs), TIMINGS_FILE);
  try {
    if (fs.statSync(f).mtimeMs + 1000 < fs.statSync(glbAbs).mtimeMs) return null;
    const v = JSON.parse(fs.readFileSync(f, "utf8"))?.stages?.export;
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
