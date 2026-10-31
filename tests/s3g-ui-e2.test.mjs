/**
 * S3-G E2 UI — #36 undo/redo + save marker, #29 multi-select (shift-click, Ctrl+A, Esc, drag box,
 * batch skip toast, cap refuses a whole restore, selection survives undo/redo), #84 compare (picker
 * obeys NIT-F-1 at 390/1280/1920, split vs stacked, diff markers, inline errors, 5 open/close cycles
 * without a WebGL leak), #44 health page (401 stub → "unauthorized", 429 Retry-After, hidden-tab
 * pause, no dataRoot text). Bounds/overlap checks like s3f-ui-share (D1 §1 AC). Needs UI_URL +
 * WORLD_API (skips SKIP_NO_UI_URL otherwise); registers + DELETEs its own fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, makeRiggedGlb, runId } from "./helpers/s3d-synth.mjs";

const json = { "Content-Type": "application/json" };
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const ABS = /\/(home|workspace|tmp|etc|usr|var)\//;

async function fixtures(API, tag) {
  const pid = process.pid;
  const c1 = runId(`s3g-${tag}-c1`);
  const c2 = runId(`s3g-${tag}-c2`);
  const sid = runId(`s3g-${tag}-scene`);
  const s = { c1: `s3gui-${tag}-a-${pid}`, c2: `s3gui-${tag}-b-${pid}`, scene: `s3gui-${tag}-scene-${pid}` };
  const reg = async (b) => {
    try {
      return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
    } catch {
      return 0;
    }
  };
  if ((await reg(billboardBody(c1, s.c1))) !== 201) return null;
  await reg({ ...billboardBody(c2, s.c2), characterType: "unknown", license: "CC0-1.0", clips: ["idle"] });
  const scene = {
    ...billboardBody(sid, s.scene),
    characterType: "unknown",
    stage: "scene",
    scene: {
      version: 1,
      rootId: "n0",
      nodes: [
        { id: "n0", assetId: c1, transform: tf(-1) },
        { id: "n1", assetId: c1, transform: tf(0) },
        { id: "n2", assetId: c1, transform: tf(1) },
        { id: "n3", assetId: c1, transform: tf(2), deleted: true },
      ],
    },
  };
  if ((await reg(scene)) !== 201) return null;
  return {
    ids: { c1, c2, sid },
    slugs: s,
    cleanup: async () => {
      for (const id of [sid, c2, c1]) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
    },
  };
}

const sceneReady = (p) =>
  p.waitForFunction(() => document.querySelector('[data-testid="viewer-root"]')?.getAttribute("data-scene-ready") === "1", null, { timeout: 15000 });
const text = async (p, id) => ((await p.getByTestId(id).textContent()) ?? "").trim();
const count = (p) => text(p, "node-count");

/** D1 §1 AC: inside the viewport and the centre of every listed control hits that control. */
async function inViewAndHittable(p, label, sel, controls) {
  const r = await p.evaluate(
    ({ sel, controls }) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      const hits = controls.map((c) => {
        const btn = document.querySelector(c);
        if (!btn) return { c, ok: false, why: "missing" };
        const q = btn.getBoundingClientRect();
        const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return { c, ok: h === btn || btn.contains(h), why: h?.outerHTML?.slice(0, 80) };
      });
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, iw: innerWidth, ih: innerHeight, hits };
    },
    { sel, controls },
  );
  assert.ok(r.left >= 0, `${label} left ${r.left}`);
  assert.ok(r.right <= r.iw + 0.5, `${label} right ${r.right} > ${r.iw}`);
  assert.ok(r.top >= 0 && r.bottom <= r.ih + 0.5, `${label} vertical ${r.top}..${r.bottom} / ${r.ih}`);
  for (const h of r.hits) assert.ok(h.ok, `${label} ${h.c} covered at its centre by ${h.why}`);
  return r;
}

