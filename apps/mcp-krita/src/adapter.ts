/**
 * Stable Krita bridge facade for Sprint 1+.
 * Tool names and path contracts stay fixed so we can swap
 * krita-mcp → first-party MCP+plugin without changing callers.
 */

export type HealthResult =
  | { ok: true; krita: "running"; detail?: string; bridge?: "mock" }
  | { ok: false; krita: "down" | "unknown"; error: string };

export type ExportPngInput = {
  /** kebab-case asset slug; drives inbox path */
  slug: string;
  /** Optional absolute/relative destination override */
  outPath?: string;
};

export type ExportPngResult = {
  path: string;
  slug: string;
  ts: string;
};

/**
 * Thin adapter interface — implement with vendor wrap now,
 * first-party bridge later. Do not leak vendor tool ids here.
 */
export interface KritaBridgeAdapter {
  /** Fail loud if Krita GUI is not reachable. */
  health(): Promise<HealthResult>;

  /**
   * Export current (or target) canvas to PNG under
   * data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png unless outPath is set.
   */
  exportPng(input: ExportPngInput): Promise<ExportPngResult>;
}

export function assertSlug(slug: string): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must match ^[a-z0-9]+(-[a-z0-9]+)*$`,
    );
  }
}

/** Timestamp segment for inbox PNG naming: YYYYMMDD-HHMMSS (local). */
export function inboxTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
