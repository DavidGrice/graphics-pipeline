/**
 * Sprint 2-B: first-party HTTP bridge adapter (MIT).
 * Talks to GPL pykrita plugin on 127.0.0.1:KRITA_FP_PORT (default 19876).
 * Process boundary only — do not import plugin Python into this package.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  assertSlug,
  inboxTimestamp,
  type ExportPngInput,
  type ExportPngResult,
  type HealthResult,
  type KritaBridgeAdapter,
} from "./adapter.js";

export type KritaFirstpartyAdapterOptions = {
  repoRoot?: string;
  /** Override loopback port (default KRITA_FP_PORT or 19876). */
  port?: number;
  /** Optional shared secret → X-Graphics-Token. */
  token?: string;
  exportTimeoutMs?: number;
};

const DEFAULT_PORT = 19876;
const DEFAULT_EXPORT_TIMEOUT_MS = 60_000;

export function kritaFirstpartyPort(override?: number): number {
  if (override != null) return override;
  const raw = process.env.KRITA_FP_PORT;
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_PORT;
}

function authHeaders(token?: string): Record<string, string> {
  const t = (token ?? process.env.KRITA_FP_TOKEN ?? "").trim();
  return t ? { "X-Graphics-Token": t } : {};
}

export class KritaFirstpartyAdapter implements KritaBridgeAdapter {
  private readonly repoRoot: string;
  private readonly port: number;
  private readonly token?: string;
  private readonly exportTimeoutMs: number;

  constructor(opts: KritaFirstpartyAdapterOptions = {}) {
    this.repoRoot = opts.repoRoot ?? process.cwd();
    this.port = kritaFirstpartyPort(opts.port);
    this.token = opts.token;
    this.exportTimeoutMs = opts.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async health(): Promise<HealthResult> {
    const mode = (process.env.KRITA_HEALTH_MODE || "bridge").toLowerCase();
    if (mode === "cli") {
      return {
        ok: true,
        krita: "running",
        detail:
          "KRITA_HEALTH_MODE=cli: firstparty bridge not probed (CI dry-run).",
      };
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${this.baseUrl()}/health`, {
        method: "GET",
        headers: authHeaders(this.token),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 401) {
        return {
          ok: false,
          krita: "unknown",
          error:
            "firstparty bridge unauthorized — set KRITA_FP_TOKEN to match plugin.",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          krita: "down",
          error: `firstparty /health HTTP ${res.status} on ${this.baseUrl()}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
      };
      if (body.ok === false) {
        return {
          ok: false,
          krita: "down",
          error: body.detail ?? "firstparty health reported not ok",
        };
      }
      return {
        ok: true,
        krita: "running",
        detail:
          body.detail ??
          `Krita firstparty bridge HTTP ${res.status} on 127.0.0.1:${this.port}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        krita: "down",
        error:
          `Krita firstparty bridge not reachable on 127.0.0.1:${this.port} (${message}). ` +
          `Install apps/krita-plugin into %APPDATA%\\krita\\pykrita\\ and set BRIDGE=firstparty.`,
      };
    }
  }

  async exportPng(input: ExportPngInput): Promise<ExportPngResult> {
    assertSlug(input.slug);
    const ts = inboxTimestamp();
    const relative = path.join("data", "inbox", input.slug, `${ts}.png`);
    const absolute =
      input.outPath ?? path.resolve(this.repoRoot, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    const health = await this.health();
    if (!health.ok) {
      throw new Error(
        `export_png blocked: ${health.error} (timeout budget ${this.exportTimeoutMs}ms)`,
      );
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.exportTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl()}/export_png`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(this.token),
        },
        body: JSON.stringify({ slug: input.slug, outPath: absolute }),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        path?: string;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(
          body.error ?? `firstparty export_png HTTP ${res.status}`,
        );
      }
      // Confirm file exists on disk (plugin writes it).
      try {
        await fs.access(absolute);
      } catch {
        throw new Error(`firstparty export_png did not create file: ${absolute}`);
      }
      return { path: absolute, slug: input.slug, ts };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createKritaFirstpartyAdapter(
  opts?: KritaFirstpartyAdapterOptions,
): KritaBridgeAdapter {
  return new KritaFirstpartyAdapter(opts);
}
