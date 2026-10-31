/**
 * S3-F E2 client helpers (D1 §2–§5): #85 share URL/QR, #140 featured strip, #11 clip requires.
 * Pure functions (unit-tested via loadClientTs) (no imports). QR drawing lives in s3fQr.ts. No network here.
 */

/** D1 §3 — base = PUBLIC_BASE_URL when set, else location.origin; deep link `?asset=` / `?scene=`. */
export function shareUrl(base: string, kind: "asset" | "scene", id: string): string {
  return `${base.replace(/\/+$/, "")}/?${kind}=${encodeURIComponent(id)}`;
}

/** D1 §3 — loopback hosts get "This link only works on this device." */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/** #140 — wrap-around step for prev/next/arrow keys. */
export function stepIndex(i: number, dir: -1 | 1, n: number): number {
  return n <= 0 ? 0 : (((i + dir) % n) + n) % n;
}

/** #140 — move item i by dir (up/down buttons); out of range → unchanged copy. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const out = [...list];
  const j = i + dir;
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** #11 — picker caption "needs: a, b" (empty when none). */
export function requiresCaption(map: Record<string, string[]> | undefined, clip: string): string {
  const r = map?.[clip];
  return r && r.length ? `needs: ${r.join(", ")}` : "";
}

/** #11 — toggle one required clip for `clip` (never itself, max 8); empty entry removed. */
export function toggleRequire(
  map: Record<string, string[]> | undefined,
  clip: string,
  req: string,
  max = 8,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...(map ?? {}) };
  if (req === clip) return out;
  const cur = out[clip] ?? [];
  const next = cur.includes(req) ? cur.filter((x) => x !== req) : cur.length >= max ? cur : [...cur, req];
  if (next.length) out[clip] = next;
  else delete out[clip];
  return out;
}

export type ClipRequiresErr = { code: string; error?: string; clip?: string; missing?: string[]; cycle?: string[] };

/** #11 — inline message + clips to highlight for a register/PATCH error body. */
export function clipRequiresIssue(e: ClipRequiresErr): { message: string; clips: string[] } {
  if (e.code === "CLIP_REQUIRES_CYCLE" && e.cycle?.length) {
    return { message: `Circular requirement: ${e.cycle.join(" → ")}`, clips: [...new Set(e.cycle)] };
  }
  if (e.code === "CLIP_REQUIRES_MISSING") {
    return { message: `Unknown clip(s) for ${e.clip ?? "?"}: ${(e.missing ?? []).join(", ")}`, clips: e.clip ? [e.clip] : [] };
  }
  return { message: `${e.code}: ${e.error ?? "save failed"}`, clips: [] };
}
