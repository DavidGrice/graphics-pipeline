/**
 * S3-H #101 — contract fuzz (R1 §12). Exact-pinned fast-check fuzzes register (POST /api/assets),
 * PATCH /api/assets/:id, PUT /api/featured and pack import (POST with X-Activity-Kind: pack.import)
 * with dishonest payloads. Every response is a success or a flat {code, error} whose code is listed in
 * docs/error-codes.md — never an absolute path or a stack.
 * Seed: FUZZ_SEED, else fixed in CI, else random. Runs: FUZZ_RUNS (default 200 per route).
 * On failure the message starts with `FUZZ_SEED=<n>` and carries the shrunk counterexample.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { ROOT, startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";

const CI_SEED = 1337101;
export function fuzzSeed(env = process.env) {
  if (env.FUZZ_SEED != null && /^-?[0-9]+$/.test(String(env.FUZZ_SEED).trim())) return Number(env.FUZZ_SEED);
  if (env.CI) return CI_SEED;
  return Math.floor(Math.random() * 2 ** 31);
}
export function fuzzRuns(env = process.env) {
  const n = Number(env.FUZZ_RUNS);
  return Number.isSafeInteger(n) && n > 0 ? n : 200;
}
const SEED = fuzzSeed();
const RUNS = fuzzRuns();
const DOC_CODES = new Set(
  [...fs.readFileSync(path.join(ROOT, "docs/error-codes.md"), "utf8").matchAll(/^\| `([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]),
);
const ABS = /(^|[\s"'(=:])\/(home|workspace|tmp|etc|usr|var|root|Users)\//;
const STACK = /\n\s+at |\bat [\w.<>]+ \(.*:\d+:\d+\)/;

let api;
let sceneId;
const json = { "Content-Type": "application/json" };
before(async () => {
  api = await startApi();
  sceneId = runId("fuzz-scene-child");
  const r = await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(billboardBody(sceneId, `fuzz-base-${process.pid}`)) });
  assert.equal(r.status, 201);
});
after(async () => {
  await api?.stop?.();
});

/** Dishonest JSON values: wrong types, huge strings, traversal, prototype keys, deep nesting. */
const nasty = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double(),
  fc.string({ maxLength: 40 }),
  fc.constantFrom("../../../../etc/passwd", "/etc/hostname", "C:\\\\Windows", "%2e%2e/", "__proto__", "constructor", "x".repeat(5000), "", " ", "\u0000"),
  fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
  fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }), { maxKeys: 3 }),
);
const assetish = fc.record(
  {
    id: fc.oneof(fc.uuid(), nasty),
    slug: fc.oneof(fc.constantFrom("ok-slug", "Bad Slug", "../x"), nasty),
    name: nasty,
    stage: fc.oneof(fc.constantFrom("mvp-billboard", "rigged", "scene", "nope"), nasty),
    characterType: fc.oneof(fc.constantFrom("billboard", "humanoid", "unknown"), nasty),
    formats: fc.oneof(fc.record({ glb: nasty, preview: nasty }, { requiredKeys: [] }), nasty),
    clips: fc.oneof(fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }), nasty),
    license: nasty,
    scene: fc.oneof(
      fc.record({ version: nasty, rootId: nasty, nodes: fc.oneof(fc.array(fc.record({ id: nasty, assetId: nasty, transform: nasty }, { requiredKeys: [] }), { maxLength: 4 }), nasty), cameras: nasty }, { requiredKeys: [] }),
      nasty,
    ),
    clipUx: nasty,
    importMeta: nasty,
    createdAt: nasty,
  },
  { requiredKeys: [] },
);

