/**
 * S3-H #133 — worker_threads entry for probeGlb (no shared state).
 * Parent posts `{ id, filePath }`; reply `{ id, ok, probed }` or `{ id, ok:false, code, message, reason? }`.
 */
import { parentPort } from "node:worker_threads";
import { probeGlb, GLB_CORRUPT } from "./probe_glb.mjs";

parentPort.on("message", ({ id, filePath }) => {
  try {
    const probed = probeGlb(filePath);
    parentPort.postMessage({ id, ok: true, probed });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      code: err?.code || GLB_CORRUPT,
      message: err?.message || String(err),
      reason: err?.reason,
    });
  }
});
