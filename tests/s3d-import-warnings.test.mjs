/**
 * S3-D E1 — #49 PNG_ALPHA_PREMULT_SUSPECT and #97 IDLE_TPOSE_SUSPECT (R1 rev2 §4/§5).
 * Warn-only → importMeta.warnings[]; a T-pose idle leaves the idle slot, so a humanoid whose
 * only idle is the T-pose fails the existing S2-D humanoid gate. Synthetic PNG/GLB bytes are
 * generated in tmpdirs (no media in git); the private API's assets are DELETEd in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, startApi, makePng, makeRiggedGlb } from "./helpers/s3d-synth.mjs";
import {
  analyzeAlpha,
  decodePng,
  premultWarningForPng,
  PNG_ALPHA_PREMULT_SUSPECT,
  PREMULT_MIN_SEMI,
  PREMULT_MIN_RATIO,
} from "../apps/blender-pipeline/png_alpha.mjs";
import {
  probeGlb,
  clipMotion,
  quatAngleDeg,
  IDLE_TPOSE_SUSPECT,
  IDLE_MAX_ROT_DEG,
  IDLE_MAX_POS,
} from "../apps/blender-pipeline/probe_glb.mjs";
import { safeParseAsset } from "@graphics-pipeline/asset-schema";

const REGISTER = path.join(ROOT, "apps/blender-pipeline/register_asset.mjs");
let api;
let tmp;
const registered = new Set();

before(async () => {
  api = await startApi();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s3d-warn-"));
});
after(async () => {
  for (const id of registered) {
    const r = await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" });
    assert.ok([204, 404].includes(r.status), `cleanup DELETE ${id} → ${r.status}`);
  }
  const left = await (await fetch(`${api.url}/api/assets`)).json();
  assert.equal(left.length, 0, "s3d warning tests left assets behind");
  await api.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** n semi-transparent pixels (a=128) of which `premult` have rgb ≤ a; the rest opaque. */
