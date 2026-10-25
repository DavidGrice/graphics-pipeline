/**
 * S1-T1.3 / T2 / T3.7 — Express demo path (server must be on :8787)
 * S2-E-E4 soft-env: skip when API down OR demo seed missing — never flake red.
 *
 * Seed locally (optional):
 *   npm run dev:world   # :8787
 *   node apps/blender-pipeline/make_demo_glb.mjs /tmp/demo.glb
 *   node apps/blender-pipeline/register_asset.mjs \
 *     --id 298c8420-a948-48a6-9a26-884013437c3a \
 *     --slug hero-billboard --glb /tmp/demo.glb
 * See docs/sprint2e-d1-scene-importmeta-wire.md §3 and docs/setup-linux.md.
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

async function findDemo() {
  const list = await (await fetch(`${API}/api/assets`)).json();
  if (!Array.isArray(list)) return null;
  return list.find((a) => a.id === ASSET) ?? null;
}

test("T1.3: health + list + GLB file for demo asset", async (t) => {
  if (!(await up())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const health = await (await fetch(`${API}/api/health`)).json();
  assert.equal(health.ok, true);

  const doc = await findDemo();
  if (!doc) {
    t.skip(
      `demo asset ${ASSET} not seeded — soft-env skip (seed via register_asset / make_demo_glb)`,
    );
    return;
  }
  assert.ok(doc.clips.includes("spin"));
  assert.ok(doc.formats.glb);

  const file = await fetch(`${API}/api/assets/${ASSET}/file`);
  assert.equal(file.status, 200);
  const buf = Buffer.from(await file.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), "glTF");
});

test("T2: API rejects OBJ+clips and clips without glb", async (t) => {
  if (!(await up())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
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
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const r = await fetch(
    `${API}/api/assets/33333333-3333-4333-8333-333333333333/file`,
  );
  assert.equal(r.status, 404);
});
