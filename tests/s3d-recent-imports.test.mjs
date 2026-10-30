/**
 * S3-D E2 #94 — Recent imports: newest 20 by createdAt, legacy (no createdAt) last
 * (R1 rev2 §10, D2 §2). GET /api/assets?sort=-createdAt&limit=20; limit 1–100 else 400 VALIDATION.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  startApi,
  billboardBody,
  loadClientTs,
  browserEnv,
  CHROME_ARGS,
  runId,
} from "./helpers/s3d-synth.mjs";

let api;
let P;
const post = (body) =>
  fetch(`${api.url}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const iso = (n) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();

before(async () => {
  api = await startApi();
  P = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
  // 24 dated assets inserted in a shuffled order + 2 legacy ("unknown" createdAt)
  const order = [...Array(24).keys()].sort((a, b) => ((a * 7) % 24) - ((b * 7) % 24));
  for (const n of order) {
    const r = await post({ ...billboardBody(runId(`r${n}`), `hist-${n}`), createdAt: iso(n), updatedAt: iso(n) });
    assert.equal(r.status, 201);
  }
  for (const n of [0, 1]) {
    const r = await post({ ...billboardBody(runId(`l${n}`), `legacy-${n}`), createdAt: "legacy", updatedAt: "legacy" });
    assert.equal(r.status, 201);
  }
});
after(async () => api && (await api.stop()));

test("#94 sort=-createdAt&limit=20 → newest 20, strictly descending", async () => {
  const r = await fetch(`${api.url}/api/assets?sort=-createdAt&limit=20`);
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.equal(list.length, 20);
  assert.deepEqual(
    list.map((a) => a.slug),
    [...Array(20).keys()].map((i) => `hist-${23 - i}`),
  );
});

test("#94 legacy assets without a parseable createdAt sort last (both directions)", async () => {
  const desc = await (await fetch(`${api.url}/api/assets?sort=-createdAt&limit=100`)).json();
  assert.deepEqual(desc.slice(-2).map((a) => a.slug), ["legacy-0", "legacy-1"]);
  const asc = await (await fetch(`${api.url}/api/assets?sort=createdAt`)).json();
  assert.equal(asc[0].slug, "hist-0");
  assert.deepEqual(asc.slice(-2).map((a) => a.slug), ["legacy-0", "legacy-1"]);
  // filters still apply before sort/limit
  const q = await (await fetch(`${api.url}/api/assets?q=hist-1&sort=-createdAt&limit=3`)).json();
  assert.deepEqual(q.map((a) => a.slug), ["hist-19", "hist-18", "hist-17"]);
});

test("#94 limit outside 1..100 or bad sort → 400 VALIDATION (flat body)", async () => {
  for (const qs of ["limit=0", "limit=101", "limit=abc", "limit=2.5", "limit=-1", "limit=1&limit=2", "sort=name", "sort=createdAt&sort=-createdAt"]) {
    const r = await fetch(`${api.url}/api/assets?${qs}`);
    assert.equal(r.status, 400, qs);
    const b = await r.json();
    assert.deepEqual(Object.keys(b).sort(), ["code", "error"], qs);
    assert.equal(b.code, "VALIDATION", qs);
  }
  for (const qs of ["limit=1", "limit=100"]) assert.equal((await fetch(`${api.url}/api/assets?${qs}`)).status, 200, qs);
});

test("#94 POST without createdAt gets an ISO createdAt (= updatedAt) stamped", async () => {
  const id = runId("r99");
  const body = billboardBody(id, "hist-stamped");
  delete body.createdAt;
  delete body.updatedAt;
  const t0 = Date.now();
  assert.equal((await post(body)).status, 201);
  const got = await (await fetch(`${api.url}/api/assets/${id}`)).json();
  assert.match(got.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(got.createdAt) - t0) < 60000);
  assert.equal(got.updatedAt, got.createdAt);
  const top = await (await fetch(`${api.url}/api/assets?sort=-createdAt&limit=1`)).json();
  assert.equal(top[0].id, id, "freshly registered is newest");
});

test("#94 helpers: client sort/cap mirrors the server; warnings count; relative time", () => {
  const rows = [{ createdAt: "x", n: "legacy" }, { createdAt: iso(1), n: "b" }, { n: "none" }, { createdAt: iso(5), n: "a" }];
  assert.deepEqual(P.sortNewestFirst(rows).map((r) => r.n), ["a", "b", "legacy", "none"]);
  assert.equal(P.recentImports(Array.from({ length: 30 }, (_, i) => ({ createdAt: iso(i) }))).length, 20);
  assert.equal(P.RECENT_IMPORTS_LIMIT, 20);
  assert.equal(P.warningsCount({ importMeta: { warnings: [{}, {}] } }), 2);
  assert.equal(P.warningsCount({}), 0);
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(P.relativeTime("2026-10-30T11:59:50Z", now), "just now");
  assert.equal(P.relativeTime("2026-10-30T11:55:00Z", now), "5 min ago");
  assert.equal(P.relativeTime("2026-10-30T09:00:00Z", now), "3 h ago");
  assert.equal(P.relativeTime("2026-10-28T12:00:00Z", now), "2 d ago");
  assert.equal(P.relativeTime("2026-01-02T00:00:00Z", now), "2026-01-02");
  assert.equal(P.relativeTime(undefined, now), "—");
});

test("#94 static wiring: read-only panel below the list, uses sort/limit, empty state", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  const list = app.indexOf('className="asset-list"');
  const panel = app.indexOf('data-testid="recent-imports"');
  const reg = app.indexOf("Register asset\n");
  assert.ok(list > 0 && panel > list && panel < reg, "below the list, above Register");
  assert.match(app, /\/api\/assets\?sort=-createdAt&limit=\$\{RECENT_IMPORTS_LIMIT\}/);
  assert.match(app, /No imports yet\./);
  const block = app.slice(panel, app.indexOf("</details>", panel));
  assert.ok(!/method:\s*"(POST|PATCH|DELETE)"/.test(block), "read-only");
  assert.match(block, /title=\{a\.createdAt/);
});

test("#94 browser: panel shows the newest first; clicking a row selects it", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("r98");
  const slug = `s3d-recent-${process.pid}`;
  const body = billboardBody(id, slug);
  delete body.createdAt;
  delete body.updatedAt;
  const r = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status !== 201) return t.skip(`SKIP_NO_API: could not register on ${API} (${r.status})`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(UI, { waitUntil: "networkidle" });
    const rows = p.getByTestId("recent-import-row");
    await rows.first().waitFor({ timeout: 10000 });
    assert.ok((await rows.count()) <= 20);
    assert.match(await rows.first().textContent(), new RegExp(slug));
    assert.match(await rows.first().textContent(), /just now/);
    await rows.first().click();
    assert.match(await p.locator(".asset-title").textContent(), new RegExp(slug));
    await p.close();
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
  }
});
