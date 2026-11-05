/**
 * S3-H E2 — pure helpers (R1 §4, §7–§10; D1 §2, §5–§8). Dependency-free so node tests can load it.
 *   #69 client Save precondition, #2 clip speed (URL ?speed=), #30 snap-to-grid steps + batch delta,
 *   #130 frustum cull threshold + sphere-vs-frustum test, and the console deprecation allowlist.
 */

// ---------------------------------------------------------------- #69
export const ETAG_PROMPT_TITLE = "This scene changed elsewhere";
export const ETAG_PROMPT_BODY =
  "Someone else saved while you were editing. Reload to take their version, or Cancel to keep editing (Save will fail again until you reload).";

/** Headers for a scene Save: If-Match only when an ETag from the last load is known (opt-in). */
export function saveHeaders(etag: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof etag === "string" && etag) h["If-Match"] = etag;
  return h;
}

/** True when a Save response is the #69 precondition failure (412 PRECONDITION_FAILED). */
export function isPreconditionFailed(status: number, body: string): boolean {
  if (status !== 412) return false;
  try {
    return (JSON.parse(body) as { code?: string })?.code === "PRECONDITION_FAILED";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- #2
export const SPEED_STEPS = [0.25, 0.5, 1, 1.5, 2] as const;
export const SPEED_DEFAULT = 1;

/** `?speed=` → one of SPEED_STEPS; anything else (missing, junk, off-step, out of range) → 1. */
export function parseSpeed(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return SPEED_DEFAULT;
  const n = Number(raw);
  return (SPEED_STEPS as readonly number[]).includes(n) ? n : SPEED_DEFAULT;
}

/** `[` (dir -1) / `]` (dir +1) step through SPEED_STEPS, clamped at the ends. */
export function stepSpeed(cur: number, dir: -1 | 1): number {
  const steps = SPEED_STEPS as readonly number[];
  let i = steps.indexOf(cur);
  if (i < 0) i = steps.indexOf(SPEED_DEFAULT);
  return steps[Math.min(steps.length - 1, Math.max(0, i + dir))];
}

/** URL search with `speed` set (removed at the default 1). Other params kept. */
export function withSpeed(search: string, speed: number): string {
  const q = new URLSearchParams(search);
  if (speed === SPEED_DEFAULT) q.delete("speed");
  else q.set("speed", String(speed));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Effective mixer timeScale: the persisted clipUx pref × the session URL speed. */
export function effectiveTimeScale(prefTimeScale: number, speed: number): number {
  return prefTimeScale * speed;
}

// ---------------------------------------------------------------- #30
export const SNAP_STEPS = [0.1, 0.25, 0.5, 1] as const;
export const SNAP_STEP_DEFAULT = 0.25;

export function snapTo(v: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return v;
  const r = Math.round(v / step) * step;
  return Number(r.toFixed(6)) + 0; // trim float noise, no -0
}

/** #29 batch: snap the shared delta (each axis), so relative offsets between nodes are kept. */
export function snapDelta(d: [number, number, number], step: number): [number, number, number] {
  return [snapTo(d[0], step), snapTo(d[1], step), snapTo(d[2], step)];
}

// ---------------------------------------------------------------- #130
/** Culling turns on only ABOVE SCENE_NODES_MAX/4 live nodes. */
export function cullActive(liveCount: number, sceneMaxNodes: number): boolean {
  return liveCount > sceneMaxNodes / 4;
}

export type Sphere = { x: number; y: number; z: number; r: number };
/** THREE.Plane convention: normal·p + constant ≥ 0 is inside. */
export type FrustumPlane = { nx: number; ny: number; nz: number; c: number };

export function sphereInFrustum(s: Sphere, planes: readonly FrustumPlane[]): boolean {
  for (const p of planes) {
    if (p.nx * s.x + p.ny * s.y + p.nz * s.z + p.c < -s.r) return false;
  }
  return true;
}

/** Per-node draw decision; `keep` (selected / gizmo target) is always drawn. */
export function cullDecisions(
  spheres: readonly Sphere[],
  planes: readonly FrustumPlane[],
  active: boolean,
  keep: readonly boolean[] = [],
): boolean[] {
  return spheres.map((s, i) => !active || keep[i] === true || sphereInFrustum(s, planes));
}

// ---------------------------------------------------------------- console allowlist (Leader, E2)
/**
 * ONLY these upstream deprecation warnings (three@0.187 via R3F/drei) are tolerated by UI
 * console/pageerror checks. Do not broaden: anything else still fails the check.
 */
export const CONSOLE_DEPRECATION_ALLOWLIST = [/THREE\.Clock/, /PCFSoftShadowMap/, /three-mesh-bvh/] as const;

export function isAllowedConsoleNoise(text: string): boolean {
  return /deprecat/i.test(text) && CONSOLE_DEPRECATION_ALLOWLIST.some((re) => re.test(text));
}
