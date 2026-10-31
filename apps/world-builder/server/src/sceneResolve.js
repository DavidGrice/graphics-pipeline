/**
 * S2-F-E1 / S2-G-E1 — Register-time scene child resolve (V4 hard + slug + V4a).
 * Pure helper: given nodes + a resolver, return reject reason or null.
 *
 * Codes (brief / D2):
 *   V4  — unknown / unresolved assetId (id or slug)
 *   V4a — slug matches >1 assets (ambiguous; do not pick first)
 *   V5  — nested stage=scene child
 *   V6b — defaultClip set but ∉ child.clips[]
 *   V8  — child stage missing / corrupt
 */

/**
 * @typedef {{ id: string, assetId: string, defaultClip?: string, transform?: object }} SceneNode
 * @typedef {{ id?: string, slug?: string, stage?: string, clips?: string[] }} AssetDoc
 * @typedef {{
 *   resolveDoc?: (idOrSlug: string) => Promise<AssetDoc|null>|AssetDoc|null,
 *   resolveAll?: (idOrSlug: string) => Promise<AssetDoc[]>|AssetDoc[],
 *   normalize?: boolean
 * }} ResolveOpts
 */

/**
 * Pick a single asset from candidates for an id-or-slug key.
 * Prefer exact id match; unique slug OK; >1 slug → ambiguous.
 * @param {string} idOrSlug
 * @param {AssetDoc[]} matches
 * @returns {{ doc: AssetDoc } | { error: string }}
 */
export function pickResolvedAsset(idOrSlug, matches) {
  const list = Array.isArray(matches) ? matches.filter(Boolean) : [];
  if (list.length === 0) {
    return { error: `unknown assetId "${idOrSlug}"` };
  }
  const byId = list.filter((d) => d.id === idOrSlug);
  if (byId.length === 1) return { doc: byId[0] };
  if (byId.length > 1) {
    return { error: `ambiguous assetId "${idOrSlug}" (V4a)` };
  }
  const bySlug = list.filter((d) => d.slug === idOrSlug);
  if (bySlug.length === 1) return { doc: bySlug[0] };
  if (bySlug.length > 1) {
    return {
      error: `ambiguous slug "${idOrSlug}" matches ${bySlug.length} assets (V4a)`,
    };
  }
  if (list.length === 1) return { doc: list[0] };
  return { error: `ambiguous assetId "${idOrSlug}" (V4a)` };
}

/**
 * @param {SceneNode[]} nodes
 * @param {(idOrSlug: string) => Promise<AssetDoc|null>|AssetDoc|null} resolveDoc
 * @param {ResolveOpts} [opts]
 * @returns {Promise<string|null>} error message or null if ok
 */
export async function validateSceneChildren(nodes, resolveDoc, opts = {}) {
  if (!Array.isArray(nodes)) {
    return "scene.nodes must be an array";
  }
  const normalize = opts.normalize === true;
  const resolveAll = opts.resolveAll;

  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || typeof node.assetId !== "string") {
      return "scene node missing id/assetId";
    }
    // S3-E #41 — tombstoned nodes are skipped by V4/V4a/V5/V6b/V8 resolve (kept verbatim).
    if (node.deleted === true) continue;

    /** @type {AssetDoc|null} */
    let child = null;

    if (typeof resolveAll === "function") {
      const matches = await resolveAll(node.assetId);
      const picked = pickResolvedAsset(node.assetId, matches || []);
      if ("error" in picked) {
        if (picked.error.startsWith("unknown")) {
          return `scene node "${node.id}" references unknown assetId "${node.assetId}"`;
        }
        return `scene node "${node.id}" ${picked.error}`;
      }
      child = picked.doc;
    } else {
      child = await resolveDoc(node.assetId);
      if (!child) {
        return `scene node "${node.id}" references unknown assetId "${node.assetId}"`;
      }
    }

    if (typeof child.stage !== "string" || !child.stage) {
      return `scene node "${node.id}" child record has missing/corrupt stage (V8)`;
    }
    if (child.stage === "scene") {
      return `scene node "${node.id}" cannot reference nested stage=scene asset`;
    }
    if (node.defaultClip) {
      const clips = Array.isArray(child.clips) ? child.clips : [];
      if (!clips.includes(node.defaultClip)) {
        return `scene node "${node.id}" defaultClip "${node.defaultClip}" not in child clips`;
      }
    }
    if (normalize && typeof child.id === "string" && child.id) {
      node.assetId = child.id;
    }
  }
  return null;
}
