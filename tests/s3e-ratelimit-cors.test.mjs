/**
 * S3-E E1 #139 rate limit + #145 CORS allowlist + CONFIG_INVALID fail-closed start
 * (R1 §1–2, D2 §1–2). Hermetic APIs on free ports; low limits; no real sleeps (fake clock).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import {
  CORS_ORIGINS_DEFAULT,
  ConfigError,
  parseCorsOrigins,
  parseRateLimitPerMin,
  parseTrustProxy,
  rateLimiter,
} from "../apps/world-builder/server/src/security.js";

const ABS = /(^|[\s'"])\/(home|workspace|tmp|etc|usr|var)\//;
const SERVER = path.join(ROOT, "apps/world-builder/server/src/index.js");
let api; // default CORS, limit 3/min
before(async () => {
  api = await startApi({ RATE_LIMIT_PER_MIN: "3" });
});
after(async () => api && (await api.stop()));

// ---------------------------------------------------------------- CONFIG_INVALID
test("CONFIG_INVALID parsers: defaults, valid values, rejections never echo the value", () => {
  assert.equal(parseRateLimitPerMin(undefined), 60);
  assert.equal(parseRateLimitPerMin(""), 60);
  assert.equal(parseRateLimitPerMin(" 5 "), 5);
  for (const bad of ["0", "-1", "1.5", "abc", "1e3", "99999999999999999999"]) {
    assert.throws(() => parseRateLimitPerMin(bad), (e) => e instanceof ConfigError && e.variable === "RATE_LIMIT_PER_MIN" && !e.message.includes(bad));
  }
  assert.deepEqual(parseCorsOrigins(undefined), CORS_ORIGINS_DEFAULT);
  assert.deepEqual(CORS_ORIGINS_DEFAULT, ["http://localhost:5173", "http://127.0.0.1:5173"]);
  assert.deepEqual(parseCorsOrigins("https://a.example, http://127.0.0.1:5174"), ["https://a.example", "http://127.0.0.1:5174"]);
  for (const bad of ["*", "http://*.example", "https://a.example/", "https://a.example/app", "a.example", "", "https://a.example,", "ftp://a.example", "http://a.example:99999", "http://u:p@a.example"]) {
    assert.throws(() => parseCorsOrigins(bad), (e) => e instanceof ConfigError && e.variable === "CORS_ORIGINS" && (bad === "" || !e.message.includes(bad)), `CORS_ORIGINS=${bad}`);
  }
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy("1"), true);
  assert.throws(() => parseTrustProxy("yes"), ConfigError);
});

test("CONFIG_INVALID: server refuses to start (exit 1), names the variable, never its value", () => {
  const cases = [
    ["RATE_LIMIT_PER_MIN", "0"],
    ["RATE_LIMIT_PER_MIN", "sekrit-12"],
    ["CORS_ORIGINS", "*"],
    ["CORS_ORIGINS", "https://sekrit.example/path"],
    ["TRUST_PROXY", "sekrit"],
  ];
  for (const [k, v] of cases) {
    const r = spawnSync(process.execPath, [SERVER], {
      env: { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", [k]: v },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(r.status, 1, `${k}=${v} must refuse to start`);
    const line = r.stderr.trim();
    assert.match(line, new RegExp(`FATAL CONFIG_INVALID: ${k} `));
    if (v.length > 1) assert.ok(!line.includes(v), `${k} value must not be echoed`);
    assert.ok(!/\n/.test(line) && !/at .*\.m?js:\d+/.test(line), "one line, no stack");
  }
});

// ---------------------------------------------------------------- #145 CORS
test("#145 allowed origin → ACAO=<origin> + Vary: Origin (never *); disallowed → processed, no ACAO; no Origin → unaffected", async () => {
  const ok = await fetch(`${api.url}/api/assets`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(ok.headers.get("vary") ?? "", /Origin/);
  const ok2 = await fetch(`${api.url}/api/assets`, { headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(ok2.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  for (const o of ["http://evil.example", "http://localhost:5174", "https://localhost:5173", "null"]) {
    const r = await fetch(`${api.url}/api/assets`, { headers: { Origin: o } });
    assert.equal(r.status, 200, `${o}: simple request still processed`);
    assert.equal(r.headers.get("access-control-allow-origin"), null, `${o}: no ACAO`);
    assert.match(r.headers.get("vary") ?? "", /Origin/);
  }
  const none = await fetch(`${api.url}/api/assets`);
  assert.equal(none.status, 200);
  assert.equal(none.headers.get("access-control-allow-origin"), null);
});

test("#145 preflight: allowed → 204 + ACAO/methods; disallowed → 403 CORS_ORIGIN_DENIED flat, no ACAO", async () => {
  const pre = (origin) =>
    fetch(`${api.url}/api/assets/x`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type" },
    });
  const ok = await pre("http://localhost:5173");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(ok.headers.get("access-control-allow-methods"), /PATCH/);
  assert.match(ok.headers.get("access-control-allow-headers"), /content-type/i);
  const bad = await pre("http://evil.example");
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  const j = await bad.json();
  assert.equal(j.code, "CORS_ORIGIN_DENIED");
  assert.equal(typeof j.error, "string");
  assert.ok(!JSON.stringify(j).includes("evil.example") && !ABS.test(JSON.stringify(j)));
  for (const v of Object.values(j)) assert.notEqual(typeof v, "object", "flat body");
});

test("#145 CORS_ORIGINS env replaces the default list exactly", async () => {
  const a = await startApi({ CORS_ORIGINS: "http://127.0.0.1:5174" });
  try {
    const r1 = await fetch(`${a.url}/api/assets`, { headers: { Origin: "http://127.0.0.1:5174" } });
    assert.equal(r1.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");
    const r2 = await fetch(`${a.url}/api/assets`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(r2.headers.get("access-control-allow-origin"), null, "default no longer allowed");
  } finally {
    await a.stop();
  }
});

// ---------------------------------------------------------------- #139 rate limit
test("#139 mutating /api over the limit → 429 RATE_LIMITED {retryAfterSec} + Retry-After; GET/OPTIONS exempt; XFF ignored", async () => {
  const id = runId("139");
  const post = (headers = {}) =>
    fetch(`${api.url}/api/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(billboardBody(id, `s3e-rl-${process.pid}`)),
    });
  // GET / OPTIONS never consume tokens
  for (let i = 0; i < 6; i++) assert.equal((await fetch(`${api.url}/api/assets`)).status, 200);
  for (let i = 0; i < 6; i++) {
    const o = await fetch(`${api.url}/api/assets`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(o.status, 204, "preflight never throttled");
  }
  assert.notEqual((await fetch(`${api.url}/api/assets`, { method: "HEAD" })).status, 429);
  assert.equal((await post()).status, 201);
  // a rejected (4xx) mutation still consumes a token
  const v = await fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.notEqual(v.status, 429);
  assert.equal((await fetch(`${api.url}/api/assets/nope`, { method: "DELETE" })).status, 404);
  const r = await post({ "X-Forwarded-For": "203.0.113.9", Origin: "http://localhost:5173" });
  assert.equal(r.status, 429, "XFF must not open a new bucket without TRUST_PROXY=1");
  const ra = r.headers.get("retry-after");
  assert.match(ra, /^[1-9][0-9]*$/);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ["code", "error", "retryAfterSec"]);
  assert.equal(j.code, "RATE_LIMITED");
  assert.equal(j.retryAfterSec, Number(ra));
  assert.ok(j.retryAfterSec >= 1 && j.retryAfterSec <= 20, "3/min → ≤ 20 s for one token");
  assert.ok(!/127\.0\.0\.1|::1|203\.0\.113/.test(JSON.stringify(j)), "body never echoes an IP");
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:5173", "UI can read the 429");
  assert.equal((await fetch(`${api.url}/api/assets/${id}`)).status, 200, "GET still served");
  assert.equal((await fetch(`${api.url}/api/health`)).status, 200);
});

test("#139 TRUST_PROXY=1 → buckets keyed by the left-most X-Forwarded-For", async () => {
  const a = await startApi({ RATE_LIMIT_PER_MIN: "1", TRUST_PROXY: "1" });
  try {
    const del = (ip) => fetch(`${a.url}/api/assets/nope`, { method: "DELETE", headers: { "X-Forwarded-For": `${ip}, 10.0.0.1` } });
    assert.equal((await del("198.51.100.1")).status, 404);
    assert.equal((await del("198.51.100.1")).status, 429);
    assert.equal((await del("198.51.100.2")).status, 404, "other client has its own bucket");
  } finally {
    await a.stop();
  }
});

test("#139 token bucket math (fake clock): capacity N, refill N/60 per s, Retry-After ceil ≥ 1, scope", () => {
  let t = 0;
  const mw = rateLimiter({ perMin: 60, now: () => t });
  const run = (method = "POST", p = "/api/assets") => {
    const res = {
      headers: {},
      statusCode: 200,
      body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    let passed = false;
    mw({ method, path: p, headers: {}, socket: { remoteAddress: "127.0.0.1" } }, res, () => (passed = true));
    return { passed, res };
  };
  for (let i = 0; i < 60; i++) assert.ok(run().passed, `burst ${i}`);
  const over = run("PATCH", "/api/assets/x");
  assert.equal(over.passed, false);
  assert.equal(over.res.statusCode, 429);
  assert.equal(over.res.headers["retry-after"], "1");
  assert.equal(over.res.body.retryAfterSec, 1);
  assert.ok(run("GET").passed && run("HEAD").passed && run("OPTIONS").passed, "safe methods exempt");
  assert.ok(run("POST", "/data/x").passed, "only /api/ is limited");
  t += 1000; // one token back
  assert.ok(run("DELETE", "/api/assets/x").passed);
  assert.equal(run().passed, false);
  t += 60_000; // full refill, capped at capacity
  for (let i = 0; i < 60; i++) assert.ok(run().passed);
  assert.equal(run().passed, false);
  // slow limit: 2/min → one token every 30 s
  let t2 = 0;
  const slow = rateLimiter({ perMin: 2, now: () => t2 });
  const call = () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; } };
    let ok = false;
    slow({ method: "POST", path: "/api/x", headers: {}, socket: { remoteAddress: "a" } }, res, () => (ok = true));
    return { ok, res };
  };
  assert.ok(call().ok && call().ok);
  assert.equal(call().res.b.retryAfterSec, 30);
  t2 += 29_500;
  assert.equal(call().res.b.retryAfterSec, 1);
});

test("#139 register_asset CLI: 429 → one clean ERROR RATE_LIMITED line, exit 1, no orphan dir", async () => {
  const a = await startApi({ RATE_LIMIT_PER_MIN: "1" });
  const fs = await import("node:fs");
  const os = await import("node:os");
  const { makeRiggedGlb } = await import("./helpers/s3d-synth.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-139-"));
  try {
    const glb = path.join(dir, "a.glb");
    fs.writeFileSync(glb, makeRiggedGlb());
    assert.equal((await fetch(`${a.url}/api/assets/nope`, { method: "DELETE" })).status, 404); // spend the token
    const id = runId("139cli");
    const r = spawnSync(process.execPath, [path.join(ROOT, "apps/blender-pipeline/register_asset.mjs"), "--id", id, "--slug", `s3e-rl-cli-${process.pid}`, "--glb", glb, "--api", a.url], {
      env: { ...process.env, WB_DATA_ROOT: a.dataRoot },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const line = r.stderr.trim();
    assert.match(line, /^ERROR RATE_LIMITED: API is throttling changes; retry in \d+s$/);
    assert.ok(!fs.existsSync(path.join(a.dataRoot, "assets", id)), "no orphan asset dir");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await a.stop();
  }
});
