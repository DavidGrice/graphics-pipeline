/**
 * S3-H E1 #146 — backup / restore round-trip, refuse tamper / path escape / non-empty without --force.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers/s3d-synth.mjs";

const node = (script, args, env = {}) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

function seedData(dir) {
  fs.mkdirSync(path.join(dir, "assets", "a1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "a1", "model.glb"), Buffer.from("glb-bytes"));
  fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scenes", "s.json"), '{"ok":1}');
  fs.writeFileSync(path.join(dir, "activity.jsonl"), '{"at":"t","kind":"asset.register","id":"a1"}\n');
}

test("#146 round-trip is byte-identical", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-data-"));
  const bak = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-out-"));
  const restored = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-rest-"));
  seedData(data);
  const b = node("backup.mjs", [bak], { WB_DATA_ROOT: data });
  assert.equal(b.status, 0, b.stderr + b.stdout);
  assert.ok(fs.existsSync(path.join(bak, "manifest.json")));
  const man = JSON.parse(fs.readFileSync(path.join(bak, "manifest.json"), "utf8"));
  assert.equal(man.version, 1);
  assert.ok(man.files.every((f) => !path.isAbsolute(f.path) && !f.path.includes("..")));

  const r = node("restore.mjs", [bak], { WB_DATA_ROOT: restored });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(
    fs.readFileSync(path.join(data, "assets/a1/model.glb")).equals(fs.readFileSync(path.join(restored, "assets/a1/model.glb"))),
    true,
  );
  assert.equal(fs.readFileSync(path.join(restored, "activity.jsonl"), "utf8"), fs.readFileSync(path.join(data, "activity.jsonl"), "utf8"));
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(bak, { recursive: true, force: true });
  fs.rmSync(restored, { recursive: true, force: true });
});

test("#146 tampered file refused; ../ path refused; non-empty without --force refused", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-data-"));
  const bak = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-out-"));
  seedData(data);
  assert.equal(node("backup.mjs", [bak], { WB_DATA_ROOT: data }).status, 0);

  // tamper
  const manPath = path.join(bak, "manifest.json");
  const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
  fs.writeFileSync(path.join(bak, man.files[0].path), Buffer.from("TAMPERED"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-tgt-"));
  const tamper = node("restore.mjs", [bak], { WB_DATA_ROOT: target });
  assert.equal(tamper.status, 2);
  assert.match(tamper.stderr, /CONFIG_INVALID/);
  assert.equal(fs.readdirSync(target).length, 0, "nothing written on tamper");

  // restore good backup into non-empty without --force
  fs.writeFileSync(path.join(bak, man.files[0].path), Buffer.from("glb-bytes")); // undo tamper... hash won't match original if we changed bytes back without fixing - re-backup
  fs.rmSync(bak, { recursive: true, force: true });
  fs.mkdirSync(bak);
  assert.equal(node("backup.mjs", [bak], { WB_DATA_ROOT: data }).status, 0);
  const occupied = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-occ-"));
  fs.writeFileSync(path.join(occupied, "keep.txt"), "x");
  const noforce = node("restore.mjs", [bak], { WB_DATA_ROOT: occupied });
  assert.equal(noforce.status, 2);
  assert.match(noforce.stderr, /CONFIG_INVALID/);
  assert.ok(fs.existsSync(path.join(occupied, "keep.txt")));

  // path escape in manifest
  const man2 = JSON.parse(fs.readFileSync(path.join(bak, "manifest.json"), "utf8"));
  man2.files.push({ path: "../etc/passwd", sha256: "a".repeat(64), bytes: 1 });
  fs.writeFileSync(path.join(bak, "manifest.json"), JSON.stringify(man2));
  const esc = node("restore.mjs", [bak, "--force"], { WB_DATA_ROOT: target });
  assert.equal(esc.status, 2);
  assert.match(esc.stderr, /CONFIG_INVALID/);

  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(bak, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(occupied, { recursive: true, force: true });
});

test("#146 never follows symlinks; npm scripts exist", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-sym-"));
  const bak = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-bk-symo-"));
  seedData(data);
  const outside = path.join(os.tmpdir(), `s3h-outside-${process.pid}`);
  fs.writeFileSync(outside, "secret");
  try {
    fs.symlinkSync(outside, path.join(data, "assets", "link.glb"));
  } catch (e) {
    // some FS may refuse; still check scripts
  }
  const b = node("backup.mjs", [bak], { WB_DATA_ROOT: data });
  assert.equal(b.status, 0, b.stderr);
  const man = JSON.parse(fs.readFileSync(path.join(bak, "manifest.json"), "utf8"));
  assert.ok(!man.files.some((f) => f.path.includes("link.glb")));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts.backup, "node scripts/backup.mjs");
  assert.equal(pkg.scripts.restore, "node scripts/restore.mjs");
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(bak, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
});
