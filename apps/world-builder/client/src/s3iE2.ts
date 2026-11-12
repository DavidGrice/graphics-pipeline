/**
 * S3-I E2 — pure helpers (R1 §7 #28, §10 #81; D1 §5, §8). Dependency-free so node tests can load it.
 *   #28 scene thumbnail: square crop of the viewer into a 256×256 PNG, the card's fallback initial.
 *   #81 timeline markers: cap 16, unique names 1..40, t integer ms in [0, clipDurations[clip]].
 */

// ---------------------------------------------------------------- #28
export const THUMB_SIZE = 256;

/** Centred square crop of a w×h source: {sx, sy, side} (side 0 when either side is 0). */
export function squareCrop(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.max(0, Math.floor(Math.min(w, h)));
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

/** Scene-card fallback: first letter or digit of the name (then slug), upper-cased; "?" when none. */
export function sceneInitial(name: string | undefined, slug: string | undefined): string {
  for (const s of [name, slug]) {
    const m = typeof s === "string" ? /[\p{L}\p{N}]/u.exec(s) : null;
    if (m) return m[0].toUpperCase();
  }
  return "?";
}

/** Only a stored .png preview is worth an <img>; anything else shows the fallback without a request. */
export function hasPngPreview(preview: string | undefined): boolean {
  return typeof preview === "string" && /\.png$/i.test(preview);
}

// ---------------------------------------------------------------- #81
export const MARKERS_MAX = 16;
export const MARKER_NAME_MAX = 40;
export type Marker = { clip: string; t: number; name: string };

/** "n of 16 markers" (counts every marker on the asset, all clips). */
export function markerHint(count: number): string {
  return `${count} of ${MARKERS_MAX} markers`;
}

/** Add is allowed below the cap and only for a clip with a probed duration. */
export function canAddMarker(markers: Marker[], durationMs: number | undefined): boolean {
  return markers.length < MARKERS_MAX && Number.isFinite(durationMs) && (durationMs as number) >= 0;
}

/** First free "Marker n" (n from 1), unique across the asset. */
export function nextMarkerName(markers: Marker[]): string {
  const used = new Set(markers.map((m) => m.name));
  for (let n = 1; ; n++) if (!used.has(`Marker ${n}`)) return `Marker ${n}`;
}

/** Scrub fraction (0..1) → integer ms clamped to [0, durationMs]. */
export function markerTime(scrub: number, durationMs: number): number {
  const f = Number.isFinite(scrub) ? Math.min(1, Math.max(0, scrub)) : 0;
  return Math.min(durationMs, Math.max(0, Math.round(f * durationMs)));
}

/** Tick position in percent of the track; 0 when the duration is unknown or 0. */
export function markerPct(t: number, durationMs: number | undefined): number {
  if (!Number.isFinite(durationMs) || !(durationMs as number) || (durationMs as number) <= 0) return 0;
  return Math.min(100, Math.max(0, (t / (durationMs as number)) * 100));
}

/** Rename check: null when ok, otherwise the reason shown inline. */
export function renameProblem(markers: Marker[], index: number, raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > MARKER_NAME_MAX) return `Name must be 1–${MARKER_NAME_MAX} characters`;
  if (markers.some((m, i) => i !== index && m.name === name)) return "Name already used";
  return null;
}

/** Markers of one clip in time order, each with its index in the asset list. */
export function markersForClip(markers: Marker[], clip: string): { m: Marker; i: number }[] {
  return markers
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.clip === clip)
    .sort((a, b) => a.m.t - b.m.t || a.i - b.i);
}

/** Only well-formed {clip, t, name} entries survive (a stale or foreign list never crashes the bar). */
export function cleanMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === "object" && typeof m.clip === "string" && Number.isInteger(m.t) && typeof m.name === "string")
    .map((m) => ({ clip: m.clip, t: m.t, name: m.name }));
}

// ---------------------------------------------------------------- #131
/** Nodes at live index < SCENE_NODES_MAX/4 load eagerly; the rest wait for first frustum visibility. */
export function eagerCap(sceneMaxNodes: number): number {
  return Math.max(0, Math.floor((Number.isFinite(sceneMaxNodes) ? sceneMaxNodes : 0) / 4));
}

export function isLazyIndex(index: number, sceneMaxNodes: number): boolean {
  return index >= eagerCap(sceneMaxNodes);
}

/** Stats panel copy (D1 §6): "Loaded n / total", n clamped to [0, total]. */
export function loadedText(loaded: number, total: number): string {
  const t = Math.max(0, Math.floor(total));
  return `Loaded ${Math.min(t, Math.max(0, Math.floor(loaded)))} / ${t}`;
}
