/**
 * S3-D R1 §0 — stable error envelope for every 4xx/5xx JSON body.
 * Flat `{ code, error, ...extra }` (R1 rev2 §0):
 *   - `code`  UPPER_SNAKE (tests and the error card key on this)
 *   - `error` human text (kept as a string for back-compat with S1–S3-C clients)
 *   - extras are top-level structured fields (e.g. sizeBytes/maxBytes, refs, issues).
 * Error bodies never carry absolute filesystem paths (repo-relative `rel` only).
 */

/** Codes a schema issue message may carry as a `CODE:` prefix. */
const ISSUE_CODES = [
  "MULTI_ARMATURE",
  "SCENE_CAMERAS_MAX",
  "HUMANOID_BONE_COUNT",
  "ARMATURE_COUNT",
  "ALT_TEXT_TOO_LONG",
  // S3-E #41
  "SCENE_ROOT_DELETE",
  "SCENE_NO_LIVE_NODES",
];

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra] top-level structured fields
 */
export function sendError(res, status, code, message, extra) {
  return res.status(status).json({ ...capEcho(extra || {}), code, error: capQuoted(message) });
}

/** S3-H Leader ruling (D2) — 400 bodies may echo caller values, each capped at 200 characters. */
export const ECHO_MAX = 200;
/** S3-I CO-1 — first 20 items of every echoed array; not an env. */
export const ECHO_ITEMS_MAX = 20;
const capStr = (s) => (s.length > ECHO_MAX ? `${s.slice(0, ECHO_MAX - 1)}…` : s);
/** Deep-cap strings at 200 and arrays at ECHO_ITEMS_MAX. When items are dropped, a top-level
 *  object also gets `truncated` equal to the sum of drops (absent when nothing is dropped). */
export function capEcho(v, depth = 0, acc) {
  const own = !acc;
  const box = acc ?? { dropped: 0 };
  const out = capEchoWalk(v, depth, box);
  if (own && depth === 0 && box.dropped > 0 && out && typeof out === "object" && !Array.isArray(out)) {
    return { ...out, truncated: box.dropped };
  }
  return out;
}
function capEchoWalk(v, depth, box) {
  if (typeof v === "string") return capStr(v);
  if (!v || typeof v !== "object") return v;
  // S-I-1 — past depth 8 the walk stops, but nothing deeper is echoed raw: the value is dropped
  // (counted in `truncated` when it is a non-empty array, else replaced by null).
  if (depth > 8) {
    if (Array.isArray(v)) {
      box.dropped += v.length;
      return [];
    }
    return null;
  }
  if (Array.isArray(v)) {
    if (v.length > ECHO_ITEMS_MAX) box.dropped += v.length - ECHO_ITEMS_MAX;
    return v.slice(0, ECHO_ITEMS_MAX).map((x) => capEchoWalk(x, depth + 1, box));
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, capEchoWalk(x, depth + 1, box)]));
}
/** Cap quoted echoes inside human text (zod: "…, received '<value>'"); server text is untouched. */
export function capQuoted(m) {
  return typeof m === "string" ? m.replace(/'([^']{201,})'/g, (_, s) => `'${capStr(s)}'`) : m;
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
  // S3-G CO-3 — an importMeta failure names the first failing path as dotted text and never echoes the value
  const im = issues.find((i) => i?.path?.[0] === "importMeta");
  if (im) {
    const field = issueField(im.path);
    const clean = issues.map(({ received, ...rest }) => ({ ...rest, message: safeIssueMessage(rest) }));
    return sendError(res, 400, "VALIDATION", `${field}: ${safeIssueMessage(im)}`, { field, issues: clean });
  }
  const msg = issues.map((i) => i.message).join("; ");
  return sendError(res, 400, codeFromIssues(issues), msg, { issues });
}

/** `["importMeta","warnings",0,"code"]` → `importMeta.warnings[0].code`. */
export function issueField(p) {
  return p.reduce((acc, k) => (typeof k === "number" ? `${acc}[${k}]` : acc ? `${acc}.${k}` : String(k)), "");
}

/** Zod message without the received value (enum / type errors echo it). */
export function safeIssueMessage(i) {
  if (i.code === "invalid_enum_value") return `must be one of ${i.options.map((o) => JSON.stringify(o)).join(", ")}`;
  if (i.code === "invalid_type") return i.received === "undefined" ? "Required" : `expected ${i.expected}`;
  return String(i.message || "invalid");
}
