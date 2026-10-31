/**
 * S3-F tip1 carry-overs.
 *  CO-1 (NIT-E2-1) — scene node booleans are strict: `deleted` / `visible` that are not real booleans
 *             ("true", 1, 0, "false", null, {}) → 400 VALIDATION on POST and PATCH, never coerced or
 *             silently dropped (a tombstone can't be revived by a junk value); body `{code, error, field: "nodes[i].<flag>"}`. Only `deleted: false`
 *             is still normalised to absent (S3-E contract).
 *  CO-2 — GITLEAKS_BIN set but missing / not a file / not executable → SECRETS_SCAN_FAILED exit 2;
 *             ACTIONLINT_BIN / SHELLCHECK_BIN the same → CONFIG_INVALID exit 2 (lint:ci); only "unset and not
 *             on PATH" is SKIP_PLATFORM. Messages name the variable, never the path.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";

let api;
const child = runId("s3f-child");
const json = { "Content-Type": "application/json" };
const post = (b) => fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const patch = (id, b) => fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
const get = async (id) => (await fetch(`${api.url}/api/assets/${id}`)).json();
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const nd = (i, extra = {}) => ({ id: `n${i}`, assetId: child, transform: tf(i), ...extra });
const sceneBody = (id, slug, nodes) => ({
  ...billboardBody(id, slug),
  characterType: "unknown",
  stage: "scene",
  scene: { version: 1, rootId: nodes[0].id, nodes },
});
const JUNK = [["string true", "true"], ["string false", "false"], ["number 1", 1], ["number 0", 0], ["null", null], ["object", {}]];

before(async () => {
  api = await startApi();
  const r = await post(billboardBody(child, "s3f-child"));
  assert.equal(r.status, 201, await r.text());
});
after(async () => api && (await api.stop()));

async function expectValidation(res, flag) {
  assert.equal(res.status, 400);
  const b = await res.json();
  assert.equal(b.code, "VALIDATION", JSON.stringify(b));
  assert.equal(b.field, `nodes[1].${flag}`, JSON.stringify(b));
  assert.equal(b.error, `nodes[1].${flag} must be a boolean (true or false)`);
  assert.doesNotMatch(JSON.stringify(b), /(^|[\s'"])\/(home|workspace|tmp)\//, "no absolute paths");
}

test("CO-1 POST: non-boolean deleted / visible → 400 VALIDATION naming the field; nothing stored", async () => {
  for (const field of ["deleted", "visible"]) {
    for (const [label, v] of JUNK) {
      const id = runId(`s3f-post-${field}`);
      const res = await post(sceneBody(id, `s3f-post-${field}-${label.replace(/\s/g, "-")}-${process.pid}`, [nd(0), nd(1, { [field]: v })]));
      await expectValidation(res, field);
      assert.equal((await fetch(`${api.url}/api/assets/${id}`)).status, 404, `${field}=${label} not stored`);
    }
  }
});

test("CO-1 PATCH: junk deleted can't revive a tombstone (400, stored node stays deleted); real booleans still work", async () => {
  const id = runId("s3f-patch");
  const r = await post(sceneBody(id, `s3f-patch-${process.pid}`, [nd(0), nd(1, { deleted: true, visible: false })]));
  assert.equal(r.status, 201, await r.text());
  const base = (await get(id)).scene;
  for (const field of ["deleted", "visible"]) {
    for (const [, v] of JUNK) {
      const nodes = base.nodes.map((n) => (n.id === "n1" ? { ...n, [field]: v } : n));
      await expectValidation(await patch(id, { scene: { ...base, nodes } }), field);
    }
  }
  const after1 = (await get(id)).scene.nodes.find((n) => n.id === "n1");
  assert.equal(after1.deleted, true, "still a tombstone");
  assert.equal(after1.visible, false);
  // contract kept: deleted:false → normalised away (restore), visible true/false accepted
  const restored = base.nodes.map((n) => (n.id === "n1" ? { ...n, deleted: false, visible: true } : n));
  const ok = await patch(id, { scene: { ...base, nodes: restored } });
  assert.equal(ok.status, 200, await ok.text());
  const n1 = (await get(id)).scene.nodes.find((n) => n.id === "n1");
  assert.equal(Object.prototype.hasOwnProperty.call(n1, "deleted"), false, "deleted:false stripped");
  assert.equal(n1.visible, true);
  await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" });
});

// ---------------------------------------------------------------- GITLEAKS_BIN
const scan = (env) => {
  const e = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
  return spawnSync(process.execPath, [path.join(ROOT, "scripts/scan-secrets.mjs"), ROOT], { cwd: ROOT, encoding: "utf8", env: e });
};

test("CO-2 GITLEAKS_BIN missing / directory / not executable → SECRETS_SCAN_FAILED exit 2 (value never echoed)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3f-gl-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const noexec = path.join(dir, "gitleaks-noexec");
  fs.writeFileSync(noexec, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  const cases = [
    ["missing", path.join(dir, "nope", "gitleaks"), /GITLEAKS_BIN does not exist/],
    ["directory", dir, /GITLEAKS_BIN is not a file/],
  ];
  // POSIX only: Windows has no execute bit
  if (process.platform !== "win32" && process.getuid?.() !== 0) cases.push(["not executable", noexec, /GITLEAKS_BIN is not executable/]);
  for (const [label, bin, re] of cases) {
    const r = scan({ GITLEAKS_BIN: bin });
    assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^ERROR SECRETS_SCAN_FAILED: /m, label);
    assert.match(r.stderr, re, label);
    assert.doesNotMatch(r.stdout, /SKIP_PLATFORM|OK scan:secrets/, label);
    assert.ok(!(r.stdout + r.stderr).includes(dir), `${label}: path not echoed`);
  }
});

test("CO-2 only GITLEAKS_BIN unset (or empty) + no gitleaks on PATH → SKIP_PLATFORM exit 0", () => {
  const PATH = path.dirname(process.execPath); // node only, no gitleaks
  for (const env of [{ GITLEAKS_BIN: undefined, PATH }, { GITLEAKS_BIN: "", PATH }]) {
    const r = scan(env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^SKIP_PLATFORM: gitleaks not on PATH/m);
    assert.equal(r.stderr, "");
  }
});

test("CO-2 ACTIONLINT_BIN / SHELLCHECK_BIN set but bad → CONFIG_INVALID exit 2 before any lint (path never echoed)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3f-lb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const noexec = path.join(dir, "tool-noexec");
  fs.writeFileSync(noexec, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  const cases = [
    ["missing", path.join(dir, "nope"), "does not exist"],
    ["directory", dir, "is not a file"],
  ];
  if (process.platform !== "win32" && process.getuid?.() !== 0) cases.push(["not executable", noexec, "is not executable"]);
  for (const v of ["ACTIONLINT_BIN", "SHELLCHECK_BIN"]) {
    for (const [label, bin, why] of cases) {
      const env = { ...process.env };
      delete env.ACTIONLINT_BIN;
      delete env.SHELLCHECK_BIN;
      env[v] = bin;
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/lint-ci.mjs")], { cwd: ROOT, encoding: "utf8", env });
      assert.equal(r.status, 2, `${v} ${label}: ${r.stdout}${r.stderr}`);
      assert.equal(r.stderr.trim(), `ERROR CONFIG_INVALID: ${v} ${why}`);
      assert.equal(r.stdout, "", "nothing linted, no SKIP/OK lines");
      assert.ok(!r.stderr.includes(dir));
    }
  }
});
