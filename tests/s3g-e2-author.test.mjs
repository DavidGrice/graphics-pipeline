/**
 * S3-G E2 — pure helpers (R1 §5–8, D1 §1–5): #36 undo/redo (cap 100, save marker, redo cut,
 * input-safe keys), #29 batch ops (root/already skipped, cap refuses whole restore, selection
 * survives undo/redo), #84 compare parse + diff rows, #44 health view (no paths) + 429 back-off,
 * NIT-F-1 overlay placement. Plus contract locks: no new codes / routes, OpenAPI 0.7.0, 6 SKIP codes.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClientTs } from "./helpers/s3d-synth.mjs";

let G;
before(async () => {
  // s3gAuthor imports ./s3eScene — transpile both into one temp dir
  const ts = (await import("node:module")).createRequire(import.meta.url)("typescript");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3g-e2-"));
  for (const f of ["s3eScene", "s3gAuthor"]) {
    const src = fs.readFileSync(path.join(ROOT, `apps/world-builder/client/src/${f}.ts`), "utf8").replace(/from "\.\/s3eScene"/g, 'from "./s3eScene.mjs"');
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    fs.writeFileSync(path.join(dir, `${f}.mjs`), out);
  }
  G = await import(path.join(dir, "s3gAuthor.mjs"));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(typeof loadClientTs, "function");
});

const step = (i) => ({ label: `s${i}`, before: i - 1, after: i });

// ---------------------------------------------------------------- #36
test("#36 a 101st step drops the first (cap 100, no UI)", () => {
  let h = G.emptyHistory();
  for (let i = 1; i <= 101; i++) h = G.pushStep(h, step(i));
  assert.equal(h.steps.length, 100);
  assert.equal(h.index, 100);
  assert.equal(h.steps[0].label, "s2");
  assert.equal(G.UNDO_CAP, 100);
  // undo all the way: the oldest reachable state is s1's after (= 1), never 0
  let st;
  for (let r; (r = G.undo(h)); h = r.history) st = r.state;
  assert.equal(st, 1);
  assert.equal(G.canUndo(h), false);
});

test("#36 dirty = current ≠ save marker; undo back to the marker clears it; Save keeps the stack", () => {
  let h = G.emptyHistory();
  assert.equal(G.isDirty(h), false);
  h = G.pushStep(h, step(1));
  h = G.pushStep(h, step(2));
  assert.equal(G.isDirty(h), true);
  h = G.markSaved(h);
  assert.equal(G.isDirty(h), false);
  assert.equal(h.steps.length, 2, "stack survives Save");
  h = G.undo(h).history;
  assert.equal(G.isDirty(h), true, "undo past the marker → dirty");
  h = G.redo(h).history;
  assert.equal(G.isDirty(h), false, "redo back onto the marker → clean");
  h = G.pushStep(h, step(3));
  assert.equal(G.isDirty(h), true);
  h = G.undo(h).history;
  assert.equal(G.isDirty(h), false);
  assert.equal(G.undoTitle(h), "Undo s2");
  assert.equal(G.redoTitle(h), "Redo s3");
});

test("#36 a new edit cuts the redo branch (and a marker on that branch becomes unreachable)", () => {
  let h = G.emptyHistory();
  for (let i = 1; i <= 3; i++) h = G.pushStep(h, step(i));
  h = G.markSaved(h); // marker 3
  h = G.undo(G.undo(h).history).history; // index 1
  assert.equal(G.canRedo(h), true);
  h = G.pushStep(h, { label: "x", before: 1, after: 9 });
  assert.equal(G.canRedo(h), false);
  assert.deepEqual(h.steps.map((s) => s.label), ["s1", "x"]);
  assert.equal(h.marker, null);
  assert.equal(G.isDirty(h), true);
  assert.equal(G.isDirty(G.undo(h).history), true, "saved state is gone → always dirty until next Save");
  // cap drop of the marker step also makes it unreachable
  let k = G.markSaved(G.emptyHistory()); // marker 0
  for (let i = 1; i <= 101; i++) k = G.pushStep(k, step(i));
  assert.equal(k.marker, null);
});

test("#36 coalesced field edits amend one step, never across the save marker", () => {
  let h = G.emptyHistory();
  h = G.pushCoalesced(h, { label: "Edit position", before: 0, after: 1, key: "vec:n1:position:0" });
  h = G.pushCoalesced(h, { label: "Edit position", before: 1, after: 12, key: "vec:n1:position:0" });
  assert.equal(h.steps.length, 1);
  assert.equal(h.steps[0].after, 12);
  assert.equal(h.steps[0].before, 0);
  h = G.markSaved(h);
  h = G.pushCoalesced(h, { label: "Edit position", before: 12, after: 123, key: "vec:n1:position:0" });
  assert.equal(h.steps.length, 2, "no amend across the marker");
});

test("#36 keys: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y; typing in an input never undoes", () => {
  const k = (o) => G.historyKey({ target: { tagName: "CANVAS" }, ...o });
  assert.equal(k({ key: "z", ctrlKey: true }), "undo");
  assert.equal(k({ key: "z", metaKey: true }), "undo");
  assert.equal(k({ key: "Z", ctrlKey: true, shiftKey: true }), "redo");
  assert.equal(k({ key: "z", metaKey: true, shiftKey: true }), "redo");
  assert.equal(k({ key: "y", ctrlKey: true }), "redo");
  assert.equal(k({ key: "z" }), null);
  assert.equal(k({ key: "z", ctrlKey: true, altKey: true }), null);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) assert.equal(k({ key: "z", ctrlKey: true, target: { tagName } }), null, tagName);
  assert.equal(k({ key: "z", ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } }), null);
});

// ---------------------------------------------------------------- #29
const n = (id, extra = {}) => ({ id, assetId: "a", visible: true, transform: { position: [Number(id.slice(1)), 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, ...extra });

test("#29 batch delete skips the root and already-deleted nodes → one step, toast", () => {
  const nodes = [n("n0"), n("n1"), n("n2"), n("n3", { deleted: true })];
  const r = G.batchApply(nodes, ["n0", "n1", "n2", "n3"], "delete", "n0", 256);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.changed, ["n1", "n2"]);
  assert.deepEqual(r.skipped, { root: 1, already: 1 });
  assert.equal(G.skipToast("delete", r.skipped), "2 skipped (root, already deleted)");
  assert.equal(r.nodes.find((x) => x.id === "n0").deleted, undefined);
  assert.equal(r.nodes.filter((x) => x.deleted).length, 3);
  // one batch = one undo step
  let h = G.pushStep(G.emptyHistory(), { label: "Delete 2 nodes", before: nodes, after: r.nodes });
  const u = G.undo(h);
  assert.equal(u.state, nodes);
  assert.equal(G.canUndo(u.history), false);
  // hide/show skip states
  const hid = G.batchApply(nodes, ["n0", "n1"], "hide", "n0", 256);
  assert.deepEqual(hid.changed, ["n1"]);
  assert.equal(G.skipToast("hide", hid.skipped), "1 skipped (root)");
  const sh = G.batchApply(hid.nodes, ["n1", "n2"], "show", "n0", 256);
  assert.deepEqual(sh.changed, ["n1"]);
  assert.equal(G.skipToast("show", sh.skipped), "1 skipped (already visible)");
  assert.equal(G.skipToast("show", { root: 0, already: 0 }), null);
});

test("#29 a batch restore over the cap is refused whole (SCENE_NODES_MAX), never partial", () => {
  const nodes = [n("n0"), n("n1"), n("n2", { deleted: true }), n("n3", { deleted: true })];
  const r = G.batchApply(nodes, ["n2", "n3"], "restore", "n0", 3);
  assert.match(r.error, /^SCENE_NODES_MAX: Restore would exceed the 3-node limit$/);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.nodes, nodes);
  const ok = G.batchApply(nodes, ["n2", "n3"], "restore", "n0", 4);
  assert.deepEqual(ok.changed, ["n2", "n3"]);
  assert.equal(ok.nodes.some((x) => x.deleted), false);
  // deleting every live node is refused too (root skipped already guarantees ≥ 1)
  const solo = [n("n0", { deleted: true }), n("n1")];
  assert.match(G.batchApply(solo, ["n1"], "delete", undefined, 9).error, /^SCENE_NO_LIVE_NODES/);
});

test("#29 selection: toggle, Ctrl+A = live only, survives undo/redo (pruned only when a node is gone), centroid + shared move", () => {
  const nodes = [n("n0"), n("n2"), n("n4", { deleted: true })];
  assert.deepEqual(G.selectAllLive(nodes), ["n0", "n2"]);
  assert.deepEqual(G.toggleSel(["n0"], "n2"), ["n0", "n2"]);
  assert.deepEqual(G.toggleSel(["n0", "n2"], "n0"), ["n2"]);
  const sel = ["n0", "n2", "n4"];
  assert.deepEqual(G.pruneSel(sel, nodes), sel, "undo/redo keeps the selection");
  assert.deepEqual(G.pruneSel(sel, nodes.slice(0, 2)), ["n0", "n2"]);
  assert.deepEqual(G.centroid(nodes, sel), [1, 0, 0], "tombstones ignored");
  const moved = G.moveBy(nodes, sel, [1, 2, 3]);
  assert.deepEqual(moved.map((x) => x.transform.position), [[1, 2, 3], [3, 2, 3], [4, 0, 0]]);
  assert.equal(G.selectionLabel(2), "2 selected");
  assert.deepEqual(G.boxSelect([{ id: "a", x: 5, y: 5 }, { id: "b", x: 50, y: 5 }], { x0: 10, y0: 10, x1: 0, y1: 0 }), ["a"]);
});

// ---------------------------------------------------------------- #84
test("#84 ?compare= parse: exactly two distinct ids; malformed / self → inline error", () => {
  assert.equal(G.parseCompare("?asset=x"), null);
  assert.deepEqual(G.parseCompare("?compare=a1,b2"), { ok: true, a: "a1", b: "b2" });
  for (const q of ["?compare=", "?compare=a", "?compare=a,b,c", "?compare=a,", "?compare=../x,b", "?compare=a%2F,b"]) {
    const r = G.parseCompare(q);
    assert.equal(r.ok, false, q);
    assert.match(r.error, /exactly two/);
  }
  assert.match(G.parseCompare("?compare=a,a").error, /two different/);
});

test("#84 diff rows: 8 D1 rows, differing rows flagged (text marker, not colour)", () => {
  const a = { id: "a", slug: "a", stage: "rigged", characterType: "humanoid", license: "CC0-1.0", clips: ["walk", "idle"], clipRequires: { run: ["walk"] }, rig: { boneCount: 20 }, sizeBytes: 2048 };
  const b = { id: "b", slug: "b", stage: "rigged", characterType: "billboard", clips: ["idle", "walk"], sizeBytes: 3 * 1048576 };
  const rows = G.diffRows(a, b, { a: { tris: 100 }, b: { tris: 100, bones: 0 } });
  assert.deepEqual(rows.map((r) => r.key), ["tris", "bones", "clips", "clipRequires", "size", "characterType", "license", "stage"]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.tris.differs, false);
  assert.equal(by.bones.a, "20");
  assert.equal(by.bones.differs, true);
  assert.equal(by.clips.differs, false, "clip order does not matter");
  assert.equal(by.clipRequires.a, "run: walk");
  assert.equal(by.size.a, "2.0 KB");
  assert.equal(by.size.b, "3.0 MB");
  assert.equal(by.license.b, "—");
  assert.equal(by.stage.differs, false);
});

// ---------------------------------------------------------------- #44
test("#44 health view: words + icon, dataRoot → set/unset, tool versions only (no absolute paths)", () => {
  const v = G.healthView({
    bridge: { mode: "vendor", status: "unauthorized", httpStatus: 401 },
    krita: { port: 5577 },
    tools: { blender: { path: "/home/box/tools/blender", version: "5.2.3 LTS" }, krita: null },
    limits: { sceneMaxNodes: 256 },
    share: { baseUrl: null },
    dataRoot: "/workspace/secret/data",
  });
  assert.equal(v.status, "unauthorized");
  assert.equal(v.icon, "⚠");
  assert.equal(v.port, "5577");
  assert.equal(v.dataRoot, "set");
  assert.deepEqual(v.tools, [{ name: "blender", version: "5.2.3 LTS" }, { name: "krita", version: "missing" }]);
  assert.ok(!/\/(home|workspace|tmp)\//.test(JSON.stringify(v)), "no absolute path in the view model");
  assert.equal(G.healthView(null).dataRoot, "unset");
  assert.equal(G.healthView(null).status, "unknown");
});

test("#44 polling: 10 s cadence; 429 honours Retry-After (floor 1 s)", () => {
  assert.equal(G.HEALTH_POLL_MS, 10000);
  assert.equal(G.nextPollMs(200, null), 10000);
  assert.equal(G.nextPollMs(429, "7"), 7000);
  assert.equal(G.nextPollMs(429, "0"), 1000);
  assert.equal(G.nextPollMs(429, "soon"), 10000);
  assert.equal(G.updatedAgo(1000, 11400), "Updated 10s ago");
  assert.equal(G.updatedAgo(null, 1), "Not updated yet");
});

// ---------------------------------------------------------------- D1 §1
test("D1 §1 NIT-F-1 placement: below, flip above, clamp left to [8, iw − w − 8]; < 600px bottom sheet", () => {
  const vp = { width: 1280, height: 800 };
  assert.deepEqual(G.placeOverlay({ left: 100, top: 40, bottom: 60 }, { width: 240, height: 200 }, vp), { left: 100, top: 64, sheet: false });
  assert.equal(G.placeOverlay({ left: 1200, top: 40, bottom: 60 }, { width: 240, height: 200 }, vp).left, 1280 - 240 - 8);
  assert.equal(G.placeOverlay({ left: -50, top: 40, bottom: 60 }, { width: 240, height: 200 }, vp).left, 8);
  assert.equal(G.placeOverlay({ left: 100, top: 700, bottom: 720 }, { width: 240, height: 200 }, vp).top, 700 - 200 - 4);
  const sheet = G.placeOverlay({ left: 100, top: 40, bottom: 60 }, { width: 240, height: 300 }, { width: 390, height: 844 });
  assert.equal(sheet.sheet, true);
  assert.equal(sheet.width, 390 - 16);
  assert.equal(sheet.left, 8);
  assert.ok(sheet.top + 300 <= 844 - 8);
});

// ---------------------------------------------------------------- locks
test("E2 locks: client-only (no new route / code), OpenAPI 0.7.0, exactly 6 SKIP codes, schema 3", () => {
  const openapi = fs.readFileSync(path.join(ROOT, "docs/openapi.yaml"), "utf8");
  assert.match(openapi, /version:\s*["']?0\.7\.0/);
  const guide = fs.readFileSync(path.join(ROOT, "docs/AGENT_GUIDE.md"), "utf8");
  assert.ok(guide.length > 0);
  const rep = fs.readFileSync(path.join(ROOT, "tests/reporters/skip-summary.mjs"), "utf8");
  const skips = new Set(rep.match(/SKIP_[A-Z_]+/g).filter((c) => c !== "SKIP_CODE_MISSING" && c !== "SKIP_CODES"));
  assert.equal(skips.size, 6, [...skips].join(","));
  const src = ["s3gAuthor.ts", "s3gViews.tsx"].map((f) => fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src", f), "utf8")).join("\n");
  // only existing GETs; no mutating fetch from the new views
  assert.ok(!/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(src));
  for (const m of src.matchAll(/fetch\(`?["']?(\/api\/[a-z]+)/g)) assert.ok(["/api/assets", "/api/health", "/api/activity"].includes(m[1]), m[1]);
  const codes = fs.readFileSync(path.join(ROOT, "docs/error-codes.md"), "utf8");
  for (const c of ["SCENE_NODES_MAX", "VALIDATION"]) assert.ok(codes.includes(c));
  const schema = fs.readFileSync(path.join(ROOT, "packages/asset-schema/src/index.ts"), "utf8");
  assert.match(schema, /ASSET_SCHEMA_VERSION\s*=\s*3|assetSchemaVersion.*3/);
});

// ---------------------------------------------------------------- D2 id-less activity kinds
test("D2 activity labels: inbox.sweep / webhook.refused / webhook.failed; unknown id-less kind → raw text; asset rows unchanged", async () => {
  const A = await loadClientTs("apps/world-builder/client/src/s3fActivity.ts");
  const at = "2026-10-31T04:00:00.000Z";
  assert.equal(A.systemActivityLabel({ at, kind: "inbox.sweep", removed: 3, kept: 9 }), "Swept inbox: 3 removed");
  assert.equal(A.systemActivityLabel({ at, kind: "webhook.refused", reason: "redirect" }), "Webhook refused (redirect)");
  assert.equal(A.systemActivityLabel({ at, kind: "webhook.failed" }), "Webhook failed");
  assert.equal(A.systemActivityLabel({ at, kind: "future.kind" }), "future.kind");
  assert.equal(A.systemActivityLabel({ at, kind: "asset.register", id: "x" }), null);
  assert.equal(A.systemActivityLabel({ at, kind: "other.kind", id: "x" }), null, "with an id it stays an asset row (raw verb)");
  assert.equal(A.activityVerb("other.kind"), "other.kind");
});

test("#36 ruling: a reload that replaces the draft resets stack + marker (old snapshots unreachable); an untouched reload keeps history", () => {
  assert.equal(G.reloadKeepsHistory(true, "A", "A"), true, "same scene, draft untouched → keep");
  assert.equal(G.reloadKeepsHistory(true, "A", "B"), false, "server changed → replace + reset");
  assert.equal(G.reloadKeepsHistory(false, "A", "A"), false, "scene switch → reset");
  // after a reset nothing old can be applied and the fresh state is clean
  const h = G.emptyHistory();
  assert.equal(G.undo(h), null);
  assert.equal(G.redo(h), null);
  assert.equal(G.isDirty(h), false);
  assert.equal(h.marker, 0);
});
