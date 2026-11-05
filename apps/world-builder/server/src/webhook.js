/**
 * S3-G #72 — webhook on register/delete (R1 §4, D2). OFF unless WEBHOOK_URL is set.
 * Guard is mandatory and fails closed:
 *  - every A/AAAA record is resolved and vetted; ANY blocked record refuses the send
 *  - the connection is pinned to the vetted IP (custom `lookup`), original Host + SNI kept (anti-rebinding)
 *  - 3xx is never followed (refused, reason "redirect")
 *  - WEBHOOK_ALLOW_PRIVATE=1 (TEST-ONLY, DANGEROUS) lifts the range check
 * Fire-and-forget: 3 s timeout, one retry after 1 s; never fails the request; never logs URL/IP/secret.
 */
import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ConfigError } from "./security.js";

export const WEBHOOK_TIMEOUT_MS = 3000;
export const WEBHOOK_RETRY_DELAY_MS = 1000;
export const WEBHOOK_EVENTS = Object.freeze(["asset.register", "asset.delete"]);

/** R1 §4 blocked ranges (mapped ::ffff:a.b.c.d additionally checked as v4). */
export const BLOCKED_V4 = Object.freeze([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
]);
export const BLOCKED_V6 = Object.freeze([
  // ::/96 = unspecified + IPv4-compatible; ff00::/8 multicast; 2002::/16 6to4 blocked wholesale
  ["::", 96], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["ff00::", 8], ["2002::", 16],
]);

const v4List = new net.BlockList();
for (const [a, p] of BLOCKED_V4) v4List.addSubnet(a, p, "ipv4");
const v6List = new net.BlockList();
for (const [a, p] of BLOCKED_V6) v6List.addSubnet(a, p, "ipv6");

/** IPv4 embedded in an IPv4-mapped IPv6 address (dotted or hex form), else null. */
function mappedV4(ip) {
  const m = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip) || /^::ffff:(.+)$/i.exec(ip);
  if (!m) return null;
  const tail = m[1];
  if (net.isIPv4(tail)) return tail;
  const h = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!h) return null;
  const hi = parseInt(h[1], 16);
  const lo = parseInt(h[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** true when `ip` is not a valid IP or falls in any blocked range (fail closed). */
export function isBlockedIp(ip) {
  if (typeof ip !== "string") return true;
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (net.isIPv4(bare)) return v4List.check(bare, "ipv4");
  if (net.isIPv6(bare)) {
    const v4 = mappedV4(bare);
    if (v4 && v4List.check(v4, "ipv4")) return true;
    return v6List.check(bare, "ipv6");
  }
  return true;
}

export function parseWebhookConfig(env = process.env) {
  const rawUrl = env.WEBHOOK_URL;
  const flag = (k) => {
    const v = env[k];
    if (v == null || v === "" || v === "0") return false;
    if (v === "1") return true;
    throw new ConfigError(k, "must be 0 or 1");
  };
  const allowHttp = flag("WEBHOOK_ALLOW_HTTP");
  const allowPrivate = flag("WEBHOOK_ALLOW_PRIVATE");
  const secret = env.WEBHOOK_SECRET;
  if (secret != null && secret !== "" && secret.length < 16) throw new ConfigError("WEBHOOK_SECRET", "must be at least 16 characters");
  if (rawUrl == null || String(rawUrl).trim() === "") return null; // off by default
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    throw new ConfigError("WEBHOOK_URL", "must be an absolute https URL");
  }
  if (u.username || u.password || !u.hostname) throw new ConfigError("WEBHOOK_URL", "must be an absolute https URL without credentials");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && allowHttp)) {
    throw new ConfigError("WEBHOOK_URL", "must be an absolute https URL (http only with WEBHOOK_ALLOW_HTTP=1)");
  }
  return { url: u, secret: secret || null, allowPrivate };
}

async function defaultResolve(host) {
  const recs = await dns.promises.lookup(host, { all: true, verbatim: true });
  return recs.map((r) => r.address);
}

/** Vet a host → {ip} or {refused: reason}. Every record must pass. */
export async function vetHost(hostname, { resolve = defaultResolve, allowPrivate = false } = {}) {
  const host = hostname.replace(/^\[|\]$/g, "");
  let ips;
  if (net.isIP(host)) ips = [host];
  else {
    try {
      ips = await resolve(host);
    } catch {
      return { refused: "dns" };
    }
  }
  if (!Array.isArray(ips) || ips.length === 0) return { refused: "dns" };
  if (!allowPrivate && ips.some((ip) => isBlockedIp(ip))) return { refused: "blocked_address" };
  if (ips.some((ip) => !net.isIP(String(ip).replace(/%.*$/, "")))) return { refused: "dns" };
  return { ip: ips[0] };
}

export function sign(body, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** One pinned POST → {status} | throws. Never follows redirects (raw http(s) request). */
function postOnce(url, ip, body, headers, timeoutMs) {
  const mod = url.protocol === "https:" ? https : http;
  const family = net.isIPv6(ip) ? 6 : 4;
  return new Promise((resolveP, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, host: url.host },
        servername: net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
        // pin: the socket connects ONLY to the vetted IP, whatever DNS says now
        lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family)),
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolveP({ status: res.statusCode }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Create the dispatcher. `emit(event, doc)` is fire-and-forget and resolves to the outcome
 * ("sent" | "refused" | "failed" | "off") — for tests; callers `void` it.
 */
export function createWebhook(config, {
  activity,
  resolve = defaultResolve,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
  retryDelayMs = WEBHOOK_RETRY_DELAY_MS,
  warn = console.warn,
} = {}) {
  const log = (kind, fields) => {
    try {
      void activity?.record(kind, fields);
    } catch {
      /* never fatal */
    }
  };
  return {
    enabled: !!config,
    async emit(event, doc) {
      if (!config || !WEBHOOK_EVENTS.includes(event) || !doc || typeof doc.id !== "string") return "off";
      try {
        const payload = { event, id: doc.id, slug: typeof doc.slug === "string" ? doc.slug : null, at: new Date().toISOString() };
        const body = JSON.stringify(payload);
        const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
        if (config.secret) headers["x-webhook-signature"] = sign(body, config.secret);
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, retryDelayMs));
          const v = await vetHost(config.url.hostname, { resolve, allowPrivate: config.allowPrivate });
          if (v.refused) {
            log("webhook.refused", { reason: v.refused });
            warn(`[world-builder] webhook refused (${v.refused})`);
            return "refused";
          }
          try {
            const { status } = await postOnce(config.url, v.ip, body, headers, timeoutMs);
            if (status >= 300 && status < 400) {
              log("webhook.refused", { reason: "redirect" });
              warn("[world-builder] webhook refused (redirect)");
              return "refused";
            }
            if (status >= 200 && status < 300) return "sent";
          } catch {
            /* timeout / network → retry once */
          }
        }
        log("webhook.failed", {});
        warn("[world-builder] webhook failed after retry");
        return "failed";
      } catch {
        log("webhook.failed", {});
        return "failed";
      }
    },
  };
}
