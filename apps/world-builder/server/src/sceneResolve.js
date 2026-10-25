/**
 * S2-F-E1 — Register-time scene child resolve (V4 hard).
 * Pure helper: given nodes + a resolver, return reject reason or null.
 *
 * Codes (brief / D2):
 *   V4  — unknown / unresolved assetId
 *   V5  — nested stage=scene child
 *   V6b — defaultClip set but ∉ child.clips[]
 *   V8  — child stage missing / corrupt
 */

/**
 * @typedef {{ id: string, assetId: string, defaultClip?: string }} SceneNode
 * @typedef {{ id?: string, slug?: string, stage?: string, clips?: string[] }} AssetDoc
 */

/**
 * @param {SceneNode[]} nodes
 * @param {(idOrSlug: string) => Promise<AssetDoc|null>|AssetDoc|null} resolveDoc
 * @returns {Promise<string|null>} error message or null if ok
 */
export async function validateSceneChildren(nodes, resolveDoc) {
  if (!Array.isArray(nodes)) {
    return 'scene.nodes must be an array';
  }
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.assetId !== 'string') {
      return 'scene node missing id/assetId';
    }
    const child = await resolveDoc(node.assetId);
    if (!child) {
      return `scene node "${node.id}" references unknown assetId "${node.assetId}"`;
    }
    if (typeof child.stage !== 'string' || !child.stage) {
      return `scene node "${node.id}" child record has missing/corrupt stage (V8)`;
    }
    if (child.stage === 'scene') {
      return `scene node "${node.id}" cannot reference nested stage=scene asset`;
    }
    if (node.defaultClip) {
      const clips = Array.isArray(child.clips) ? child.clips : [];
      if (!clips.includes(node.defaultClip)) {
        return `scene node "${node.id}" defaultClip "${node.defaultClip}" not in child clips`;
      }
    }
  }
  return null;
}
