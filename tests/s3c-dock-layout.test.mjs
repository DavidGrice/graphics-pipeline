/**
 * S3-C tip3 #82 — bottom dock layout (Designer /workspace/s3c-82-dock-layout.md).
 * Static guards always run. Browser check runs only when UI_URL (vite) is set and
 * playwright-core + Chrome are resolvable; otherwise skips with an explicit reason.
 *   UI_URL=http://localhost:5173 PLAYWRIGHT_CORE_DIR=/tmp/pw node --test tests/s3c-dock-layout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/styles.css"), "utf8");
const APP = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");

/** All declaration blocks whose selector list mentions `sel` (exact class token). */
function blocks(sel) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const out = [];
  for (const m of CSS.matchAll(re)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.some((s) => new RegExp(`(^|[\\s>])${sel.replace(".", "\\.")}($|[\\s:.>])`).test(s))) out.push(m[2]);
  }
  return out;
}

test("tip3 #82 static: dock rows never absolutely positioned; dock is a flex column ≤45vh", () => {
  for (const sel of [".clip-bar", ".clip-author", ".clip-bar-s3c", ".dock-row", ".viewer-dock"]) {
    for (const b of blocks(sel)) {
      if (sel === ".viewer-dock" && /position:\s*relative/.test(b)) continue;
      assert.doesNotMatch(b, /position:\s*(absolute|fixed)/, `${sel} must stay in flow`);
      assert.doesNotMatch(b, /(^|\s)(top|bottom):\s*-?\d/, `${sel} must not use fixed top/bottom offsets`);
    }
  }
  const dock = blocks(".viewer-dock").join("\n");
  assert.match(dock, /flex-direction:\s*column/);
  assert.match(dock, /max-height:\s*45vh/);
  assert.match(dock, /overflow-y:\s*auto/);
  assert.match(blocks(".dock-row").join("\n"), /flex-wrap:\s*wrap/);
  assert.match(blocks(".overlay-toggle").join("\n"), /min-height:\s*24px/);
});

test("tip3 #82 static: dock markup order Author → Blend/Speed → View(Overlay|Scene view) → Transport; header 3-C", () => {
  const dockAt = APP.indexOf('className="viewer-dock"');
  assert.ok(dockAt > 0);
  const at = (needle) => {
    const i = APP.indexOf(needle, dockAt);
    assert.ok(i > dockAt, `missing in dock: ${needle}`);
    return i;
  };
  const order = [
    at('className="clip-author"'),
    at('className="dock-row dock-row-clipux"'),
    at('className="dock-row dock-row-view"'),
    at('aria-label="Overlay (session)"'),
    at('aria-label="Scene view"'),
    at('<div className="clip-bar">'),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const ov = APP.slice(order[3], order[4]);
  assert.match(ov, />\s*Wireframe\s*</);
  assert.match(ov, />\s*Bones\s*</);
  const sv = APP.slice(order[4], order[5]);
  assert.match(sv, />\s*Ground\s*</);
  assert.match(sv, />\s*Shadows\s*</);
  assert.match(APP, /localhost · Sprint 3-C/);
  assert.doesNotMatch(APP, /Sprint 3-B</);
});

test("tip3 #82 browser: Wireframe/Bones topmost + clickable at 1280x800 and 1920x1080; rows don't intersect", async (t) => {
  const UI = process.env.UI_URL;
  if (!UI) {
    t.skip("UI_URL unset — browser layout check skipped (set UI_URL=http://localhost:5173 with vite + API up)");
    return;
  }
  let chromium;
  try {
    const req = createRequire(path.join(process.env.PLAYWRIGHT_CORE_DIR || ROOT, "/"));
    ({ chromium } = req("playwright-core"));
  } catch {
    t.skip("playwright-core not resolvable — set PLAYWRIGHT_CORE_DIR (dir containing node_modules/playwright-core)");
    return;
  }
  const exe = process.env.CHROME_BIN || "/usr/bin/google-chrome";
  if (!fs.existsSync(exe)) {
    t.skip(`Chrome not found at ${exe} — set CHROME_BIN`);
    return;
  }
  const API = process.env.WORLD_API || "http://127.0.0.1:8787";
  const list = await (await fetch(`${API}/api/assets`)).json();
  const rig = list.find((a) => a.stage === "rigged" && (a.clips || []).length > 1);
  if (!rig) {
    t.skip(`no rigged asset with clips on ${API}`);
    return;
  }
  const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByText(rig.name || rig.slug).first().click();
      await p.waitForTimeout(1500);
      for (const l of ["Wireframe", "Bones"]) {
        const inp = p.getByLabel(l, { exact: true });
        const hit = await inp.evaluate((el) => {
          const lab = el.closest("label");
          const r = lab.getBoundingClientRect();
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return t === el || t === lab;
        });
        assert.ok(hit, `${w}x${h} ${l}: elementFromPoint is not the control`);
        const before = await inp.isChecked();
        await inp.click({ timeout: 4000 });
        assert.equal(await inp.isChecked(), !before, `${w}x${h} ${l}: click did not toggle`);
      }
      const ok = await p.evaluate(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect();
        const rows = [".clip-author", ".dock-row-clipux", ".dock-row-view", ".viewer-dock > .clip-bar:not(.clip-bar-s3c)"].map(r);
        const x = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
        for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[i] && rows[j] && x(rows[i], rows[j])) return false;
        const a = r(".clip-author"), s = r(".clip-bar-s3c");
        return !(a && s && x(a, s));
      });
      assert.ok(ok, `${w}x${h}: dock rows intersect`);
      await p.close();
    }
  } finally {
    await b.close();
  }
});
