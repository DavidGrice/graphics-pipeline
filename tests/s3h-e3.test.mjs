/**
 * S3-H E3 — #117 compare "What changed" probe diff, #32 Cameras popover (Leader ruling: reuse
 * scene.cameras, cap 16, NIT-F-1 placement, "16 of 16 cameras", D1 empty state).
 * Pure helpers always run; browser checks need UI_URL + WORLD_API (8792/5176 locally).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClientTs, billboardBody, browserEnv, CHROME_ARGS, runId } from "./helpers/s3d-synth.mjs";

let G;
before(async () => {
  // s3gAuthor imports ./s3eScene — transpile both into one temp dir (as s3g-e2-author does)
  const ts = (await import("node:module")).createRequire(import.meta.url)("typescript");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3h-e3-"));
  for (const f of ["s3eScene", "s3gAuthor"]) {
    const s = fs.readFileSync(path.join(ROOT, `apps/world-builder/client/src/${f}.ts`), "utf8").replace(/from "\.\/s3eScene"/g, 'from "./s3eScene.mjs"');
    fs.writeFileSync(path.join(dir, `${f}.mjs`), ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  G = await import(path.join(dir, "s3gAuthor.mjs"));
  fs.rmSync(dir, { recursive: true, force: true });
});
const src = (f) => fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src", f), "utf8");

// ---------------------------------------------------------------- #117
test("#117 probeDiff: identical → []; tris/bones/size/characterType a → b", () => {
  const a = { id: "a", clips: ["idle"], characterType: "billboard", meshStats: { tris: 12 }, sizeBytes: 2048 };
  assert.deepEqual(G.probeDiff(a, { ...a, id: "b" }), []);
  const d = G.probeDiff(a, { id: "b", clips: ["idle"], characterType: "humanoid", meshStats: { tris: 40, bones: 22 }, sizeBytes: 4096 });
  assert.deepEqual(d, ["Tris: 12 → 40", "Bones: — → 22", "Size: 2.0 KB → 4.0 KB", "characterType: billboard → humanoid"]);
});

test("#117 probeDiff: clips added/removed sorted; clipRequires added/removed/changed", () => {
  const a = { id: "a", clips: ["walk", "idle", "run"], clipRequires: { walk: ["legs"], run: ["legs", "arms"] } };
  const b = { id: "b", clips: ["idle", "wave", "jump"], clipRequires: { run: ["arms"], wave: ["arms"] } };
  assert.deepEqual(G.probeDiff(a, b), [
    "Clips added: jump, wave",
    "Clips removed: run, walk",
    "clipRequires run: arms+legs → arms",
    "clipRequires removed: walk",
    "clipRequires added: wave: arms",
  ]);
  assert.deepEqual(G.probeDiff({ id: "a", clipRequires: { x: ["b", "a"] } }, { id: "b", clipRequires: { x: ["a", "b"] } }), [], "order-insensitive");
});

test("#117 probeDiff: stats fallback when meta has no meshStats", () => {
  assert.deepEqual(G.probeDiff({ id: "a" }, { id: "b" }, { a: { tris: 5 }, b: { tris: 5 } }), []);
  assert.deepEqual(G.probeDiff({ id: "a" }, { id: "b" }, { a: { tris: 5 }, b: { tris: 9 } }), ["Tris: 5 → 9"]);
});

test("#117 compare page renders the panel above the diff table", () => {
  const v = src("s3gViews.tsx");
  assert.match(v, /data-testid="compare-probe-diff"/);
  assert.match(v, /<summary>What changed<\/summary>/);
  assert.match(v, /No differences/);
  assert.ok(v.indexOf('data-testid="compare-probe-diff"') < v.indexOf("compare-diff\""), "panel before table");
});

// ---------------------------------------------------------------- #32 popover
test("#32 Cameras popover: reuses scene.cameras (cap 16), NIT-F-1 placement, cap hint, D1 empty state", async () => {
  const app = src("App.tsx");
  for (const id of ["camera-bookmarks", "camera-bookmark-empty", "camera-bookmark-item", "camera-bookmark-restore", "camera-bookmark-rename", "camera-bookmark-delete", "camera-bookmark-save", "camera-bookmark-cap"]) {
    assert.ok(app.includes(`data-testid="${id}"`), id);
  }
  assert.match(app, /useOverlayPlacement\(camOpen, camBtnRef, camPopRef/);
  assert.match(app, /No saved cameras yet/);
  assert.match(app, /\{CAMERAS_MAX\} of \{CAMERAS_MAX\} cameras/);
  assert.doesNotMatch(app, /view\.bookmarks/, "no new schema field (Leader #32)");
  assert.doesNotMatch(app, /8 of 8 cameras/);
  assert.match(src("s3cViewer.ts"), /export const CAMERAS_MAX = 16;/, "cap 16 reused from S3-C");
});

// ---------------------------------------------------------------- #117 browser
test("#117 browser: identical pair shows 'No differences'; a characterType change is listed", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI } = env;
  const API = env.API;
  const mk = async (tag, extra = {}) => {
    const id = crypto.randomUUID();
    const r = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...billboardBody(id, runId(`e3-${tag}`)), ...extra }) });
    assert.ok(r.ok, `register ${tag}: ${r.status} ${await r.text()}`);
    return id;
  };
  const a = await mk("a");
  const b = await mk("b");
  const c = await mk("c", { characterType: "prop" });
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const base = UI.replace(/\/$/, "");
    await p.goto(`${base}/?compare=${a},${b}`, { waitUntil: "networkidle" });
    await p.getByTestId("compare-probe-diff").waitFor({ timeout: 10000 });
    assert.match(await p.getByTestId("compare-probe-diff").innerText(), /What changed[\s\S]*No differences/);
    await p.goto(`${base}/?compare=${a},${c}`, { waitUntil: "networkidle" });
    await p.getByTestId("compare-probe-diff").waitFor({ timeout: 10000 });
    assert.match(await p.getByTestId("compare-probe-diff").innerText(), /characterType: billboard → prop/);
    assert.deepEqual(errs, []);
  } finally {
    await br.close();
    for (const id of [a, b, c]) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
  }
});

// ---------------------------------------------------------------- #32 browser
async function sceneWithCameras(API, tag, cameras) {
  const json = { "Content-Type": "application/json" };
  const c = runId(`s3h-e3-${tag}-c`);
  const sid = runId(`s3h-e3-${tag}-s`);
  const slug = `s3h-e3-${tag}-scene-${process.pid}`;
  const reg = async (b) => {
    try {
      return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
    } catch {
      return 0;
    }
  };
  if ((await reg(billboardBody(c, `s3h-e3-${tag}-c-${process.pid}`))) !== 201) return null;
  const tf = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const st = await reg({ ...billboardBody(sid, slug), characterType: "unknown", stage: "scene", scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: c, transform: tf }], cameras } });
  if (st !== 201) return null;
  return { slug, cleanup: async () => { for (const id of [sid, c]) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {}); } };
}

test("#32 browser: Cameras popover — empty state; at 16 Save is disabled with '16 of 16 cameras'; NIT-F-1 sheet < 600px", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const cams = Array.from({ length: 16 }, (_, i) => ({ id: `cam${i}`, name: `View ${i}`, position: [i + 1, 2, 3], target: [0, 0, 0] }));
  const empty = await sceneWithCameras(API, "e", []);
  const full = await sceneWithCameras(API, "f", cams);
  if (!empty || !full) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  const open = async (p, slug) => {
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(slug) }).first().click();
    await p.waitForFunction(() => document.querySelector('[data-testid="viewer-root"]')?.getAttribute("data-scene-ready") === "1", null, { timeout: 20000 });
    await p.getByTestId("camera-bookmarks").click();
  };
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await open(p, empty.slug);
    await p.getByTestId("camera-bookmark-empty").waitFor({ timeout: 10000 });
    assert.match(await p.getByTestId("camera-bookmark-empty").innerText(), /No saved cameras yet/);
    assert.equal(await p.getByTestId("camera-bookmark-save").isDisabled(), false);
    await open(p, full.slug);
    await p.getByTestId("camera-bookmark-cap").waitFor({ timeout: 10000 });
    assert.equal(await p.getByTestId("camera-bookmark-item").count(), 16);
    assert.equal(await p.getByTestId("camera-bookmark-save").isDisabled(), true);
    assert.match(await p.getByTestId("camera-bookmark-cap").innerText(), /16 of 16 cameras/);
    // NIT-F-1: on screen at desktop; bottom sheet (full width minus 16) under 600px
    const box = await p.locator(".camera-pop").boundingBox();
    assert.ok(box && box.x >= 8 && box.x + box.width <= 1280 - 8 + 1, `in viewport: ${JSON.stringify(box)}`);
    await p.close();
    const m = await br.newPage({ viewport: { width: 390, height: 844 } });
    m.on("pageerror", (e) => errs.push(String(e)));
    await open(m, full.slug);
    await m.getByTestId("camera-bookmark-cap").waitFor({ timeout: 10000 });
    await m.waitForFunction(() => { const r = document.querySelector(".camera-pop")?.getBoundingClientRect(); return r && Math.abs(r.width - (390 - 16)) <= 1; }, null, { timeout: 5000 });
    const mb = await m.locator(".camera-pop").boundingBox();
    assert.ok(mb && mb.y + mb.height <= 844 - 8 + 1, `sheet at bottom: ${JSON.stringify(mb)}`);
    assert.deepEqual(errs, []);
  } finally {
    await br.close();
    await empty.cleanup();
    await full.cleanup();
  }
});
