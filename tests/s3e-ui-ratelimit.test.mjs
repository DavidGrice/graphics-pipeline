/**
 * S3-E E1 #139 UI — 429 shows an inline "Too many changes, try again in Ns" countdown, the
 * button is disabled until it runs out, nothing auto-retries (D2 §1). #66 UI — Recent imports
 * row tooltip shows the import total from importMeta.timingsMs (D2 §4).
 * The 429 is injected with page.route (no real throttling of the shared WORLD_API).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, browserEnv, CHROME_ARGS, billboardBody, runId } from "./helpers/s3d-synth.mjs";

test("#139 static wiring: every mutating UI call goes through noteRateLimit and shows the countdown", () => {
  const src = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  for (const where of ["register", "alt", "actionMap", "scene"]) {
    assert.match(src, new RegExp(`noteRateLimit\\(r, \\w+, "${where}"\\)`), `${where} handles 429`);
    assert.match(src, new RegExp(`rateLimitNote\\("${where}"\\)`), `${where} renders the countdown`);
  }
  assert.ok(!/setTimeout\([^)]*submitRegister|retry\(/.test(src), "no auto-retry");
});

test("#139/#66 browser: 429 countdown disables Register then re-enables; history tooltip shows total", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("e1-ui");
  const slug = `s3e-timing-${process.pid}`;
  const body = {
    ...billboardBody(id, slug),
    importMeta: { source: "png_pipeline", timingsMs: { export: 900, probe: 12, copy: 3, total: 915, probeCache: "hit" } },
  };
  let status = 0;
  try {
    const r = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    status = r.status;
  } catch {
    status = 0;
  }
  if (status !== 201) return t.skip(`SKIP_NO_API: could not register on ${API} (${status || "unreachable"})`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    let posts = 0;
    await p.route("**/api/assets", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      return route.fulfill({
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
        body: JSON.stringify({ code: "RATE_LIMITED", error: "too many changes; retry in 1s", retryAfterSec: 1 }),
      });
    });
    await p.goto(UI, { waitUntil: "networkidle" });
    // #66 tooltip on the Recent imports row
    const row = p.getByTestId("recent-import-row").filter({ hasText: slug }).first();
    await row.waitFor({ timeout: 10000 });
    assert.equal(await row.getAttribute("title"), "Import took 915 ms (export 900 ms · probe 12 ms · copy 3 ms) · probe cache hit");
    // #139 countdown
    await p.getByRole("button", { name: "Register asset" }).click();
    await p.getByLabel("Asset JSON").fill(JSON.stringify(billboardBody(runId("e1-ui-2"), `${slug}-x`)));
    const btn = p.getByTestId("register-submit");
    await btn.click();
    const note = p.getByTestId("rate-limited");
    await note.waitFor({ timeout: 5000 });
    assert.equal((await note.textContent()).trim(), "Too many changes, try again in 1s");
    assert.equal(await btn.isDisabled(), true, "disabled during the countdown");
    await p.waitForFunction(() => !document.querySelector('[data-testid="rate-limited"]'), null, { timeout: 3000 });
    assert.equal(await btn.isDisabled(), false, "re-enabled after N seconds");
    assert.equal(posts, 1, "no automatic retry");
    assert.ok(await p.getByLabel("Asset JSON").inputValue(), "form keeps its JSON");
    assert.deepEqual(errs, []);
    await p.close();
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
  }
});
