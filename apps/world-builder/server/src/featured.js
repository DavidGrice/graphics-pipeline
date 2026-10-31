/**
 * S3-F #140 (R1 + D2) — featured scene playlist at <DATA_ROOT>/featured.json `{sceneIds}`.
 * Max 20 unique scene ids; missing/corrupt file = empty. Writes are atomic (tmp + rename).
 * S3-F #85 — PUBLIC_BASE_URL parse (share QR base; exposed on /api/health as share.baseUrl).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveUnder } from "./pathGuard.js";
import { ConfigError } from "./security.js";

export const FEATURED_MAX = 20;

/** Absolute http(s) origin, optional trailing "/", nothing else. Unset/"" → null. */
export function parsePublicBaseUrl(raw) {
  if (raw === undefined || raw === "") return null;
  const bad = () => new ConfigError("PUBLIC_BASE_URL", "must be an absolute http(s) URL with no path, query or hash");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw bad();
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw bad();
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(raw)) throw bad();
  return u.origin;
}

export function createFeaturedStore({ dataRoot }) {
  const file = resolveUnder(dataRoot, "featured.json");
  return {
    read() {
      try {
        const j = JSON.parse(fs.readFileSync(file, "utf8"));
        const ids = Array.isArray(j?.sceneIds) ? j.sceneIds.filter((x) => typeof x === "string") : [];
        return [...new Set(ids)].slice(0, FEATURED_MAX);
      } catch {
        return [];
      }
    },
    write(sceneIds) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sceneIds }, null, 2) + "\n");
      fs.renameSync(tmp, file);
    },
  };
}

/**
 * Validate a PUT body against the live docs. Returns null or {invalid, reason, error}.
 * Order: shape → > 20 → duplicates → unknown → non-scene.
 * @param {unknown} body
 * @param {(id: string) => Promise<any>} findById
 */
export async function featuredProblem(body, findById) {
  const ids = body?.sceneIds;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !x)) {
    return { invalid: [], reason: "shape", error: "sceneIds must be an array of scene ids" };
  }
  if (ids.length > FEATURED_MAX) {
    return { invalid: ids.slice(FEATURED_MAX), reason: "too_many", error: `at most ${FEATURED_MAX} featured scenes` };
  }
  const seen = new Set();
  const dups = [...new Set(ids.filter((x) => (seen.has(x) ? true : (seen.add(x), false))))];
  if (dups.length) return { invalid: dups, reason: "duplicate", error: "sceneIds must be unique" };
  const unknown = [];
  const nonScene = [];
  for (const id of ids) {
    const d = await findById(id);
    if (!d || d.deleted === true) unknown.push(id);
    else if (d.stage !== "scene") nonScene.push(id);
  }
  if (unknown.length) return { invalid: unknown, reason: "unknown", error: "unknown scene id(s)" };
  if (nonScene.length) return { invalid: nonScene, reason: "not_scene", error: "id(s) are not scenes" };
  return null;
}
