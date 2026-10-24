/**
 * Probe the krita-mcp in-process HTTP bridge (loopback).
 * Default start port 9797 (vendor kritarc); any HTTP response means GUI+bridge up
 * (401 is success — token required). Connection errors ⇒ Krita down.
 */
export type BridgeProbeResult =
  | { ok: true; port: number; detail: string }
  | { ok: false; port: number; error: string };

const DEFAULT_PORT = 9797;
const DEFAULT_TIMEOUT_MS = 1500;
const PORT_SCAN = 5;

export function kritaBridgePort(): number {
  const raw = process.env.KRITA_MCP_PORT;
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_PORT;
}

/**
 * Probe loopback bridge. Scans a few ports upward when KRITA_MCP_PORT unset
 * (vendor scans upward if 9797 is taken).
 */
export async function probeKritaBridge(
  opts: { port?: number; timeoutMs?: number; scan?: boolean } = {},
): Promise<BridgeProbeResult> {
  const start = opts.port ?? kritaBridgePort();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scan =
    opts.scan ?? process.env.KRITA_MCP_PORT === undefined;
  const ports = scan
    ? Array.from({ length: PORT_SCAN }, (_, i) => start + i)
    : [start];

  let lastErr = "connection refused";
  for (const port of ports) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: "GET",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // Any HTTP status ⇒ listener is up (incl. 401 without token).
      return {
        ok: true,
        port,
        detail: `Krita MCP bridge HTTP ${res.status} on 127.0.0.1:${port}`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    ok: false,
    port: start,
    error:
      `Krita MCP bridge not reachable on 127.0.0.1:${start}` +
      (scan ? `–${start + PORT_SCAN - 1}` : "") +
      ` (${lastErr}). Start Krita GUI, enable Tools → Scripts → MCP Bridge, ` +
      `or set KRITA_MCP_PORT.`,
  };
}
