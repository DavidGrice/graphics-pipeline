/**
 * S3-F #52 — Krita bridge health: 401/403 is "unauthorized", not "down" (D2 @1f687da / R1 §9).
 *
 *   BRIDGE ∈ vendor | firstparty | mock (case-insensitive; unset = vendor; the adapter's aliases
 *   fp / first-party → firstparty and ci / stub → mock are accepted). Anything else → CONFIG_INVALID.
 *   status ∈ ok | unauthorized | down | mock | skipped:
 *     2xx–3xx → ok · 401/403 → unauthorized · other HTTP → down (+httpStatus) · connect error/timeout → down
 */
import { ConfigError } from "./security.js";

export const BRIDGE_MODES = Object.freeze(["vendor", "firstparty", "mock"]);
const ALIASES = { fp: "firstparty", "first-party": "firstparty", ci: "mock", stub: "mock" };

export function parseBridgeMode(raw) {
  if (raw == null || String(raw).trim() === "") return "vendor";
  const v = String(raw).trim().toLowerCase();
  const m = ALIASES[v] ?? v;
  if (!BRIDGE_MODES.includes(m)) throw new ConfigError("BRIDGE", "must be vendor, firstparty or mock");
  return m;
}

export function bridgePort(mode, env = process.env) {
  return mode === "firstparty" ? Number(env.KRITA_FP_PORT || 19876) : Number(env.KRITA_MCP_PORT || 9797);
}

/** HTTP status → bridge status. */
export function statusFromHttp(code) {
  if (code >= 200 && code < 400) return "ok";
  if (code === 401 || code === 403) return "unauthorized";
  return "down";
}

/**
 * @returns {Promise<{mode: string, status: string, httpStatus?: number, port?: number}>}
 */
export async function probeBridge({ mode, skip = false, env = process.env, timeoutMs = 1500, fetchImpl = fetch }) {
  if (mode === "mock") return { mode, status: "mock" };
  if (skip) return { mode, status: "skipped" };
  const port = bridgePort(mode, env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/`, { method: "GET", redirect: "manual", signal: ctrl.signal });
    try {
      await r.body?.cancel?.();
    } catch {
      /* ignore */
    }
    const status = statusFromHttp(r.status);
    return { mode, status, port, ...(status === "ok" ? {} : { httpStatus: r.status }) };
  } catch {
    return { mode, status: "down", port };
  } finally {
    clearTimeout(timer);
  }
}

/** Legacy `krita` object (kept for compatibility); ok derived from the bridge status. */
export function legacyKrita(bridge) {
  const ok = bridge.status === "ok" || bridge.status === "mock" || bridge.status === "skipped";
  const k = { ok, status: bridge.status === "ok" ? "running" : bridge.status };
  if (bridge.port != null) k.port = bridge.port;
  if (bridge.httpStatus != null) k.detail = `bridge HTTP ${bridge.httpStatus}`;
  else if (bridge.status === "ok") k.detail = "bridge reachable";
  if (bridge.status === "down") k.error = "connection failed";
  if (bridge.status === "unauthorized") k.error = "bridge rejected the request (401/403)";
  return k;
}
