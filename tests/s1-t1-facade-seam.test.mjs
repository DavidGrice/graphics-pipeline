/**
 * S1-T1 / T3.8 — facade seam: stable tool surface, no vendor leak in public types
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSlug,
  inboxTimestamp,
} from "../apps/mcp-krita/dist/adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("T1/T3.8: assertSlug enforces kebab-case", () => {
  assert.doesNotThrow(() => assertSlug("hero-billboard"));
  assert.throws(() => assertSlug("Hero"), /Invalid slug/);
});

test("T1: inboxTimestamp matches YYYYMMDD-HHMMSS", () => {
  const ts = inboxTimestamp(new Date("2026-10-24T19:45:00"));
  // local TZ dependent — shape only
  assert.match(ts, /^\d{8}-\d{6}$/);
});

test("T3.8: public adapter.ts does not export vendor tool map", () => {
  const adapterSrc = fs.readFileSync(
    path.join(ROOT, "apps/mcp-krita/src/adapter.ts"),
    "utf8",
  );
  assert.doesNotMatch(adapterSrc, /KRITA_MCP_TOOL_MAP/);
  assert.match(adapterSrc, /KritaBridgeAdapter/);
  assert.match(adapterSrc, /health/);
  assert.match(adapterSrc, /exportPng/);
});

test("T3.8: vendor map lives only in krita-mcp-adapter implementation", () => {
  const impl = fs.readFileSync(
    path.join(ROOT, "apps/mcp-krita/src/krita-mcp-adapter.ts"),
    "utf8",
  );
  assert.match(impl, /KRITA_MCP_TOOL_MAP/);
  assert.match(impl, /implements KritaBridgeAdapter/);
});
