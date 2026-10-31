/**
 * S3-E #139 — pure 429 helpers for the inline Retry-After countdown (D2 §1).
 * No auto-retry: the UI only disables the mutating buttons and counts down.
 */

export const RATE_LIMITED = "RATE_LIMITED";

/**
 * Seconds to wait if this response is a 429 RATE_LIMITED, else null.
 * Prefers the body's `retryAfterSec`, falls back to the `Retry-After` header, floor 1.
 */
export function parseRateLimited(status: number, bodyText: string, retryAfterHeader: string | null): number | null {
  if (status !== 429) return null;
  let sec: number | null = null;
  try {
    const j = JSON.parse(bodyText) as { code?: unknown; retryAfterSec?: unknown };
    if (j && j.code !== undefined && j.code !== RATE_LIMITED) return null;
    if (typeof j?.retryAfterSec === "number" && Number.isFinite(j.retryAfterSec)) sec = j.retryAfterSec;
  } catch {
    /* non-JSON 429 → header only */
  }
  if (sec == null && retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())) sec = Number(retryAfterHeader.trim());
  return Math.max(1, Math.ceil(sec ?? 1));
}

/** Whole seconds left until `untilMs` (0 once passed). */
export function remainingSec(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

export function rateLimitMessage(sec: number): string {
  return `Too many changes, try again in ${sec}s`;
}

export type TimingsMirror = { export?: number; probe?: number; copy?: number; total?: number; probeCache?: string };

/** D2 §4 — history-row tooltip (total + probe cache hit/miss) from importMeta.timingsMs. */
export function timingsTitle(t: TimingsMirror | null | undefined): string | null {
  if (!t || typeof t.total !== "number") return null;
  const parts = (["export", "probe", "copy"] as const)
    .filter((k) => typeof t[k] === "number")
    .map((k) => `${k} ${t[k]} ms`);
  const cache = t.probeCache ? ` · probe cache ${t.probeCache}` : "";
  return `Import took ${t.total} ms (${parts.join(" · ")})${cache}`;
}
