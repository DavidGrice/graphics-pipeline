/**
 * S3-H tip1 — CO-1 recent imports by register time; CO-2 UI fixtures own their GLBs + lint.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  startApi,
  billboardBody,
  browserEnv,
  CHROME_ARGS,
  runId,
  loadClientTs,
} from "./helpers/s3d-synth.mjs";
import { registerFixture } from "./helpers/registerFixture.mjs";

const json = { "Content-Type": "application/json" };
const post = (base, body) =>
  fetch(`${base}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) });
const iso = (y, n) => new Date(Date.UTC(y, 0, 1, 0, 0, n)).toISOString();
const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...opts });

// ---------------------------------------------------------------- CO-1 helpers
test("CO-1 recentRegisterIds: de-dupes asset.register newest-first; skips other kinds", async () => {
  const P = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
  const items = [
    { kind: "asset.patch", id: "p1", at: "2026-01-01T00:00:03Z" },
    { kind: "asset.register", id: "a", at: "2026-01-01T00:00:02Z" },
    { kind: "asset.register", id: "b", at: "2026-01-01T00:00:01Z" },
    { kind: "asset.register", id: "a", at: "2026-01-01T00:00:00Z" }, // older dup of a
    { kind: "scene.save", id: "s1", at: "2025-01-01T00:00:00Z" },
    { kind: "asset.register", id: "c", at: "2024-01-01T00:00:00Z" },
  ];
  assert.deepEqual(
    P.recentRegisterIds(items, 20).map((x) => x.id),
    ["a", "b", "c"],
  );
  assert.equal(P.recentRegisterIds(items, 2).length, 2);
  assert.deepEqual(P.recentRegisterIds([], 20), []);
  assert.deepEqual(P.recentRegisterIds(null, 20), []);
});

test("CO-1 App wiring: activity primary + createdAt fallback; registerAt on the row", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  assert.match(app, /\/api\/activity\?limit=100/);
  assert.match(app, /recentRegisterIds/);
  assert.match(app, /\/api\/assets\?sort=-createdAt&limit=\$\{RECENT_IMPORTS_LIMIT\}/);
  assert.match(app, /registerAt \?\? a\.createdAt/);
});

// ---------------------------------------------------------------- CO-1 hermetic API + browser
let api;
before(async () => {
  api = await startApi();
});
after(async () => {
  await api?.stop?.();
});

test("CO-1 API/activity: older-dated register still surfaces after 40 newer createdAt fixtures; deleted does not", async () => {
  const newer = [];
  for (let i = 0; i < 40; i++) {
    const id = runId(`co1-new-${i}`);
    newer.push(id);
    const body = { ...billboardBody(id, `co1-new-${i}`), createdAt: iso(2099, i), updatedAt: iso(2099, i) };
    assert.equal((await post(api.url, body)).status, 201);
  }
  // Older createdAt, but registered AFTER the 40 → newest asset.register in activity
  const old = runId("co1-old");
  const oldSlug = `co1-old-${process.pid}`;
  assert.equal(
    (await post(api.url, { ...billboardBody(old, oldSlug), createdAt: iso(2000, 0), updatedAt: iso(2000, 0) })).status,
    201,
  );

  const act = await (await fetch(`${api.url}/api/activity?limit=100`)).json();
  const regs = act.items.filter((x) => x.kind === "asset.register");
  assert.equal(regs[0].id, old, "freshest register is first in activity");

  // sort=-createdAt would bury `old` past limit=20 (40 newer createdAt)
  const byCreated = await (await fetch(`${api.url}/api/assets?sort=-createdAt&limit=20`)).json();
  assert.ok(!byCreated.some((a) => a.id === old), "createdAt sort drops the older-dated asset");

  // Hydrate like the client: de-dupe registers, skip gone
  const seen = new Set();
  const ids = [];
  for (const e of regs) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    ids.push(e.id);
  }
  assert.ok(ids.includes(old));

  // Delete → gone on hydrate
  assert.equal((await fetch(`${api.url}/api/assets/${old}`, { method: "DELETE" })).status, 204);
  const gone = await fetch(`${api.url}/api/assets/${old}`);
  assert.equal(gone.status, 404);
  // activity still mentions it, but GET skips it
  const act2 = await (await fetch(`${api.url}/api/activity?limit=100`)).json();
  assert.ok(act2.items.some((x) => x.kind === "asset.register" && x.id === old));
  const live = [];
  for (const e of act2.items) {
    if (e.kind !== "asset.register" || live.includes(e.id)) continue;
    const r = await fetch(`${api.url}/api/assets/${e.id}`);
    if (r.ok) live.push(e.id);
    if (live.length >= 20) break;
  }
  assert.ok(!live.includes(old), "deleted asset excluded after hydrate");

  for (const id of newer) await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
});

test("CO-1 browser: Recent imports shows older-dated asset registered onto a 40-fixture store", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const made = [];
  try {
    for (let i = 0; i < 40; i++) {
      const fx = await registerFixture(API, {
        tag: `co1ui-${i}`,
        slug: `co1ui-${process.pid}-${i}`,
        createdAt: iso(2099, i),
        writeGlb: false,
      }).catch((e) => {
        t.skip(`SKIP_NO_API: could not seed ${API} (${e.status || e.message})`);
        return null;
      });
      if (!fx) return;
      made.push(fx);
    }
    const old = await registerFixture(API, {
      tag: "co1ui-old",
      slug: `co1ui-old-${process.pid}`,
      createdAt: iso(2000, 0),
      writeGlb: false,
    });
    made.push(old);
    const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
    try {
      const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByTestId("recent-import-row").filter({ hasText: old.slug }).first().waitFor({ timeout: 15000 });
      // deleted → disappears on refresh
      await fetch(`${API}/api/assets/${old.id}`, { method: "DELETE" });
      await p.reload({ waitUntil: "networkidle" });
      await p.getByTestId("recent-imports").waitFor({ timeout: 10000 });
      assert.equal(await p.getByTestId("recent-import-row").filter({ hasText: old.slug }).count(), 0);
      await p.close();
    } finally {
      await br.close();
    }
  } finally {
    for (const fx of made.reverse()) await fx.cleanup().catch(() => {});
  }
});

test("CO-1 fallback wiring: empty activity uses sort=-createdAt&limit=RECENT_IMPORTS_LIMIT", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  assert.match(app, /regs\.length === 0/);
  assert.match(app, /sort=-createdAt&limit=\$\{RECENT_IMPORTS_LIMIT\}/);
});


test("NIT-H-1: tombstoned register (deleted:true) is skipped after hydrate", async () => {
  const id = runId("nit-h1");
  const slug = `nit-h1-${process.pid}`;
  assert.equal((await post(api.url, billboardBody(id, slug))).status, 201);
  // Soft-tombstone via upsert (POST stores the body; deleted is not a PATCH field)
  assert.equal((await post(api.url, { ...billboardBody(id, slug), deleted: true })).status, 201);
  const got = await (await fetch(`${api.url}/api/assets/${id}`)).json();
  assert.equal(got.deleted, true);

  const act = await (await fetch(`${api.url}/api/activity?limit=100`)).json();
  assert.ok(act.items.some((x) => x.kind === "asset.register" && x.id === id));

  const live = [];
  for (const e of act.items) {
    if (e.kind !== "asset.register" || live.includes(e.id)) continue;
    const r = await fetch(`${api.url}/api/assets/${e.id}`);
    if (!r.ok) continue;
    const a = await r.json();
    if (a.deleted === true) continue;
    live.push(e.id);
    if (live.length >= 20) break;
  }
  assert.ok(!live.includes(id), "tombstoned asset excluded from recent hydrate");

  // App wiring asserts the skip
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  assert.match(app, /a\.deleted === true\) continue/);
});

// ---------------------------------------------------------------- CO-2
test("CO-2 registerFixture: registers, writes GLB, cleanup removes metadata", async () => {
  const dataRoot = api.dataRoot;
  const prev = process.env.WB_DATA_ROOT;
  process.env.WB_DATA_ROOT = dataRoot;
  try {
    const fx = await registerFixture(api.url, { tag: "co2-reg", slug: `co2-reg-${process.pid}` });
    assert.equal((await fetch(`${api.url}/api/assets/${fx.id}`)).status, 200);
    const glb = path.join(dataRoot, "assets", fx.id, "model.glb");
    assert.ok(fs.existsSync(glb), "GLB written under WB_DATA_ROOT");
    await fx.cleanup();
    assert.equal((await fetch(`${api.url}/api/assets/${fx.id}`)).status, 404);
    assert.ok(!fs.existsSync(glb) || !fs.existsSync(path.dirname(glb)));
  } finally {
    if (prev === undefined) delete process.env.WB_DATA_ROOT;
    else process.env.WB_DATA_ROOT = prev;
  }
});

test("CO-2 ui-fixture-lint: clean on current UI tests; planted hard-coded id → LINT_FAILED", () => {
  const clean = node(["scripts/ui-fixture-lint.mjs"]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /^OK ui-fixture/m);

  // Build the planted UUID without a contiguous literal so this file itself stays lint-clean.
  const plantedId = ["aaaaaaaa", "bbbb", "4ccc", "8ddd", "eeeeeeeeeeee"].join("-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-co2-"));
  const planted = path.join(dir, "planted-ui.test.mjs");
  fs.writeFileSync(
    planted,
    `import { browserEnv } from "./helpers/s3d-synth.mjs";\nconst ASSET = "${plantedId}";\nbrowserEnv();\n`,
  );
  const bad = node(["scripts/ui-fixture-lint.mjs", planted]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /LINT_FAILED: ui-fixture/);
  assert.match(bad.stderr, new RegExp(plantedId));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CO-2 lint:ci invokes ui-fixture-lint", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/lint-ci.mjs"), "utf8");
  assert.match(src, /ui-fixture-lint\.mjs/);
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /ui-populated:/);
  assert.match(ci, /seed-ui-populated\.mjs 40/);
  assert.match(ci, /node-version: "24"/);
});
