/**
 * S3-I E2 UI — #28 scene thumbnail (Save captures a 256×256 PNG via SwiftShader and PUTs it; the card
 * shows it, else the scene initial) and #81 timeline markers (add, reload, click jumps, double-click
 * renames, delete, "16 of 16 markers" with Add disabled). R1 §7/§10, D1 §5/§8. Needs UI_URL +
 * WORLD_API (skips SKIP_NO_UI_URL otherwise); registers + DELETEs its own fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, makeRiggedGlb, runId } from "./helpers/s3d-synth.mjs";

const json = { "Content-Type": "application/json" };
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const reg = async (API, b) => {
  try {
    return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
  } catch {
    return 0;
  }
};
const del = (API, id) => fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
const sceneReady = (p) =>
  p.waitForFunction(() => document.querySelector('[data-testid="viewer-root"]')?.getAttribute("data-scene-ready") === "1", null, { timeout: 15000 });
const text = async (loc) => ((await loc.textContent()) ?? "").trim();

test("#28 browser: scene card falls back to the initial, Save PUTs a 256×256 PNG, the card then shows it", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const pid = process.pid;
  const c1 = runId("s3i-ui28-c1");
  const sid = runId("s3i-ui28-scene");
  const slugs = { c1: `s3iui28-a-${pid}`, scene: `s3iui28-scene-${pid}` };
  if ((await reg(API, billboardBody(c1, slugs.c1))) !== 201) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const scene = {
    ...billboardBody(sid, slugs.scene),
    characterType: "unknown",
    stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: c1, transform: tf(-1) }, { id: "n1", assetId: c1, transform: tf(1) }] },
  };
  if ((await reg(API, scene)) !== 201) {
    await del(API, c1);
    return t.skip(`SKIP_NO_API: could not register the scene on ${API}`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    const card = p.getByRole("button", { name: new RegExp(slugs.scene) }).first();
    assert.equal(await card.getByTestId("scene-thumb-fallback").count(), 1, "no .png preview → fallback, no request");
    assert.equal(await text(card.getByTestId("scene-thumb-fallback")), "S");
    assert.equal(await card.getByTestId("scene-thumb").count(), 0);
    const plain = p.getByRole("button", { name: new RegExp(slugs.c1) }).first();
    assert.equal(await plain.locator('[data-testid^="scene-thumb"]').count(), 0, "non-scene cards have no thumb");

    await card.click();
    await sceneReady(p);
    await p.getByTestId("node-row-n1").click();
    await p.getByTestId("node-delete-n1").click();
    const put = p.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/assets/${sid}/preview`), { timeout: 20000 });
    await p.getByTestId("scene-save").click();
    const res = await put;
    assert.equal(res.status(), 200, await res.text());
    const j = await res.json();
    assert.equal(j.preview, `assets/${sid}/preview.png`);
    assert.equal(await p.getByTestId("scene-thumb-error").count(), 0);

    // the stored file is a 256×256 PNG
    const g = await fetch(`${API}/api/assets/${sid}/preview`);
    assert.equal(g.status, 200);
    const buf = Buffer.from(await g.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(buf.readUInt32BE(16), 256);
    assert.equal(buf.readUInt32BE(20), 256);
    assert.equal(buf.length, j.bytes);

    // the card swaps to the image; SwiftShader pixels are not one flat colour (grid + clear colour)
    const img = card.getByTestId("scene-thumb");
    await img.waitFor({ timeout: 10000 });
    await p.waitForFunction((s) => {
      const el = [...document.querySelectorAll('[data-testid="scene-thumb"]')].find((e) => e.closest("button")?.textContent?.includes(s));
      return el && el.complete && el.naturalWidth === 256;
    }, slugs.scene, { timeout: 10000 });
    const colours = await img.evaluate((el) => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d");
      x.drawImage(el, 0, 0);
      const d = x.getImageData(0, 0, 256, 256).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return set.size;
    });
    assert.ok(colours >= 2, `thumbnail has ${colours} distinct sampled colours`);
    assert.equal(await card.getByTestId("scene-thumb-fallback").count(), 0);
    // Save again still works (the PUT's ETag was picked up, no 412)
    await p.getByTestId("undo").click();
    const put2 = p.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/assets/${sid}/preview`), { timeout: 20000 });
    await p.getByTestId("scene-save").click();
    assert.equal((await put2).status(), 200);
    await p.waitForFunction(() => document.querySelector('[data-testid="scene-save"]')?.textContent === "Saved", null, { timeout: 10000 });
    assert.deepEqual(errs, []);
  } finally {
    await br.close();
    await del(API, sid);
    await del(API, c1);
  }
});

test("#81 browser: add, reload, click jumps, double-click renames, delete, cap 16 disables Add", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("s3i-ui81-a");
  const slug = `s3iui81-a-${process.pid}`;
  const body = { ...billboardBody(id, slug), clips: ["idle", "walk", "run"], clipDurations: { idle: 1000, walk: 1000, run: 1000 } };
  if ((await reg(API, body)) !== 201) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const dirs = [ROOT + "/data", process.env.WB_DATA_ROOT].filter(Boolean).map((d) => path.join(d, "assets", id));
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "model.glb"), makeRiggedGlb());
  }
  const patch = (b) => fetch(`${API}/api/assets/${id}/clip-ux`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const open = async () => {
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: new RegExp(slug) }).first().click();
      await p.getByTestId("timeline-marker-add").waitFor({ timeout: 15000 });
    };
    await open();
    const hint = p.getByTestId("timeline-marker-hint");
    const add = p.getByTestId("timeline-marker-add");
    const ticks = p.getByTestId("timeline-marker");
    assert.equal(await text(hint), "0 of 16 markers");
    await p.waitForFunction(() => !document.querySelector('[data-testid="timeline-marker-add"]')?.disabled, null, { timeout: 15000 });
    await add.click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-marker"]').length === 1);
    await add.click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-marker"]').length === 2);
    assert.equal(await text(hint), "2 of 16 markers");
    const names = await ticks.evaluateAll((els) => els.map((e) => e.getAttribute("data-marker-name")).sort());
    assert.deepEqual(names, ["Marker 1", "Marker 2"]);
    const clip = (await (await fetch(`${API}/api/assets/${id}`)).json()).clipUx.markers[0].clip;
    assert.ok(["idle", "walk", "run"].includes(clip));

    // a marker at mid-clip; reload → it and the two above persist; click → jump + pause
    assert.equal((await patch({ markers: [{ clip, t: 0, name: "Marker 1" }, { clip, t: 0, name: "Marker 2" }, { clip, t: 500, name: "mid" }] })).status, 200);
    await open();
    assert.equal(await ticks.count(), 3, "save and reload");
    const mid = p.locator('[data-testid="timeline-marker"][data-marker-name="mid"]');
    await mid.click();
    const v = Number(await p.locator('.scrub input[type="range"]').inputValue());
    assert.ok(Math.abs(v - 0.5) < 0.01, `scrub jumped to ${v}`);
    assert.equal(await mid.getAttribute("aria-pressed"), "true");

    // double-click renames; a duplicate name is refused inline
    await mid.dblclick();
    const ren = p.getByTestId("timeline-marker-rename");
    await ren.fill("Marker 1");
    await ren.press("Enter");
    assert.equal(await text(p.getByTestId("timeline-marker-rename-error")), "Name already used");
    await ren.fill("Hit");
    // bind the wait to the rename's own PATCH so a slow or failed save says why instead of timing out blind
    const renamed = p.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/assets/${id}/clip-ux`), { timeout: 20000 });
    await ren.press("Enter");
    const rr = await renamed;
    assert.equal(rr.status(), 200, `rename PATCH ${rr.status()}: ${await rr.text()}`);
    try {
      await p.locator('[data-testid="timeline-marker"][data-marker-name="Hit"]').waitFor({ timeout: 10000 });
    } catch (e) {
      const seen = await p.evaluate(() => ({
        names: [...document.querySelectorAll('[data-testid="timeline-marker"]')].map((el) => el.getAttribute("data-marker-name")),
        editing: document.querySelector('[data-testid="timeline-marker-rename"]')?.value ?? null,
        err: document.querySelector('[data-testid="timeline-marker-error"]')?.textContent ?? null,
      }));
      assert.fail(`"Hit" not shown after a 200 PATCH: ${JSON.stringify(seen)} (${e.message.split("\n")[0]})`);
    }
    const saved = (await (await fetch(`${API}/api/assets/${id}`)).json()).clipUx.markers.map((m) => m.name);
    assert.deepEqual(saved.sort(), ["Hit", "Marker 1", "Marker 2"]);

    // delete the selected marker
    await p.locator('[data-testid="timeline-marker"][data-marker-name="Hit"]').click();
    await p.getByTestId("timeline-marker-delete").click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-marker"]').length === 2);
    assert.equal(await text(hint), "2 of 16 markers");

    // at the cap: "16 of 16 markers" and Add disabled
    const full = Array.from({ length: 16 }, (_, i) => ({ clip, t: i * 50, name: `m${i}` }));
    assert.equal((await patch({ markers: full })).status, 200);
    await open();
    assert.equal(await text(hint), "16 of 16 markers");
    assert.equal(await add.isDisabled(), true);
    assert.equal(await ticks.count(), 16);
    for (const sel of ['[data-testid="timeline-marker-add"]']) {
      const b = await p.locator(sel).boundingBox();
      assert.ok(b && b.width >= 24 && b.height >= 24, `${sel} hit target`);
    }
    const tb = await ticks.first().boundingBox();
    assert.ok(tb && tb.width >= 24 && tb.height >= 24, "tick hit target ≥ 24×24");
    assert.deepEqual(errs, []);
  } finally {
    await br.close();
    await del(API, id);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
