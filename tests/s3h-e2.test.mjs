/**
 * S3-H E2 — #69 client Save precondition, #2 clip speed, #30 snap, #32 bookmarks (reuse S3-C cameras),
 * #130 frustum cull, and the Leader console deprecation allowlist (narrow).
 * Pure helpers always run; browser checks need UI_URL + WORLD_API (8792/5176 locally).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClientTs, startApi, billboardBody, browserEnv, CHROME_ARGS, runId } from "./helpers/s3d-synth.mjs";
import { watchConsole } from "./helpers/consoleAllow.mjs";

let E;
before(async () => {
  E = await loadClientTs("apps/world-builder/client/src/s3hE2.ts");
});
const json = { "Content-Type": "application/json" };
const tf = (x, z = 0) => ({ position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] });
const APP = () => fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");

// ---------------------------------------------------------------- #69
test("#69 client: If-Match only when an ETag is known; 412 PRECONDITION_FAILED detected; D2 copy", () => {
  assert.deepEqual(E.saveHeaders(null), { "Content-Type": "application/json" });
  assert.equal(E.saveHeaders('"abc"')["If-Match"], '"abc"');
  assert.equal(E.isPreconditionFailed(412, JSON.stringify({ code: "PRECONDITION_FAILED", current: '"x"' })), true);
  assert.equal(E.isPreconditionFailed(412, "nope"), false);
  assert.equal(E.isPreconditionFailed(400, JSON.stringify({ code: "PRECONDITION_FAILED" })), false);
  assert.equal(E.ETAG_PROMPT_TITLE, "This scene changed elsewhere");
  assert.match(E.ETAG_PROMPT_BODY, /^Someone else saved while you were editing\. Reload to take their version, or Cancel/);
  const app = APP();
  for (const id of ["etag-reload-prompt", "etag-reload", "etag-cancel"]) assert.ok(app.includes(`data-testid="${id}"`), id);
  assert.match(app, /histFor\.current = null/, "Reload forces the replacing path (clears undo)");
});

// ---------------------------------------------------------------- #2
test("#2 speed: steps, URL round-trip, invalid → 1, [ ] clamp", () => {
  assert.deepEqual([...E.SPEED_STEPS], [0.25, 0.5, 1, 1.5, 2]);
  for (const s of E.SPEED_STEPS) assert.equal(E.parseSpeed(new URLSearchParams(E.withSpeed("?a=1", s)).get("speed")), s);
  assert.equal(E.withSpeed("?a=1&speed=2", 1), "?a=1", "default removes the param");
  assert.equal(E.withSpeed("", 0.5), "?speed=0.5");
  for (const bad of [null, "", "abc", "3", "0", "-1", "0.3", "Infinity"]) assert.equal(E.parseSpeed(bad), 1, String(bad));
  assert.equal(E.stepSpeed(1, 1), 1.5);
  assert.equal(E.stepSpeed(2, 1), 2);
  assert.equal(E.stepSpeed(0.25, -1), 0.25);
  assert.equal(E.stepSpeed(0.5, -1), 0.25);
  assert.equal(E.stepSpeed(7, 1), 1.5, "unknown current treated as 1");
  assert.equal(E.effectiveTimeScale(1.5, 0.5), 0.75);
});

// ---------------------------------------------------------------- #30
test("#30 snap: steps; a drag lands on a multiple; batch keeps relative offsets", () => {
  assert.deepEqual([...E.SNAP_STEPS], [0.1, 0.25, 0.5, 1]);
  for (const step of E.SNAP_STEPS) {
    const v = E.snapTo(1.337, step);
    assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, `${v} multiple of ${step}`);
  }
  assert.equal(Object.is(E.snapTo(-0.01, 0.5), -0), false);
  const nodes = [[0.3, 0, 0], [1.7, 0, 2]];
  const d = E.snapDelta([0.62, -0.13, 0.4], 0.25);
  assert.deepEqual(d, [0.5, -0.25, 0.5]);
  const moved = nodes.map((p) => p.map((v, i) => v + d[i]));
  assert.deepEqual(moved[1].map((v, i) => +(v - moved[0][i]).toFixed(6)), [1.4, 0, 2], "offsets kept");
  const app = APP();
  assert.match(app, /snapStep=\{snapEnabled \? snapStep : null\}/, "MultiGizmo snaps the shared delta");
  for (const id of ["snap-toggle", "snap-step"]) assert.ok(app.includes(`data-testid="${id}"`), id);
});

// ---------------------------------------------------------------- #32 (reuse S3-C scene.cameras)
test("#32 bookmarks: reuse S3-C scene.cameras + SCENE_CAMERAS_MAX; save/reload, cap, unique names", async () => {
  const api = await startApi();
  try {
    const sid = runId("s3h-e2-cams");
    const child = runId("s3h-e2-cams-c");
    assert.equal((await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(billboardBody(child, `s3h-e2-cams-c-${process.pid}`)) })).status, 201);
    const cam = (i) => ({ id: `c${i}`, name: `View ${i}`, position: [i, 1, 3], target: [0, 0, 0] });
    const base = { ...billboardBody(sid, `s3h-e2-cams-${process.pid}`), characterType: "unknown", stage: "scene" };
    const scene = { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: child, transform: tf(0) }] };
    let r = await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify({ ...base, scene: { ...scene, cameras: [cam(1), cam(2)] } }) });
    assert.equal(r.status, 201, await r.text());
    const got = await (await fetch(`${api.url}/api/assets/${sid}`)).json();
    assert.deepEqual(got.scene.cameras.map((c) => c.name), ["View 1", "View 2"], "save + reload");
    const patch = (cameras) => fetch(`${api.url}/api/assets/${sid}`, { method: "PATCH", headers: json, body: JSON.stringify({ scene: { ...scene, cameras } }) });
    r = await patch(Array.from({ length: 17 }, (_, i) => cam(i)));
    assert.equal(r.status, 400, "over SCENE_CAMERAS_MAX");
    assert.match(await r.text(), /SCENE_CAMERAS_MAX|cameras/);
    r = await patch([cam(1), { ...cam(2), name: "View 1" }]);
    assert.equal(r.status, 400, "duplicate names refused");
  } finally {
    await api.stop();
  }
  const app = APP();
  for (const id of ["camera-bookmarks", "camera-bookmark-item", "camera-bookmark-save", "camera-bookmark-delete"]) {
    assert.ok(app.includes(`data-testid="${id}"`), id);
  }
});

// ---------------------------------------------------------------- #130
test("#130 cull: only above SCENE_NODES_MAX/4; spheres outside the frustum hidden; keep always drawn", () => {
  assert.equal(E.cullActive(64, 256), false);
  assert.equal(E.cullActive(65, 256), true);
  // box frustum |x|,|y|,|z| ≤ 10 as six planes (normal·p + c ≥ 0 inside)
  const planes = [
    { nx: 1, ny: 0, nz: 0, c: 10 }, { nx: -1, ny: 0, nz: 0, c: 10 },
    { nx: 0, ny: 1, nz: 0, c: 10 }, { nx: 0, ny: -1, nz: 0, c: 10 },
    { nx: 0, ny: 0, nz: 1, c: 10 }, { nx: 0, ny: 0, nz: -1, c: 10 },
  ];
  const spheres = Array.from({ length: 256 }, (_, i) => ({ x: i < 10 ? 0 : 50 + i, y: 0, z: 0, r: 0.5 }));
  const on = E.cullDecisions(spheres, planes, true);
  assert.equal(on.filter(Boolean).length, 10, "facing away → fewer than total");
  assert.equal(E.cullDecisions(spheres, planes, false).filter(Boolean).length, 256, "inactive → all drawn");
  const keep = spheres.map((_, i) => i === 200);
  assert.equal(E.cullDecisions(spheres, planes, true, keep)[200], true, "gizmo target always drawn");
  assert.equal(E.sphereInFrustum({ x: 10.4, y: 0, z: 0, r: 0.5 }, planes), true, "bounds overlap counts as in view");
  const app = APP();
  for (const id of ["stats-drawn", "stats-total"]) assert.ok(app.includes(`data-testid="${id}"`), id);
});

// ---------------------------------------------------------------- console allowlist
test("console allowlist: ONLY THREE.Clock / PCFSoftShadowMap / three-mesh-bvh deprecations", () => {
  const ok = [
    "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.",
    "THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.",
    "three-mesh-bvh: deprecated due to three.js version incompatibility",
  ];
  for (const s of ok) assert.equal(E.isAllowedConsoleNoise(s), true, s);
  const bad = [
    "THREE.WebGLRenderer: Context Lost.",
    "THREE.Geometry has been deprecated",
    "TypeError: Cannot read properties of undefined",
    "THREE.Clock exploded", // named module but not a deprecation
    "Warning: something deprecated in React",
  ];
  for (const s of bad) assert.equal(E.isAllowedConsoleNoise(s), false, s);
  assert.equal(E.CONSOLE_DEPRECATION_ALLOWLIST.length, 3, "do not broaden");
});

// ---------------------------------------------------------------- browser
async function sceneFixture(API, tag, nodes) {
  const c = runId(`s3h-e2-${tag}-c`);
  const sid = runId(`s3h-e2-${tag}-s`);
  const slug = `s3h-e2-${tag}-scene-${process.pid}`;
  const reg = async (b) => {
    try {
      return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
    } catch {
      return 0;
    }
  };
  if ((await reg(billboardBody(c, `s3h-e2-${tag}-c-${process.pid}`))) !== 201) return null;
  const st = await reg({
    ...billboardBody(sid, slug),
    characterType: "unknown",
    stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: nodes(c) },
  });
  if (st !== 201) return null;
  return {
    sid,
    slug,
    cleanup: async () => {
      for (const id of [sid, c]) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
    },
  };
}
const sceneReady = (p) =>
  p.waitForFunction(() => document.querySelector('[data-testid="viewer-root"]')?.getAttribute("data-scene-ready") === "1", null, { timeout: 20000 });
const openScene = async (p, UI, slug) => {
  await p.goto(UI, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: new RegExp(slug) }).first().click();
  await sceneReady(p);
};

test("#69 browser two-tab: stale Save → prompt; Cancel keeps draft; Reload replaces draft + clears undo", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await sceneFixture(API, "etag", (c) => [0, 1, 2].map((i) => ({ id: `n${i}`, assetId: c, transform: tf(i) })));
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const con = await watchConsole(p);
    await openScene(p, UI, fx.slug);
    await p.getByTestId("node-row-n1").click();
    await p.getByTestId("node-delete-n1").click();
    // "other tab": save on the server (changes the ETag)
    const cur = await (await fetch(`${API}/api/assets/${fx.sid}`)).json();
    const other = await fetch(`${API}/api/assets/${fx.sid}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ scene: { ...cur.scene, nodes: cur.scene.nodes.filter((n) => n.id !== "n2") } }),
    });
    assert.equal(other.status, 200);
    await p.getByTestId("scene-save").click();
    await p.getByTestId("etag-reload-prompt").waitFor({ timeout: 10000 });
    assert.match(await p.getByTestId("etag-reload-prompt").innerText(), /This scene changed elsewhere/);
    await p.getByTestId("etag-cancel").click();
    assert.equal(await p.getByTestId("etag-reload-prompt").count(), 0);
    assert.equal(await p.getByTestId("node-row-n2").count(), 1, "Cancel keeps the local draft (server's n2 removal not applied)");
    assert.equal(await p.getByTestId("undo").isDisabled(), false, "Cancel keeps undo");
    // server untouched by the stale Save
    const mid = await (await fetch(`${API}/api/assets/${fx.sid}`)).json();
    assert.deepEqual(mid.scene.nodes.map((n) => n.id), ["n0", "n1"]);
    await p.getByTestId("scene-save").click();
    await p.getByTestId("etag-reload").click();
    await p.waitForFunction(() => !document.querySelector('[data-testid="node-row-n2"]'), null, { timeout: 10000 });
    assert.equal(await p.getByTestId("etag-reload-prompt").count(), 0);
    assert.equal(await p.getByTestId("undo").isDisabled(), true, "Reload clears undo");
    // expected network noise only: preflight 404s (fixtures carry no GLB) and the deliberate 412
    const real = con.problems.filter((s) => !/^error: Failed to load resource: the server responded with a status of (404|412)\b/.test(s));
    console.log(`# console ignored by allowlist: ${JSON.stringify(con.ignored)}`);
    assert.deepEqual(real.filter((s) => !/GPU stall|swiftshader|WebGL/i.test(s)), [], "no other console errors/warnings");
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#2 browser: ?speed= round-trip, [ ] keys, invalid → 1", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI } = env;
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(`${UI.replace(/\/$/, "")}/?speed=0.5`, { waitUntil: "networkidle" });
    const sel = p.getByTestId("clip-speed");
    await sel.waitFor({ timeout: 10000 });
    assert.equal(await sel.inputValue(), "0.5");
    await p.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => {});
    await p.keyboard.press("]");
    assert.equal(await sel.inputValue(), "1");
    assert.equal(new URL(p.url()).searchParams.get("speed"), null, "1 drops the param");
    await p.keyboard.press("]");
    await p.keyboard.press("]");
    await p.keyboard.press("]");
    assert.equal(await sel.inputValue(), "2", "clamped at 2");
    assert.equal(new URL(p.url()).searchParams.get("speed"), "2");
    await p.goto(`${UI.replace(/\/$/, "")}/?speed=9`, { waitUntil: "networkidle" });
    assert.equal(await p.getByTestId("clip-speed").inputValue(), "1");
    await p.close();
  } finally {
    await br.close();
  }
});

test("#130 browser: 72-node scene mostly behind the camera draws fewer than total", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  // 2 nodes at the origin (in view) + 70 far behind the default camera (+z)
  const fx = await sceneFixture(API, "cull", (c) => [
    { id: "n0", assetId: c, transform: tf(0) },
    { id: "n1", assetId: c, transform: tf(0.5) },
    ...Array.from({ length: 70 }, (_, i) => ({ id: `b${i}`, assetId: c, transform: tf((i % 10) - 5, 60 + Math.floor(i / 10)) })),
  ]);
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await openScene(p, UI, fx.slug);
    await p.getByRole("button", { name: "Stats" }).click();
    await p.waitForFunction(() => Number(document.querySelector('[data-testid="stats-total"]')?.textContent) === 72, null, { timeout: 20000 });
    const drawn = Number(await p.getByTestId("stats-drawn").textContent());
    assert.ok(drawn >= 2 && drawn < 72, `drawn ${drawn} / 72`);
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});
