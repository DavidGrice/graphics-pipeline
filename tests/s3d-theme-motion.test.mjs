/**
 * S3-D E2 #86 theme (dark/light, session override, AA contrast) and #90 reduced motion
 * (session override, crossfade 0, no autoplay, instant bookmarks) — R1 rev2 §7–8, D1 §3–4.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, billboardBody, loadClientTs, browserEnv, CHROME_ARGS, runId } from "./helpers/s3d-synth.mjs";

const SRC = path.join(ROOT, "apps/world-builder/client/src");
const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(SRC, "App.tsx"), "utf8");
let P;
before(async () => {
  P = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
});

function themeBlock(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, `${selector} block present`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
const DARK = ':root,\n:root[data-theme="dark"]';
const LIGHT = ':root[data-theme="light"]';

/** Text-on-surface pairs that occur in the chrome (dock labels, sidebar, badges, error card). */
const TEXT_PAIRS = [
  ["text", "bg"], ["text", "input-bg"], ["text", "header-bg"], ["text", "panel-bg"], ["text", "dock-row-bg"],
  ["text", "active-bg"], ["text", "primary-bg"], ["text", "hover-bg"], ["text", "node-active-bg"],
  ["text-muted", "bg"], ["text-muted", "header-bg"], ["text-muted", "panel-bg"], ["text-muted", "dock-row-bg"],
  ["text-muted", "input-bg"], ["text-muted", "chip-bg"], ["text-muted", "hover-bg"], ["text-muted", "active-bg"],
  ["err", "bg"], ["err", "panel-bg"], ["err", "header-bg"], ["err", "dock-row-bg"], ["err", "card-bg"], ["err", "chip-bg"],
  ["chip-text", "chip-bg"], ["chip-text", "tiny-primary-bg"], ["badge-text", "chip-bg"], ["accent-text", "chip-bg"],
  ["mode-text", "chip-bg"], ["on-text", "on-bg"], ["clip-active-text", "clip-active-bg"], ["import-text", "chip-bg"],
  ["mixamo-text", "chip-bg"], ["fbx-text", "chip-bg"], ["other-text", "chip-bg"], ["ctype-accent-text", "chip-bg"],
  ["ctype-neutral-text", "chip-bg"], ["ctype-muted-text", "chip-bg"], ["hotkey-text", "chip-bg"],
  ["hotkey-text", "clip-active-bg"], ["card-text", "card-bg"], ["card-text", "card-pre-bg"],
];

test("#86 CSS: every chrome colour is a var; hex literals only inside the two theme blocks", () => {
  const end = css.indexOf("}", css.indexOf(LIGHT)) + 1;
  const rest = css.slice(end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [], [], "no literal colours outside theme tokens");
  assert.ok(!/opacity:\s*0\.(6|65|7|8)\b/.test(rest), "no opacity-dimmed text (fails AA)");
  const d = themeBlock(DARK);
  const l = themeBlock(LIGHT);
  assert.deepEqual(Object.keys(d).sort(), Object.keys(l).sort(), "both themes define the same tokens");
  for (const v of new Set([...rest.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]))) {
    assert.ok(v in d, `--${v} defined`);
  }
});

test("#86 AA: all chrome text pairs ≥ 4.5:1 in dark AND light", () => {
  for (const [name, sel] of [["dark", DARK], ["light", LIGHT]]) {
    const v = themeBlock(sel);
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = P.contrastRatio(v[fg], v[bg]);
      assert.ok(r >= 4.5, `${name}: --${fg} on --${bg} = ${r.toFixed(2)} < 4.5`);
    }
  }
});

