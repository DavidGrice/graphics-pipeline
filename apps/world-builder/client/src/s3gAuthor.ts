/**
 * S3-G E2 — pure helpers (no React; node-testable via ts.transpileModule).
 * #36 undo/redo history (cap 100, save marker drives dirty) · #29 multi-select batch ops ·
 * #84 compare parse + diff rows · #44 health page view model. R1 §5–8, D1 §2–5.
 */
import { isTombstone, liveNodes, type AuthorNode, type Vec3 } from "./s3eScene";

// ---------------------------------------------------------------- #36 undo / redo
export const UNDO_CAP = 100;
export type Step<T> = { label: string; before: T; after: T; key?: string };
/**
 * `index` = number of applied steps (0 = nothing to undo). `marker` = the index at the last Save
 * (null once that state is unreachable: dropped by the cap or cut off as a redo branch).
 */
export type History<T> = { steps: Step<T>[]; index: number; marker: number | null };

export const emptyHistory = <T>(): History<T> => ({ steps: [], index: 0, marker: 0 });

/** Push a new step: cuts any redo branch, drops the oldest past the cap (no UI). */
export function pushStep<T>(h: History<T>, step: Step<T>, cap = UNDO_CAP): History<T> {
  const steps = h.steps.slice(0, h.index);
  let marker = h.marker !== null && h.marker > h.index ? null : h.marker; // marker was on the cut branch
  steps.push(step);
  let index = steps.length;
  while (steps.length > cap) {
    steps.shift();
    index -= 1;
    marker = marker === null || marker === 0 ? null : marker - 1;
  }
  return { steps, index, marker };
}
/**
 * Like pushStep, but a step with the same `key` as the newest unsaved step amends it (typing in a
 * transform field = one step per field edit, not per keystroke). Never amends across the marker.
 */
export function pushCoalesced<T>(h: History<T>, step: Step<T>, cap = UNDO_CAP): History<T> {
  const last = h.steps[h.index - 1];
  if (step.key && last && last.key === step.key && h.index === h.steps.length && h.marker !== h.index) {
    const steps = h.steps.slice();
    steps[h.index - 1] = { ...last, after: step.after };
    return { ...h, steps };
  }
  return pushStep(h, step, cap);
}
/**
 * Leader ruling: a server reload keeps history only when it is the same scene AND would leave the
 * draft untouched; otherwise the draft is replaced and the stack + marker reset (emptyHistory()).
 */
export const reloadKeepsHistory = (sameScene: boolean, draftSnap: string, serverSnap: string): boolean =>
  sameScene && draftSnap === serverSnap;
export const canUndo = (h: History<unknown>) => h.index > 0;
export const canRedo = (h: History<unknown>) => h.index < h.steps.length;
export function undo<T>(h: History<T>): { history: History<T>; state: T; label: string } | null {
  if (!canUndo(h)) return null;
  const s = h.steps[h.index - 1];
  return { history: { ...h, index: h.index - 1 }, state: s.before, label: s.label };
}
export function redo<T>(h: History<T>): { history: History<T>; state: T; label: string } | null {
  if (!canRedo(h)) return null;
  const s = h.steps[h.index];
  return { history: { ...h, index: h.index + 1 }, state: s.after, label: s.label };
}
/** Save keeps the stack and moves the marker onto the current step. */
export const markSaved = <T>(h: History<T>): History<T> => ({ ...h, marker: h.index });
/** Dirty = current step ≠ save marker. */
export const isDirty = (h: History<unknown>) => h.marker !== h.index;
export const undoTitle = (h: History<unknown>) => (canUndo(h) ? `Undo ${h.steps[h.index - 1].label}` : "Nothing to undo");
export const redoTitle = (h: History<unknown>) => (canRedo(h) ? `Redo ${h.steps[h.index].label}` : "Nothing to redo");

/** Keyboard → "undo" | "redo" | null; never while typing in an input / textarea / contenteditable. */
export function historyKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}): "undo" | "redo" | null {
  const t = e.target;
  const tag = (t?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && e.ctrlKey && !e.shiftKey) return "redo";
  return null;
}

// ---------------------------------------------------------------- #29 multi-select
export type BatchOp = "hide" | "show" | "delete" | "restore";
export type BatchResult<T> = { nodes: T[]; changed: string[]; skipped: { root: number; already: number }; error?: string };

const ALREADY: Record<BatchOp, string> = { hide: "already hidden", show: "already visible", delete: "already deleted", restore: "not deleted" };

/** Toast text for skips, e.g. "2 skipped (root, already deleted)"; null when none. */
export function skipToast(op: BatchOp, s: { root: number; already: number }): string | null {
  const n = s.root + s.already;
  if (n === 0) return null;
  const why = [s.root ? "root" : "", s.already ? ALREADY[op] : ""].filter(Boolean).join(", ");
  return `${n} skipped (${why})`;
}
export const restoreCapText = (max: number) => `Restore would exceed the ${max}-node limit`;
export const selectionLabel = (n: number) => `${n} selected`;

