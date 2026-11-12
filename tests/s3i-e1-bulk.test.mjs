/**
 * S3-I E1 #70 — POST /api/assets/bulk {zip:"inbox/<file>.zip"} (R1 §6, D1 §4, D2).
 * Whole-request failures write nothing; per-entry failures leave the other rows intact.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { startApi, billboardBody, makeRiggedGlb, runId, ROOT, tmpDataRoot } from "./helpers/s3d-synth.mjs";
import { parseBulkMax, readZipEntries, entryEscapes, slugFromEntryName } from "../apps/world-builder/server/src/bulk.js";

const json = { "Content-Type": "application/json" };
const SERVER = path.join(ROOT, "apps/world-builder/server/src/index.js");
const apis = [];
async function api(env = {}) {
  const a = await startApi(env);
  apis.push(a);
  return a;
}
after(async () => {
  for (const a of apis) await a.stop();
});

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** zip writer with arbitrary entry names; deflate unless `store`. */
function makeZip(files, { store = false } = {}) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = f.data;
    const comp = store || name.toString().endsWith("/") ? data : zlib.deflateRawSync(data);
    const method = comp === data ? 0 : 8;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    locals.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(files.length, 8);
  e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const glb = (clips) => makeRiggedGlb(clips ? { clips } : undefined);
/** Plain static GLB (no armature): registers as an honest mvp-billboard. */
function plainGlb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "n" }] }));
  const pad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const body = Buffer.concat([json, pad]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(12 + 8 + body.length, 8);
  h.writeUInt32LE(body.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([h, body]);
}
const put = (a, name, buf) => fs.writeFileSync(path.join(a.dataRoot, "inbox", name), buf);
const bulk = (a, body) => fetch(`${a.url}/api/assets/bulk`, { method: "POST", headers: json, body: JSON.stringify(body) });
const assetDirs = (a) => fs.readdirSync(path.join(a.dataRoot, "assets"));

test("#70 unit: BULK_MAX 1..100 default 20; zip reader; escape detection; slugs", () => {
  assert.equal(parseBulkMax(undefined), 20);
  assert.equal(parseBulkMax("1"), 1);
  assert.equal(parseBulkMax("100"), 100);
  for (const bad of ["0", "101", "1.5", "-1", "abc"]) {
    assert.throws(() => parseBulkMax(bad), (e) => e.code === "CONFIG_INVALID" && /BULK_MAX/.test(e.message) && !e.message.includes(`"${bad}"`));
  }
  const z = makeZip([{ name: "a/b.glb", data: Buffer.from("xyz") }, { name: "d/", data: Buffer.alloc(0) }]);
  const es = readZipEntries(z);
  assert.deepEqual(es.map((e) => [e.name, e.dir]), [["a/b.glb", false], ["d/", true]]);
  for (const n of ["../x.glb", "a/../../x.glb", "/abs.glb", "C:\\x.glb", "a\\..\\..\\x.glb", "a\0b.glb"]) assert.ok(entryEscapes(n), n);
  for (const n of ["x.glb", "dir/x.glb", "a..b.glb"]) assert.ok(!entryEscapes(n), n);
  assert.equal(slugFromEntryName("dir/My Model_v2.GLB"), "my-model-v2");
  assert.equal(slugFromEntryName("___.glb"), null);
});

test("#70 two GLBs → two ids in zip order; stored files exist; asset.register recorded; other entries ignored", async () => {
  const a = await api();
  put(a, "pair.zip", makeZip([
    { name: "readme.txt", data: Buffer.from("hi") },
    { name: "models/Alpha One.glb", data: glb() },
    { name: "models/beta.glb", data: plainGlb() },
  ]));
  const r = await bulk(a, { zip: "inbox/pair.zip" });
  assert.equal(r.status, 200, await r.clone().text());
  const { results } = await r.json();
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((x) => [x.name, x.ok, x.slug]), [["models/Alpha One.glb", true, "alpha-one"], ["models/beta.glb", true, "beta"]]);
  assert.notEqual(results[0].id, results[1].id);
  assert.equal((await (await fetch(`${a.url}/api/assets/${results[0].id}`)).json()).stage, "rigged");
  assert.equal((await (await fetch(`${a.url}/api/assets/${results[1].id}`)).json()).stage, "mvp-billboard");
  for (const row of results) {
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(row).sort(), ["id", "name", "ok", "slug"]);
    const g = await fetch(`${a.url}/api/assets/${row.id}`);
    assert.equal(g.status, 200);
    assert.equal((await g.json()).slug, row.slug);
    assert.equal((await fetch(`${a.url}/api/assets/${row.id}/file`)).status, 200);
  }
  const feed = (await (await fetch(`${a.url}/api/activity?limit=50`)).json()).items;
  for (const row of results) assert.equal(feed.find((e) => e.id === row.id)?.kind, "asset.register");
  assert.ok(!feed.some((e) => e.kind === "pack.import"));
});

