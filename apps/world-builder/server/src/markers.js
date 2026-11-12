/**
 * S3-I #81 — clipUx.markers cross-checks that need the asset (clips[], clipDurations).
 * Shape and the 16 cap are also in ClipUxSchema; this returns the first problem as text.
 */
export const MARKERS_MAX = 16;
export const MARKER_NAME_MAX = 40;

/** @returns {string|null} first problem, or null when `markers` is valid for `asset`. */
export function markersProblem(markers, asset) {
  if (!Array.isArray(markers)) return "clipUx.markers must be an array";
  if (markers.length > MARKERS_MAX) return `clipUx.markers allows at most ${MARKERS_MAX} markers`;
  const clips = Array.isArray(asset?.clips) ? asset.clips : [];
  const dur = asset?.clipDurations && typeof asset.clipDurations === "object" ? asset.clipDurations : {};
  const seen = new Set();
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) return `clipUx.markers[${i}] must be an object`;
    if (typeof m.name !== "string" || m.name.length < 1 || m.name.length > MARKER_NAME_MAX) {
      return `clipUx.markers[${i}].name must be 1..${MARKER_NAME_MAX} characters`;
    }
    if (seen.has(m.name)) return `clipUx.markers[${i}].name must be unique`;
    seen.add(m.name);
    if (typeof m.clip !== "string" || !clips.includes(m.clip)) return `clipUx.markers[${i}].clip must be one of the asset's clips`;
    if (!Number.isInteger(m.t) || m.t < 0) return `clipUx.markers[${i}].t must be an integer ms >= 0`;
    const d = dur[m.clip];
    if (!Number.isFinite(d)) return `clipUx.markers[${i}].clip has no probed duration`;
    if (m.t > d) return `clipUx.markers[${i}].t must be within the clip duration (0..${d} ms)`;
  }
  return null;
}