test("#86 canvas: clear #1a1a1f / #e9e9ee; grid + ground ≥ 3:1 vs clear", () => {
  assert.equal(P.CANVAS_THEME.dark.clear, "#1a1a1f");
  assert.equal(P.CANVAS_THEME.light.clear, "#e9e9ee");
  for (const t of ["dark", "light"]) {
    const c = P.CANVAS_THEME[t];
    for (const k of ["gridSection", "gridCell", "ground"]) {
      const r = P.contrastRatio(c[k], c.clear);
      assert.ok(r >= 3, `${t} ${k} ${r.toFixed(2)} < 3`);
    }
  }
  assert.ok(Math.abs(P.contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.match(app, /<color attach="background" args=\{\[canvasTheme\.clear\]\} \/>/);
  assert.match(app, /sectionColor=\{canvasTheme\.gridSection\}/);
  assert.match(app, /<meshStandardMaterial color=\{canvasTheme\.ground\} \/>/, "ground opaque (no 0.5 alpha wash)");
});

test("#86/#90 resolve: system follows media; overrides win", () => {
  assert.equal(P.resolveTheme("system", true), "dark");
  assert.equal(P.resolveTheme("system", false), "light");
  assert.equal(P.resolveTheme("light", true), "light");
  assert.equal(P.resolveTheme("dark", false), "dark");
  assert.equal(P.resolveReducedMotion("system", true), true);
  assert.equal(P.resolveReducedMotion("system", false), false);
  assert.equal(P.resolveReducedMotion("on", true), false, "session can re-enable motion");
  assert.equal(P.resolveReducedMotion("reduced", false), true);
  assert.deepEqual(P.THEME_PREFS, ["system", "light", "dark"]);
  assert.deepEqual(P.MOTION_PREFS, ["system", "on", "reduced"]);
});

test("#90 reduced: crossfade 0 (stored value untouched), no autoplay", () => {
  assert.equal(P.effectiveBlendMs(350, true), 0);
  assert.equal(P.effectiveBlendMs(350, false), 350);
  assert.equal(P.shouldAutoplay(true, true), false);
  assert.equal(P.shouldAutoplay(true, false), true);
  assert.equal(P.shouldAutoplay(false, false), false);
  assert.match(app, /blendMs=\{effectiveBlendMs\(blendMs, reducedMotion\)\}/);
  assert.match(app, /setPlaying\(shouldAutoplay\(next\.length > 0, reducedMotion\)\)/);
  assert.match(app, /enableDamping=\{!reducedMotion\}/);
  assert.match(app, /clipName=\{reducedMotion \? undefined : clipForNode\}/, "scene children don't autoplay");
  // the blend input still shows/edits the stored value
  assert.match(app, /value=\{blendMs\}\s+disabled=\{!canPlay \|\| !blendControlEnabled/);
  // bookmark jump has no tween
  const j = app.indexOf("const jumpToCamera");
  const body = app.slice(j, app.indexOf("};", j));
  assert.ok(!/requestAnimationFrame|lerp|tween|setInterval/.test(body));
});

test("#86/#90 wiring: data-theme on <html>; Theme + Motion selects inside Overlay (session)", () => {
  assert.match(app, /document\.documentElement\.dataset\.theme = theme/);
  const g = app.indexOf('aria-label="Overlay (session)"');
  const end = app.indexOf('aria-label="Scene view"', g);
  const group = app.slice(g, end);
  const th = group.indexOf('data-testid="theme-select"');
  const mo = group.indexOf('data-testid="motion-select"');
  assert.ok(th > 0 && mo > th, "Theme then Motion, both in the Overlay (session) group");
  assert.ok(!/localStorage/.test(app.slice(app.indexOf("themePref"), app.indexOf("themePref") + 400)), "session only");
});

test("#86/#90 browser: media → data-theme/motion; overrides; computed dock label contrast ≥ 4.5", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("tm1");
  const slug = `s3d-theme-${process.pid}`;
  const r = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(billboardBody(id, slug)) });
  if (r.status !== 201) return t.skip(`SKIP_NO_API: could not register on ${API} (${r.status})`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  const rgbToHex = (s) => "#" + s.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  try {
    for (const scheme of ["light", "dark"]) {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.locator("ul.asset-list").getByRole("button", { name: new RegExp(slug) }).click();
      const html = p.locator("html");
      assert.equal(await html.getAttribute("data-theme"), scheme, "follows prefers-color-scheme");
      assert.equal(await html.getAttribute("data-motion"), "reduced", "follows prefers-reduced-motion");
      const other = scheme === "light" ? "dark" : "light";
      await p.getByTestId("theme-select").selectOption(other);
      assert.equal(await html.getAttribute("data-theme"), other, "session override wins");
      await p.getByTestId("motion-select").selectOption("on");
      assert.equal(await html.getAttribute("data-motion"), "on");
      for (const th of ["light", "dark"]) {
        await p.getByTestId("theme-select").selectOption(th);
        const pairs = await p.evaluate(() => {
          const bgOf = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = getComputedStyle(e).backgroundColor;
              if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const sel = [".dock-group-title", ".viewer-dock label", ".sidebar .muted", ".sidebar h1", ".badge", ".recent-imports summary"];
          return sel.flatMap((s) => [...document.querySelectorAll(s)].slice(0, 4).map((el) => ({ s, fg: getComputedStyle(el).color, bg: bgOf(el) })));
        });
        assert.ok(pairs.length >= 6);
        const P2 = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
        for (const { s, fg, bg } of pairs) {
          if (/rgba\(.*,\s*0(\.\d+)?\)$/.test(fg)) continue;
          const ratio = P2.contrastRatio(rgbToHex(fg), rgbToHex(bg));
          assert.ok(ratio >= 4.5, `${th} ${s}: ${fg} on ${bg} = ${ratio.toFixed(2)}`);
        }
      }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
  }
});

test("#90 browser: reduce → default clip is NOT autoplayed; no-preference → it plays", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, API } = env;
  const { makeRiggedGlb } = await import("./helpers/s3d-synth.mjs");
  const id = runId("tm2");
  const slug = `s3d-motion-${process.pid}`;
  const dir = path.join(ROOT, "data/assets", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.glb"), makeRiggedGlb());
  const body = {
    ...billboardBody(id, slug),
    characterType: "prop",
    stage: "rigged",
    clips: ["idle", "walk", "run"],
    rig: { hasArmature: true, hasWeights: true, boneCount: 2 },
  };
  const r = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const served = r.status === 201 && (await fetch(`${API}/api/assets/${id}/file`)).status === 200;
  if (!served) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status === 201) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
    return t.skip(`SKIP_NO_API: ${API} did not register/serve a GLB from this checkout's data dir (${r.status})`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    for (const [reducedMotion, want] of [["reduce", "▶ Play"], ["no-preference", "Pause"]]) {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
      const p = await ctx.newPage();
      await p.goto(env.UI, { waitUntil: "networkidle" });
      await p.locator("ul.asset-list").getByRole("button", { name: new RegExp(slug) }).click();
      await p.locator(".clip.active").first().waitFor({ timeout: 15000 });
      const btn = p.getByRole("button", { name: /^(Pause|▶ Play)$/ });
      await p.waitForFunction(
        (w) => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === w),
        want,
        { timeout: 10000 },
      );
      assert.equal((await btn.textContent()).trim(), want, reducedMotion);
      await ctx.close();
    }
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
