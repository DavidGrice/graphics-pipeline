/**
 * S3-E E1 — #139 rate limit, #145 CORS allowlist, CONFIG_INVALID fail-closed env parsing
 * (R1 §1–2, D2 §1–2). Pure factories so tests can drive them without a socket.
 */
import { sendError } from "./errors.js";

export const CONFIG_INVALID = "CONFIG_INVALID";
export const RATE_LIMITED = "RATE_LIMITED";
export const CORS_ORIGIN_DENIED = "CORS_ORIGIN_DENIED";

export const RATE_LIMIT_PER_MIN_DEFAULT = 60;
/** R1 §2: unset → the vite dev UI only (localhost and 127.0.0.1 spellings). Never "*". */
export const CORS_ORIGINS_DEFAULT = ["http://localhost:5173", "http://127.0.0.1:5173"];
export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Fail-closed config error: names the variable, never echoes its value. */
export class ConfigError extends Error {
  constructor(variable, rule) {
    super(`${CONFIG_INVALID}: ${variable} ${rule}`);
    this.code = CONFIG_INVALID;
    this.variable = variable;
  }
}

export function parseRateLimitPerMin(raw) {
  if (raw == null || String(raw).trim() === "") return RATE_LIMIT_PER_MIN_DEFAULT;
  const t = String(raw).trim();
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(Number(t)) || Number(t) < 1) {
    throw new ConfigError("RATE_LIMIT_PER_MIN", "must be an integer >= 1");
  }
  return Number(t);
}

export function parseTrustProxy(raw) {
  if (raw == null || String(raw).trim() === "" || String(raw).trim() === "0") return false;
  if (String(raw).trim() === "1") return true;
  throw new ConfigError("TRUST_PROXY", "must be 0 or 1");
}

const ORIGIN_RE = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(?::([0-9]{1,5}))?$/i;

/** Exact origins only: scheme + host [+ port], no path / trailing slash / wildcard / creds. */
export function parseCorsOrigins(raw) {
  if (raw == null) return [...CORS_ORIGINS_DEFAULT];
  const parts = String(raw).split(",").map((s) => s.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) {
    throw new ConfigError("CORS_ORIGINS", "must be a comma list of exact origins (scheme://host[:port])");
  }
  const out = [];
  for (const p of parts) {
    const m = ORIGIN_RE.exec(p);
    if (p.includes("*") || !m || (m[3] && (Number(m[3]) < 1 || Number(m[3]) > 65535))) {
      throw new ConfigError("CORS_ORIGINS", "must be a comma list of exact origins (scheme://host[:port]); no wildcards or paths");
    }
    out.push(p.toLowerCase());
  }
  return [...new Set(out)];
}

/**
 * #145 — allowlisted origins get ACAO=<origin> (never *, never an unlisted reflection);
 * others get no ACAO; a disallowed preflight is 403 CORS_ORIGIN_DENIED. No Origin → untouched.
 */
export function corsAllowlist(origins) {
  const allow = new Set(origins.map((o) => o.toLowerCase()));
  return (req, res, next) => {
    res.vary("Origin");
    const origin = req.headers.origin;
    const isPreflight = req.method === "OPTIONS" && req.headers["access-control-request-method"];
    if (!origin) return isPreflight ? res.status(204).end() : next();
    const ok = allow.has(String(origin).toLowerCase());
    if (ok) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Expose-Headers", "Retry-After, X-Store");
    }
    if (isPreflight) {
      if (!ok) return sendError(res, 403, CORS_ORIGIN_DENIED, "origin is not in CORS_ORIGINS");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS");
      const reqHeaders = req.headers["access-control-request-headers"];
      res.setHeader("Access-Control-Allow-Headers", reqHeaders ? String(reqHeaders) : "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }
    return next();
  };
}

/**
 * Client key: socket address; with TRUST_PROXY=1 the RIGHT-most X-Forwarded-For entry (the one
 * our single trusted proxy appended — same as Express `trust proxy 1`). Left-most entries are
 * client-controlled and never used.
 */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const parts = xff ? String(xff).split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * #139 — per-client token bucket on mutating /api routes. Capacity = perMin, refill perMin/60 s.
 * Over → 429 RATE_LIMITED {retryAfterSec} + Retry-After (integer seconds ≥ 1). In-memory.
 */
export function rateLimiter({ perMin, trustProxy = false, now = () => Date.now() }) {
  const buckets = new Map();
  const ratePerMs = perMin / 60000;
  let sweepAt = now() + 60000;
  return (req, res, next) => {
    // Express routing is case-insensitive (/API/assets reaches /api/assets) → compare lowercased.
    if (!MUTATING_METHODS.has(req.method) || !String(req.path).toLowerCase().startsWith("/api/")) return next();
    const t = now();
    if (t >= sweepAt) {
      // drop full buckets so the map can't grow without bound
      for (const [k, b] of buckets) if (b.tokens + (t - b.at) * ratePerMs >= perMin) buckets.delete(k);
      sweepAt = t + 60000;
    }
    const key = clientKey(req, trustProxy);
    const b = buckets.get(key) ?? { tokens: perMin, at: t };
    b.tokens = Math.min(perMin, b.tokens + (t - b.at) * ratePerMs);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(key, b);
      return next();
    }
    buckets.set(key, b);
    const retryAfterSec = Math.max(1, Math.ceil((1 - b.tokens) / ratePerMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return sendError(res, 429, RATE_LIMITED, `too many changes; retry in ${retryAfterSec}s`, { retryAfterSec });
  };
}
