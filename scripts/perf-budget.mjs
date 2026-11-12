#!/usr/bin/env node
/**
 * S3-I #105 — perf budgets (perf-budgets.json). Two kinds:
 *  - fixtureGlbBytes: byte size of each synthetic fixture GLB the suites load (no stack needed).
 *  - frame256Ms: median frame time of a 256-node in-view scene in the viewer under SwiftShader
 *    (CHROME_ARGS) — a SwiftShader number on the Linux runner/box, not a native GPU budget.
 * Every over-budget line prints the budget, the actual and the run's HEAD= line; exit 1 if any.
 * Frame check needs UI_URL + WORLD_API + WB_DATA_ROOT; without them it prints SKIP_NO_UI_URL
 * (exit 0) unless PERF_REQUIRE_UI=1 (CI), which makes a missing stack a failure.
 * Usage: node scripts/perf-budget.mjs [--budgets path]
 */
import fs from "node:fs";
import path from "node:path";
import { formatRunHeader } from "../tests/reporters/skip-summary.mjs";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, makeRiggedGlb, runId } from "../tests/helpers/s3d-synth.mjs";

export const FIXTURES = { "rigged-synth": () => makeRiggedGlb() };

export function loadBudgets(p = path.join(ROOT, "perf-budgets.json")) {
  const b = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!b.fixtureGlbBytes || typeof b.fixtureGlbBytes !== "object") throw new Error("perf-budgets: fixtureGlbBytes required");
  if (!b.frame256Ms || !(b.frame256Ms.budget > 0)) throw new Error("perf-budgets: frame256Ms.budget required");
  return b;
}

/** One result line; `over` lines carry the HEAD= header so a CI log alone names the commit. */
export function line(name, budget, actual, unit) {
  const over = actual > budget;
  return { over, text: `PERF ${over ? "OVER" : "OK"} ${name} budget=${budget}${unit} actual=${actual}${unit}${over ? ` ${formatRunHeader()}` : ""}` };
}

export function checkGlbBytes(budgets) {
  return Object.entries(budgets.fixtureGlbBytes).map(([name, budget]) => {
    const make = FIXTURES[name];
    if (!make) return { over: true, text: `PERF OVER ${name} unknown fixture (known: ${Object.keys(FIXTURES).join(", ")}) ${formatRunHeader()}` };
    return line(`glb:${name}`, budget, make().length, "B");
  });
}

const json = { "Content-Type": "application/json" };
const post = (API, b) => fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const del = (API, id) => fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});

/** Median rAF delta (ms) over `frames` after `warmup`, with all 256 nodes loaded and in view. */
export async function measureFrame256({ frames = 120, warmup = 30 } = {}) {
  const env = browserEnv();
  if (env.skip) return { skip: env.skip };
  const { chromium, exe, UI, API } = env;
  const dataRoot = process.env.WB_DATA_ROOT;
  if (!dataRoot) return { skip: "SKIP_NO_UI_URL: WB_DATA_ROOT unset (the API's data root, for the fixture GLB)" };
  const c = runId("perf105-c");
  const sid = runId("perf105-scene");
  const slugs = { c: `perf105-c-${process.pid}`, scene: `perf105-scene-${process.pid}` };
  const dir = path.join(dataRoot, "assets", c);
  const cleanup = async () => {
    for (const id of [sid, c]) await del(API, id);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  let r = await post(API, billboardBody(c, slugs.c));
  if (r.status !== 201) return { skip: `SKIP_NO_API: could not register the fixture on ${API} (${r.status})` };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.glb"), makeRiggedGlb());
  const tf = (i) => ({ position: [(i % 16) * 0.05 - 0.375, Math.floor(i / 16) * 0.05, 0], rotation: [0, 0, 0], scale: [0.04, 0.04, 0.04] });
  const nodes = Array.from({ length: 256 }, (_, i) => ({ id: `n${i}`, assetId: c, transform: tf(i) }));
  r = await post(API, { ...billboardBody(sid, slugs.scene), characterType: "unknown", stage: "scene", scene: { version: 1, rootId: "n0", nodes } });
  if (r.status !== 201) {
    await cleanup();
    throw new Error(`could not register the 256-node scene: ${r.status} ${await r.text()}`);
  }
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(UI, { waitUntil: "load", timeout: 60000 });
    await p.getByRole("button", { name: new RegExp(slugs.scene) }).first().click({ timeout: 30000 });
    await p.getByRole("button", { name: "Stats" }).click();
    try {
      await p.waitForFunction(() => document.querySelector('[data-testid="stats-loaded"]')?.textContent === "Loaded 256 / 256", null, { timeout: 90000 });
    } catch (e) {
      const seen = await p
        .evaluate(() => ({
          loaded: document.querySelector('[data-testid="stats-loaded"]')?.textContent ?? "(no stats-loaded)",
          placeholders: document.querySelectorAll('[data-testid="lazy-placeholder"]').length,
          errors: [...document.querySelectorAll(".error, [role=alert]")].map((n) => n.textContent).slice(0, 3),
        }))
        .catch(() => ({}));
      throw new Error(`frame256: scene never reached "Loaded 256 / 256": ${JSON.stringify(seen)} (${e.message.split("\n")[0]})`);
    }
    const deltas = await p.evaluate(
      ({ frames, warmup }) =>
        new Promise((done) => {
          const out = [];
          let last = 0;
          let n = 0;
          const tick = (t) => {
            if (last && n > warmup) out.push(t - last);
            last = t;
            if (++n <= frames + warmup) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        }),
      { frames, warmup },
    );
    deltas.sort((a, b) => a - b);
    return { ms: Math.round(deltas[deltas.length >> 1] * 10) / 10, frames: deltas.length };
  } finally {
    await br.close();
    await cleanup();
  }
}

async function main() {
  const i = process.argv.indexOf("--budgets");
  const budgets = loadBudgets(i > 0 ? path.resolve(process.argv[i + 1]) : undefined);
  console.log(formatRunHeader());
  const results = checkGlbBytes(budgets);
  const f = await measureFrame256(budgets.frame256Ms);
  if (f.skip) {
    if (process.env.PERF_REQUIRE_UI === "1") results.push({ over: true, text: `PERF OVER frame256 no measurement (${f.skip}) ${formatRunHeader()}` });
    else console.log(`${f.skip.split(":")[0]}: frame256 not measured — ${f.skip}`);
  } else {
    results.push(line(`frame256:${budgets.frame256Ms.renderer || "swiftshader"}`, budgets.frame256Ms.budget, f.ms, "ms"));
  }
  for (const r of results) console.log(r.text);
  const over = results.filter((r) => r.over).length;
  console.log(over ? `FAIL perf budgets: ${over} over` : "OK perf budgets");
  process.exit(over ? 1 : 0);
}

if (path.resolve(process.argv[1] || "") === path.resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error(`FAIL perf budgets: ${e.message} ${formatRunHeader()}`);
    process.exit(1);
  });
}
