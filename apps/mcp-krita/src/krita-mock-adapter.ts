/**
 * S3-A #50 — BRIDGE=mock for CI.
 * health OK without Krita; export_png writes a deterministic 1×1 PNG
 * under testdata/ (or /tmp) — never data/inbox.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSlug,
  inboxTimestamp,
  type ExportPngInput,
  type ExportPngResult,
  type HealthResult,
  type KritaBridgeAdapter,
} from "./adapter.js";

/** Minimal valid 1×1 PNG (deterministic). */
const FIXTURE_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

export type KritaMockAdapterOptions = {
  repoRoot?: string;
};

function defaultMockOutDir(repoRoot: string): string {
  // Prefer repo testdata/; fall back to OS tmp if repoRoot unusable.
  try {
    const candidate = path.join(repoRoot, "testdata", "mock-exports");
    fs.mkdirSync(candidate, { recursive: true });
    return candidate;
  } catch {
    return path.join(os.tmpdir(), "graphics-pipeline-mock");
  }
}

export class KritaMockAdapter implements KritaBridgeAdapter {
  private repoRoot: string;

  constructor(opts: KritaMockAdapterOptions = {}) {
    this.repoRoot = opts.repoRoot ?? process.cwd();
  }

  async health(): Promise<HealthResult> {
    return {
      ok: true,
      krita: "running",
      detail: "BRIDGE=mock — no Krita required",
      bridge: "mock",
    };
  }

  async exportPng(input: ExportPngInput): Promise<ExportPngResult> {
    assertSlug(input.slug);
    const ts = inboxTimestamp();
    const outPath =
      input.outPath ??
      path.join(defaultMockOutDir(this.repoRoot), input.slug, `${ts}.png`);
    const norm = outPath.replace(/\\/g, "/");
    if (norm.includes("/data/inbox/")) {
      throw new Error(
        "BRIDGE=mock refuses data/inbox paths — use testdata/ or /tmp",
      );
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, FIXTURE_PNG);
    return { path: outPath, slug: input.slug, ts };
  }
}

export function createKritaMockAdapter(
  opts: KritaMockAdapterOptions = {},
): KritaBridgeAdapter {
  return new KritaMockAdapter(opts);
}
