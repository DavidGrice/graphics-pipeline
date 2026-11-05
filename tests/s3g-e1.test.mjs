/**
 * S3-G E1 — #78 inbox PNG TTL sweep, #72 register webhook + fail-closed SSRF guard (R1 §3–§4, D2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ROOT, startApi, billboardBody, runId, tmpDataRoot } from "./helpers/s3d-synth.mjs";

const SRC = path.join(ROOT, "apps/world-builder/server/src");
const SERVER = path.join(SRC, "index.js");
const { parseInboxTtlHours, sweepInbox, referencedInboxNames } = await import(path.join(SRC, "inboxSweep.js"));
const { isBlockedIp, vetHost, parseWebhookConfig, createWebhook, sign, BLOCKED_V4, BLOCKED_V6 } = await import(path.join(SRC, "webhook.js"));
const { createActivityLog, ACTIVITY_KINDS } = await import(path.join(SRC, "activity.js"));

const HOUR = 3600 * 1000;
function inboxDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "s3g-inbox-"));
  return d;
}
function png(dir, name, ageH) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const t = (Date.now() - ageH * HOUR) / 1000;
  fs.utimesSync(f, t, t);
  return f;
}

// ---------------- #78 ----------------
test("#78 INBOX_TTL_HOURS: default 168, 1..8760, else CONFIG_INVALID naming the variable", () => {
  assert.equal(parseInboxTtlHours(undefined), 168);
  assert.equal(parseInboxTtlHours(""), 168);
  assert.equal(parseInboxTtlHours("1"), 1);
  assert.equal(parseInboxTtlHours("8760"), 8760);
  for (const bad of ["0", "8761", "-1", "1.5", "abc", "24h"]) {
    assert.throws(() => parseInboxTtlHours(bad), (e) => e.code === "CONFIG_INVALID" && /INBOX_TTL_HOURS/.test(e.message) && !e.message.includes(bad === "1.5" ? "1.5" : `"${bad}"`));
  }
});

test("#78 sweep: removes old PNGs only; keeps fresh, referenced, non-PNG, symlinks and subdirs", () => {
  const dir = inboxDir();
  png(dir, "old.png", 200);
  png(dir, "fresh.png", 10);
  png(dir, "ref.png", 500);
  png(dir, "sp.png", 500);
  png(dir, "old.txt", 500);
  fs.mkdirSync(path.join(dir, "sub"));
  png(path.join(dir, "sub"), "deep.png", 500);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "s3g-out-"));
  const target = png(outside, "target.png", 500);
  fs.symlinkSync(target, path.join(dir, "link.png"));
  const referenced = referencedInboxNames([
    { id: "a", importMeta: { originalFilename: "ref.png" } },
    { id: "b", formats: { sourcePng: "inbox/sp.png" } },
  ]);
  const warns = [];
  const r = sweepInbox({ inboxRoot: dir, ttlHours: 168, referenced, warn: (m) => warns.push(m) });
  assert.deepEqual(r, { removed: 1, kept: 3 });
  assert.ok(!fs.existsSync(path.join(dir, "old.png")));
  for (const f of ["fresh.png", "ref.png", "sp.png", "old.txt", "sub/deep.png", "link.png"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(fs.existsSync(target), "symlink target untouched");
  assert.deepEqual(warns, []);
});

test("#78 sweep: fake clock decides age; missing inbox is a no-op", () => {
  const dir = inboxDir();
  png(dir, "a.png", 0);
  assert.deepEqual(sweepInbox({ inboxRoot: dir, ttlHours: 1, now: Date.now() + 30 * 60 * 1000 }), { removed: 0, kept: 1 });
  assert.deepEqual(sweepInbox({ inboxRoot: dir, ttlHours: 1, now: Date.now() + 2 * HOUR }), { removed: 1, kept: 0 });
  assert.deepEqual(sweepInbox({ inboxRoot: path.join(dir, "nope"), ttlHours: 1 }), { removed: 0, kept: 0 });
});

test("#78 startup sweep via the API logs inbox.sweep {removed, kept} (only when removed > 0)", async () => {
  const dataRoot = tmpDataRoot("s3g-e1-");
  fs.mkdirSync(path.join(dataRoot, "inbox"), { recursive: true });
  png(path.join(dataRoot, "inbox"), "stale.png", 48);
  png(path.join(dataRoot, "inbox"), "new.png", 1);
  const api = await startApi({ WB_DATA_ROOT: dataRoot, INBOX_TTL_HOURS: "24" });
  try {
    assert.ok(!fs.existsSync(path.join(dataRoot, "inbox/stale.png")));
    assert.ok(fs.existsSync(path.join(dataRoot, "inbox/new.png")));
    const feed = await (await fetch(`${api.url}/api/activity`)).json();
    const sw = feed.items.filter((i) => i.kind === "inbox.sweep");
    assert.equal(sw.length, 1);
    assert.equal(sw[0].removed, 1);
    assert.equal(sw[0].kept, 1);
    assert.doesNotMatch(JSON.stringify(feed), /stale\.png|\/tmp\//);
  } finally {
    await api.stop();
  }
  const api2 = await startApi({ WB_DATA_ROOT: dataRoot, INBOX_TTL_HOURS: "24" });
  try {
    const feed = await (await fetch(`${api2.url}/api/activity`)).json();
    assert.equal(feed.items.filter((i) => i.kind === "inbox.sweep").length, 1, "no entry when nothing removed");
  } finally {
    await api2.stop();
  }
});

// ---------------- #72 guard ----------------
const SAMPLE = {
  "0.0.0.0/8": "0.1.2.3",
  "10.0.0.0/8": "10.9.8.7",
  "100.64.0.0/10": "100.100.1.1",
  "127.0.0.0/8": "127.0.0.1",
  "169.254.0.0/16": "169.254.169.254",
  "172.16.0.0/12": "172.20.0.1",
  "192.0.0.0/24": "192.0.0.8",
  "192.168.0.0/16": "192.168.1.1",
  "198.18.0.0/15": "198.19.0.1",
  "224.0.0.0/4": "239.1.1.1",
  "240.0.0.0/4": "250.0.0.1",
  "::/96": "::",
  "::1/128": "::1",
  "fc00::/7": "fd12::1",
  "fe80::/10": "fe80::1",
  "::ffff:0:0/96": "::ffff:8.8.8.8",
  "64:ff9b::/96": "64:ff9b::808:808",
  "ff00::/8": "ff02::1",
  "2002::/16": "2002:808:808::1",
};
test("#72 every R1 range has a sample (table complete)", () => {
  const ranges = [...BLOCKED_V4, ...BLOCKED_V6].map(([a, p]) => `${a}/${p}`);
  assert.deepEqual(new Set(Object.keys(SAMPLE)), new Set(ranges));
});
for (const [range, ip] of Object.entries(SAMPLE)) {
  test(`#72 guard refuses ${range} (stub resolver → ${ip})`, async () => {
    assert.equal(isBlockedIp(ip), true);
    const v = await vetHost("hook.example.com", { resolve: async () => [ip] });
    assert.deepEqual(v, { refused: "blocked_address" });
  });
}
test("#72 IPv6 hardening: ::/96 (IPv4-compatible), ff00::/8 multicast, 2002::/16 6to4 each refused via the fake resolver", async () => {
  for (const ip of ["::7f00:1", "::a00:1", "::0.0.0.1"]) {
    assert.equal(isBlockedIp(ip), true, `::/96 ${ip}`);
    assert.deepEqual(await vetHost("c.example", { resolve: async () => [ip] }), { refused: "blocked_address" });
  }
  for (const ip of ["ff02::1", "ff05::2", "ff0e::101"]) {
    assert.equal(isBlockedIp(ip), true, `ff00::/8 ${ip}`);
    assert.deepEqual(await vetHost("m6.example", { resolve: async () => [ip] }), { refused: "blocked_address" });
  }
  for (const ip of ["2002:7f00:1::1", "2002:808:808::1", "2002::"]) {
    assert.equal(isBlockedIp(ip), true, `2002::/16 ${ip}`);
    assert.deepEqual(await vetHost("t4.example", { resolve: async () => [ip] }), { refused: "blocked_address" });
  }
  assert.equal(isBlockedIp("2001:db8::1"), false, "neighbouring public-format range still passes");
  assert.equal(isBlockedIp("2003::1"), false);
});
test("#72 public addresses pass; mixed public + private records are refused", async () => {
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("2606:4700::1111"), false);
  assert.deepEqual(await vetHost("x.example", { resolve: async () => ["93.184.216.34"] }), { ip: "93.184.216.34" });
  assert.deepEqual(await vetHost("x.example", { resolve: async () => ["93.184.216.34", "10.0.0.1"] }), { refused: "blocked_address" });
  assert.deepEqual(await vetHost("x.example", { resolve: async () => ["2606:4700::1111", "::1"] }), { refused: "blocked_address" });
  assert.deepEqual(await vetHost("x.example", { resolve: async () => [] }), { refused: "dns" });
  assert.deepEqual(await vetHost("x.example", { resolve: async () => { throw new Error("NXDOMAIN"); } }), { refused: "dns" });
  assert.deepEqual(await vetHost("127.0.0.1"), { refused: "blocked_address" }, "IP literal vetted too");
});
test("#72 IPv4-mapped IPv6 refused in dotted and hex forms (loopback, private, metadata)", async () => {
  for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:192.168.0.1"]) {
    assert.equal(isBlockedIp(ip), true, ip);
    assert.deepEqual(await vetHost("m.example", { resolve: async () => [ip] }), { refused: "blocked_address" });
  }
  assert.equal(isBlockedIp("not-an-ip"), true, "garbage fails closed");
});

// ---------------- #72 config ----------------
test("#72 config: off by default; https only; http with WEBHOOK_ALLOW_HTTP=1; secret ≥ 16; flags 0/1", () => {
  assert.equal(parseWebhookConfig({}), null);
  assert.equal(parseWebhookConfig({ WEBHOOK_URL: "" }), null);
  assert.equal(parseWebhookConfig({ WEBHOOK_URL: "https://hook.example.com/x" }).url.hostname, "hook.example.com");
  assert.ok(parseWebhookConfig({ WEBHOOK_URL: "http://h.example/x", WEBHOOK_ALLOW_HTTP: "1" }));
  const bad = [
    [{ WEBHOOK_URL: "http://h.example/x" }, "WEBHOOK_URL"],
    [{ WEBHOOK_URL: "ftp://h.example/x" }, "WEBHOOK_URL"],
    [{ WEBHOOK_URL: "/relative" }, "WEBHOOK_URL"],
    [{ WEBHOOK_URL: "https://u:p@h.example/" }, "WEBHOOK_URL"],
    [{ WEBHOOK_URL: "https://h.example/", WEBHOOK_SECRET: "short" }, "WEBHOOK_SECRET"],
    [{ WEBHOOK_URL: "https://h.example/", WEBHOOK_ALLOW_HTTP: "yes" }, "WEBHOOK_ALLOW_HTTP"],
  ];
  for (const [env, v] of bad) {
    assert.throws(() => parseWebhookConfig(env), (e) => e.code === "CONFIG_INVALID" && e.variable === v && !e.message.includes("h.example") && !e.message.includes("short"));
  }
});
test("#72/#78 bad env refuses to start with CONFIG_INVALID naming the variable, never the value", () => {
  const cases = [
    ["INBOX_TTL_HOURS", "sekrit-ttl"],
    ["INBOX_TTL_HOURS", "99999"],
    ["WEBHOOK_URL", "http://secret-host.example/x"],
    ["WEBHOOK_SECRET", "tooShortValue"],
    ["WEBHOOK_ALLOW_HTTP", "maybe"],
  ];
  for (const [k, v] of cases) {
    const env = { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", WB_DATA_ROOT: tmpDataRoot("s3g-bad-"), [k]: v };
    if (k === "WEBHOOK_SECRET") env.WEBHOOK_URL = "https://h.example/";
    const r = spawnSync(process.execPath, [SERVER], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 1, k);
    assert.match(r.stderr, new RegExp(`CONFIG_INVALID: ${k}`));
    assert.ok(!r.stderr.includes(v), `${k} value not echoed`);
  }
});

// ---------------- #72 dispatch ----------------
function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port, close: () => new Promise((r) => s.close(r)) }));
  });
}
function memActivity() {
  const items = [];
  return { items, record: (kind, f) => items.push({ kind, ...f }) };
}
// fake value lives under tests/fixtures/ (gitleaks allowlist); never a real secret
const SECRET = fs.readFileSync(path.join(ROOT, "tests/fixtures/s3g-webhook-secret.txt"), "utf8").trim();

test("#72 happy path to a local server under the allow flags: JSON {event,id,slug,at}, valid HMAC, no paths", async () => {
  const got = [];
  const srv = await server((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      got.push({ headers: req.headers, body: b });
      res.writeHead(204).end();
    });
  });
  try {
    const cfg = parseWebhookConfig({ WEBHOOK_URL: `http://localhost:${srv.port}/hook`, WEBHOOK_ALLOW_HTTP: "1", WEBHOOK_ALLOW_PRIVATE: "1", WEBHOOK_SECRET: SECRET });
    const act = memActivity();
    const wh = createWebhook(cfg, { activity: act, resolve: async () => ["127.0.0.1"], warn: () => {} });
    assert.equal(await wh.emit("asset.register", { id: "a1", slug: "s1", formats: { glb: "assets/x.glb" } }), "sent");
    assert.equal(got.length, 1);
    const body = JSON.parse(got[0].body);
    assert.deepEqual(Object.keys(body).sort(), ["at", "event", "id", "slug"]);
    assert.equal(body.event, "asset.register");
    assert.equal(got[0].headers["x-webhook-signature"], sign(got[0].body, SECRET));
    assert.equal(got[0].headers["x-webhook-signature"], `sha256=${crypto.createHmac("sha256", SECRET).update(got[0].body).digest("hex")}`);
    assert.equal(got[0].headers.host, `localhost:${srv.port}`, "original Host kept while pinned to the IP");
    assert.doesNotMatch(got[0].body, /assets\//);
    assert.deepEqual(act.items, []);
  } finally {
    await srv.close();
  }
});

test("#72 without WEBHOOK_ALLOW_PRIVATE the same local target is refused (fail closed, no URL/IP in log)", async () => {
  let hits = 0;
  const srv = await server((_q, res) => { hits++; res.end(); });
  try {
    const cfg = parseWebhookConfig({ WEBHOOK_URL: `http://localhost:${srv.port}/hook`, WEBHOOK_ALLOW_HTTP: "1" });
    const act = memActivity();
    const warns = [];
    const wh = createWebhook(cfg, { activity: act, warn: (m) => warns.push(m) });
    assert.equal(await wh.emit("asset.register", { id: "a1" }), "refused");
    assert.equal(hits, 0);
    assert.deepEqual(act.items, [{ kind: "webhook.refused", reason: "blocked_address" }]);
    assert.doesNotMatch(warns.join("\n"), /localhost|127\.0\.0\.1|\/hook/);
  } finally {
    await srv.close();
  }
});

test("#72 redirect is refused, never followed (logged webhook.refused {reason: redirect})", async () => {
  let followed = 0;
  const target = await server((_q, res) => { followed++; res.end(); });
  const srv = await server((_q, res) => res.writeHead(302, { location: `http://127.0.0.1:${target.port}/` }).end());
  try {
    const cfg = parseWebhookConfig({ WEBHOOK_URL: `http://localhost:${srv.port}/`, WEBHOOK_ALLOW_HTTP: "1", WEBHOOK_ALLOW_PRIVATE: "1" });
    const act = memActivity();
    const wh = createWebhook(cfg, { activity: act, resolve: async () => ["127.0.0.1"], warn: () => {} });
    assert.equal(await wh.emit("asset.delete", { id: "a1" }), "refused");
    assert.equal(followed, 0);
    assert.deepEqual(act.items, [{ kind: "webhook.refused", reason: "redirect" }]);
  } finally {
    await srv.close();
    await target.close();
  }
});

test("#72 DNS is re-vetted per attempt: a rebinding answer on retry is refused", async () => {
  const srv = await server((_q, res) => res.writeHead(500).end());
  try {
    const cfg = parseWebhookConfig({ WEBHOOK_URL: `http://rebind.example:${srv.port}/`, WEBHOOK_ALLOW_HTTP: "1" });
    const act = memActivity();
    let n = 0;
    // first answer public (unreachable TEST-NET-free public ip would hang; use mocked outcome via 500 path is not possible) →
    // emulate by: first public-but-closed, second private → must refuse, never connect to private.
    const wh = createWebhook(cfg, { activity: act, resolve: async () => (n++ === 0 ? ["203.0.113.1"] : ["127.0.0.1"]), timeoutMs: 200, retryDelayMs: 10, warn: () => {} });
    assert.equal(await wh.emit("asset.register", { id: "a1" }), "refused");
    assert.deepEqual(act.items, [{ kind: "webhook.refused", reason: "blocked_address" }]);
  } finally {
    await srv.close();
  }
});

test("#72 timeout then exactly one retry, then webhook.failed; the caller is never failed", async () => {
  let hits = 0;
  const srv = await server(() => { hits++; /* never respond */ });
  try {
    const cfg = parseWebhookConfig({ WEBHOOK_URL: `http://localhost:${srv.port}/`, WEBHOOK_ALLOW_HTTP: "1", WEBHOOK_ALLOW_PRIVATE: "1" });
    const act = memActivity();
    const wh = createWebhook(cfg, { activity: act, resolve: async () => ["127.0.0.1"], timeoutMs: 150, retryDelayMs: 50, warn: () => {} });
    const t0 = Date.now();
    assert.equal(await wh.emit("asset.register", { id: "a1" }), "failed");
    assert.equal(hits, 2);
    assert.ok(Date.now() - t0 >= 300);
    assert.deepEqual(act.items, [{ kind: "webhook.failed" }]);
  } finally {
    srv.s.closeAllConnections?.();
    await srv.close();
  }
});

