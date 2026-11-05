/**
 * S3-H E1 #69 — strong ETag + opt-in If-Match (412 PRECONDITION_FAILED).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import { etagOf, parseIfMatch, ifMatchOk, canonicalJson } from "../apps/world-builder/server/src/etag.js";

const json = { "Content-Type": "application/json" };
let api;
before(async () => {
  api = await startApi();
});
after(async () => {
  await api?.stop?.();
});

const post = (body) =>
  fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) });
const get = (id) => fetch(`${api.url}/api/assets/${id}`);
const patch = (id, body, headers = {}) =>
  fetch(`${api.url}/api/assets/${id}`, {
    method: "PATCH",
    headers: { ...json, ...headers },
    body: JSON.stringify(body),
  });

test("#69 helpers: etag stable across key order; parseIfMatch; ifMatchOk", () => {
  const a = { id: "x", slug: "s", z: 1, a: { b: 2, a: 1 } };
  const b = { a: { a: 1, b: 2 }, slug: "s", z: 1, id: "x" };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(etagOf(a), etagOf(b));
  assert.match(etagOf(a), /^"[0-9a-f]{32}"$/);

  assert.equal(parseIfMatch(undefined), null);
  assert.deepEqual(parseIfMatch("*"), { ok: true, star: true });
  assert.equal(parseIfMatch("not-quoted").ok, false);
  assert.equal(parseIfMatch('W/"abc"').ok, false);
  const tag = etagOf(a);
  assert.deepEqual(parseIfMatch(tag), { ok: true, tags: [tag] });
  assert.equal(ifMatchOk(null, tag), true);
  assert.equal(ifMatchOk(parseIfMatch("*"), tag), true);
  assert.equal(ifMatchOk(parseIfMatch(tag), tag), true);
  assert.equal(ifMatchOk(parseIfMatch('"deadbeefdeadbeefdeadbeefdeadbeef"'), tag), false);
});

test("#69 GET returns ETag; PATCH without If-Match unchanged; match → new ETag", async () => {
  const id = runId("e69a");
  assert.equal((await post(billboardBody(id, `e69a-${process.pid}`))).status, 201);
  const g = await get(id);
  assert.equal(g.status, 200);
  const etag = g.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  const doc = await g.json();
  assert.equal(etag, etagOf(doc));

  const p0 = await patch(id, { name: "n1" });
  assert.equal(p0.status, 200);
  const etag2 = p0.headers.get("etag");
  assert.match(etag2, /^"[0-9a-f]{32}"$/);
  assert.notEqual(etag2, etag);

  const p1 = await patch(id, { name: "n2" }, { "If-Match": etag2 });
  assert.equal(p1.status, 200);
  assert.notEqual(p1.headers.get("etag"), etag2);
});

test("#69 stale If-Match → 412 PRECONDITION_FAILED {current}; nothing written; * matches; malformed → 400", async () => {
  const id = runId("e69b");
  assert.equal((await post(billboardBody(id, `e69b-${process.pid}`))).status, 201);
  const etag = (await get(id)).headers.get("etag");
  const before = await (await get(id)).json();

  const stale = await patch(id, { name: "nope" }, { "If-Match": '"deadbeefdeadbeefdeadbeefdeadbeef"' });
  assert.equal(stale.status, 412);
  const body = await stale.json();
  assert.equal(body.code, "PRECONDITION_FAILED");
  assert.equal(body.current, etag);
  assert.deepEqual(Object.keys(body).sort(), ["code", "current", "error"]);
  const after = await (await get(id)).json();
  assert.equal(after.name, before.name);
  assert.equal(after.updatedAt, before.updatedAt);

  const star = await patch(id, { name: "starred" }, { "If-Match": "*" });
  assert.equal(star.status, 200);
  assert.equal((await star.json()).name, "starred");

  const bad = await patch(id, { name: "x" }, { "If-Match": "unquoted" });
  assert.equal(bad.status, 400);
  const vb = await bad.json();
  assert.equal(vb.code, "VALIDATION");
  assert.equal(vb.field, "If-Match");
});

test("#69 404 before 412; clip-ux returns ETag; DELETE respects If-Match", async () => {
  const missing = await patch(runId("gone"), { name: "x" }, { "If-Match": '"deadbeefdeadbeefdeadbeefdeadbeef"' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "NOT_FOUND");

  const id = runId("e69c");
  assert.equal((await post(billboardBody(id, `e69c-${process.pid}`))).status, 201);
  const etag = (await get(id)).headers.get("etag");
  const ux = await fetch(`${api.url}/api/assets/${id}/clip-ux`, {
    method: "PATCH",
    headers: { ...json, "If-Match": etag },
    body: JSON.stringify({ defaultClip: "idle" }),
  });
  assert.equal(ux.status, 200);
  const uxEtag = ux.headers.get("etag");
  assert.match(uxEtag, /^"[0-9a-f]{32}"$/);
  assert.notEqual(uxEtag, etag);

  const delStale = await fetch(`${api.url}/api/assets/${id}`, {
    method: "DELETE",
    headers: { "If-Match": etag },
  });
  assert.equal(delStale.status, 412);
  assert.equal((await get(id)).status, 200);

  const delOk = await fetch(`${api.url}/api/assets/${id}`, {
    method: "DELETE",
    headers: { "If-Match": uxEtag },
  });
  assert.equal(delOk.status, 204);
  assert.equal((await get(id)).status, 404);
});

test("#69 CORS exposes ETag and allows If-Match", async () => {
  const id = runId("e69d");
  assert.equal((await post(billboardBody(id, `e69d-${process.pid}`))).status, 201);
  const r = await fetch(`${api.url}/api/assets/${id}`, {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(r.status, 200);
  const expose = (r.headers.get("access-control-expose-headers") || "").toLowerCase();
  assert.match(expose, /etag/);

  const pre = await fetch(`${api.url}/api/assets/${id}`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "PATCH",
      "Access-Control-Request-Headers": "content-type,if-match",
    },
  });
  assert.equal(pre.status, 204);
  const allow = (pre.headers.get("access-control-allow-headers") || "").toLowerCase();
  assert.match(allow, /if-match/);
});
