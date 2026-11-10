/**
 * S3-H E3 #43 — firstparty-default docs. AGENTS.md / docs/setup-linux.md say the box AC uses
 * BRIDGE=firstparty and CI uses BRIDGE=mock, and every env var / npm script they name exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const DOCS = ["AGENTS.md", "docs/setup-linux.md"];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (["node_modules", ".git", "data", "dist", "coverage"].includes(n)) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(m?js|ts|tsx|sh|py|ya?ml|json)$|^\.env\.example$/.test(n) && s.size < 2_000_000) out.push(p);
  }
  return out;
}
const corpus = walk(root).filter((p) => !p.endsWith("s3h-e3-docs.test.mjs")).map((p) => readFileSync(p, "utf8")).join("\n");

const scripts = new Set();
for (const p of walk(root).filter((p) => p.endsWith("package.json"))) {
  try { for (const k of Object.keys(JSON.parse(readFileSync(p, "utf8")).scripts || {})) scripts.add(k); } catch {}
}

test("#43 AGENTS.md + setup-linux state firstparty on the box, mock in CI", () => {
  for (const d of DOCS) {
    const t = read(d);
    assert.match(t, /box AC[^\n]*BRIDGE=firstparty/i, `${d}: box AC → BRIDGE=firstparty`);
    assert.match(t, /CI[^\n]*BRIDGE=mock/, `${d}: CI → BRIDGE=mock`);
  }
});

test("#43 the BRIDGE values the docs name are real modes", async () => {
  const { BRIDGE_MODES } = await import("../apps/world-builder/server/src/bridge.js");
  for (const d of DOCS) for (const [, v] of read(d).matchAll(/BRIDGE=([a-z]+)/g)) assert.ok(BRIDGE_MODES.includes(v), `${d}: BRIDGE=${v}`);
});

test("#43 every env var named in the docs is read somewhere in the repo", () => {
  const missing = [];
  for (const d of DOCS) {
    const t = read(d);
    const names = new Set([...t.matchAll(/(?:export\s+|`)([A-Z][A-Z0-9_]{2,})=/g)].map((m) => m[1]));
    for (const m of t.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)) names.add(m[1]);
    for (const n of names) if (!new RegExp(`\\b${n}\\b`).test(corpus)) missing.push(`${d}: ${n}`);
  }
  assert.deepEqual(missing, []);
});

test("#43 every `npm run <script>` named in the docs exists", () => {
  const missing = [];
  for (const d of DOCS) for (const [, s] of read(d).matchAll(/npm run ([a-z0-9:_-]+)/gi)) if (!scripts.has(s)) missing.push(`${d}: ${s}`);
  assert.deepEqual(missing, []);
});