test("#72 off by default: emit is a no-op; activity log accepts only sanitised ops fields", async () => {
  assert.equal(await createWebhook(null).emit("asset.register", { id: "a" }), "off");
  assert.ok(["inbox.sweep", "webhook.refused", "webhook.failed"].every((k) => ACTIVITY_KINDS.includes(k)));
  const dataRoot = tmpDataRoot("s3g-act-");
  const log = createActivityLog({ dataRoot, warn: () => {} });
  await log.record("webhook.refused", { reason: "redirect", url: "http://evil/", ip: "10.0.0.1" });
  await log.record("inbox.sweep", { removed: 2, kept: 1, path: "/tmp/x" });
  const { items } = await log.read(10);
  assert.deepEqual(items.map(({ at, ...r }) => r), [{ kind: "inbox.sweep", removed: 2, kept: 1 }, { kind: "webhook.refused", reason: "redirect" }]);
  assert.doesNotMatch(fs.readFileSync(path.join(dataRoot, "activity.jsonl"), "utf8"), /evil|10\.0\.0\.1|\/tmp/);
});

test("#72 end-to-end: register + delete via the API fire the webhook after the response", async () => {
  const got = [];
  const srv = await server((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { got.push(JSON.parse(b)); res.writeHead(200).end(); });
  });
  const api = await startApi({ WEBHOOK_URL: `http://127.0.0.1:${srv.port}/h`, WEBHOOK_ALLOW_HTTP: "1", WEBHOOK_ALLOW_PRIVATE: "1", WEBHOOK_SECRET: SECRET });
  try {
    const id = runId("s3g-wh");
    const r = await fetch(`${api.url}/api/assets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(billboardBody(id, id)) });
    assert.equal(r.status, 201, await r.clone().text());
    const d = await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" });
    assert.equal(d.status, 204);
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((x) => setTimeout(x, 100));
    assert.deepEqual(got.map((g) => [g.event, g.id]), [["asset.register", id], ["asset.delete", id]]);
    assert.doesNotMatch(api.log(), new RegExp(SECRET));
  } finally {
    await api.stop();
    await srv.close();
  }
});

test("#72 WEBHOOK_ALLOW_PRIVATE=1 logs a startup warning without URL or secret", async () => {
  const api = await startApi({ WEBHOOK_URL: "https://hook-host.example/p", WEBHOOK_SECRET: SECRET, WEBHOOK_ALLOW_PRIVATE: "1" });
  try {
    assert.match(api.log(), /WARNING WEBHOOK_ALLOW_PRIVATE=1 is TEST-ONLY/);
    assert.ok(!api.log().includes(SECRET) && !api.log().includes("hook-host.example"));
  } finally {
    await api.stop();
  }
  const off = await startApi({});
  try {
    assert.doesNotMatch(off.log(), /WEBHOOK_ALLOW_PRIVATE/);
  } finally {
    await off.stop();
  }
});

test("#72 WEBHOOK_ALLOW_PRIVATE is never set in .env.example or .github/workflows", () => {
  const set = /^\s*(?:export\s+|-\s*)?WEBHOOK_ALLOW_PRIVATE\s*[:=]\s*["']?(?!0\b)\S/m;
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.doesNotMatch(env, set, ".env.example must only document it commented/unset");
  const wf = path.join(ROOT, ".github/workflows");
  for (const f of fs.readdirSync(wf)) {
    const t = fs.readFileSync(path.join(wf, f), "utf8");
    assert.doesNotMatch(t, /WEBHOOK_ALLOW_PRIVATE/, `${f} must not set WEBHOOK_ALLOW_PRIVATE`);
  }
  // self-check the matcher
  assert.match("WEBHOOK_ALLOW_PRIVATE=1", set);
  assert.match("  WEBHOOK_ALLOW_PRIVATE: '1'", set);
  assert.doesNotMatch("# WEBHOOK_ALLOW_PRIVATE=1", set);
});
