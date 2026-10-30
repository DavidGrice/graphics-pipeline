/**
 * S3-E E2 UI — #38 counter + cap disables, #41 tombstone rows / Restore / Purge confirm / root &
 * last-live Delete disabled, #35 Replace asset… + Undo keeps the transform, #87 touch orbit on the
 * canvas only + 390×844 dock with 44 px targets (D1 §1–4). Registers + DELETEs its own fixtures
 * on WORLD_API. Set S3E_SHOT_DIR to also write screenshots (390×844, 1280, 1920).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, runId } from "./helpers/s3d-synth.mjs";

const SHOTS = process.env.S3E_SHOT_DIR || null;
const json = { "Content-Type": "application/json" };
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

async function fixtures(API, tag) {
  const pid = process.pid;
  const c1 = runId(`${tag}-c1`);
  const c2 = runId(`${tag}-c2`);
  const sid = runId(`${tag}-scene`);
  const s = { c1: `e2ui-${tag}-a-${pid}`, c2: `e2ui-${tag}-b-${pid}`, scene: `e2ui-${tag}-scene-${pid}` };
  const reg = async (b) => {
    try {
      return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
    } catch {
      return 0;
    }
  };
  if ((await reg(billboardBody(c1, s.c1))) !== 201) return null;
  await reg(billboardBody(c2, s.c2));
  const scene = {
    ...billboardBody(sid, s.scene),
    name: s.scene,
    characterType: "unknown",
    stage: "scene",
    scene: {
      version: 1,
      rootId: "n0",
      nodes: [
        { id: "n0", assetId: c1, transform: tf(0) },
        { id: "n1", assetId: c1, transform: { position: [3, 2, 1], rotation: [0, 0.5, 0], scale: [2, 2, 2] }, visible: true },
        { id: "n2", assetId: c1, transform: tf(4), deleted: true },
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

const shot = async (p, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: path.join(SHOTS, name), fullPage: false });
};

test("#38/#41/#35 browser 1280: counter, tombstone row, root Delete disabled, Restore, Replace+Undo, Purge confirm, Save", async (t) => {
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
    const count = p.getByTestId("node-count");
    await count.waitFor({ timeout: 10000 });
    assert.equal((await count.textContent()).trim(), "Nodes 2 / 256", "tombstone excluded");
    // tombstone row: struck through, Restore, not selectable
    const dead = p.getByTestId("node-row-deleted-n2");
    assert.ok(await dead.isVisible());
    assert.match(await dead.locator(".scene-node").evaluate((e) => getComputedStyle(e).textDecorationLine), /line-through/);
    assert.match(await dead.textContent(), /deleted/);
    assert.equal(await p.getByTestId("nodes-show-deleted").isChecked(), true);
    // root Delete disabled with the D1 title
    await p.locator(".scene-node-list button.scene-node").nth(0).click();
    const delRoot = p.getByTestId("node-delete-n0");
    assert.equal(await delRoot.isDisabled(), true);
    assert.equal(await delRoot.getAttribute("title"), "Root node can't be deleted");
    // delete n1 → tombstone; restore
    await p.locator(".scene-node-list button.scene-node").nth(1).click();
    await p.getByTestId("node-delete-n1").click();
    assert.equal((await count.textContent()).trim(), "Nodes 1 / 256");
    assert.ok(await p.getByTestId("node-row-deleted-n1").isVisible());
    await p.getByTestId("node-restore-n1").click();
    assert.equal((await count.textContent()).trim(), "Nodes 2 / 256");
    // replace n1 → c2, undo, replace again
    await p.locator(".scene-node-list button.scene-node").nth(1).click();
    await p.getByTestId("node-replace-n1").click();
    assert.equal(await p.getByTestId(`replace-pick-${fx.slugs.c1}`).count(), 0, "current asset excluded");
    await p.getByTestId(`replace-pick-${fx.slugs.c2}`).click();
    const undo = p.getByTestId("node-replace-undo");
    await undo.waitFor({ timeout: 5000 });
    assert.match(await p.locator(".replace-chip").textContent(), new RegExp(`Replaced ${fx.slugs.c1} → ${fx.slugs.c2}`));
    await shot(p, "e2-replace-1280.png");
    await undo.click();
    assert.equal(await undo.count(), 0);
    await p.getByTestId("node-replace-n1").click();
    await p.getByTestId(`replace-pick-${fx.slugs.scene}`).click();
    assert.match(await p.locator(".replace-picker .err").textContent(), /self-reference/);
    await p.getByTestId(`replace-pick-${fx.slugs.c2}`).click();
    // purge with inline confirm, then Save (Save itself never purges — purge is explicit)
    await p.getByTestId("nodes-purge").click();
    assert.equal((await p.getByTestId("nodes-purge-confirm").locator("..").textContent()).includes("Permanently remove 1 node? This can't be undone."), true);
    await shot(p, "e2-purge-confirm-1280.png");
    await p.getByTestId("nodes-purge-confirm").click();
    assert.equal(await p.getByTestId("node-row-deleted-n2").count(), 0);
    await p.getByTestId("scene-save").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="scene-save"]')?.textContent === "Saved", null, { timeout: 10000 });
    const saved = await (await fetch(`${API}/api/assets/${fx.ids.sid}`)).json();
    assert.deepEqual(saved.scene.nodes.map((n) => n.id), ["n0", "n1"]);
    assert.equal(saved.scene.nodes[1].assetId, fx.ids.c2);
    assert.deepEqual(saved.scene.nodes[1].transform, { position: [3, 2, 1], rotation: [0, 0.5, 0], scale: [2, 2, 2] }, "transform kept");
    assert.deepEqual(errs, []);
    // 1920 screenshot
    await p.setViewportSize({ width: 1920, height: 1080 });
    await shot(p, "e2-scene-author-1920.png");
    await p.close();

    // cap reached (health says max 2): Add / Duplicate / Restore disabled with the title
    const p2 = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p2.route("**/api/health", (r) => r.fulfill({ status: 200, headers: json, body: JSON.stringify({ ok: true, limits: { sceneMaxNodes: 2 } }) }));
    await fetch(`${API}/api/assets/${fx.ids.sid}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ scene: { ...saved.scene, nodes: [...saved.scene.nodes, { id: "n9", assetId: fx.ids.c1, transform: tf(9), deleted: true }] } }),
    });
    await p2.goto(UI, { waitUntil: "networkidle" });
    await p2.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await p2.getByTestId("node-count").waitFor({ timeout: 10000 });
    assert.equal((await p2.getByTestId("node-count").textContent()).trim(), "Nodes 2 / 2");
    assert.match(await p2.getByTestId("node-count").getAttribute("class"), /node-count-max/);
    for (const id of ["node-add", "node-duplicate", "node-restore-n9"]) {
      const b = p2.getByTestId(id);
      assert.equal(await b.isDisabled(), true, `${id} disabled at cap`);
      assert.equal(await b.getAttribute("title"), "Node limit reached (2)");
    }
    await shot(p2, "e2-cap-1280.png");
    await p2.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#41 browser: Delete asset blocked by a tombstoned ref shows the purge hint", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "b");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    // make c2 referenced only by a tombstone
    const sc = await (await fetch(`${API}/api/assets/${fx.ids.sid}`)).json();
    await fetch(`${API}/api/assets/${fx.ids.sid}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ scene: { ...sc.scene, nodes: [...sc.scene.nodes, { id: "n7", assetId: fx.ids.c2, transform: tf(7), deleted: true }] } }),
    });
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.c2) }).first().click();
    await p.getByTestId("asset-delete").click();
    await p.getByTestId("asset-delete-confirm").click();
    const msg = p.getByTestId("asset-delete-msg");
    await msg.waitFor({ timeout: 5000 });
    assert.equal((await msg.textContent()).trim(), `Used by deleted nodes in ${fx.slugs.scene}, purge to free`);
    assert.equal((await fetch(`${API}/api/assets/${fx.ids.c2}`)).status, 200, "not deleted");
    await p.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});

