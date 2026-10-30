/**
 * S3-D R1 §0 — stable error envelope for every 4xx/5xx JSON body.
 * Flat `{ code, error, ...extra }` (R1 rev2 §0):
 *   - `code`  UPPER_SNAKE (tests and the error card key on this)
 *   - `error` human text (kept as a string for back-compat with S1–S3-C clients)
 *   - extras are top-level structured fields (e.g. sizeBytes/maxBytes, refs, issues).
 * Error bodies never carry absolute filesystem paths (repo-relative `rel` only).
 */

/** Codes a schema issue message may carry as a `CODE:` prefix. */
const ISSUE_CODES = ["MULTI_ARMATURE", "SCENE_CAMERAS_MAX", "HUMANOID_BONE_COUNT", "ARMATURE_COUNT"];

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra] top-level structured fields
 */
export function sendError(res, status, code, message, extra) {
  return res.status(status).json({ ...(extra || {}), code, error: message });
}

/** Fixed 500 text — details (fs errors carry absolute paths) go to the server log only. */
export const INTERNAL_MESSAGE = "internal error";

/**
 * 500 INTERNAL with a fixed body; logs code + route + the real error server-side.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {unknown} err
 */
export function sendInternal(req, res, err) {
  const route = `${req.method} ${req.route?.path ?? req.path}`;
  const e = /** @type {{ code?: unknown, stack?: unknown, message?: unknown }} */ (err ?? {});
  console.error(`[world-builder] INTERNAL ${route} code=${e.code ?? "-"}`, e.stack || e.message || err);
  if (res.headersSent) return;
  return sendError(res, 500, "INTERNAL", INTERNAL_MESSAGE);
}

/** Pick the most specific code from zod issues (named refinement codes win). */
export function codeFromIssues(issues) {
  for (const i of issues || []) {
    const msg = String(i?.message || "");
    for (const c of ISSUE_CODES) {
      if (msg.startsWith(`${c}:`) || msg.startsWith(c)) return c;
    }
  }
  return "VALIDATION";
}

/** 400 from a failed safeParse result. */
export function sendValidation(res, parsed) {
  const issues = parsed.error.issues;
  const msg = issues.map((i) => i.message).join("; ");
  return sendError(res, 400, codeFromIssues(issues), msg, { issues });
}