/** No two of these controls overlap (S3-C #82 rule). */
async function noOverlap(p, label, sels) {
  const rects = await p.evaluate((sels) => sels.map((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { s, l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  }).filter(Boolean), sels);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ov = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      assert.ok(!ov, `${label}: ${a.s} overlaps ${b.s}`);
    }
  for (const a of rects) assert.ok(a.w >= 24 && a.h >= 24, `${label}: ${a.s} hit target ${a.w}x${a.h} < 24`);
}

test("#36/#29 browser 1280: undo/redo, save marker, input-safe keys, multi-select batch = one step, drag box", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "a");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await sceneReady(p);
    await p.getByTestId("node-count").waitFor({ timeout: 10000 });
    assert.equal(await count(p), "Nodes 3 / 256");
    const undo = p.getByTestId("undo"), redo = p.getByTestId("redo");
    assert.equal(await undo.isDisabled(), true);
    assert.equal(await redo.isDisabled(), true);
    assert.equal(await undo.getAttribute("aria-label"), "Undo");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0);

    // one edit → dirty; undo → clean; redo → dirty
    await p.getByTestId("node-row-n1").click();
    await p.getByTestId("node-delete-n1").click();
    assert.equal(await count(p), "Nodes 2 / 256");
    assert.match(await text(p, "dirty-indicator"), /•\s*Unsaved/);
    assert.equal(await undo.getAttribute("title"), "Undo Delete node");
    await undo.click();
    assert.equal(await count(p), "Nodes 3 / 256");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0, "undo back to the marker clears dirty");
    assert.equal(await redo.isDisabled(), false);
    await redo.click();
    assert.equal(await count(p), "Nodes 2 / 256");

    // typing in an input never undoes; outside an input Ctrl+Z does
    await p.locator("input.search").first().focus();
    await p.keyboard.press("Control+z");
    assert.equal(await count(p), "Nodes 2 / 256", "Ctrl+Z in an input is ignored");
    await p.locator("input.search").first().evaluate((e) => e.blur());
    await p.keyboard.press("Control+z");
    assert.equal(await count(p), "Nodes 3 / 256");
    await p.keyboard.press("Control+Shift+z");
    assert.equal(await count(p), "Nodes 2 / 256");
    await p.keyboard.press("Control+z");
    assert.equal(await count(p), "Nodes 3 / 256");

    // Save keeps the stack; the marker moves to the saved step
    await p.getByTestId("node-row-n2").click();
    await p.getByTestId("node-delete-n2").click();
    await p.getByTestId("scene-save").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="scene-save"]')?.textContent === "Saved", null, { timeout: 10000 });
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0);
    assert.equal(await undo.isDisabled(), false, "stack survives Save");
    await undo.click();
    assert.equal(await count(p), "Nodes 3 / 256");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 1, "undo past the save marker → dirty");
    await redo.click();
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0, "back on the marker → clean");
    await undo.click(); // n2 live again (dirty)

    // multi-select: shift-click, batch delete skips root, one undo restores all, selection survives
    await p.getByTestId("node-row-n0").click();
    await p.getByTestId("node-row-n1").click({ modifiers: ["Shift"] });
    await p.getByTestId("node-row-n2").click({ modifiers: ["Shift"] });
    assert.equal(await text(p, "selection-count"), "3 selected");
    assert.equal(await p.getByTestId("node-row-n1").getAttribute("aria-pressed"), "true");
    assert.match(await p.getByTestId("node-row-n1").textContent(), /✓/, "check badge, not colour alone");
    await p.getByTestId("batch-delete").click();
    assert.equal(await count(p), "Nodes 1 / 256");
    assert.equal(await text(p, "batch-toast"), "1 skipped (root)");
    assert.equal(await undo.getAttribute("title"), "Undo Delete 2 nodes");
    await p.keyboard.press("Control+z");
    assert.equal(await count(p), "Nodes 3 / 256", "batch = one undo step");
    assert.equal(await text(p, "selection-count"), "3 selected", "selection survives undo");
    await p.keyboard.press("Control+y");
    assert.equal(await count(p), "Nodes 1 / 256");
    assert.equal(await text(p, "selection-count"), "3 selected", "selection survives redo");
    await p.keyboard.press("Control+z");
    await p.keyboard.press("Escape");
    assert.equal(await p.getByTestId("selection-count").count(), 0, "Esc clears");
    await p.keyboard.press("Control+a");
    assert.equal(await text(p, "selection-count"), "3 selected", "Ctrl+A = live nodes only");
    // bounds + overlap of the author toolbar and batch row
    await p.getByTestId("batch-actions").scrollIntoViewIfNeeded();
    await inViewAndHittable(p, "1280 batch", '[data-testid="batch-actions"]', ['[data-testid="batch-hide"]', '[data-testid="batch-restore"]']);
    await p.keyboard.press("Escape");
    await p.getByTestId("node-row-n0").click();
    await p.getByTestId("node-delete-n0").isDisabled();
    await p.getByTestId("node-row-n1").click();
    await p.getByTestId("node-delete-n1").click(); // dirty for the indicator overlap check
    await p.getByTestId("undo").scrollIntoViewIfNeeded();
    await noOverlap(p, "1280 toolbar", ['[data-testid="undo"]', '[data-testid="redo"]', '[data-testid="scene-save"]', '[data-testid="node-add"]']);
    await p.keyboard.press("Control+z");

    // drag box: Shift+drag on the empty canvas selects the nodes inside (no orbit while boxing)
    const c = await p.getByTestId("viewer-canvas").boundingBox();
    await p.keyboard.down("Shift");
    await p.mouse.move(c.x + 4, c.y + 4);
    await p.mouse.down();
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
    await p.mouse.move(c.x + c.width - 4, c.y + c.height - 4, { steps: 4 });
    assert.equal(await p.getByTestId("select-box").count(), 1, "box drawn while dragging");
    await p.mouse.up();
    await p.keyboard.up("Shift");
    assert.equal(await p.getByTestId("select-box").count(), 0);
    assert.equal(await text(p, "selection-count"), "3 selected", "box over the whole canvas selects every live node");
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#29 browser: a batch restore over the cap is refused whole with the D1 text", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "b");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.route("**/api/health", (r) => r.fulfill({ status: 200, headers: json, body: JSON.stringify({ ok: true, limits: { sceneMaxNodes: 3 } }) }));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await sceneReady(p);
    await p.getByTestId("node-count").waitFor({ timeout: 10000 });
    assert.equal(await count(p), "Nodes 3 / 3");
    await p.getByTestId("node-row-n3").click({ modifiers: ["Shift"] });
    assert.equal(await text(p, "selection-count"), "1 selected");
    await p.getByTestId("batch-restore").click();
    assert.equal(await text(p, "batch-toast"), "Restore would exceed the 3-node limit");
    assert.equal(await count(p), "Nodes 3 / 3", "nothing restored");
    assert.equal(await p.getByTestId("undo").isDisabled(), true, "no step recorded");
    // author toolbar + batch row: no overlap, targets ≥ 24px at 390×844 / 1280 / 1920 (S3-C #82, D1 locks)
    for (const [w, h] of [[390, 844], [1280, 800], [1920, 1080]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.getByTestId("undo").scrollIntoViewIfNeeded();
      await noOverlap(p, `${w} toolbar`, ['[data-testid="undo"]', '[data-testid="redo"]', '[data-testid="scene-save"]', '[data-testid="node-add"]', '[data-testid="node-duplicate"]']);
      await p.getByTestId("batch-actions").scrollIntoViewIfNeeded();
      await noOverlap(p, `${w} batch`, ["hide", "show", "delete", "restore", "clear"].map((b) => `[data-testid="batch-${b}"]`));
      await inViewAndHittable(p, `${w} batch`, '[data-testid="batch-actions"]', ['[data-testid="batch-restore"]', '[data-testid="batch-clear"]']);
    }
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#84 browser: Compare… picker obeys NIT-F-1 at 390/1280/1920 (+resize); split vs stacked; diff markers; 5 cycles no leak", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "c");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    for (const [w, h] of [[390, 844], [1280, 800], [1920, 1080]]) {
      const p = await br.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      const warns = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      p.on("console", (m) => /too many active webgl contexts/i.test(m.text()) && warns.push(m.text()));
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: new RegExp(fx.slugs.c1) }).first().click();
      await p.getByTestId("compare-open").click();
      await p.getByTestId("compare-picker").waitFor({ timeout: 5000 });
      await p.locator('[data-testid="compare-picker"] input').fill(fx.slugs.c2);
      await p.waitForTimeout(50);
      const pick = `[data-testid="compare-pick-${fx.slugs.c2}"]`;
      const r = await inViewAndHittable(p, `${w} picker`, '[data-testid="compare-picker"]', [pick, '[data-testid="compare-cancel"]']);
      if (w < 600) assert.ok(Math.abs(r.width - (w - 16)) <= 1, `${w} sheet width ${r.width}`);
      if (w === 1280) {
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(50);
        await inViewAndHittable(p, "1280→390 resize", '[data-testid="compare-picker"]', [pick]);
        await p.setViewportSize({ width: 700, height: 500 });
        await p.waitForTimeout(50);
        await inViewAndHittable(p, "→700x500 resize", '[data-testid="compare-picker"]', [pick]);
        await p.setViewportSize({ width: w, height: h });
        await p.waitForTimeout(50);
      }
      await p.locator(pick).click();
      await p.getByTestId("compare-diff").waitFor({ timeout: 10000 });
      assert.match(p.url(), new RegExp(`compare=${fx.ids.c1},${fx.ids.c2}`));
      const L = await p.getByTestId("compare-left").boundingBox();
      const R = await p.getByTestId("compare-right").boundingBox();
      if (w < 600) assert.ok(R.y >= L.y + L.height - 1, `${w}: stacked (right below left)`);
      else assert.ok(R.x >= L.x + L.width - 1 && Math.abs(R.y - L.y) < 2, `${w}: side by side`);
      for (const b of [L, R]) assert.ok(b.x >= 0 && b.x + b.width <= w + 0.5, `${w}: viewport inside width`);
      const sync = p.locator('[data-testid="compare-sync"] input');
      assert.equal(await sync.isChecked(), true, "sync orbit default on");
      const diff = await p.$$eval('[data-testid="compare-diff"] tbody tr', (rows) => rows.map((r) => ({ row: r.dataset.row, d: r.dataset.differs, t: r.textContent })));
      assert.deepEqual(diff.map((d) => d.row), ["tris", "bones", "clips", "clipRequires", "size", "characterType", "license", "stage"]);
      for (const k of ["clips", "characterType", "license"]) {
        const d = diff.find((x) => x.row === k);
        assert.equal(d.d, "1", `${k} differs`);
        assert.match(d.t, /≠/, `${k} has a text marker`);
      }
      assert.equal(diff.find((x) => x.row === "stage").d, "0");
      await inViewAndHittable(p, `${w} compare top`, '[data-testid="compare-sync"]', ['[data-testid="compare-sync"] input', '[data-testid="compare-back"]']);
      if (w === 1280) {
        // 5 open/close cycles: never more than the 2 compare canvases, no context-limit warning
        for (let i = 0; i < 5; i++) {
          await p.goBack(); // close (history back to the builder) …
          await p.getByTestId("viewer-root").waitFor({ timeout: 10000 });
          await p.goForward(); // … and reopen the same compare
          await p.getByTestId("compare-diff").waitFor({ timeout: 10000 });
          assert.equal(await p.locator("canvas").count(), 2, `cycle ${i + 1}: 2 canvases`);
        }
        assert.deepEqual(warns, [], "no WebGL context leak");
        await p.getByTestId("compare-back").click();
        await p.getByTestId("viewer-root").waitFor({ timeout: 10000 });
        assert.equal(await p.locator("canvas").count(), 1, "back link: compare canvases disposed");
      }
      assert.deepEqual(errs, []);
      await p.close();
    }
    // inline errors (malformed, self, unknown) with a link back, no crash
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    for (const [q, re] of [["a", /exactly two/], [`${fx.ids.c1},${fx.ids.c1}`, /two different/], [`${fx.ids.c1},${runId("nope")}`, /Unknown asset id/]]) {
      await p.goto(`${UI.replace(/\/$/, "")}/?compare=${q}`, { waitUntil: "networkidle" });
      await p.getByTestId("compare-error").waitFor({ timeout: 10000 });
      assert.match(await text(p, "compare-error"), re);
      assert.equal(await p.getByTestId("compare-error-back").getAttribute("href"), "/");
    }
    await p.getByTestId("compare-error-back").click();
    await p.getByTestId("viewer-root").waitFor({ timeout: 10000 });
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#44 browser: /health shows a 401-stub bridge as unauthorized, honours 429 Retry-After, pauses when hidden, never shows dataRoot", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI } = env;
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    for (const [w, h] of [[390, 844], [1280, 800], [1920, 1080]]) {
      const p = await br.newPage({ viewport: { width: w, height: h } });
      let hits = 0;
      let arm429 = 0;
      await p.route("**/api/health", (r) => {
        hits++;
        if (arm429 > 0 && w === 1280 && p.url().endsWith("/health")) {
          arm429--; // 2: React StrictMode (dev) mounts the poller twice; the first fetch is discarded
          return r.fulfill({ status: 429, headers: { ...json, "Retry-After": "2" }, body: JSON.stringify({ code: "RATE_LIMITED", error: "rate limited", retryAfterSec: 2 }) });
        }
        return r.fulfill({
          status: 200,
          headers: json,
          body: JSON.stringify({
            ok: true,
            bridge: { mode: "vendor", status: "unauthorized", httpStatus: 401 },
            krita: { ok: false, status: "unauthorized", port: 5577 },
            tools: { blender: { path: "/home/box/tools/blender", version: "5.2.3 LTS" }, krita: null },
            limits: { sceneMaxNodes: 256 },
            dataRoot: "/workspace/secret-data-root",
            share: { baseUrl: null },
          }),
        });
      });
      await p.goto(UI, { waitUntil: "networkidle" });
      arm429 = 2; // the first /health poll is rate limited (1280 only)
      await p.getByTestId("nav-health").click();
      await p.getByTestId("health-page").waitFor({ timeout: 10000 });
      assert.match(p.url(), /\/health$/);
      if (w === 1280) {
        await p.waitForFunction(() => /Rate limited, retrying in \ds/.test(document.querySelector('[data-testid="health-updated"]')?.textContent ?? ""), null, { timeout: 5000 }).catch(async (e) => { throw new Error(`${e.message} hits=${hits} text=${await p.textContent('[data-testid="health-updated"]')}`); });
      }
      await p
        .waitForFunction(() => /unauthorized/.test(document.querySelector('[data-testid="health-bridge"]')?.textContent ?? ""), null, { timeout: 15000 })
        .catch(async (e) => {
          throw new Error(`${w}: ${e.message} hits=${hits} updated=${await p.textContent('[data-testid="health-updated"]')}`);
        });
      assert.match(await text(p, "health-bridge"), /⚠\s*unauthorized/);
      assert.match(await text(p, "health-dataroot"), /set$/);
      const body = await p.evaluate(() => document.body.innerText + document.body.innerHTML);
      assert.ok(!body.includes("secret-data-root"), "dataRoot path never in the DOM");
      assert.ok(!ABS.test(await p.evaluate(() => document.body.innerText)), "no absolute path in the page text");
      await inViewAndHittable(p, `${w} health`, '[data-testid="health-bridge"]', ['[data-testid="health-back"]']);
      if (w < 600) {
        const xs = await p.$$eval(".health-card", (cs) => [...new Set(cs.map((c) => Math.round(c.getBoundingClientRect().left)))]);
        assert.equal(xs.length, 1, "single column under 600px");
      }
      if (w === 1280) {
        // hidden tab pauses polling (no fetch for > one 10 s interval)
        await p.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await p.waitForFunction(() => document.querySelector('[data-testid="health-updated"]')?.textContent?.includes("Paused (tab hidden)"), null, { timeout: 3000 });
        const before = hits;
        await p.waitForTimeout(11000);
        assert.equal(hits, before, "no polling while hidden");
        await p.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await p.waitForFunction((b) => Number(document.querySelector('[data-testid="health-page"]')?.dataset.polls) > 0 && true, before, { timeout: 3000 });
        await p.waitForFunction(() => /Updated \d+s ago/.test(document.querySelector('[data-testid="health-updated"]')?.textContent ?? ""), null, { timeout: 5000 });
        assert.ok(hits > before, "polling resumes when visible");
      }
      await p.close();
    }
  } finally {
    await br.close();
  }
});