test("#87 browser 390×844 touch: canvas-only gestures, page scrolls, dock wraps with 44 px targets, no overlap", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const fx = await fixtures(API, "c");
  if (!fx) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: new RegExp(fx.slugs.scene) }).first().click();
    await p.getByTestId("node-count").waitFor({ timeout: 10000 });
    const canvas = p.locator(".viewer canvas").first();
    await canvas.waitFor({ timeout: 10000 });
    assert.equal(await canvas.evaluate((e) => getComputedStyle(e).touchAction), "none");
    assert.notEqual(await p.evaluate(() => getComputedStyle(document.body).touchAction), "none", "page keeps native touch");
    // layout: single column, viewer full width
    const vb = await p.locator(".viewer").boundingBox();
    assert.ok(vb.width >= 380, `viewer width ${vb.width}`);
    // page scrolls normally (touch scroll outside the canvas)
    assert.ok(await p.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 50), "page is taller than the viewport");
    const cdp = await ctx.newCDPSession(p);
    await p.evaluate(() => scrollTo(0, 0));
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    // start on page chrome outside the viewer / internal scrollers (dock, import panel) so the page itself scrolls
    const sy = await p.evaluate(() => {
      for (let y = 600; y >= 260; y -= 10) {
        const e = document.elementFromPoint(195, y);
        if (e && !e.closest(".viewer, .viewer-dock, .import-meta-panel, input, select, textarea")) return y;
      }
      return null;
    });
    assert.ok(sy, "found a sidebar touch point");
    await touch("touchStart", [[195, sy]]);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", [[195, sy - i * 22]]);
      await p.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await p.waitForTimeout(400);
    assert.ok((await p.evaluate(() => scrollY)) > 50, "touch-drag on the sidebar scrolls the page");
    // gestures on the canvas: page doesn't scroll / zoom; one finger rotates the view
    await canvas.scrollIntoViewIfNeeded();
    const cb = await canvas.boundingBox();
    // off-centre so the drag starts on empty ground, not on the selected node's gizmo at the origin
    const cx = cb.x + cb.width * 0.2;
    const cy = cb.y + cb.height * 0.75;
    const y0 = await p.evaluate(() => scrollY);
    const before = await canvas.screenshot();
    await touch("touchStart", [[cx, cy]]);
    for (let i = 1; i <= 8; i++) await touch("touchMove", [[cx + i * 15, cy + i * 4]]);
    await touch("touchEnd", []);
    await p.waitForTimeout(200);
    const after = await canvas.screenshot();
    assert.ok(!before.equals(after), "one-finger drag on the canvas orbits the view");
    assert.equal(await p.evaluate(() => scrollY), y0, "canvas drag does not scroll the page");
    await touch("touchStart", [[cx - 20, cy], [cx + 20, cy]]);
    for (let i = 1; i <= 6; i++) await touch("touchMove", [[cx - 20 - i * 10, cy], [cx + 20 + i * 10, cy]]);
    await touch("touchEnd", []);
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => visualViewport.scale), 1, "pinch on the canvas never zooms the page");
    // dock + author targets ≥ 44×44, dock rows never overlap
    const small = await p.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".viewer-dock button, .viewer-dock select, .scene-author-panel button, .scene-author-panel select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) out.push(`${el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    assert.deepEqual(small, [], "every touch target ≥ 44×44 below 600 px");
    const overlaps = await p.evaluate(() => {
      const dock = document.querySelector(".viewer-dock");
      if (!dock) return ["no dock"];
      const kids = [...dock.children].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
      const bad = [];
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i], b = kids[j];
          if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad.push(`${i}/${j}`);
        }
      // #82 rule kept: content box ≤ 45vh (padding/border extra), dock scrolls internally
      const cs = getComputedStyle(dock);
      const content = dock.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (content > innerHeight * 0.45 + 1) bad.push(`dock content ${content} > 45vh`);
      if (!/auto|scroll/.test(cs.overflowY)) bad.push(`dock overflow ${cs.overflowY}`);
      return bad;
    });
    assert.deepEqual(overlaps, []);
    await p.evaluate(() => scrollTo(0, 0));
    await shot(p, "e2-touch-390x844-top.png");
    await p.locator(".viewer").scrollIntoViewIfNeeded();
    await shot(p, "e2-touch-390x844-viewer.png");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally {
    await br.close();
    await fx.cleanup();
  }
});
