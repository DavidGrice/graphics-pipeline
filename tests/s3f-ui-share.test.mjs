/**
 * S3-F NIT-F-1 — Share popover stays inside the viewport at 390/1280/1920 (8px margin; < 600px is a
 * bottom sheet). Asserts rect.left >= 0, rect.right <= innerWidth, rect.bottom <= innerHeight, QR >= 160px,
 * and elementFromPoint at the Copy button centre is the Copy button (S3-C #82 overlap check); also after resize.
 * Needs UI_URL + WORLD_API (skips SKIP_NO_UI_URL otherwise). Registers + DELETEs its own fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserEnv, CHROME_ARGS, billboardBody, runId } from "./helpers/s3d-synth.mjs";

async function check(p, label) {
  await p.getByTestId("share-pop").waitFor({ timeout: 5000 });
  await p.waitForTimeout(100);
  const r = await p.evaluate(() => {
    const pop = document.querySelector('[data-testid="share-pop"]').getBoundingClientRect();
    const qr = document.querySelector('[data-testid="share-qr"]').getBoundingClientRect();
    const copy = document.querySelector('[data-testid="share-copy"]');
    const c = copy.getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return { left: pop.left, right: pop.right, top: pop.top, bottom: pop.bottom, width: pop.width,
      qr: Math.min(qr.width, qr.height), iw: innerWidth, ih: innerHeight, hit: hit === copy || copy.contains(hit) };
  });
  assert.ok(r.left >= 0, `${label} left ${r.left}`);
  assert.ok(r.right <= r.iw, `${label} right ${r.right} > ${r.iw}`);
  assert.ok(r.top >= 0 && r.bottom <= r.ih, `${label} vertical ${r.top}..${r.bottom} / ${r.ih}`);
  assert.ok(r.qr >= 160, `${label} QR ${r.qr}px`);
  assert.ok(r.hit, `${label} Copy button covered at its centre`);
  if (r.iw < 600) assert.ok(Math.abs(r.width - (r.iw - 16)) <= 1, `${label} sheet width ${r.width}`);
  return r;
}

test("NIT-F-1 share popover in viewport at 390/1280/1920 + resize", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const id = runId("nitf1");
  const slug = `nitf1-${process.pid}`;
  const st = await fetch(`${API}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(billboardBody(id, slug)) })
    .then((r) => r.status, () => 0);
  if (st !== 201) return t.skip(`SKIP_NO_API: could not register fixture on ${API}`);
  const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
  try {
    for (const [w, h] of [[390, 844], [1280, 800], [1920, 1080]]) {
      const p = await br.newPage({ viewport: { width: w, height: h } });
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: new RegExp(slug) }).first().click();
      await p.getByTestId("share-button").click();
      const r = await check(p, `${w}`);
      t.diagnostic(`${w}: ${JSON.stringify(r)}`);
      if (w === 1280) {
        await p.setViewportSize({ width: 390, height: 844 });
        await check(p, "1280→390 resize");
        await p.setViewportSize({ width: 700, height: 500 });
        await check(p, "→700x500 resize");
      }
      await p.close();
    }
  } finally {
    await br.close();
    await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
  }
});