function semiPng(n, premult, w = 32) {
  const h = Math.ceil(Math.max(n, 1) / w) + 1;
  return makePng(w, h, (x, y) => {
    const i = y * w + x;
    if (i >= n) return [200, 50, 50, 255];
    return i < premult ? [100, 60, 20, 128] : [250, 200, 180, 128];
  });
}
function writeTmp(name, buf) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, buf);
  return f;
}
function register(args, env = {}) {
  const id = `5d3d0001-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  const r = spawnSync(process.execPath, [REGISTER, "--id", id, "--api", api.url, ...args], {
    env: { ...process.env, WB_DATA_ROOT: api.dataRoot, ...env },
    encoding: "utf8",
  });
  if (r.status === 0) registered.add(id);
  return { ...r, id };
}

test("#49 thresholds are R1 rev2 fixed values (64 semi px, 99%)", () => {
  assert.equal(PNG_ALPHA_PREMULT_SUSPECT, "PNG_ALPHA_PREMULT_SUSPECT");
  assert.equal(PREMULT_MIN_SEMI, 64);
  assert.equal(PREMULT_MIN_RATIO, 0.99);
});

test("#49 decoder round-trips filtered RGBA rows", () => {
  const png = makePng(5, 4, (x, y) => [x * 40, y * 50, (x + y) * 10, 255 - x]);
  const d = decodePng(png);
  assert.equal(d.width, 5);
  assert.equal(d.height, 4);
  assert.deepEqual([...d.rgba.slice(4 * 7, 4 * 8)], [80, 50, 30, 253]); // (x=2,y=1) — Sub-filtered row
});

test("#49 premultiplied suspicion: boundary at 64 semi px and 99%", () => {
  const f = (n, p) => analyzeAlpha(decodePng(semiPng(n, p)).rgba);
  assert.equal(f(64, 64).suspect, true, "64 semi, 100% → suspect");
  assert.equal(f(63, 63).suspect, false, "63 semi → below sample floor, no check");
  assert.equal(f(63, 63).checked, false);
  assert.equal(f(100, 99).suspect, true, "99% → suspect");
  assert.equal(f(100, 98).suspect, false, "98% → straight alpha");
  assert.equal(f(200, 0).suspect, false, "straight alpha → no warning");
  assert.equal(f(0, 0).suspect, false, "opaque art → no warning");
  // deterministic
  assert.deepEqual(f(100, 99), f(100, 99));
  const w = premultWarningForPng(writeTmp("p.png", semiPng(100, 100)));
  assert.equal(w.code, "PNG_ALPHA_PREMULT_SUSPECT");
  assert.deepEqual(w.detail, { semiCount: 100, ratio: 1 });
  assert.equal(premultWarningForPng(writeTmp("s.png", semiPng(100, 0))), null);
  assert.equal(premultWarningForPng(writeTmp("junk.png", Buffer.from("not a png"))), null, "unreadable → null, never throws");
});

test("#97 thresholds + synthetic static (0°) vs 1° vs 0.4° idle", () => {
  assert.equal(IDLE_TPOSE_SUSPECT, "IDLE_TPOSE_SUSPECT");
  assert.equal(IDLE_MAX_ROT_DEG, 0.5);
  assert.equal(IDLE_MAX_POS, 1e-4);
  assert.ok(Math.abs(quatAngleDeg([0, 0, 0, 1], [0, Math.sin(Math.PI / 360), 0, Math.cos(Math.PI / 360)]) - 1) < 1e-6);
  const p0 = probeGlb(writeTmp("i0.glb", makeRiggedGlb({ clips: { idle: 0, walk: 10, run: 10 } })));
  assert.equal(p0.clipMotion.idle.static, true);
  assert.equal(p0.clipMotion.walk.static, false);
  const p1 = probeGlb(writeTmp("i1.glb", makeRiggedGlb({ clips: { idle: 1, walk: 10, run: 10 } })));
  assert.equal(p1.clipMotion.idle.static, false, "1° idle is motion");
  assert.equal(p1.clipMotion.idle.maxRotDeg, 1);
  const p04 = probeGlb(writeTmp("i04.glb", makeRiggedGlb({ clips: { idle: 0.4, walk: 10, run: 10 } })));
  assert.equal(p04.clipMotion.idle.static, true, "0.4° < 0.5° → static");
  // unknown/unreadable motion is never reported as static
  assert.equal(clipMotion({ animations: [{ name: "idle", samplers: [{ output: 9 }], channels: [{ sampler: 0, target: { path: "rotation" } }] }] }, Buffer.alloc(0), "idle"), null);
});

test("#49 + #97 register (prop): warnings recorded, still 201, T-pose idle leaves the default slot", async () => {
  const glb = writeTmp("prop-tpose.glb", makeRiggedGlb({ clips: { idle: 0, walk: 10, run: 10 } }));
  const png = writeTmp("prop.png", semiPng(128, 128));
  const r = register(["--slug", "s3d-prop-tpose", "--glb", glb, "--preview", png]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARN IDLE_TPOSE_SUSPECT/);
  assert.match(r.stderr, /WARN PNG_ALPHA_PREMULT_SUSPECT/);
  const doc = await (await fetch(`${api.url}/api/assets/${r.id}`)).json();
  assert.equal(doc.stage, "rigged");
  assert.equal(doc.characterType, "prop");
  assert.deepEqual(doc.clips, ["idle", "walk", "run"], "T-pose clip stays in clips (probe wins)");
  const codes = doc.importMeta.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ["IDLE_TPOSE_SUSPECT", "PNG_ALPHA_PREMULT_SUSPECT"]);
  const tw = doc.importMeta.warnings.find((w) => w.code === "IDLE_TPOSE_SUSPECT");
  assert.equal(tw.clip, "idle");
  assert.equal(doc.clipUx?.defaultClip, "walk", "default slot skips the T-pose idle");
  assert.equal(doc.assetSchemaVersion, 3, "no schema bump");
});

test("#97 control: moving idle + straight-alpha PNG → no warnings, no importMeta added", async () => {
  const glb = writeTmp("prop-ok.glb", makeRiggedGlb({ clips: { idle: 3, walk: 10, run: 10 } }));
  const png = writeTmp("ok.png", semiPng(128, 0));
  const r = register(["--slug", "s3d-prop-ok", "--glb", glb, "--preview", png]);
  assert.equal(r.status, 0, r.stderr);
  const doc = await (await fetch(`${api.url}/api/assets/${r.id}`)).json();
  assert.equal(doc.importMeta, undefined);
  assert.equal(doc.clipUx, undefined);
});

test("#97 humanoid whose only idle is the T-pose → existing humanoid gate fails (CLI + API)", async () => {
  const meta = writeTmp("mixamo.json", JSON.stringify({ source: "mixamo", boneMapStub: "mixamo", actionMap: { "Armature|Idle": "idle" } }));
  const tpose = writeTmp("hum-tpose.glb", makeRiggedGlb({ bones: 8, clips: { idle: 0, walk: 10, run: 10 } }));
  const bad = register(["--slug", "s3d-hum-tpose", "--glb", tpose, "--import-meta", meta]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /characterType "humanoid" requires clips idle and walk/);
  assert.match(bad.stderr, /IDLE_TPOSE_SUSPECT/);
  assert.equal((await fetch(`${api.url}/api/assets/${bad.id}`)).status, 404, "nothing registered");
  assert.ok(!fs.existsSync(path.join(api.dataRoot, "assets", bad.id)), "no GLB copied on reject");

  // control: same humanoid with a moving idle registers as humanoid
  const moving = writeTmp("hum-ok.glb", makeRiggedGlb({ bones: 8, clips: { idle: 2, walk: 10, run: 10 } }));
  const ok = register(["--slug", "s3d-hum-ok", "--glb", moving, "--import-meta", meta]);
  assert.equal(ok.status, 0, ok.stderr);
  const doc = await (await fetch(`${api.url}/api/assets/${ok.id}`)).json();
  assert.equal(doc.characterType, "humanoid");

  // API/schema side: a humanoid POST carrying IDLE_TPOSE_SUSPECT on idle hits the same gate
  const hand = {
    ...doc,
    id: "5d3d0001-0000-4000-8000-00000000beef",
    slug: "s3d-hum-hand",
    importMeta: { ...doc.importMeta, warnings: [{ code: "IDLE_TPOSE_SUSPECT", clip: "idle" }] },
  };
  const r = await fetch(`${api.url}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hand),
  });
  const j = await r.json();
  if (r.status === 201) registered.add(hand.id);
  assert.equal(r.status, 400);
  assert.equal(j.code, "VALIDATION");
  assert.match(j.error, /characterType "humanoid" requires clips idle and walk/);
  const parsed = safeParseAsset(hand);
  assert.equal(parsed.success, false);
  // a warning on a non-idle clip does not empty the slot
  assert.equal(safeParseAsset({ ...hand, importMeta: { ...hand.importMeta, warnings: [{ code: "IDLE_TPOSE_SUSPECT", clip: "walk" }] } }).success, true);
});