/** The contract every response must keep. Returns a problem string or null. */
async function checkResponse(r, sent) {
  const text = await r.text();
  // a value the client itself sent may be echoed back (e.g. FEATURED_INVALID.invalid); only server paths count
  const echoed = [];
  const walk = (v) => {
    if (typeof v === "string") echoed.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(sent);
  let scan = text;
  // D2: echoes are allowed within the 200-char cap (a capped echo is the first 199 chars + "…")
  const forms = echoed.flatMap((s) => (s.length > 200 ? [s.slice(0, 199) + "…"] : [s]));
  for (const s of forms.sort((a, b) => b.length - a.length)) if (s.length > 1) scan = scan.split(JSON.stringify(s).slice(1, -1)).join("");
  // D2: only on error bodies, flag uncapped echoes of client-sent values (not server-written text, not 2xx payloads)
  if (r.status >= 400) {
    const over = echoed.filter((s) => s.length > 200);
    for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      let s;
      try {
        s = JSON.parse(`"${m[1]}"`);
      } catch {
        continue;
      }
      if (typeof s !== "string" || s.length <= 200) continue;
      if (over.some((sent) => s === sent || sent.startsWith(s) || s.startsWith(sent.slice(0, 200)) || s.includes(sent.slice(0, 201)))) {
        return `echo over 200 chars in ${r.status} body`;
      }
    }
  }
  if (ABS.test(scan)) return `absolute path in ${r.status} body: ${text.slice(0, 200)}`;
  if (STACK.test(text)) return `stack trace in ${r.status} body`;
  if (r.status < 400) return null;
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return `non-JSON ${r.status} body: ${text.slice(0, 120)}`;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return `non-object ${r.status} body`;
  if (typeof j.code !== "string" || typeof j.error !== "string") return `not flat {code, error}: ${text.slice(0, 160)}`;
  if (!DOC_CODES.has(j.code)) return `undocumented code ${j.code}`;
  for (const v of Object.values(j)) if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => x && typeof x === "object")) return "nested error body";
  return null;
}

async function fuzz(name, arb, send) {
  try {
    await fc.assert(
      fc.asyncProperty(arb, async (input) => {
        const problem = await checkResponse(await send(input), input);
        if (problem) throw new Error(problem);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  } catch (e) {
    // fast-check's message carries the shrunk counterexample + path; lead with the seed (R1 §12)
    const msg = `FUZZ_SEED=${SEED} (${name}, FUZZ_RUNS=${RUNS})\n${e?.message ?? e}`;
    console.error(msg);
    throw new Error(msg);
  }
}

test("#101 seed/runs: FUZZ_SEED wins, CI fixed, FUZZ_RUNS overrides (default 200); fast-check exact-pinned", () => {
  assert.equal(fuzzSeed({ FUZZ_SEED: "42" }), 42);
  assert.equal(fuzzSeed({ CI: "true" }), CI_SEED);
  assert.equal(fuzzRuns({}), 200);
  assert.equal(fuzzRuns({ FUZZ_RUNS: "7" }), 7);
  assert.equal(fuzzRuns({ FUZZ_RUNS: "x" }), 200);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.devDependencies["fast-check"], /^\d+\.\d+\.\d+$/, "exact pin, no ^/~");
});

test("#101 failure output leads with FUZZ_SEED and the shrunk counterexample", async () => {
  const seen = [];
  const orig = console.error;
  console.error = (m) => seen.push(String(m));
  try {
    await assert.rejects(
      fuzz("selftest", fc.integer({ min: 0, max: 1000 }), async (n) => new Response(n > 10 ? JSON.stringify({ code: "NOPE_NOT_A_CODE", error: "x" }) : "{}", { status: n > 10 ? 400 : 200 })),
      (e) => /^FUZZ_SEED=-?\d+/.test(e.message) && /Counterexample: \[11\]/.test(e.message),
    );
  } finally {
    console.error = orig;
  }
  assert.ok(seen.some((s) => s.startsWith(`FUZZ_SEED=${SEED}`)));
});

test("#101 fuzz register: POST /api/assets", async () => {
  await fuzz("register", assetish, (body) => fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) }));
});

