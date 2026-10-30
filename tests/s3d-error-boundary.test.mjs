/**
 * S3-D E1 #89 — error boundary + probe dump (D1 §1, R1 rev2 §1).
 * Pure helpers (transpiled from TS) + static wiring guards always run. The browser check
 * (orphan GLB → card in the viewer, list still usable, no pageerror) runs only with UI_URL and
 * playwright-core; it registers its fixtures on WORLD_API and DELETEs them in finally.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT, billboardBody } from "./helpers/s3d-synth.mjs";

const require = createRequire(import.meta.url);
const SRC = path.join(ROOT, "apps/world-builder/client/src");
let E;

before(async () => {
  const ts = require("typescript");
  const out = ts.transpileModule(fs.readFileSync(path.join(SRC, "s3dErrors.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3d-err-"));
  const mod = path.join(dir, "s3dErrors.mjs");
  fs.writeFileSync(mod, out);
  E = await import(pathToFileURL(mod).href);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("#89 describeLoadError: three HttpError, message fallback, plain exception", () => {
  const http = Object.assign(new Error('fetch for "http://x/api/assets/a/file" responded with 404: Not Found'), {
    name: "HttpError",
    response: { status: 404, url: "http://x/api/assets/a/file" },
  });
  const a = E.describeLoadError(http);
  assert.equal(a.status, 404);
  assert.equal(a.url, "http://x/api/assets/a/file");
  assert.equal(E.statusLine(a), "/api/assets/a/file · HTTP 404", "URL shown repo-relative, origin stripped");
  const b = E.describeLoadError(new Error('Could not load /f: fetch for "/f" responded with 500: x'));
  assert.equal(b.status, 500);
  assert.equal(b.url, "/f");
  const c = E.describeLoadError(new TypeError("boom"), "/api/assets/z/file");
  assert.equal(c.status, null);
  assert.equal(c.url, "/api/assets/z/file");
  assert.equal(E.statusLine(c), "/api/assets/z/file · Exception: TypeError");
  assert.equal(E.statusLine({ status: 404, name: "HttpError", code: "FILE_MISSING" }), "HTTP 404 · FILE_MISSING");
  assert.equal(E.relativeUrl("http://localhost:5173/api/assets/a/file?x=1"), "/api/assets/a/file?x=1");
});

test("#89 probe dump: clips/rig/clipDurations/warnings; 20 KB cap says truncated", () => {
  const d = E.probeDump({
    id: "a",
    slug: "s",
    stage: "rigged",
    clips: ["idle"],
    clipDurations: { idle: 1000 },
    rig: { hasArmature: true },
    importMeta: { warnings: [{ code: "IDLE_TPOSE_SUSPECT", clip: "idle" }] },
  });
  assert.deepEqual(Object.keys(d), ["clips", "rig", "clipDurations", "warnings"]);
  assert.deepEqual(d.clips, ["idle"]);
  assert.deepEqual(d.clipDurations, { idle: 1000 });
  assert.deepEqual(d.warnings, [{ code: "IDLE_TPOSE_SUSPECT", clip: "idle" }]);
  assert.equal(E.probeDump(null), null);
  assert.equal(E.PROBE_DUMP_MAX_BYTES, 20 * 1024);
  const small = E.capJson(d);
  assert.equal(small.truncated, false);
  const big = E.capJson({ blob: "é".repeat(30000) });
  assert.equal(big.truncated, true);
  assert.match(big.text, /\(truncated\)$/);
  assert.ok(Buffer.byteLength(big.text.replace(/\n… \(truncated\)$/, "")) <= 20 * 1024);
  const copy = JSON.parse(E.errorDetailsJson("a", { status: 404, code: "FILE_MISSING", url: "http://h:1/u", message: "m", name: "HttpError" }, d));
  assert.deepEqual(Object.keys(copy), ["assetId", "url", "status", "code", "probe"]);
  assert.equal(copy.url, "/u");
});

test("#89 preflightGlb: 404 {code} → card info; non-GLB → GLB_CORRUPT; glTF header → ok", async () => {
  const resp = (status, body, type = "application/json") => new Response(body, { status, headers: { "content-type": type } });
  const miss = await E.preflightGlb("/f", async () => resp(404, JSON.stringify({ code: "FILE_MISSING", error: "file missing: assets/x/model.glb" })));
  assert.equal(miss.ok, false);
  assert.equal(miss.info.status, 404);
  assert.equal(miss.info.code, "FILE_MISSING");
  const junk = await E.preflightGlb("/f", async () => resp(200, new Uint8Array(64).fill(7), "model/gltf-binary"));
  assert.equal(junk.ok, false);
  assert.equal(junk.info.code, "GLB_CORRUPT");
  const short = await E.preflightGlb("/f", async () => resp(200, new Uint8Array(0), "model/gltf-binary"));
  assert.equal(short.ok, false);
  const head = new Uint8Array(12);
  head.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
  const good = await E.preflightGlb("/f", async (_u, init) => {
    assert.equal(init.headers.Range, "bytes=0-11");
    return resp(206, head, "model/gltf-binary");
  });
  assert.deepEqual(good, { ok: true });
  const net = await E.preflightGlb("/f", async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(net.ok, false);
  assert.equal(net.info.name, "TypeError");
});

test("#89 static wiring: app + viewer boundaries, card hooks, Retry / Copy details / Back to list", () => {
  const main = fs.readFileSync(path.join(SRC, "main.tsx"), "utf8");
  assert.match(main, /<ErrorBoundary scope="app">\s*<App \/>\s*<\/ErrorBoundary>/);
  const app = fs.readFileSync(path.join(SRC, "App.tsx"), "utf8");
  const vb = app.indexOf('scope="viewer"');
  const canvas = app.indexOf("<Canvas", vb);
  const close = app.indexOf("</ErrorBoundary>", canvas);
  assert.ok(vb > 0 && canvas > vb && close > canvas, "viewer boundary must wrap the Canvas");
  assert.ok(app.indexOf('<aside className="sidebar">') < vb, "sidebar stays outside the viewer boundary");
  assert.match(app, /preflightGlb\(/);
  const card = fs.readFileSync(path.join(SRC, "ErrorBoundary.tsx"), "utf8");
  for (const hook of ["error-card", "error-card-retry", "error-card-copy", "error-card-back", "error-card-probe"]) {
    assert.match(card, new RegExp(`data-testid="${hook}"`));
  }
  assert.match(card, />\s*Retry\s*</);
  assert.match(card, />\s*Copy details\s*</);
  assert.match(card, />\s*Back to list\s*</);
  const order = ["error-card-retry", "error-card-back", "error-card-copy"].map((h) => card.indexOf(`data-testid="${h}"`));
  assert.deepEqual([...order].sort((x, y) => x - y), order, "D1 rev2 button order: Retry, Back to list, Copy details");
  assert.match(card, /Probe summary/);
  assert.match(card, /Couldn't load/);
  assert.match(card, /Something went wrong/);
});

test("#89 browser: orphan GLB → card in viewer, sidebar usable, Retry/Copy/Back, no pageerror", async (t) => {
  const UI = process.env.UI_URL;
  if (!UI) return t.skip("SKIP_NO_UI_URL: set UI_URL (vite) + WORLD_API for the browser check");
  let chromium;
  try {
    ({ chromium } = createRequire(path.join(process.env.PLAYWRIGHT_CORE_DIR || ROOT, "/"))("playwright-core"));
  } catch {
    return t.skip("SKIP_ENV_PLAYWRIGHT: playwright-core not resolvable (set PLAYWRIGHT_CORE_DIR)");
  }
  const exe = process.env.CHROME_BIN || "/usr/bin/google-chrome";
  if (!fs.existsSync(exe)) return t.skip(`SKIP_ENV_CHROME: Chrome not found at ${exe}`);
  const API = process.env.WORLD_API || "http://127.0.0.1:8787";
  const id = `5d3d0002-0000-4000-8000-${String(process.pid).padStart(12, "0")}`;
  const slug = `s3d-orphan-${process.pid}`;
  const r = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(billboardBody(id, slug)),
  });
  if (r.status !== 201) return t.skip(`SKIP_NO_API: could not register orphan on ${API} (${r.status})`);
  const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.locator("ul.asset-list").getByRole("button", { name: new RegExp(slug) }).click();
      const card = p.locator(".viewer [data-testid=error-card]");
      await card.waitFor({ timeout: 10000 });
      const line = await p.getByTestId("error-card-status").textContent();
      assert.match(line, new RegExp(`^/api/assets/${id}/file · HTTP 404 · FILE_MISSING$`));
      assert.ok(await p.locator(".sidebar").isVisible(), "sidebar visible");
      assert.ok((await p.locator("body").innerText()).trim().length > 0, "body non-empty");
      await p.locator(".error-card-probe summary").click();
      assert.match(await p.getByTestId("error-card-probe").textContent(), /"clips": \[\]/);
      await p.getByTestId("error-card-retry").click();
      await card.waitFor({ timeout: 10000 });
      await p.getByTestId("error-card-back").click();
      assert.equal(await card.count(), 0);
      await p.getByLabel("Search assets").fill(slug);
      assert.ok(await p.locator("ul.asset-list").getByRole("button", { name: new RegExp(slug) }).isVisible(), "search still works");
      assert.deepEqual(errs, [], `${w}x${h} pageerror`);
      await p.close();
    }
  } finally {
    await b.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
  }
});