test("#70 a slug clash (existing asset, or a repeat inside the zip) fails only that row", async () => {
  const a = await api();
  const taken = runId("b70-taken");
  assert.equal((await fetch(`${a.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(billboardBody(taken, "taken")) })).status, 201);
  put(a, "clash.zip", makeZip([
    { name: "taken.glb", data: glb() },
    { name: "fresh.glb", data: glb() },
    { name: "other/fresh.glb", data: glb() },
    { name: "armature-no-clips.glb", data: glb({ spin: 5 }) },
  ]));
  const { results } = await (await bulk(a, { zip: "inbox/clash.zip" })).json();
  assert.deepEqual(results.map((x) => [x.ok, x.code, x.slug]), [[false, "SLUG_CLASH", "taken"], [true, undefined, "fresh"], [false, "SLUG_CLASH", "fresh"], [false, "VALIDATION", "armature-no-clips"]]);
  assert.equal(assetDirs(a).length, 1, "only the one new asset was written (failed rows leave no dir)");
});

test("#70 zip-slip / absolute entry names → 400 PATH_OUTSIDE_INBOX for the whole request; nothing written", async () => {
  const a = await api();
  for (const evil of ["../evil.glb", "/abs/evil.glb", "ok/../../evil.glb"]) {
    put(a, "slip.zip", makeZip([{ name: "good.glb", data: glb() }, { name: evil, data: glb() }]));
    const r = await bulk(a, { zip: "inbox/slip.zip" });
    assert.equal(r.status, 400, evil);
    const j = await r.json();
    assert.equal(j.code, "PATH_OUTSIDE_INBOX");
    assert.ok(!JSON.stringify(j).includes("evil"), "entry name is not echoed");
    assert.equal(assetDirs(a).length, 0, "nothing written");
  }
  assert.ok(!fs.existsSync(path.join(a.dataRoot, "evil.glb")));
});

test("#70 the zip path is guarded: outside inbox/ → PATH_OUTSIDE_INBOX; missing/non-string/non-zip/not found → VALIDATION zip", async () => {
  const a = await api();
  for (const z of ["../x.zip", "inbox/../../etc.zip", "/etc/x.zip", "assets/x.zip", "inbox/%2e%2e/x.zip"]) {
    const r = await bulk(a, { zip: z });
    assert.equal(r.status, 400, z);
    assert.equal((await r.json()).code, "PATH_OUTSIDE_INBOX", z);
  }
  for (const body of [{}, { zip: 5 }, { zip: "" }, { zip: "inbox/a.txt" }, { zip: "inbox/missing.zip" }]) {
    const r = await bulk(a, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    const j = await r.json();
    assert.equal(j.code, "VALIDATION");
    assert.equal(j.field, "zip");
  }
  put(a, "junk.zip", Buffer.from("this is not a zip at all, not even close"));
  const r = await bulk(a, { zip: "inbox/junk.zip" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).field, "zip");
});

test("#70 over BULK_MAX or zero GLB entries → 400 VALIDATION {field:\"entries\"}; nothing written", async () => {
  const a = await api({ BULK_MAX: "2" });
  put(a, "three.zip", makeZip(["a", "b", "c"].map((n) => ({ name: `${n}.glb`, data: glb() }))));
  let r = await bulk(a, { zip: "inbox/three.zip" });
  assert.equal(r.status, 400);
  let j = await r.json();
  assert.equal(j.code, "VALIDATION");
  assert.equal(j.field, "entries");
  put(a, "none.zip", makeZip([{ name: "notes.txt", data: Buffer.from("x") }]));
  r = await bulk(a, { zip: "inbox/none.zip" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).field, "entries");
  put(a, "two.zip", makeZip(["a", "b"].map((n) => ({ name: `${n}.glb`, data: glb() }))));
  r = await bulk(a, { zip: "inbox/two.zip" });
  assert.equal(r.status, 200, "exactly BULK_MAX is fine");
  assert.equal(assetDirs(a).length, 2);
});

test("#70 a zip larger than BULK_MAX * MAX_GLB_BYTES → 413 GLB_TOO_LARGE; a too-large or corrupt entry fails only its row", async () => {
  const a = await api({ MAX_GLB_MB: "1", BULK_MAX: "1" });
  put(a, "huge.zip", makeZip([{ name: "big.glb", data: crypto_random(1_100_000) }], { store: true }));
  let r = await bulk(a, { zip: "inbox/huge.zip" });
  assert.equal(r.status, 413);
  const j = await r.json();
  assert.equal(j.code, "GLB_TOO_LARGE");
  assert.equal(assetDirs(a).length, 0);

  const b = await api({ MAX_GLB_MB: "1", BULK_MAX: "4" });
  put(b, "mixed.zip", makeZip([
    { name: "toobig.glb", data: Buffer.alloc(1_500_000, 7) }, // deflates tiny, declared size is over the cap
    { name: "ok.glb", data: glb() },
    { name: "broken.glb", data: Buffer.from("glTF-but-not-really") },
  ]));
  r = await bulk(b, { zip: "inbox/mixed.zip" });
  assert.equal(r.status, 200, await r.clone().text());
  const { results } = await r.json();
  assert.deepEqual(results.map((x) => [x.name, x.ok, x.code]), [["toobig.glb", false, "GLB_TOO_LARGE"], ["ok.glb", true, undefined], ["broken.glb", false, "GLB_CORRUPT"]]);
  assert.equal(assetDirs(b).length, 1, "failed rows leave no files");
});

test("#70 a long entry name is echoed capped at 200 characters", async () => {
  const a = await api();
  const long = `${"d".repeat(300)}/x.glb`;
  put(a, "long.zip", makeZip([{ name: long, data: glb() }]));
  const { results } = await (await bulk(a, { zip: "inbox/long.zip" })).json();
  assert.equal(results[0].name.length, 200);
  assert.ok(results[0].name.endsWith("…"));
});

test("#70 a bad BULK_MAX refuses boot with CONFIG_INVALID naming the variable, never the value", () => {
  for (const v of ["0", "101", "sekrit-bulk", "2.5"]) {
    const env = { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", WB_DATA_ROOT: tmpDataRoot("b70-bad-"), BULK_MAX: v };
    const r = spawnSync(process.execPath, [SERVER], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 1, v);
    assert.match(r.stderr, /CONFIG_INVALID: BULK_MAX/);
    assert.ok(!r.stderr.includes(v) || v === "0" || v === "101", `${v} not echoed`);
  }
});

function crypto_random(n) {
  return Buffer.from(Array.from({ length: n }, (_, i) => (i * 2654435761) >>> 24));
}