/**
 * Apply one batch op. Root (for hide/delete) and nodes already in the target state are skipped.
 * A restore that would cross the live cap is refused whole (`SCENE_NODES_MAX`), never partial.
 */
export function batchApply<T extends AuthorNode>(
  nodes: readonly T[],
  ids: readonly string[],
  op: BatchOp,
  rootId: string | undefined,
  max: number,
): BatchResult<T> {
  const sel = new Set(ids);
  const skipped = { root: 0, already: 0 };
  const changed: string[] = [];
  for (const n of nodes) {
    if (!sel.has(n.id)) continue;
    const dead = isTombstone(n);
    if ((op === "delete" || op === "hide") && rootId && n.id === rootId) {
      skipped.root++;
      continue;
    }
    const already =
      op === "delete" ? dead : op === "restore" ? !dead : op === "hide" ? dead || n.visible === false : dead || n.visible !== false;
    if (already) {
      skipped.already++;
      continue;
    }
    changed.push(n.id);
  }
  if (op === "restore" && liveNodes(nodes).length + changed.length > max) {
    return { nodes: [...nodes], changed: [], skipped, error: `SCENE_NODES_MAX: ${restoreCapText(max)}` };
  }
  if (op === "delete" && liveNodes(nodes).length - changed.length < 1) {
    return { nodes: [...nodes], changed: [], skipped, error: "SCENE_NO_LIVE_NODES: a scene needs at least one live node" };
  }
  const ch = new Set(changed);
  const next = nodes.map((n) => {
    if (!ch.has(n.id)) return n;
    if (op === "delete") return { ...n, deleted: true };
    if (op === "restore") {
      const { deleted: _d, ...rest } = n;
      return rest as T;
    }
    return { ...n, visible: op === "show" };
  });
  return { nodes: next, changed, skipped };
}

/** Centroid of the selected live nodes' positions (gizmo anchor). */
export function centroid(nodes: readonly AuthorNode[], ids: readonly string[]): Vec3 | null {
  const sel = new Set(ids);
  const pts = nodes.filter((n) => sel.has(n.id) && !isTombstone(n)).map((n) => n.transform?.position ?? [0, 0, 0]);
  if (pts.length === 0) return null;
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
}

/** Move every selected live node by one shared delta. */
export function moveBy<T extends AuthorNode>(nodes: readonly T[], ids: readonly string[], d: Vec3): T[] {
  const sel = new Set(ids);
  return nodes.map((n) => {
    if (!sel.has(n.id) || isTombstone(n)) return n;
    const p = n.transform?.position ?? [0, 0, 0];
    return {
      ...n,
      transform: {
        rotation: n.transform?.rotation ?? [0, 0, 0],
        scale: n.transform?.scale ?? [1, 1, 1],
        position: [p[0] + d[0], p[1] + d[1], p[2] + d[2]] as Vec3,
      },
    };
  });
}

/** Shift-click toggle. */
export const toggleSel = (sel: readonly string[], id: string): string[] => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
/** Ctrl/Cmd+A → live nodes only. */
export const selectAllLive = (nodes: readonly AuthorNode[]): string[] => liveNodes(nodes).map((n) => n.id);
/** Drop ids that no longer exist (selection survives undo/redo otherwise). */
export const pruneSel = (sel: readonly string[], nodes: readonly AuthorNode[]): string[] => sel.filter((id) => nodes.some((n) => n.id === id));

export type Rect = { x0: number; y0: number; x1: number; y1: number };
/** Drag-box hit test on projected screen points (ids whose point lies inside the box). */
export function boxSelect(points: readonly { id: string; x: number; y: number }[], r: Rect): string[] {
  const [l, rr] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
  const [t, b] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
  return points.filter((p) => p.x >= l && p.x <= rr && p.y >= t && p.y <= b).map((p) => p.id);
}

// ---------------------------------------------------------------- #84 compare
export type CompareParse = { ok: true; a: string; b: string } | { ok: false; error: string } | null;
/** `?compare=a,b` → exactly two distinct ids; null when absent. */
export function parseCompare(search: string): CompareParse {
  const raw = new URLSearchParams(search).get("compare");
  if (raw === null) return null;
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length !== 2 || parts.some((p) => !p || !/^[A-Za-z0-9_-]{1,128}$/.test(p))) {
    return { ok: false, error: "Compare needs exactly two asset ids: ?compare=<idA>,<idB>" };
  }
  if (parts[0] === parts[1]) return { ok: false, error: "Pick two different assets to compare" };
  return { ok: true, a: parts[0], b: parts[1] };
}
export type CompareAsset = {
  id: string;
  slug?: string;
  stage?: string;
  characterType?: string;
  license?: string | { id?: string; spdx?: string; name?: string };
  clips?: string[];
  clipRequires?: Record<string, string[]>;
  meshStats?: { tris?: number; triangles?: number; bones?: number };
  rig?: { boneCount?: number };
  sizeBytes?: number;
  size?: number;
  files?: { glb?: { bytes?: number } };
};
export type DiffRow = { key: string; label: string; a: string; b: string; differs: boolean };
const fmtLicense = (l: CompareAsset["license"]) => (l == null ? "—" : typeof l === "string" ? l : l.spdx ?? l.id ?? l.name ?? "—");
const fmtNum = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "—");
const fmtSize = (n: number | undefined) =>
  typeof n !== "number" || !Number.isFinite(n) ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
