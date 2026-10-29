/**
 * S3-C E2/E3 — pure viewer + scene-author helpers (no React / three imports so
 * tests can transpile + run them under node). Contracts: D1 §2–§5, D2 §2–§4,
 * R1 §3–§9.
 */

// ---------- #1 blend crossfade ----------
export const BLEND_MS_MIN = 0;
export const BLEND_MS_MAX = 1000;
export const BLEND_MS_DEFAULT = 250;

/** Clamp UI input to 0–1000 ms; non-finite → default. */
export function clampBlendMs(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return BLEND_MS_DEFAULT;
  return Math.round(Math.min(BLEND_MS_MAX, Math.max(BLEND_MS_MIN, n)));
}

export type CrossfadePlan =
  | { kind: "noop" }
  | { kind: "cut" }
  | { kind: "fade"; seconds: number };

/**
 * Decide how to switch clips. Same clip → noop (no fade restart);
 * no previous / blend 0 / single-clip asset / paused / scrubbing → hard cut.
 */
export function planCrossfade(opts: {
  prevClip: string | null;
  nextClip: string;
  blendMs: number;
  clipCount: number;
  playing: boolean;
  scrubbing: boolean;
}): CrossfadePlan {
  if (opts.prevClip === opts.nextClip) return { kind: "noop" };
  const ms = clampBlendMs(opts.blendMs);
  if (!opts.prevClip || ms === 0 || opts.clipCount < 2 || !opts.playing || opts.scrubbing) {
    return { kind: "cut" };
  }
  return { kind: "fade", seconds: ms / 1000 };
}

/** Blend control disabled for single-clip / billboard spin assets (R1 §3 HARDEN). */
export function blendControlEnabled(clips: string[]): boolean {
  return clips.length >= 2;
}

/**
 * Actions to stop so that at most 2 (outgoing + incoming) keep weight > 0
 * after rapid switches (R1 §3 HARDEN). Inputs are opaque action keys.
 */
export function actionsToStop<T>(weighted: T[], keep: T[]): T[] {
  return weighted.filter((a) => !keep.includes(a));
}

// ---------- #2 timescale ----------
export const TIMESCALE_MIN = 0.5;
export const TIMESCALE_MAX = 2;
export const TIMESCALE_STEP = 0.1;
export const TIMESCALE_DEFAULT = 1;

/** Clamp to [0.5, 2.0], snap to 0.1 step; non-finite → 1.0. */
export function clampTimeScale(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return TIMESCALE_DEFAULT;
  const c = Math.min(TIMESCALE_MAX, Math.max(TIMESCALE_MIN, n));
  return Math.round(c * 10) / 10;
}

/** Effective (displayed) length; raw clipDurations are never rewritten. */
export function effectiveDurationMs(rawMs: number, timeScale: number): number {
  return Math.round(rawMs / clampTimeScale(timeScale));
}

// ---------- #80 hotkeys ----------
export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

/** Key "1".."9" → clip index 0..8; null when ignored (focus in field, modifiers). */
export function hotkeyClipIndex(e: KeyLike): number | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  if (e.target?.isContentEditable) return null;
  if (!/^[1-9]$/.test(e.key)) return null;
  return Number(e.key) - 1;
}

/** n-th CLIP (not camera) in displayed order; out of range → null (no-op). */
export function clipForHotkey(clips: string[], e: KeyLike): string | null {
  const i = hotkeyClipIndex(e);
  if (i === null || i >= clips.length) return null;
  return clips[i];
}

/** Digit badge for the clip button (clips 10+ have none). */
export function hotkeyLabel(index: number): string | null {
  return index >= 0 && index < 9 ? String(index + 1) : null;
}

// ---------- #82 overlay ----------
export type OverlayState = { wireframe: boolean; bones: boolean };
export const OVERLAY_DEFAULT: OverlayState = { wireframe: false, bones: false };

/** Bones toggle only when the asset has a skin (boneCount > 0 or probed skeleton). */
export function bonesToggleEnabled(boneCount: number | null | undefined, hasSkin: boolean): boolean {
  return hasSkin || (typeof boneCount === "number" && boneCount > 0);
}

// ---------- #26 duplicate ----------
export type Vec3 = [number, number, number];
export type DraftNode = {
  id: string;
  assetId: string;
  defaultClip?: string;
  visible?: boolean;
  transform?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 };
};

export const DUPLICATE_OFFSET_X = 0.5;

/**
 * Clone the selected node: new unique id, same assetId/defaultClip/visible,
 * copied transform, position.x + 0.5 (or + snapStep when snap is on).
 * `newId` is tried first; on collision falls back to `<src>-copy-N`.
 */
