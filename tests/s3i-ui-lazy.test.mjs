/**
 * S3-I #131 UI — a 72-node scene (SCENE_NODES_MAX 256, eager cap 64): the first 64 nodes load eagerly,
 * the 2 lazy nodes in view load without a camera move, the 6 lazy nodes behind the camera stay
 * wireframe placeholders, and selecting one loads it. R1 §8, D1 §6, D2. Needs UI_URL + WORLD_API
 * (skips SKIP_NO_UI_URL otherwise); registers + DELETEs its own fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, makeRiggedGlb, runId } from "./helpers/s3d-synth.mjs";

const json = { "Content-Type": "application/json" };
const tf = (x, z = 0) => ({ position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] });
const reg = async (API, b) => {
  try {
    return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
  } catch {
    return 0;
  }
};
const del = (API, id) => fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
// wait for an exact "Loaded n / total"; on timeout the message carries what the panel and mirror showed
const waitLoaded = async (p, want, ms = 20000) => {
  const end = Date.now() + ms;
  let last = "";
  while (Date.now() < end) {
    last = await p.evaluate(() => ({
      loaded: document.querySelector('[data-testid="stats-loaded"]')?.textContent ?? null,
      drawn: document.querySelector('[data-testid="stats-drawn"]')?.textContent ?? null,
      placeholders: [...document.querySelectorAll('[data-testid="lazy-placeholder"]')].map((e) => e.getAttribute("data-node-id")),
    }));
    if (last.loaded === want) return;
    await p.waitForTimeout(200);
  }
  assert.fail(`expected "${want}", saw ${JSON.stringify(last)}`);
};
const behind = (i) => tf((i % 10) - 5, 60 + Math.floor(i / 10));

test("#131 browser: past the eager cap, in-view nodes load and behind-camera nodes stay placeholders", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const pid = process.pid;
  const c = runId("s3i-ui131-c");
  const sid = runId("s3i-ui131-scene");
  const slugs = { c: `s3iui131-c-${pid}`, scene: `s3iui131-scene-${pid}` };
  if ((await reg(API, billboardBody(c, slugs.c))) !== 201) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  // a real GLB on disk so preflight passes and nodes can load (missing files render SceneNodeMissing)
  const dirs = [ROOT + "/data", process.env.WB_DATA_ROOT].filter(Boolean).map((d) => path.join(d, "assets", c));
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "model.glb"), makeRiggedGlb());
  }
  // fail loudly when the API reads a different data root than we wrote to (CI 177: "Loaded 0 / 0")
  const fr = await fetch(`${API}/api/assets/${c}/file?format=glb`);
  if (!fr.ok) {
    await del(API, c);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    assert.fail(`fixture GLB not served: GET /api/assets/${c}/file ${fr.status}; wrote to ${dirs.join(", ")} (set WB_DATA_ROOT to the API's data root)`);
  }
  // index 0..63 eager (behind the camera), 64..65 lazy in view at the origin, 66..71 lazy behind
  const nodes = [
    ...Array.from({ length: 64 }, (_, i) => ({ id: `e${i}`, assetId: c, transform: behind(i) })),
    { id: "v0", assetId: c, transform: tf(0) },
    { id: "v1", assetId: c, transform: tf(0.5) },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `z${i}`, assetId: c, transform: behind(i) })),
  ];
  const scene = { ...billboardBody(sid, slugs.scene), characterType: "unknown", stage: "scene", scene: { version: 1, rootId: "e0", nodes } };
  if ((await reg(API, scene)) !== 201) {
    await del(API, c);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    return t.skip(`SKIP_NO_API: could not register the scene on ${API}`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(slugs.scene) }).first().click();
    await p.waitForFunction(() => document.querySelector('[data-testid="viewer-root"]')?.getAttribute("data-scene-ready") === "1", null, { timeout: 15000 });
    await p.getByRole("button", { name: "Stats" }).click();
    const loaded = p.getByTestId("stats-loaded");
    await waitLoaded(p, "Loaded 66 / 72");
    const ph = p.getByTestId("lazy-placeholder");
    assert.equal(await ph.count(), 6, "6 lazy nodes behind the camera stay placeholders");
    const ids = await ph.evaluateAll((els) => els.map((e) => e.getAttribute("data-node-id")).sort());
    assert.deepEqual(ids, ["z0", "z1", "z2", "z3", "z4", "z5"]);
    // in-view lazy nodes loaded with no camera move; give it a moment to be sure nothing else loads
    await p.waitForTimeout(500);
    assert.equal(await loaded.textContent(), "Loaded 66 / 72");

    // selecting a culled placeholder (gizmo target) loads it
    await p.getByTestId("node-row-z3").click();
    await waitLoaded(p, "Loaded 67 / 72");
    assert.equal(await ph.count(), 5);
    assert.equal(await p.locator('[data-testid="lazy-placeholder"][data-node-id="z3"]').count(), 0);
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    for (const id of [sid, c]) await del(API, id);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
