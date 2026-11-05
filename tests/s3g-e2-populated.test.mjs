/**
 * S3-G E2 NIT-G-2 — Recent imports on a populated store.
 * Root cause: GET /api/assets?sort=-createdAt broke createdAt ties by store order (oldest stored first),
 * so once 20+ assets shared a createdAt (test fixtures use a fixed one) a just-registered asset fell
 * past limit=20 and never reached the Recent imports panel. "-createdAt" now puts the most recently
 * stored asset first among ties; ascending keeps store order.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApi, billboardBody, browserEnv, CHROME_ARGS, runId } from "./helpers/s3d-synth.mjs";

const SEED = 25;
const post = (base, body) =>
  fetch(`${base}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let api;
before(async () => {
  api = await startApi();
});
after(async () => {
  await api?.stop?.();
});

test("NIT-G-2 API: on a pre-populated store a just-registered asset sharing createdAt is first in sort=-createdAt&limit=20", async () => {
  const ids = [];
  for (let i = 0; i < SEED; i++) {
    const id = runId(`pop-${i}`);
    ids.push(id);
    assert.equal((await post(api.url, billboardBody(id, `pop-seed-${i}`))).status, 201);
  }
  const last = runId("pop-new");
  assert.equal((await post(api.url, billboardBody(last, "pop-new"))).status, 201);
  const desc = await (await fetch(`${api.url}/api/assets?sort=-createdAt&limit=20`)).json();
  assert.equal(desc.length, 20);
  assert.equal(desc[0].id, last, "newest stored first among equal createdAt");
  assert.deepEqual(desc.slice(1, 4).map((d) => d.id), [ids[SEED - 1], ids[SEED - 2], ids[SEED - 3]]);
  const asc = await (await fetch(`${api.url}/api/assets?sort=createdAt&limit=3`)).json();
  assert.deepEqual(asc.map((d) => d.id), ids.slice(0, 3), "ascending keeps store order");
});

test("NIT-G-2 browser: Recent imports shows the just-registered asset after 25 pre-seeded fixtures", async (t) => {
  const env = browserEnv();
  if (env.skip) return t.skip(env.skip);
  const { chromium, exe, UI, API } = env;
  const made = [];
  try {
    for (let i = 0; i < SEED; i++) {
      const id = runId(`ui-pop-${i}`);
      const r = await post(API, billboardBody(id, `ui-pop-${process.pid}-${i}`)).catch(() => null);
      if (!r || r.status !== 201) return t.skip(`SKIP_NO_API: could not seed ${API} (${r?.status || "unreachable"})`);
      made.push(id);
    }
    const id = runId("ui-pop-new");
    const slug = `ui-pop-new-${process.pid}`;
    assert.equal((await post(API, billboardBody(id, slug))).status, 201);
    made.push(id);
    const br = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
    try {
      const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
      await p.goto(UI, { waitUntil: "networkidle" });
      await p.getByTestId("recent-import-row").filter({ hasText: slug }).first().waitFor({ timeout: 10000 });
      await p.close();
    } finally {
      await br.close();
    }
  } finally {
    for (const id of made.reverse()) await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
  }
});