export function duplicateSceneNode(
  nodes: DraftNode[],
  srcId: string,
  opts: { newId?: string; snapEnabled?: boolean; snapStep?: number; maxNodes?: number } = {},
): { nodes: DraftNode[]; node: DraftNode } | { error: string } {
  const src = nodes.find((n) => n.id === srcId);
  if (!src) return { error: `DUPLICATE_NO_SOURCE: node "${srcId}" not found` };
  if (typeof opts.maxNodes === "number" && nodes.length >= opts.maxNodes) {
    return { error: `DUPLICATE_MAX_NODES: scene already has ${nodes.length} nodes (max ${opts.maxNodes})` };
  }
  const ids = new Set(nodes.map((n) => n.id));
  let id = opts.newId && !ids.has(opts.newId) ? opts.newId : "";
  for (let k = 1; !id; k++) {
    const cand = `${srcId}-copy-${k}`;
    if (!ids.has(cand)) id = cand;
  }
  const step =
    opts.snapEnabled && typeof opts.snapStep === "number" && Number.isFinite(opts.snapStep) && opts.snapStep > 0
      ? opts.snapStep
      : DUPLICATE_OFFSET_X;
  const pos = (src.transform?.position ?? [0, 0, 0]) as Vec3;
  const node: DraftNode = {
    id,
    assetId: src.assetId,
    ...(src.defaultClip ? { defaultClip: src.defaultClip } : {}),
    visible: src.visible !== false,
    transform: {
      position: [pos[0] + step, pos[1], pos[2]],
      rotation: [...((src.transform?.rotation ?? [0, 0, 0]) as Vec3)] as Vec3,
      scale: [...((src.transform?.scale ?? [1, 1, 1]) as Vec3)] as Vec3,
    },
  };
  const at = nodes.findIndex((n) => n.id === srcId);
  const next = [...nodes.slice(0, at + 1), node, ...nodes.slice(at + 1)];
  return { nodes: next, node };
}

// ---------- #31 ground + shadows ----------
export type SceneView = { ground?: boolean; shadows?: boolean };
export function resolveSceneView(view: SceneView | undefined | null): Required<SceneView> {
  return {
    ground: view?.ground !== false,
    shadows: view?.shadows === true,
  };
}

// ---------- #32 orbit bookmarks ----------
export const CAMERAS_MAX = 16;
export type CameraBookmark = {
  id: string;
  name: string;
  position: Vec3;
  target: Vec3;
  fov?: number;
};

function finiteVec(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** Mirrors schema gates so the UI fails before the API 400. */
export function validateCameraBookmark(c: CameraBookmark, others: CameraBookmark[]): string | null {
  const name = (c.name ?? "").trim();
  if (name.length < 1 || name.length > 40) return "camera name 1–40 chars";
  if (!finiteVec(c.position) || !finiteVec(c.target)) return "camera position/target must be finite numbers";
  if (c.fov !== undefined && !(Number.isFinite(c.fov) && c.fov >= 10 && c.fov <= 120)) return "camera fov 10–120";
  if (others.some((o) => o.id !== c.id && o.name.trim().toLowerCase() === name.toLowerCase())) {
    return `duplicate camera name "${name}"`;
  }
  return null;
}

export function addCameraBookmark(
  cams: CameraBookmark[],
  c: CameraBookmark,
): { cameras: CameraBookmark[] } | { error: string } {
  if (cams.length >= CAMERAS_MAX) return { error: `SCENE_CAMERAS_MAX: at most ${CAMERAS_MAX} cameras per scene` };
  if (cams.some((o) => o.id === c.id)) return { error: `duplicate camera id "${c.id}"` };
  const err = validateCameraBookmark(c, cams);
  if (err) return { error: err };
  return { cameras: [...cams, { ...c, name: c.name.trim() }] };
}

export function renameCameraBookmark(
  cams: CameraBookmark[],
  id: string,
  name: string,
): { cameras: CameraBookmark[] } | { error: string } {
  const cur = cams.find((c) => c.id === id);
  if (!cur) return { error: `camera "${id}" not found` };
  const next = { ...cur, name };
  const err = validateCameraBookmark(next, cams);
  if (err) return { error: err };
  return { cameras: cams.map((c) => (c.id === id ? { ...next, name: name.trim() } : c)) };
}

export function deleteCameraBookmark(cams: CameraBookmark[], id: string): CameraBookmark[] {
  return cams.filter((c) => c.id !== id);
}

/** Unique default name "View N". */
export function nextCameraName(cams: CameraBookmark[]): string {
  const names = new Set(cams.map((c) => c.name.trim().toLowerCase()));
  for (let i = cams.length + 1; ; i++) {
    const n = `View ${i}`;
    if (!names.has(n.toLowerCase())) return n;
  }
}

/** Round to 4 dp so bookmark JSON stays stable for dirty-diff. */
export function roundVec(v: Vec3): Vec3 {
  return v.map((x) => Math.round(x * 1e4) / 1e4) as Vec3;
}
