/**
 * BRIDGE=vendor|firstparty|mock factory. Default: vendor (9797).
 * Tool names stay health / export_png either way.
 * S3-A #50: BRIDGE=mock → CI-safe stub (no Krita).
 */

import type { KritaBridgeAdapter } from "./adapter.js";
import {
  createVendorKritaMcpAdapter as createVendorAdapter,
  type KritaMcpAdapterOptions,
} from "./krita-mcp-adapter.js";
import {
  createKritaFirstpartyAdapter,
  type KritaFirstpartyAdapterOptions,
} from "./krita-firstparty-adapter.js";
import {
  createKritaMockAdapter,
  type KritaMockAdapterOptions,
} from "./krita-mock-adapter.js";

export type BridgeMode = "vendor" | "firstparty" | "mock";

export type CreateBridgeOptions = KritaMcpAdapterOptions &
  KritaFirstpartyAdapterOptions &
  KritaMockAdapterOptions & {
    /** Explicit mode; else process.env.BRIDGE (default vendor). */
    bridge?: BridgeMode | string;
  };

export function resolveBridgeMode(
  raw?: string | BridgeMode,
): BridgeMode {
  const v = (raw ?? process.env.BRIDGE ?? "vendor").toLowerCase().trim();
  if (v === "firstparty" || v === "first-party" || v === "fp") {
    return "firstparty";
  }
  if (v === "mock" || v === "ci" || v === "stub") {
    return "mock";
  }
  return "vendor";
}

/**
 * Stable factory used by smoke scripts and hosts.
 * Prefer this over constructing adapters directly.
 */
export function createKritaBridgeAdapter(
  opts: CreateBridgeOptions = {},
): KritaBridgeAdapter {
  const mode = resolveBridgeMode(opts.bridge);
  if (mode === "mock") {
    return createKritaMockAdapter(opts);
  }
  if (mode === "firstparty") {
    return createKritaFirstpartyAdapter(opts);
  }
  return createVendorAdapter(opts);
}
