/**
 * S3-I #34 UI — New scene → Duo billboard: Create stays disabled until both slots are picked from
 * the user's own assets; Cancel leaves no scene; Create POSTs one stage=scene asset with those
 * children and selects it. R1 §9, D1 §7. Needs UI_URL + WORLD_API (skips SKIP_NO_UI_URL otherwise);
 * registers + DELETEs its own fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserEnv, CHROME_ARGS, billboardBody, runId } from "./helpers/s3d-synth.mjs";

const json = { "Content-Type": "application/json" };
const reg = async (API, b) => {
  try {
    return (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) })).status;
  } catch {
    return 0;
  }
};
const del = (API, id) => fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});

test("#34 browser: template slots gate Create, Cancel leaves no scene, Create makes the Duo scene", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const pid = process.pid;
  const a = runId("s3i-ui34-a");
  const b = runId("s3i-ui34-b");
  const names = { a: `s3iui34-a-${pid}`, b: `s3iui34-b-${pid}`, scene: `s3iui34 scene ${pid}` };
  if ((await reg(API, billboardBody(a, names.a))) !== 201) return t.skip(`SKIP_NO_API: could not register fixtures on ${API}`);
  await reg(API, billboardBody(b, names.b));
  const mine = async () => (await (await fetch(`${API}/api/assets`)).json()).filter((x) => x.stage === "scene" && x.name === names.scene);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  let made = [];
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const posts = [];
    p.on("request", (r) => r.method() === "POST" && r.url().endsWith("/api/assets") && posts.push(r.url()));
    await p.goto(UI, { waitUntil: "networkidle" });
    const create = p.getByTestId("template-create");
    const pick = (slot) => p.locator(`[data-testid="template-slot-pick"][data-slot="${slot}"]`);

    // Cancel path: pick a template and one slot, cancel → dialog gone, nothing POSTed
    await p.getByTestId("new-scene").click();
    assert.deepEqual(await p.getByTestId("template-option").allTextContents(), ["Blank", "Duo billboard", "Rigged + prop"]);
    await p.locator('[data-testid="template-option"][data-template-id="duo-billboard"]').click();
    assert.equal(await p.getByTestId("template-slot-pick").count(), 2);
    assert.ok(await create.isDisabled(), "Create disabled with no picks");
    await pick("left").selectOption(a);
    assert.ok(await create.isDisabled(), "Create disabled with one slot empty");
    await p.getByTestId("template-cancel").click();
    assert.equal(await p.getByTestId("new-scene-dialog").count(), 0);
    assert.deepEqual(posts, [], "cancel POSTs nothing");

    // Create path: reopening starts clean; both slots picked → one POST, scene selected
    await p.getByTestId("new-scene").click();
    await p.locator('[data-testid="template-option"][data-template-id="duo-billboard"]').click();
    assert.equal(await pick("left").inputValue(), "", "picks reset after cancel");
    await pick("left").selectOption(a);
    await pick("right").selectOption(b);
    await p.getByTestId("template-name").fill(names.scene);
    assert.ok(!(await create.isDisabled()));
    const resp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/assets"), { timeout: 20000 });
    await create.click();
    const rr = await resp;
    assert.equal(rr.status(), 201, await rr.text());
    await p.getByTestId("new-scene-dialog").waitFor({ state: "detached", timeout: 10000 });
    made = await mine();
    assert.equal(made.length, 1, "exactly one scene created");
    assert.deepEqual(made[0].scene.nodes.map((n) => n.assetId), [a, b]);
    await p.getByText(names.scene).first().waitFor({ timeout: 10000 });
    assert.equal(posts.length, 1);
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    for (const s of made.length ? made : await mine().catch(() => [])) await del(API, s.id);
    for (const id of [a, b]) await del(API, id);
  }
});
