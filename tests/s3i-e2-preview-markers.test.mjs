/**
 * S3-I E2 — #28 PUT /api/assets/:id/preview (scene thumbnail) and #81 clipUx.markers.
 * Specs: docs/sprint3i-brief.md R1 §7 and §10; D1 §5 and §8.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApi, billboardBody, makePng, runId } from "./helpers/s3d-synth.mjs";

const json = { "Content-Type": "application/json" };
const apis = [];
// One API per file: every test uses runId-scoped assets, and seven cold Node starts on a busy box
// were what tripped "API did not start" (#81 cap test), not the marker code.
let shared = null;
async function api(env = {}) {
  if (!Object.keys(env).length) {
    shared ??= startApi().then((a) => (apis.push(a), a));
    return shared;
  }
  const a = await startApi(env);
  apis.push(a);
  return a;
}
after(async () => {
  for (const a of apis) await a.stop();
});
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const post = (a, b) => fetch(`${a.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const png = (n = 256, m = n, c = [200, 40, 40, 255]) => makePng(n, m, () => c);
const put = (a, id, body, headers = { "Content-Type": "image/png" }) => fetch(`${a.url}/api/assets/${id}/preview`, { method: "PUT", headers, body });

async function mkScene(a, tag) {
  const base = runId(`${tag}-b`);
  assert.equal((await post(a, billboardBody(base, `${tag}-b`))).status, 201);
  const sc = runId(`${tag}-s`);
  const scene = {
    ...billboardBody(sc, `${tag}-s`),
    characterType: "unknown",
    stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: base, transform: tf(0) }] },
  };
  const r = await post(a, scene);
  assert.equal(r.status, 201, await r.clone().text());
  return { base, sc };
}

// ---------------------------------------------------------------- #28
test("#28 PUT then GET is byte-identical; file lives under WB_DATA_ROOT; response carries an ETag", async () => {
  const a = await api();
  const { sc } = await mkScene(a, "t28a");
  const body = png();
  const r = await put(a, sc, body);
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.id, sc);
  assert.equal(j.bytes, body.length);
  assert.match(r.headers.get("etag"), /^"[0-9a-f]{32}"$/);
  const g = await fetch(`${a.url}/api/assets/${sc}/preview`);
  assert.equal(g.status, 200);
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), body);
  const file = path.join(a.dataRoot, j.preview);
  assert.ok(file.startsWith(a.dataRoot + path.sep));
  assert.deepEqual(fs.readFileSync(file), body);
  // the stored doc points at the file; a second PUT replaces it
  const body2 = png(256, 256, [10, 200, 10, 255]);
  assert.equal((await put(a, sc, body2)).status, 200);
  assert.deepEqual(Buffer.from(await (await fetch(`${a.url}/api/assets/${sc}/preview`)).arrayBuffer()), body2);
});

test("#28 a non-scene asset is 400 VALIDATION {field:'stage'}; unknown id is 404; nothing written", async () => {
  const a = await api();
  const { base } = await mkScene(a, "t28b");
  const r = await put(a, base, png());
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, "VALIDATION");
  assert.equal(j.field, "stage");
  assert.ok(!fs.existsSync(path.join(a.dataRoot, "assets", base, "preview.png")));
  assert.equal((await put(a, "no-such-id", png())).status, 404);
});

test("#28 a body that is not a 256x256 PNG is 400 VALIDATION {field:'body'}; oversize is 413", async () => {
  const a = await api();
  const { sc } = await mkScene(a, "t28c");
  const bad = [
    ["wrong size", png(128)],
    ["not square", png(256, 255)],
    ["not a png", Buffer.from("GIF89a-not-a-png-at-all-really-not-a-png-at-all-padding-padding")],
    ["empty", Buffer.alloc(0)],
    ["truncated", png().subarray(0, 120)],
  ];
  for (const [name, body] of bad) {
    const r = await put(a, sc, body);
    assert.equal(r.status, 400, name);
    const j = await r.json();
    assert.equal(j.code, "VALIDATION", name);
    assert.equal(j.field, "body", name);
  }
  // wrong content type → the body is not parsed → 400 body
  const ct = await put(a, sc, png(), { "Content-Type": "application/octet-stream" });
  assert.equal(ct.status, 400);
  assert.equal((await ct.json()).field, "body");
  const big = await put(a, sc, Buffer.alloc(600 * 1024, 1));
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, "PAYLOAD_TOO_LARGE");
  assert.equal((await fetch(`${a.url}/api/assets/${sc}/preview`)).status, 404, "nothing was stored by the failed PUTs");
});

test("#28 If-Match is opt-in: stale → 412 (nothing written); the ETag from the PUT chains into the next write", async () => {
  const a = await api();
  const { sc } = await mkScene(a, "t28d");
  const stale = await put(a, sc, png(), { "Content-Type": "image/png", "If-Match": '"00000000000000000000000000000000"' });
  assert.equal(stale.status, 412);
  assert.equal((await fetch(`${a.url}/api/assets/${sc}/preview`)).status, 404);
  const cur = (await fetch(`${a.url}/api/assets/${sc}`)).headers.get("etag");
  const ok = await put(a, sc, png(), { "Content-Type": "image/png", "If-Match": cur });
  assert.equal(ok.status, 200);
  const next = ok.headers.get("etag");
  assert.equal((await fetch(`${a.url}/api/assets/${sc}`)).headers.get("etag"), next, "PUT's ETag is the asset's current ETag");
  const p = await fetch(`${a.url}/api/assets/${sc}`, { method: "PATCH", headers: { ...json, "If-Match": next }, body: JSON.stringify({ altText: "x" }) });
  assert.equal(p.status, 200);
});

// ---------------------------------------------------------------- #81
async function mkClipAsset(a, tag, clips = ["idle", "walk"], clipDurations = { idle: 2000, walk: 1500 }) {
  const id = runId(tag);
  const body = { ...billboardBody(id, tag), clips, ...(clipDurations ? { clipDurations } : {}) };
  const r = await post(a, body);
  assert.equal(r.status, 201, await r.clone().text());
  return id;
}
const clipUx = (a, id, body, headers = {}) =>
  fetch(`${a.url}/api/assets/${id}/clip-ux`, { method: "PATCH", headers: { ...json, ...headers }, body: JSON.stringify(body) });

test("#81 markers save and reload; absent key keeps them; [] clears; extra fields are dropped", async () => {
  const a = await api();
  const id = await mkClipAsset(a, "t81a");
  const markers = [{ clip: "idle", t: 0, name: "start", junk: 1 }, { clip: "walk", t: 1500, name: "end" }];
  const r = await clipUx(a, id, { defaultClip: "idle", markers });
  assert.equal(r.status, 200, await r.clone().text());
  const want = [{ clip: "idle", t: 0, name: "start" }, { clip: "walk", t: 1500, name: "end" }];
  assert.deepEqual((await r.json()).clipUx.markers, want);
  assert.deepEqual((await (await fetch(`${a.url}/api/assets/${id}`)).json()).clipUx.markers, want, "reload");
  const keep = await clipUx(a, id, { blendMs: 100 });
  assert.equal(keep.status, 200);
  assert.deepEqual((await keep.json()).clipUx.markers, want, "absent markers key keeps them");
  const clear = await clipUx(a, id, { markers: [] });
  assert.deepEqual((await clear.json()).clipUx.markers, []);
});

test("#81 cap 16, unique names, name 1..40, t integer within the clip duration, clip must exist → 400 VALIDATION {field:'clipUx.markers'}", async () => {
  const a = await api();
  const id = await mkClipAsset(a, "t81b");
  const mk = (i) => ({ clip: "idle", t: i, name: `m${i}` });
  const sixteen = Array.from({ length: 16 }, (_, i) => mk(i));
  assert.equal((await clipUx(a, id, { markers: sixteen })).status, 200, "16 is allowed");
  const cases = {
    "17 markers": [...sixteen, mk(16)],
    "duplicate name": [mk(1), { ...mk(2), name: "m1" }],
    "empty name": [{ ...mk(1), name: "" }],
    "41-char name": [{ ...mk(1), name: "x".repeat(41) }],
    "t past duration": [{ clip: "idle", t: 2001, name: "late" }],
    "t negative": [{ clip: "idle", t: -1, name: "neg" }],
    "t fractional": [{ clip: "idle", t: 1.5, name: "frac" }],
    "missing clip": [{ clip: "run", t: 5, name: "nope" }],
    "not an array": "nope",
    "entry not an object": [5],
  };
  for (const [name, markers] of Object.entries(cases)) {
    const r = await clipUx(a, id, { markers });
    assert.equal(r.status, 400, name);
    const j = await r.json();
    assert.equal(j.code, "VALIDATION", name);
    assert.equal(j.field, "clipUx.markers", name);
  }
  assert.equal((await (await fetch(`${a.url}/api/assets/${id}`)).json()).clipUx.markers.length, 16, "failed saves changed nothing");
  assert.equal((await clipUx(a, id, { markers: [{ clip: "idle", t: 2000, name: "edge" }] })).status, 200, "t == duration is allowed");
});

test("#81 If-Match from #69 still applies; an asset with no probed duration cannot hold markers", async () => {
  const a = await api();
  const id = await mkClipAsset(a, "t81c");
  const stale = await clipUx(a, id, { markers: [mk()] }, { "If-Match": '"00000000000000000000000000000000"' });
  assert.equal(stale.status, 412);
  const nod = await mkClipAsset(a, "t81d", ["idle"], null);
  const r = await clipUx(a, nod, { markers: [{ clip: "idle", t: 0, name: "a" }] });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).field, "clipUx.markers");
  function mk() {
    return { clip: "idle", t: 1, name: "a" };
  }
});
