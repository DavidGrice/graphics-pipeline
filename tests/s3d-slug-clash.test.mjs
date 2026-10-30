/**
 * S3-D E2 #127 — SLUG_CLASH 409 + inline "Use <suggestedSlug>" (R1 rev2 §6, D1 §2).
 * API checks run against a hermetic API (own port + data root). The browser check needs UI_URL
 * and registers/DELETEs its own fixtures on WORLD_API.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
const post = (body) =>
  fetch(`${api.url}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

before(async () => {
  api = await startApi();
  P = await loadClientTs("apps/world-builder/client/src/s3dPrefs.ts");
});
after(async () => api && (await api.stop()));

test("#127 different id + taken slug → 409 SLUG_CLASH {slug, existingId, suggestedSlug} flat body", async () => {
  const a = runId("1a");
  const b = runId("1b");
  assert.equal((await post(billboardBody(a, "hero"))).status, 201);
  const r = await post(billboardBody(b, "hero"));
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ["code", "error", "existingId", "slug", "suggestedSlug"]);
  assert.equal(j.code, "SLUG_CLASH");
  assert.equal(j.slug, "hero");
  assert.equal(j.existingId, a);
  assert.equal(j.suggestedSlug, "hero-2");
  assert.ok(!ABS.test(JSON.stringify(j)), "no absolute path in body");
  assert.equal((await fetch(`${api.url}/api/assets/${b}`)).status, 404, "nothing stored on clash");
});

test("#127 suggestedSlug is the first FREE -N (skips taken -2, keeps kebab-valid)", async () => {
  const ids = [runId("2a"), runId("2b"), runId("2c"), runId("2d")];
  assert.equal((await post(billboardBody(ids[0], "npc"))).status, 201);
  assert.equal((await post(billboardBody(ids[1], "npc-2"))).status, 201);
  assert.equal((await post(billboardBody(ids[2], "npc-4"))).status, 201);
  const j = await (await post(billboardBody(ids[3], "npc"))).json();
  assert.equal(j.suggestedSlug, "npc-3");
  assert.match(j.suggestedSlug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  // the suggestion is accepted as-is
  assert.equal((await post(billboardBody(ids[3], j.suggestedSlug))).status, 201);
});

test("#127 same id + same slug re-register stays an idempotent upsert (rule unchanged)", async () => {
  const id = runId("3a");
  assert.equal((await post(billboardBody(id, "same-slug"))).status, 201);
  const again = await post({ ...billboardBody(id, "same-slug"), name: "renamed" });
  assert.equal(again.status, 201);
  assert.equal((await (await fetch(`${api.url}/api/assets/${id}`)).json()).name, "renamed");
  // the owner can also move to a free slug
  assert.equal((await post(billboardBody(id, "same-slug-moved"))).status, 201);
});

test("#127 register_asset CLI: clean one-line SLUG_CLASH, exit 1, no orphan GLB dir", () => {
  const glb = path.join(api.dataRoot, "in.glb");
  fs.writeFileSync(glb, makeRiggedGlb());
  const run = (slug) =>
    spawnSync(
      process.execPath,
      [path.join(ROOT, "apps/blender-pipeline/register_asset.mjs"), "--slug", slug, "--glb", glb, "--api", api.url],
      { env: { ...process.env, WB_DATA_ROOT: api.dataRoot }, encoding: "utf8" },
    );
  const first = run("cli-dup");
  assert.equal(first.status, 0, first.stderr);
  const before = fs.readdirSync(path.join(api.dataRoot, "assets")).length;
  const second = run("cli-dup");
  assert.equal(second.status, 1);
  const line = second.stderr.trim();
  assert.match(line, /^ERROR SLUG_CLASH: slug "cli-dup" is already used by [0-9a-f-]{36}; retry with --slug cli-dup-2$/);
  assert.ok(!/\n/.test(line) && !/at .*\.m?js:\d+/.test(line), "no stack");
  assert.equal(fs.readdirSync(path.join(api.dataRoot, "assets")).length, before, "failed register leaves no dir");
});

test("#127 helpers: parseSlugClash + applySuggestedSlug keep every other value", () => {
  const body = JSON.stringify({ code: "SLUG_CLASH", error: "x", slug: "a", existingId: "i", suggestedSlug: "a-2" });
  assert.deepEqual(P.parseSlugClash(409, body), { slug: "a", existingId: "i", suggestedSlug: "a-2" });
  assert.equal(P.parseSlugClash(400, body), null);
  assert.equal(P.parseSlugClash(409, '{"code":"ASSET_IN_USE"}'), null);
  assert.equal(P.parseSlugClash(409, "nope"), null);
  const reg = { id: "i2", slug: "a", name: "Keep me", tags: ["t"], formats: { glb: "assets/i2/model.glb" } };
  assert.deepEqual(JSON.parse(P.applySuggestedSlug(JSON.stringify(reg), "a-2")), { ...reg, slug: "a-2" });
  assert.equal(P.applySuggestedSlug('{"slug": "a", broken', "a-2"), '{"slug": "a-2", broken');
  assert.equal(P.ambiguousSlugOf('ambiguous slug "npc" matches 2 assets (V4a)'), "npc");
  assert.equal(P.ambiguousSlugOf("unknown assetId"), null);
});

test("#127 static wiring: inline banner + slug-clash-suggest fills without submitting", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  const i = app.indexOf('data-testid="slug-clash-suggest"');
  assert.ok(i > 0, "suggest button hook present");
  const handler = app.slice(i, app.indexOf("</button>", i));
  assert.match(handler, /applySuggestedSlug/);
  assert.ok(!/submitRegister/.test(handler), "button must not submit");
  assert.match(app, /is already used by/);
});

test("#127 browser: clash banner, Use <suggested> fills the JSON, then register succeeds", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const a = runId("7a");
  const b = runId("7b");
  const slug = `s3d-clash-${process.pid}`;
  const r = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(billboardBody(a, slug)),
  });
  if (r.status !== 201) return t.skip(`SKIP_NO_API: could not register on ${API} (${r.status})`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(UI, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Register asset" }).click();
    const reg = { ...billboardBody(b, slug), name: "keep-this-name" };
    await p.getByLabel("Asset JSON").fill(JSON.stringify(reg));
    await p.getByRole("button", { name: "POST /api/assets" }).click();
    const banner = p.getByTestId("slug-clash");
    await banner.waitFor({ timeout: 10000 });
    assert.match(await banner.textContent(), new RegExp(`${slug} is already used by ${a}`));
    const sug = p.getByTestId("slug-clash-suggest");
    assert.equal((await sug.textContent()).trim(), `Use ${slug}-2`);
    await sug.click();
    const after = JSON.parse(await p.getByLabel("Asset JSON").inputValue());
    assert.equal(after.slug, `${slug}-2`);
    assert.equal(after.name, "keep-this-name", "form keeps its values");
    assert.equal((await fetch(`${API}/api/assets/${b}`)).status, 404, "suggest does not submit");
    await p.getByRole("button", { name: "POST /api/assets" }).click();
    await p.getByRole("button", { name: /keep-this-name/ }).first().waitFor({ timeout: 10000 });
    assert.equal((await fetch(`${API}/api/assets/${b}`)).status, 200);
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${b}`, { method: "DELETE" });
    await fetch(`${API}/api/assets/${a}`, { method: "DELETE" });
  }
});
