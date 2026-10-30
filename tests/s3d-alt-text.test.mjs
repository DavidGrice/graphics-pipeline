/**
 * S3-D E2 #88 — optional altText (trimmed, 1–280; "" clears) via PATCH; > 280 → 400
 * ALT_TEXT_TOO_LONG (R1 rev2 §9, D2 §1). Canvas wrapper role="img" + aria-label = altText ?? name.
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
  makeRiggedGlb,
  runId,
} from "./helpers/s3d-synth.mjs";

const ABS = /(^|[\s'"])\/(home|workspace|tmp|etc|usr|var)\//;
let api;
let P;
let S;
const j = (method, url, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  api = await startApi();
  P = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
  S = await import(path.join(ROOT, "packages/asset-schema/dist/index.js"));
});
after(async () => api && (await api.stop()));

test("#88 PATCH altText: 280 ok, trimmed; 281 → 400 ALT_TEXT_TOO_LONG {length,max} flat", async () => {
  const id = runId("8a");
  assert.equal((await j("POST", `${api.url}/api/assets`, billboardBody(id, "alt-a"))).status, 201);
  const url = `${api.url}/api/assets/${id}`;
  const ok = await j("PATCH", url, { altText: `  ${"a".repeat(280)}  ` });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).altText, "a".repeat(280));
  const bad = await j("PATCH", url, { altText: "b".repeat(281) });
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.deepEqual(Object.keys(body).sort(), ["code", "error", "length", "max"]);
  assert.equal(body.code, "ALT_TEXT_TOO_LONG");
  assert.equal(body.length, 281);
  assert.equal(body.max, 280);
  assert.ok(!ABS.test(JSON.stringify(body)));
  assert.equal((await (await fetch(url)).json()).altText, "a".repeat(280), "rejected PATCH changes nothing");
  // whitespace padding does not count toward the cap
  assert.equal((await j("PATCH", url, { altText: ` ${"c".repeat(280)} ` })).status, 200);
});

test('#88 "" / whitespace / null clear altText; non-string → VALIDATION', async () => {
  const id = runId("8b");
  await j("POST", `${api.url}/api/assets`, { ...billboardBody(id, "alt-b"), altText: "A bench" });
  const url = `${api.url}/api/assets/${id}`;
  assert.equal((await (await fetch(url)).json()).altText, "A bench");
  for (const clear of ["", "   ", null]) {
    await j("PATCH", url, { altText: "x" });
    const r = await j("PATCH", url, { altText: clear });
    assert.equal(r.status, 200);
    assert.ok(!("altText" in (await r.json())), `cleared by ${JSON.stringify(clear)}`);
    assert.ok(!("altText" in (await (await fetch(url)).json())));
  }
  const n = await j("PATCH", url, { altText: 42 });
  assert.equal(n.status, 400);
  assert.equal((await n.json()).code, "VALIDATION");
});

test("#88 POST altText > 280 → ALT_TEXT_TOO_LONG; schema keeps v3 + optional field", async () => {
  const r = await j("POST", `${api.url}/api/assets`, { ...billboardBody(runId("8c"), "alt-c"), altText: "z".repeat(300) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "ALT_TEXT_TOO_LONG");
  const base = billboardBody(runId("8d"), "alt-d");
  assert.equal(S.safeParseAsset(base).success, true, "altText optional");
  assert.equal(S.safeParseAsset({ ...base, altText: "y".repeat(280) }).success, true);
  assert.equal(S.safeParseAsset({ ...base, altText: "y".repeat(281) }).success, false);
  assert.equal(S.ALT_TEXT_MAX, 280);
  assert.equal(S.ASSET_SCHEMA_VERSION, 3, "no schema bump");
});

test("#88 helpers: n/280 counter, over flag, aria-label = altText ?? name", () => {
  assert.deepEqual(P.altTextState("  hi  "), { trimmed: "hi", length: 2, over: false, counter: "2/280" });
  assert.equal(P.altTextState("x".repeat(281)).over, true);
  assert.equal(P.altTextState("x".repeat(281)).counter, "281/280");
  assert.equal(P.canvasAriaLabel({ altText: "  A red bench ", name: "bench" }), "A red bench");
  assert.equal(P.canvasAriaLabel({ altText: "  ", name: "bench" }), "bench");
  assert.equal(P.canvasAriaLabel({ slug: "s" }), "s");
  assert.match(P.canvasAriaLabel(null), /no asset/);
});

test("#88 static wiring: Canvas inside role=img wrapper; counter + disabled Save", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  const w = app.indexOf('className="viewer-canvas"');
  assert.ok(w > 0);
  const tag = app.slice(w, app.indexOf(">", w));
  assert.match(tag, /role="img"/);
  assert.match(tag, /aria-label=\{canvasAriaLabel\(selected\)\}/);
  assert.ok(app.indexOf("<Canvas", w) > w && app.indexOf("<Canvas", w) < app.indexOf("</Canvas>", w));
  assert.match(app, /Alt text \(optional\)/);
  assert.match(app, /data-testid="alt-text-counter"/);
  assert.match(app, /disabled=\{altSaving \|\| st\.over \|\| !dirty\}/);
});

test("#88 browser: counter turns error at 281 + Save disabled; saved alt text becomes the canvas label", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("8e");
  const slug = `s3d-alt-${process.pid}`;
  // the canvas only mounts for a loadable GLB: drop a synthetic one where a same-checkout API serves it
  const dir = path.join(ROOT, "data/assets", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.glb"), makeRiggedGlb({ bones: 2, clips: {} }));
  const r = await j("POST", `${API}/api/assets`, billboardBody(id, slug));
  const served = r.status === 201 && (await fetch(`${API}/api/assets/${id}/file`)).status === 200;
  if (!served) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status === 201) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
    return t.skip(`SKIP_NO_API: ${API} did not register/serve a GLB from this checkout's data dir (${r.status})`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.locator("ul.asset-list").getByRole("button", { name: new RegExp(slug) }).click();
    const canvas = p.getByTestId("viewer-canvas");
    assert.equal(await canvas.getAttribute("role"), "img");
    assert.equal(await canvas.getAttribute("aria-label"), slug, "falls back to name");
    const box = p.getByLabel("Alt text (optional)");
    await box.fill("q".repeat(281));
    const counter = p.getByTestId("alt-text-counter");
    assert.equal(await counter.textContent(), "281/280");
    assert.match(await counter.getAttribute("class"), /over/);
    assert.equal(await p.getByTestId("alt-text-save").isDisabled(), true);
    await box.fill("A test billboard leaning on a wall");
    assert.equal(await counter.textContent(), "34/280");
    await p.getByTestId("alt-text-save").click();
    await p.waitForFunction(
      () => document.querySelector("[data-testid=viewer-canvas]")?.getAttribute("aria-label") === "A test billboard leaning on a wall",
      null,
      { timeout: 10000 },
    );
    assert.equal((await (await fetch(`${API}/api/assets/${id}`)).json()).altText, "A test billboard leaning on a wall");
    await p.close();
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