test("#101 fuzz PATCH /api/assets/:id (incl. dishonest If-Match)", async () => {
  await fuzz(
    "patch",
    fc.tuple(assetish, fc.oneof(fc.constant(undefined), fc.constantFrom("*", '"x"', "x", "W/\"x\""), fc.string({ maxLength: 20 }))),
    ([body, im]) => {
      const headers = { ...json };
      if (im !== undefined) headers["If-Match"] = im.replace(/[^\x20-\x7e]/g, "");
      return fetch(`${api.url}/api/assets/${sceneId}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    },
  );
});

test("#101 fuzz PUT /api/featured", async () => {
  await fuzz(
    "featured",
    fc.oneof(fc.record({ sceneIds: fc.oneof(fc.array(fc.oneof(fc.uuid(), nasty), { maxLength: 25 }), nasty) }, { requiredKeys: [] }), nasty),
    (body) => fetch(`${api.url}/api/featured`, { method: "PUT", headers: json, body: JSON.stringify(body) }),
  );
});

test("#101 fuzz pack import: POST /api/assets with X-Activity-Kind: pack.import", async () => {
  await fuzz("pack-import", assetish, (body) =>
    fetch(`${api.url}/api/assets`, { method: "POST", headers: { ...json, "X-Activity-Kind": "pack.import" }, body: JSON.stringify(body) }),
  );
});

// ---------------------------------------------------------------- Leader ruling (D2): echo cap
test("echo cap: client values echoed in 400 bodies are kept but capped at 200 chars", async () => {
  const { capEcho, capQuoted, ECHO_MAX } = await import("../apps/world-builder/server/src/errors.js");
  assert.equal(ECHO_MAX, 200);
  const L = "x".repeat(5000);
  assert.equal(capEcho({ invalid: [L], issues: [{ received: L, path: ["a"] }] }).issues[0].received.length, 200);
  assert.equal(capEcho({ invalid: [L] }).invalid[0].endsWith("…"), true);
  assert.equal(capEcho("short"), "short");
  assert.equal(capQuoted(`bad, received '${L}'`).length, "bad, received ''".length + 200);
  const longest = (t) => Math.max(0, ...(t.match(/x+/g) || []).map((s) => s.length));
  for (const [method, url, body] of [
    ["PUT", "/api/featured", { sceneIds: [L] }],
    ["POST", "/api/assets", { id: crypto.randomUUID(), slug: "ok-slug", characterType: L }],
  ]) {
    const r = await fetch(`${api.url}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    assert.equal(r.status, 400, url);
    assert.ok(text.includes("x".repeat(150)), `${url}: echo kept`);
    assert.ok(longest(text) <= ECHO_MAX, `${url}: echo capped (${longest(text)})`);
    assert.ok(text.includes("…"), `${url}: truncation marked`);
  }
});

test("echo oracle: rejects an injected uncapped 5000-char echo", async () => {
  const L = "x".repeat(5000);
  const uncapped = JSON.stringify({ code: "FEATURED_INVALID", error: "bad", invalid: [L] });
  const problem = await checkResponse({ status: 400, text: async () => uncapped }, { sceneIds: [L] });
  assert.match(problem ?? "", /echo over 200 chars/);
  const capped = L.slice(0, 199) + "…";
  const ok = await checkResponse(
    { status: 400, text: async () => JSON.stringify({ code: "FEATURED_INVALID", error: "bad", invalid: [capped] }) },
    { sceneIds: [L] },
  );
  assert.equal(ok, null);
  // server-written long string (not a client echo) must not trip the oracle
  const serverOnly = "y".repeat(5000);
  const serverBody = JSON.stringify({ code: "FEATURED_INVALID", error: serverOnly });
  assert.equal(await checkResponse({ status: 400, text: async () => serverBody }, { sceneIds: [L] }), null);
  // mid-string zod-style uncapped echo (the case capQuoted handles)
  const mid = JSON.stringify({ code: "FEATURED_INVALID", error: `bad, received '${L}'` });
  assert.match((await checkResponse({ status: 400, text: async () => mid }, { sceneIds: [L] })) ?? "", /echo over 200 chars/);
});
