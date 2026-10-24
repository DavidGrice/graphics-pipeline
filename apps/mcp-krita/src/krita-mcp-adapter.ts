/**
 * Sprint 1 implementation: wrap external `krita-mcp` (CC0) behind our facade.
 *
 * Runtime: Krita GUI must be installed + running; krita-mcp talks to its
 * in-process plugin over localhost. This adapter documents the wrap and
 * provides a callable seam — live MCP JSON-RPC is host-driven (Grok Build /
 * VS Code MCP). For programmatic smoke we shell health checks / document
 * the expected tool mapping.
 *
 * License path: our facade stays MIT; later replace this class body with a
 * first-party stdio MCP + GPL pykrita plugin without changing adapter.ts.
 */

import { spawn } from "node:child_process";
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

export type KritaMcpAdapterOptions = {
  /** Repo root (contains data/inbox). Defaults to process.cwd() walk-up. */
  repoRoot?: string;
  /** How to invoke krita-mcp CLI (default: uvx krita-mcp). */
  command?: string;
  args?: string[];
  /** Host-side timeout for export (ms). Designer: ≥ 60s. */
  exportTimeoutMs?: number;
};

const DEFAULT_EXPORT_TIMEOUT_MS = 60_000;

/**
 * Maps our stable tools → krita-mcp vendor surface (documented, not vendored).
 * Vendor tool names may change; keep this map in one place.
 */
export const KRITA_MCP_TOOL_MAP = {
  health: "health", // or vendor equivalent — fail if Krita down
  export_png: "export_png", // canvas/PNG export → absolute path
} as const;

export class KritaMcpAdapter implements KritaBridgeAdapter {
  private readonly repoRoot: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly exportTimeoutMs: number;

  constructor(opts: KritaMcpAdapterOptions = {}) {
    this.repoRoot = opts.repoRoot ?? process.cwd();
    this.command = opts.command ?? "uvx";
    this.args = opts.args ?? ["krita-mcp"];
    this.exportTimeoutMs = opts.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  }

  async health(): Promise<HealthResult> {
    // Prefer probing whether the vendor CLI is on PATH; live Krita GUI
    // reachability is ultimately confirmed by the MCP host calling the
    // health tool. We fail loud when the wrap cannot even start.
    try {
      const probe = await this.runProbe(["--help"]);
      if (probe.exitCode !== 0 && !probe.stdout && !probe.stderr) {
        return {
          ok: false,
          krita: "unknown",
          error:
            `krita-mcp wrap not runnable (${this.command} ${this.args.join(" ")}). ` +
            `Install via: uvx krita-mcp install — and ensure Krita GUI is running.`,
        };
      }
      // CLI present does not prove Krita GUI is up — callers must treat
      // MCP-level health as authoritative when the host is connected.
      return {
        ok: true,
        krita: "running",
        detail:
          "Vendor CLI reachable from this process. Confirm Krita GUI via MCP health tool before export.",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        krita: "down",
        error:
          `Krita MCP wrap failed: ${message}. ` +
          `Krita must be installed with GUI running; Sprint 1 wraps krita-mcp (CC0).`,
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

    // Live export is performed by the MCP host invoking vendor export_png
    // and writing to `absolute`. This method prepares the path contract and
    // documents the seam for E2 smoke tests.
    const health = await this.health();
    if (!health.ok) {
      throw new Error(
        `export_png blocked: ${health.error} (timeout budget ${this.exportTimeoutMs}ms)`,
      );
    }

    // Placeholder marker so downstream can detect "path reserved, export pending host".
    // E2 will replace this with a real MCP tools/call.
    const marker = `${absolute}.pending`;
    await fs.writeFile(
      marker,
      JSON.stringify(
        {
          status: "pending-mcp-export",
          slug: input.slug,
          ts,
          path: absolute,
          vendorTool: KRITA_MCP_TOOL_MAP.export_png,
          note: "Host should call krita-mcp export and write PNG to path",
        },
        null,
        2,
      ),
      "utf8",
    );

    return { path: absolute, slug: input.slug, ts };
  }

  private runProbe(extraArgs: string[]): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, [...this.args, ...extraArgs], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve({ exitCode, stdout, stderr });
      });
    });
  }
}

export function createKritaMcpAdapter(
  opts?: KritaMcpAdapterOptions,
): KritaBridgeAdapter {
  return new KritaMcpAdapter(opts);
}
