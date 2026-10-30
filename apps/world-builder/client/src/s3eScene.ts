/**
 * S3-E E2 — pure scene-author helpers (no React; node-testable via ts.transpileModule).
 * #38 live-node cap · #41 soft-delete / restore / purge · #35 replace child, keep transform.
 * R1 §5–7, D1 §1–3 (rebound at 3c2f26f).
 */

export const SCENE_MAX_NODES_DEFAULT = 256;

export type Vec3 = [number, number, number];
export type AuthorNode = {
  id: string;
  assetId: string;
  defaultClip?: string;
  visible?: boolean;
  deleted?: boolean;
  transform?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 };
};
export type PickAsset = { id: string; slug?: string; stage?: string; clips?: string[]; clipUx?: { defaultClip?: string } };

export const isTombstone = (n: { deleted?: boolean } | null | undefined): boolean => n?.deleted === true;
export const liveNodes = <T extends { deleted?: boolean }>(nodes: readonly T[]): T[] => nodes.filter((n) => !isTombstone(n));
export const tombstones = <T extends { deleted?: boolean }>(nodes: readonly T[]): T[] => nodes.filter(isTombstone);

/** #38 — counter tone: ok < 90 % ≤ warn < max ≤ error. */
export function capTone(live: number, max: number): "ok" | "warn" | "max" {
  if (live >= max) return "max";
  if (live >= Math.ceil(max * 0.9)) return "warn";
  return "ok";
}
export const capLabel = (live: number, max: number) => `Nodes ${live} / ${max}`;
export const capTitle = (max: number) => `Node limit reached (${max})`;
export const atCap = (nodes: readonly { deleted?: boolean }[], max: number) => liveNodes(nodes).length >= max;

export const ROOT_DELETE_TITLE = "Root node can't be deleted";
export const LAST_LIVE_TITLE = "A scene needs at least one live node";

/** #41 — why Delete is disabled for this node (null = allowed). Mirrors the API invariants. */
export function deleteBlock(
  nodes: readonly AuthorNode[],
  id: string,
  rootId: string | undefined,
): { code: "SCENE_ROOT_DELETE" | "SCENE_NO_LIVE_NODES"; title: string } | null {
  const n = nodes.find((x) => x.id === id);
  if (!n || isTombstone(n)) return null;
  if (rootId && id === rootId) return { code: "SCENE_ROOT_DELETE", title: ROOT_DELETE_TITLE };
  if (liveNodes(nodes).length <= 1) return { code: "SCENE_NO_LIVE_NODES", title: LAST_LIVE_TITLE };
  return null;
}

/** #41 — tombstone a node (keeps id + transform). */
export function tombstoneNode<T extends AuthorNode>(
  nodes: readonly T[],
  id: string,
  rootId: string | undefined,
): { nodes: T[] } | { error: string } {
  const b = deleteBlock(nodes, id, rootId);
  if (b) return { error: `${b.code}: ${b.title}` };
  if (!nodes.some((n) => n.id === id)) return { error: `node "${id}" not found` };
  return { nodes: nodes.map((n) => (n.id === id ? { ...n, deleted: true } : n)) };
}

/** #41 — restore a tombstone unless the live cap would be exceeded (#38). */
export function restoreNode<T extends AuthorNode>(nodes: readonly T[], id: string, max: number): { nodes: T[] } | { error: string } {
  const n = nodes.find((x) => x.id === id);
  if (!n || !isTombstone(n)) return { error: `node "${id}" is not deleted` };
  if (atCap(nodes, max)) return { error: `SCENE_NODES_MAX: ${capTitle(max)}` };
  return {
    nodes: nodes.map((x) => {
      if (x.id !== id) return x;
      const { deleted: _d, ...rest } = x;
      return rest as T;
    }),
  };
}

/** #41 — explicit purge: drop every tombstone from the draft (persisted on the next Save). */
export function purgeTombstones<T extends AuthorNode>(nodes: readonly T[]): T[] {
  return liveNodes(nodes);
}
export const purgeConfirmText = (n: number) =>
  `Permanently remove ${n} node${n === 1 ? "" : "s"}? This can't be undone.`;

/** Wire form for PATCH: `deleted: true` only on tombstones (never `false`). */
export function wireNode(n: AuthorNode): AuthorNode {
  const out: AuthorNode = {
    id: n.id,
    assetId: n.assetId.trim(),
    defaultClip: n.defaultClip || undefined,
    visible: n.visible !== false,
    transform: n.transform,
  };
  if (isTombstone(n)) out.deleted = true;
  return out;
}

export type ReplaceUndo = { nodeId: string; prevAssetId: string; prevDefaultClip?: string; from: string; to: string };

/**
 * #35 — swap a live node's assetId only. Keeps id, transform and visible; defaultClip resets to
 * the new asset's default (clipUx.defaultClip when it is one of its clips). Rejects a
 * tombstoned node, the scene itself, a stage:"scene" asset (no nesting) and a no-op.
 */
export function replaceNodeAsset<T extends AuthorNode>(
  nodes: readonly T[],
  nodeId: string,
  target: PickAsset,
  sceneId: string | null | undefined,
): { nodes: T[]; undo: ReplaceUndo } | { error: string } {
  const n = nodes.find((x) => x.id === nodeId);
  if (!n) return { error: `node "${nodeId}" not found` };
  if (isTombstone(n)) return { error: "deleted nodes can't be replaced — restore it first" };
  if (sceneId && (target.id === sceneId || target.slug === sceneId)) {
    return { error: "a scene can't contain itself (self-reference)" };
  }
  if (target.stage === "scene") {
    return { error: `scene node "${nodeId}" cannot reference nested stage=scene asset` };
  }
  if (target.id === n.assetId || (target.slug && target.slug === n.assetId)) {
    return { error: "that is already this node's asset" };
  }
  const dc = target.clipUx?.defaultClip;
  const defaultClip = dc && (target.clips ?? []).includes(dc) ? dc : undefined;
  const next = nodes.map((x) => {
    if (x.id !== nodeId) return x;
    const { defaultClip: _old, ...rest } = x;
    return { ...rest, assetId: target.id, ...(defaultClip ? { defaultClip } : {}) } as T;
  });
  return {
    nodes: next,
    undo: { nodeId, prevAssetId: n.assetId, prevDefaultClip: n.defaultClip, from: n.assetId, to: target.slug ?? target.id },
  };
}

/** #35 — one-step undo of the last replace (until Save). */
export function undoReplace<T extends AuthorNode>(nodes: readonly T[], u: ReplaceUndo): T[] {
  return nodes.map((x) => {
    if (x.id !== u.nodeId) return x;
    const { defaultClip: _dc, ...rest } = x;
    return { ...rest, assetId: u.prevAssetId, ...(u.prevDefaultClip ? { defaultClip: u.prevDefaultClip } : {}) } as T;
  });
}

/** #41 — asset-panel hint when the 409 ASSET_IN_USE comes only from tombstoned nodes. */
export function inUseHint(body: { code?: string; refs?: string[]; deletedRefs?: string[] } | null, sceneName: (id: string) => string): string | null {
  if (!body || body.code !== "ASSET_IN_USE") return null;
  const del = body.deletedRefs ?? [];
  if (del.length === 0) return null;
  return `Used by deleted nodes in ${del.map(sceneName).join(", ")}, purge to free`;
}
