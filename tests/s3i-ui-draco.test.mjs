/**
 * S3-I #59 UI — a scene whose child is a real `pipeline.sh --draco` GLB loads in the viewer with
 * the vendored decoder: the page fetches /draco/draco_wasm_wrapper.js + draco_decoder.wasm from
 * the app (200) and never asks a CDN. Needs UI_URL + WORLD_API (SKIP_NO_UI_URL) and BLENDER_BIN
 * (SKIP_NO_BLENDER; SKIP_PLATFORM when Blender has no Draco encoder). Writes + deletes its fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import { PIPELINE_SH, makeFixturePng, requireBlenderBin, tmpDir } from "../apps/blender-pipeline/golden.mjs";

const json = { "Content-Type": "application/json" };
const reg = async (API, b) => {
  try {
    return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
  } catch {
    return 0;
  }
};
const del = (API, id) => fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});

test("#59 browser: a Draco GLB loads through the vendored /draco/ decoder, no CDN", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  if (!process.env.BLENDER_BIN) return t.skip("SKIP_NO_BLENDER: BLENDER_BIN unset — #59 Draco viewer check skipped (not a green lie)");
  const bin = requireBlenderBin();
  const { chromium, exe, UI, API } = env;
  const work = tmpDir("gp-ui59-");
  const glb = path.join(work, "draco.glb");
  const r = spawnSync("bash", [PIPELINE_SH, "--draco", makeFixturePng(work), glb], {
    env: { ...process.env, BLENDER_BIN: bin, MODE: "rigged", SEED: "0" },
    encoding: "utf8",
  });
  if (r.status === 6) {
    fs.rmSync(work, { recursive: true, force: true });
    return t.skip("SKIP_PLATFORM: this Blender build has no Draco encoder (png_to_glb.py exit 6)");
  }
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const pid = process.pid;
  const c = runId("s3i-ui59-c");
  const sid = runId("s3i-ui59-scene");
  const slugs = { c: `s3iui59-c-${pid}`, scene: `s3iui59-scene-${pid}` };
  const dirs = [ROOT + "/data", process.env.WB_DATA_ROOT].filter(Boolean).map((d) => path.join(d, "assets", c));
  const cleanup = async () => {
    for (const id of [sid, c]) await del(API, id);
    for (const d of [...dirs, work]) fs.rmSync(d, { recursive: true, force: true });
  };
  if ((await reg(API, billboardBody(c, slugs.c))) !== 201) {
    await cleanup();
    return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  }
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(glb, path.join(d, "model.glb"));
  }
  const fr = await fetch(`${API}/api/assets/${c}/file?format=glb`);
  if (!fr.ok) {
    await cleanup();
    assert.fail(`fixture GLB not served: GET /api/assets/${c}/file ${fr.status}; wrote to ${dirs.join(", ")} (set WB_DATA_ROOT to the API's data root)`);
  }
  const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  const nodes = [{ id: "d0", assetId: c, transform: tf(0) }];
  const scene = { ...billboardBody(sid, slugs.scene), characterType: "unknown", stage: "scene", scene: { version: 1, rootId: "d0", nodes } };
  if ((await reg(API, scene)) !== 201) {
    await cleanup();
    return t.skip(`SKIP_NO_API: could not register the scene on ${API}`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const cdn = [];
    await p.route(/gstatic\.com|unpkg\.com|jsdelivr\.net/, (route) => {
      cdn.push(route.request().url());
      return route.abort();
    });
    const draco = new Map();
    p.on("response", (res) => {
      const u = new URL(res.url());
      if (u.pathname.startsWith("/draco/")) draco.set(path.basename(u.pathname), res.status());
    });
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(slugs.scene) }).first().click();
    await p.getByRole("button", { name: "Stats" }).click();
    const loaded = p.getByTestId("stats-loaded");
    try {
      await p.waitForFunction(() => document.querySelector('[data-testid="stats-loaded"]')?.textContent === "Loaded 1 / 1", null, { timeout: 30000 });
    } catch (e) {
      assert.fail(`Draco GLB never loaded: stats="${await loaded.textContent().catch(() => null)}" draco=${JSON.stringify([...draco])} cdn=${JSON.stringify(cdn)} errs=${JSON.stringify(errs)} (${e.message})`);
    }
    assert.equal(await p.getByTestId("error-card").count(), 0, "no error card");
    assert.deepEqual(cdn, [], "no CDN decoder request");
    assert.equal(draco.get("draco_wasm_wrapper.js"), 200);
    assert.equal(draco.get("draco_decoder.wasm"), 200);
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await cleanup();
  }
});
