export * from "./adapter.js";
export * from "./krita-mcp-adapter.js";
export * from "./krita-bridge-probe.js";
export * from "./krita-firstparty-adapter.js";
export * from "./krita-mock-adapter.js";
export {
  createKritaBridgeAdapter,
  resolveBridgeMode,
  type BridgeMode,
  type CreateBridgeOptions,
} from "./create-bridge.js";

// Smoke scripts import createKritaMcpAdapter — route through BRIDGE.
import { createKritaBridgeAdapter } from "./create-bridge.js";
import type { CreateBridgeOptions } from "./create-bridge.js";
import type { KritaBridgeAdapter } from "./adapter.js";

export function createKritaMcpAdapter(
  opts?: CreateBridgeOptions,
): KritaBridgeAdapter {
  return createKritaBridgeAdapter(opts);
}
