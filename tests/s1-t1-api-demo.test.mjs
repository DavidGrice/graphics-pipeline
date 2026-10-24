/**
 * S1-T1.3 / T2 / T3.7 — Express demo path (server must be on :8787)
 * Skips cleanly if server is down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const API = process.env.WORLD_API || "http://127.0.0.1:8787";
const ASSET = "298c8420-a948-48a6-9a26-884013437c3a";

async function up() {
  try {
    const r = await fetch(`${API}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

test("T1.3: health + list + GLB file for demo asset", async (t) => {
  if (!(await up())) {
    t.skip("world-builder not listening on :8787");
    return;
  }
  const health = await (await fetch(`${API}/api/health`)).json();
  assert.equal(health.ok, true);

  const list = await (await fetch(`${API}/api/assets`)).json();
  const doc = list.find((a) => a.id === ASSET);
  assert.ok(doc, "demo asset registered");
  assert.ok(doc.clips.includes("spin"));
  assert.ok(doc.formats.glb);

  const file = await fetch(`${API}/api/assets/${ASSET}/file`);
  assert.equal(file.status, 200);
  const buf = Buffer.from(await file.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), "glTF");
});

test("T2: API rejects OBJ+clips and clips without glb", async (t) => {
  if (!(await up())) {
    t.skip("world-builder not listening on :8787");
    return;
  }
  const now = new Date().toISOString();
  const badObj = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "55555555-5555-4555-8555-555555555555",
      slug: "api-bad-obj",
      name: "bad",
      characterType: "billboard",
      clips: ["spin"],
      formats: { obj: "assets/x/model.obj", preview: "assets/x/p.png" },
      rig: { hasArmature: false, hasWeights: false },
      createdAt: now,
      updatedAt: now,
    }),
  });
  assert.equal(badObj.status, 400);

  const both = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "66666666-6666-4666-8666-666666666666",
      slug: "api-glb-obj",
      name: "both",
      characterType: "billboard",
      clips: ["spin"],
      formats: {
        glb: "assets/x/model.glb",
        obj: "assets/x/model.obj",
        preview: "assets/x/p.png",
      },
      rig: { hasArmature: false, hasWeights: false },
      createdAt: now,
      updatedAt: now,
    }),
  });
  assert.equal(both.status, 400);
  const body = await both.json();
  assert.match(String(body.error), /obj/i);
});

test("T3.7: missing GLB on disk → 404", async (t) => {
  if (!(await up())) {
    t.skip("world-builder not listening on :8787");
    return;
  }
  const r = await fetch(
    `${API}/api/assets/33333333-3333-4333-8333-333333333333/file`,
  );
  assert.equal(r.status, 404);
});