test("D2 browser: id-less activity rows are muted plain text (no link) with relative time + ISO tooltip; unknown kind never errors", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI } = env;
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const at = new Date(Date.now() - 120000).toISOString();
    const items = [
      { at, kind: "inbox.sweep", removed: 2, kept: 5 },
      { at, kind: "webhook.refused", reason: "redirect" },
      { at, kind: "webhook.failed" },
      { at, kind: "mystery.kind" },
    ];
    await p.route("**/api/activity*", (r) => r.fulfill({ status: 200, headers: json, body: JSON.stringify({ items, total: items.length }) }));
    await p.goto(UI, { waitUntil: "networkidle" });
    const rows = p.locator('[data-testid="activity-panel"] [data-testid="activity-row"]');
    await rows.first().waitFor({ timeout: 10000 });
    const got = await rows.evaluateAll((els) => els.map((e) => ({ t: e.textContent, btn: e.querySelectorAll("button,a").length, muted: e.classList.contains("muted"), title: e.querySelector("time")?.getAttribute("title") })));
    assert.equal(got.length, 4);
    for (const [i, re] of [/Swept inbox: 2 removed/, /Webhook refused \(redirect\)/, /Webhook failed/, /mystery\.kind/].entries()) {
      assert.match(got[i].t, re);
      assert.equal(got[i].btn, 0, "no link");
      assert.equal(got[i].muted, true);
      assert.equal(got[i].title, at, "ISO tooltip");
    }
    await p.getByTestId("nav-health").click();
    await p.getByTestId("health-activity").waitFor({ timeout: 10000 });
    await p.waitForFunction(() => /Swept inbox: 2 removed/.test(document.querySelector('[data-testid="health-activity"]')?.textContent ?? ""), null, { timeout: 10000 });
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
  }
});

