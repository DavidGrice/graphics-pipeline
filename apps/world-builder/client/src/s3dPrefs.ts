/**
 * S3-D E2 — pure helpers for #86 theme, #90 reduced motion, #88 alt text, #127 slug clash and
 * #94 recent imports (R1 rev2 §6–10, D1 §2–4, D2 §1–2). No React / DOM here so node tests can
 * transpile and exercise it directly.
 */

// ---------------------------------------------------------------- #86 theme
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): Theme {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark ? "dark" : "light";
}

/** Canvas colours per theme (D1 §3): clear #1a1a1f / #e9e9ee; grid + ground ≥ 3:1 vs clear. */
export const CANVAS_THEME: Record<
  Theme,
  { clear: string; gridSection: string; gridCell: string; ground: string }
> = {
  dark: { clear: "#1a1a1f", gridSection: "#9097a6", gridCell: "#6c7280", ground: "#6a6e7a" },
  light: { clear: "#e9e9ee", gridSection: "#4a4f5c", gridCell: "#6a6f7c", ground: "#80838e" },
};

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad hex colour ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- #90 reduced motion
export type MotionPref = "system" | "on" | "reduced";
export const MOTION_PREFS: MotionPref[] = ["system", "on", "reduced"];

export function resolveReducedMotion(pref: MotionPref, systemPrefersReduce: boolean): boolean {
  if (pref === "on") return false;
  if (pref === "reduced") return true;
  return systemPrefersReduce;
}

/** Effective crossfade: 0 ms when reduced. The stored clipUx.blendMs is never rewritten. */
export function effectiveBlendMs(storedBlendMs: number, reduced: boolean): number {
  return reduced ? 0 : storedBlendMs;
}

/** Autoplay of the default clip on selection is off when reduced (user presses Play). */
export function shouldAutoplay(hasClip: boolean, reduced: boolean): boolean {
  return hasClip && !reduced;
}

// ---------------------------------------------------------------- #88 alt text
export const ALT_TEXT_MAX = 280;

export function altTextState(raw: string): {
  trimmed: string;
  length: number;
  over: boolean;
  counter: string;
} {
  const trimmed = (raw ?? "").trim();
  const length = trimmed.length;
  return { trimmed, length, over: length > ALT_TEXT_MAX, counter: `${length}/${ALT_TEXT_MAX}` };
}

/** Accessible name for the viewer canvas: altText ?? name (?? slug). */
export function canvasAriaLabel(
  a: { altText?: string; name?: string; slug?: string } | null | undefined,
): string {
  if (!a) return "3D viewer — no asset selected";
  const alt = typeof a.altText === "string" ? a.altText.trim() : "";
  return alt || a.name || a.slug || "3D asset";
}

// ---------------------------------------------------------------- #127 slug clash
export type SlugClash = { slug: string; existingId: string; suggestedSlug: string };

export function parseSlugClash(status: number, bodyText: string): SlugClash | null {
  if (status !== 409) return null;
  try {
    const j = JSON.parse(bodyText);
    if (
      j &&
      j.code === "SLUG_CLASH" &&
      typeof j.slug === "string" &&
      typeof j.existingId === "string" &&
      typeof j.suggestedSlug === "string"
    ) {
      return { slug: j.slug, existingId: j.existingId, suggestedSlug: j.suggestedSlug };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Rewrite only the slug in the register JSON; every other value is kept. */
export function applySuggestedSlug(regJson: string, suggestedSlug: string): string {
  try {
    const j = JSON.parse(regJson);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      return JSON.stringify({ ...j, slug: suggestedSlug }, null, 2);
    }
  } catch {
    /* fall through */
  }
  return regJson.replace(/("slug"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(suggestedSlug)}`);
}

/** V4a: `ambiguous slug "x" matches n assets` → "x". */
export function ambiguousSlugOf(message: string | null | undefined): string | null {
  const m = /ambiguous slug "([^"]+)"/.exec(message ?? "");
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- #94 recent imports
export const RECENT_IMPORTS_LIMIT = 20;

type Dated = { createdAt?: string };

/** Newest first by createdAt; legacy rows without a parseable createdAt last (stable). */
export function sortNewestFirst<T extends Dated>(list: T[]): T[] {
  return list
    .map((d, i) => ({ d, i, t: Date.parse(d?.createdAt ?? "") }))
    .sort((a, b) => {
      const an = Number.isFinite(a.t);
      const bn = Number.isFinite(b.t);
      if (!an || !bn) return Number(!an) - Number(!bn) || a.i - b.i;
      return b.t - a.t || a.i - b.i;
    })
    .map((x) => x.d);
}

export function recentImports<T extends Dated>(list: T[], limit = RECENT_IMPORTS_LIMIT): T[] {
  return sortNewestFirst(list).slice(0, limit);
}

export function warningsCount(a: { importMeta?: { warnings?: unknown[] } } | null | undefined): number {
  const w = a?.importMeta?.warnings;
  return Array.isArray(w) ? w.length : 0;
}

/** Short relative time ("just now", "5 min ago", "3 h ago", "2 d ago", else YYYY-MM-DD). */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toISOString().slice(0, 10);
}