const fmtReq = (r: CompareAsset["clipRequires"]) =>
  !r || Object.keys(r).length === 0 ? "—" : Object.keys(r).sort().map((k) => `${k}: ${[...r[k]].sort().join("+")}`).join("; ");
/** D1 §4 rows: tris, bones, clips, clipRequires, size, characterType, license, stage. */
export function diffRows(a: CompareAsset, b: CompareAsset, stats: { a?: { tris?: number; bones?: number }; b?: { tris?: number; bones?: number } } = {}): DiffRow[] {
  const tris = (x: CompareAsset, s?: { tris?: number }) => fmtNum(x.meshStats?.tris ?? x.meshStats?.triangles ?? s?.tris);
  const bones = (x: CompareAsset, s?: { bones?: number }) => fmtNum(x.rig?.boneCount ?? x.meshStats?.bones ?? s?.bones);
  const size = (x: CompareAsset) => fmtSize(x.sizeBytes ?? x.size ?? x.files?.glb?.bytes);
  const clips = (x: CompareAsset) => (x.clips && x.clips.length ? [...x.clips].sort().join(", ") : "—");
  const rows: [string, string, string, string][] = [
    ["tris", "Tris", tris(a, stats.a), tris(b, stats.b)],
    ["bones", "Bones", bones(a, stats.a), bones(b, stats.b)],
    ["clips", "Clips", clips(a), clips(b)],
    ["clipRequires", "clipRequires", fmtReq(a.clipRequires), fmtReq(b.clipRequires)],
    ["size", "Size", size(a), size(b)],
    ["characterType", "characterType", a.characterType ?? "—", b.characterType ?? "—"],
    ["license", "License", fmtLicense(a.license), fmtLicense(b.license)],
    ["stage", "Stage", a.stage ?? "—", b.stage ?? "—"],
  ];
  return rows.map(([key, label, va, vb]) => ({ key, label, a: va, b: vb, differs: va !== vb }));
}

// ---------------------------------------------------------------- #44 health page
export const HEALTH_POLL_MS = 10_000;
export type HealthJson = {
  ok?: boolean;
  bridge?: { mode?: string; status?: string; httpStatus?: number };
  krita?: { port?: number; status?: string };
  tools?: Record<string, { version?: string } | null>;
  limits?: Record<string, unknown>;
  share?: { baseUrl?: string | null };
  dataRoot?: unknown;
};
/** View model: never carries an absolute path (dataRoot → "set" / "unset"; tools → versions only). */
export function healthView(j: HealthJson | null) {
  const status = j?.bridge?.status ?? "unknown";
  const icon = status === "ok" || status === "mock" ? "●" : status === "unauthorized" ? "⚠" : status === "down" ? "✖" : "○";
  const tools = Object.entries(j?.tools ?? {}).map(([k, v]) => ({ name: k, version: v?.version ? String(v.version).split("\n")[0].slice(0, 60) : "missing" }));
  const limits = Object.entries(j?.limits ?? {}).map(([k, v]) => ({ name: k, value: String(v) }));
  const share = j?.share?.baseUrl ? String(j.share.baseUrl) : "unset (uses this page's origin)";
  return {
    status,
    icon,
    mode: j?.bridge?.mode ?? "unknown",
    http: j?.bridge?.httpStatus ?? null,
    port: typeof j?.krita?.port === "number" ? String(j.krita.port) : "—",
    tools,
    limits,
    share,
    dataRoot: typeof j?.dataRoot === "string" && j.dataRoot ? "set" : "unset",
  };
}
/** Delay before the next poll: 429 honours Retry-After (seconds, floor 1); else the 10 s cadence. */
export function nextPollMs(status: number, retryAfter: string | null): number {
  if (status === 429) {
    const s = retryAfter && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) : 10;
    return Math.max(1, s) * 1000;
  }
  return HEALTH_POLL_MS;
}
export const updatedAgo = (lastMs: number | null, nowMs: number) =>
  lastMs == null ? "Not updated yet" : `Updated ${Math.max(0, Math.round((nowMs - lastMs) / 1000))}s ago`;

// ---------------------------------------------------------------- D1 §1 overlay placement
/** NIT-F-1: below the anchor, flip above when no room, left clamped to [8, iw − w − 8]; < 600px = bottom sheet. */
export function placeOverlay(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  vp: { width: number; height: number },
): { left: number; top: number; width?: number; sheet: boolean } {
  if (vp.width < 600) {
    const h = Math.min(size.height, vp.height - 16);
    return { left: 8, top: Math.max(8, vp.height - h - 8), width: vp.width - 16, sheet: true };
  }
  const left = Math.max(8, Math.min(anchor.left, vp.width - size.width - 8));
  let top = anchor.bottom + 4;
  if (top + size.height > vp.height - 8) top = Math.max(8, anchor.top - size.height - 4);
  return { left, top, sheet: false };
}
