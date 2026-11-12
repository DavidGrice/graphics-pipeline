/**
 * S3-I #131 lazy child GLBs (R1 §8, D1 §6, D2): eager cap SCENE_NODES_MAX/4, "Loaded n / total",
 * test ids `lazy-placeholder` / `stats-loaded`, useGLTF under a per-node Suspense. No browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadClientTs } from "./helpers/s3d-synth.mjs";

const m = await loadClientTs("apps/world-builder/client/src/s3iE2.ts");
const APP = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");

test("#131 eager cap is SCENE_NODES_MAX/4; indices at or past it are lazy", () => {
  assert.equal(m.eagerCap(256), 64);
  assert.equal(m.eagerCap(10), 2);
  assert.equal(m.eagerCap(3), 0);
  assert.equal(m.eagerCap(Number.NaN), 0);
  assert.equal(m.isLazyIndex(63, 256), false);
  assert.equal(m.isLazyIndex(64, 256), true);
  assert.equal(m.isLazyIndex(0, 256), false);
});

test("#131 stats copy is \"Loaded n / total\" (n clamped)", () => {
  assert.equal(m.loadedText(0, 0), "Loaded 0 / 0");
  assert.equal(m.loadedText(66, 72), "Loaded 66 / 72");
  assert.equal(m.loadedText(80, 72), "Loaded 72 / 72");
  assert.equal(m.loadedText(-1, 3), "Loaded 0 / 3");
});

test("#131 client wiring: test ids, per-node Suspense with the box as fallback, no API change", () => {
  for (const id of ["lazy-placeholder", "stats-loaded"]) assert.ok(APP.includes(`data-testid="${id}"`), id);
  assert.match(APP, /function LazySceneNode\(/);
  assert.match(APP, /<Suspense fallback=\{box\}>\{children\}<\/Suspense>/);
  assert.match(APP, /isLazyIndex\(nodeIndex, sceneMaxNodes\)/);
  assert.match(APP, /sphereInFrustum\(/);
  assert.ok(!/\/api\/[a-z-/:]*lazy/i.test(APP), "no lazy API route");
});