async function registerViaUi(p, body) {
  const ta = p.getByLabel("Asset JSON");
  if (!(await ta.count())) await p.getByRole("button", { name: "Register asset" }).click();
  await ta.fill(JSON.stringify(body));
  await p.getByTestId("register-submit").click();
  await p.getByLabel("Asset JSON").waitFor({ state: "detached", timeout: 10000 });
}

test("#36 ruling browser: stale-undo probe — Save, server-side delete, refresh reload → Undo can't revive/touch nodes; Unsaved accurate; scene switch resets", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "d");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const extra = [runId("s3g-d-r1"), runId("s3g-d-r2")];
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await sceneReady(p);
    await p.getByTestId("node-count").waitFor({ timeout: 10000 });
    const undo = p.getByTestId("undo");
    // edit + Save: stack survives with the marker on it
    await p.getByTestId("node-row-n2").click();
    await p.getByTestId("node-delete-n2").click();
    await p.getByTestId("scene-save").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="scene-save"]')?.textContent === "Saved", null, { timeout: 10000 });
    assert.equal(await undo.isDisabled(), false);
    // a list refresh that leaves the draft untouched must not touch history
    await registerViaUi(p, billboardBody(extra[0], `s3gui-d-r1-${process.pid}`));
    assert.equal(await undo.isDisabled(), false, "untouched reload keeps the stack");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0);
    // second "page": hard-remove n1 on the server
    const cur = await (await fetch(`${API}/api/assets/${fx.ids.sid}`)).json();
    const pr = await fetch(`${API}/api/assets/${fx.ids.sid}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ scene: { ...cur.scene, nodes: cur.scene.nodes.filter((n) => n.id !== "n1") } }),
    });
    assert.equal(pr.status, 200, await pr.text());
    // refresh that reloads the scene → draft replaced, stack + marker reset
    await registerViaUi(p, billboardBody(extra[1], `s3gui-d-r2-${process.pid}`));
    await p.waitForFunction(() => !document.querySelector('[data-testid="node-row-n1"]'), null, { timeout: 10000 });
    assert.equal(await undo.isDisabled(), true, "stack cleared by the replacing reload");
    assert.equal(await p.getByTestId("redo").isDisabled(), true);
    const before = await count(p);
    await p.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press("Control+z");
    await undo.click({ force: true }).catch(() => {});
    assert.equal(await count(p), before, "Undo is a no-op");
    assert.equal(await p.getByTestId("node-row-n1").count(), 0, "deleted node not revived");
    assert.equal(await p.getByTestId("node-row-deleted-n2").count(), 1, "saved delete not undone (still a tombstone)");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0, "draft == server → not Unsaved");
    const srv = await (await fetch(`${API}/api/assets/${fx.ids.sid}`)).json();
    assert.equal(before, `Nodes ${srv.scene.nodes.filter((n) => !n.deleted).length} / 256`, "UI matches the server scene");
    // scene switch with unsaved edits resets too
    await p.getByTestId("node-row-n0").click();
    await p.getByTestId("node-add").click();
    assert.equal(await p.getByTestId("dirty-indicator").count(), 1);
    await p.getByRole("button", { name: new RegExp(fx.slugs.c1) }).first().click();
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await sceneReady(p);
    assert.equal(await undo.isDisabled(), true, "scene switch clears the stack");
    assert.equal(await p.getByTestId("dirty-indicator").count(), 0);
    assert.equal(await count(p), before);
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    for (const id of extra) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
    await fx.cleanup();
  }
});

test("#29 browser: help text names Shift+drag; a Shift+drag starting on a gizmo handle stays a gizmo drag (no box)", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  // the gizmo only mounts on a loadable GLB child: drop a synthetic one where a same-checkout API serves it
  const gid = runId("s3g-e-glb");
  const dirs = [ROOT + "/data", process.env.WB_DATA_ROOT].filter(Boolean).map((d) => path.join(d, "assets", gid));
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "model.glb"), makeRiggedGlb({ bones: 2, clips: {} }));
  }
  const gslug = `s3gui-e-glb-${process.pid}`;
  const sid = runId("s3g-e-scene");
  const post = (b) => fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) }).then((r) => r.status, () => 0);
  const rmDirs = () => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  const fx = {
    slugs: { scene: `s3gui-e-scene-${process.pid}` },
    cleanup: async () => {
      for (const id of [sid, gid]) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
      rmDirs();
    },
  };
  const served = (await post(billboardBody(gid, gslug))) === 201 && (await fetch(`${API}/api/assets/${gid}/file`)).status === 200;
  const sceneOk = served && (await post({ ...billboardBody(sid, fx.slugs.scene), characterType: "unknown", stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: gid, transform: tf(-3) }, { id: "n1", assetId: gid, transform: tf(0) }] } })) === 201;
  if (!sceneOk) {
    await fx.cleanup();
    return t.skip(`SKIP_NO_API: ${API} did not register/serve a GLB from this checkout's data dir`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await sceneReady(p);
    await p.waitForTimeout(500); // GLB + gizmo mount after preflight
    assert.match(await text(p, "canvas-help"), /Shift\+drag to box-select/);
    await p.getByTestId("node-row-n1").click(); // n1 sits at the origin = orbit target = canvas centre
    const c = await p.getByTestId("viewer-canvas").boundingBox();
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
    await p.mouse.move(cx + 3, cy + 3);
    await p.mouse.move(cx, cy, { steps: 3 }); // hover → the gizmo picks a handle
    await p.keyboard.down("Shift");
    await p.mouse.down();
    await p.mouse.move(cx + 60, cy + 10, { steps: 6 });
    const boxDuring = await p.getByTestId("select-box").count();
    await p.mouse.up();
    await p.keyboard.up("Shift");
    assert.equal(boxDuring, 0, "no selection box from a gizmo handle");
    assert.equal(await p.getByTestId("selection-count").count(), 0);
    assert.equal(await p.getByTestId("undo").getAttribute("title"), "Undo Move node", "the drag moved the node");
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});
