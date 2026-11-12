/**
 * S3-I E2 client helpers (apps/world-builder/client/src/s3iE2.ts) — #28 thumbnail crop / fallback
 * initial and #81 marker rules (R1 §7, §10; D1 §5, §8). Pure functions; no browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientTs } from "./helpers/s3d-synth.mjs";

const m = await loadClientTs("apps/world-builder/client/src/s3iE2.ts");

test("#28 squareCrop centres the largest square; sceneInitial / hasPngPreview pick the fallback", () => {
  assert.equal(m.THUMB_SIZE, 256);
  assert.deepEqual(m.squareCrop(1280, 720), { sx: 280, sy: 0, side: 720 });
  assert.deepEqual(m.squareCrop(390, 844), { sx: 0, sy: 227, side: 390 });
  assert.deepEqual(m.squareCrop(256, 256), { sx: 0, sy: 0, side: 256 });
  assert.equal(m.squareCrop(0, 500).side, 0);
  assert.equal(m.sceneInitial("my scene", "x"), "M");
  assert.equal(m.sceneInitial("  #2 hall", "x"), "2");
  assert.equal(m.sceneInitial("", "éclair"), "É");
  assert.equal(m.sceneInitial("—", "—"), "?");
  assert.equal(m.hasPngPreview("assets/a/preview.png"), true);
  assert.equal(m.hasPngPreview("assets/a/PREVIEW.PNG"), true);
  assert.equal(m.hasPngPreview("assets/a/model.glb"), false);
  assert.equal(m.hasPngPreview(undefined), false);
});

test("#81 hint, cap, next name, time clamp, tick position", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ clip: "idle", t: i, name: `Marker ${i + 1}` }));
  assert.equal(m.MARKERS_MAX, 16);
  assert.equal(m.markerHint(0), "0 of 16 markers");
  assert.equal(m.markerHint(16), "16 of 16 markers");
  assert.equal(m.canAddMarker(mk(15), 1000), true);
  assert.equal(m.canAddMarker(mk(16), 1000), false, "Add disabled at the cap");
  assert.equal(m.canAddMarker([], undefined), false, "no probed duration → no Add");
  assert.equal(m.nextMarkerName([]), "Marker 1");
  assert.equal(m.nextMarkerName([{ clip: "idle", t: 0, name: "Marker 1" }, { clip: "idle", t: 0, name: "Marker 3" }]), "Marker 2");
  assert.equal(m.markerTime(0.5, 1001), 501);
  assert.equal(m.markerTime(2, 1000), 1000);
  assert.equal(m.markerTime(-1, 1000), 0);
  assert.equal(m.markerTime(NaN, 1000), 0);
  assert.ok(Number.isInteger(m.markerTime(0.3333, 999)));
  assert.equal(m.markerPct(250, 1000), 25);
  assert.equal(m.markerPct(250, 0), 0);
  assert.equal(m.markerPct(250, undefined), 0);
  assert.equal(m.markerPct(2000, 1000), 100);
});

test("#81 rename rules, per-clip order, cleanMarkers drops malformed entries", () => {
  const list = [
    { clip: "walk", t: 900, name: "b" },
    { clip: "idle", t: 10, name: "a" },
    { clip: "walk", t: 100, name: "c" },
  ];
  assert.equal(m.renameProblem(list, 0, " b "), null, "same name on itself is fine (trimmed)");
  assert.equal(m.renameProblem(list, 0, "a"), "Name already used");
  assert.match(m.renameProblem(list, 0, "   "), /1–40/);
  assert.match(m.renameProblem(list, 0, "x".repeat(41)), /1–40/);
  assert.equal(m.renameProblem(list, 0, "x".repeat(40)), null);
  assert.deepEqual(m.markersForClip(list, "walk").map((x) => [x.m.name, x.i]), [["c", 2], ["b", 0]]);
  assert.deepEqual(m.markersForClip(list, "run"), []);
  assert.deepEqual(m.cleanMarkers(null), []);
  assert.deepEqual(
    m.cleanMarkers([{ clip: "idle", t: 1, name: "ok", junk: 1 }, { clip: "idle", t: 1.5, name: "x" }, null, { clip: 3, t: 1, name: "y" }]),
    [{ clip: "idle", t: 1, name: "ok" }],
  );
});
