/**
 * BRIDGE=vendor|firstparty factory. Default: vendor (9797).
 * Tool names stay health / export_png either way.
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

export type BridgeMode = "vendor" | "firstparty";

export type CreateBridgeOptions = KritaMcpAdapterOptions &
  KritaFirstpartyAdapterOptions & {
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
  if (mode === "firstparty") {
    return createKritaFirstpartyAdapter(opts);
  }
  return createVendorAdapter(opts);
}
