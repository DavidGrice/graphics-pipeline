/**
 * S3-G tip1 — CO-1 changelog lane suffixes, CO-2 changelog:verify provenance, CO-3 importMeta
 * `field` + shared fixture, CO-4 scene-ready hook + UI repeat runner (flip fixture → exit 1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ROOT, startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import { makeImportMeta, IMPORTMETA_MINIMAL_PATH } from "./helpers/import-meta.mjs";
import { laneOf } from "../scripts/changelog.mjs";
import { sprintOfSubject, foldSprint, parseChangelog } from "../scripts/changelog-verify.mjs";

const json = { "Content-Type": "application/json" };
const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...opts });
const hasFullHistory = () => {
  const r = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "false";
};
const hasCommit = (sha) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT }).status === 0;

// ---------------------------------------------------------------- CO-1
test("CO-1 laneOf: suffixed lanes map (s3f-e1b, (E2a), E3:, e1); E10 / E4 / ae1 / node22 don't", () => {
  assert.equal(laneOf("feat(s3f-e1b): #128 activity"), "E1");
  assert.equal(laneOf("feat(s3g) (E2a) batch ops"), "E2");
  assert.equal(laneOf("fix E3: flake"), "E3");
  assert.equal(laneOf("feat e1 thing"), "E1");
  assert.equal(laneOf("feat(s3f) E2 1/5: clips"), "E2");
  assert.equal(laneOf("feat E10 something"), "other");
  assert.equal(laneOf("feat E4 something"), "other");
  assert.equal(laneOf("feat ae1 something"), "other");
  assert.equal(laneOf("ci: node22 matrix"), "other");
  assert.equal(laneOf("docs: readme"), "docs");
  assert.equal(laneOf("test: more"), "test");
});

test("CO-1 real history f6a637d..d94d945: every s3f-e1b (tip1b) commit lands in E1, none in other", (t) => {
  if (!hasCommit("f6a637d") || !hasCommit("d94d945")) return t.skip("SKIP_PLATFORM: history not available (shallow clone)");
  const r = node(["scripts/changelog.mjs", "f6a637d..d94d945"]);
  assert.equal(r.status, 0, r.stderr);
  const sec = (g) => (r.stdout.split(`### ${g}\n`)[1] || "").split("\n\n")[0];
  const tip1b = r.stdout.split("\n").filter((l) => /s3f-e1b/.test(l));
  assert.equal(tip1b.length, 4);
  for (const l of tip1b) assert.ok(sec("E1").includes(l), `in E1: ${l}`);
  assert.doesNotMatch(sec("other"), /e1b/);
});

// ---------------------------------------------------------------- CO-2
test("CO-2 helpers: subject tags and folding", () => {
  assert.equal(sprintOfSubject("feat(s3d-e1): API envelope"), "S3-D");
  assert.equal(sprintOfSubject("docs(s3f): sync"), "S3-F");
  assert.equal(sprintOfSubject("feat(s3e) E1 1/6"), "S3-E");
  assert.equal(sprintOfSubject("chore: add world-builder Express API"), null);
  assert.equal(foldSprint("S2-B", ["S2-C", "S2-D"]), "S2-C");
  assert.equal(foldSprint("S3-B", ["S2-C", "S3-A", "S3-C"]), "S3-A");
  const { sections, codeSprint } = parseChangelog(fs.readFileSync(path.join(ROOT, "docs/contract-changelog.md"), "utf8"));
  assert.equal(sections[0], "S2-C");
  assert.equal(codeSprint.get("SLUG_CLASH"), "S3-D");
});

test("CO-2 changelog:verify: the repo doc passes; a seeded wrong sprint → LINT_FAILED exit 1 with {code, docSprint, gitSprint}", (t) => {
  if (!hasFullHistory()) return t.skip("SKIP_PLATFORM: shallow clone (changelog:verify needs full history)");
  const ok = node(["scripts/changelog-verify.mjs"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^OK changelog:verify$/m);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3g-co2-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = fs
    .readFileSync(path.join(ROOT, "docs/contract-changelog.md"), "utf8")
    .replace("`KRITA_UNAUTHORIZED`, ", "")
    .replace("- **Codes:** `MONGO_REQUIRED`", "- **Codes:** `MONGO_REQUIRED`, `KRITA_UNAUTHORIZED`");
  const f = path.join(dir, "contract-changelog.md");
  fs.writeFileSync(f, bad);
  const r = node(["scripts/changelog-verify.mjs", "--doc", f]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const line = r.stderr.split("\n").find((l) => l.includes("KRITA_UNAUTHORIZED"));
  const j = JSON.parse(line);
  assert.deepEqual([j.code, j.docSprint, j.gitSprint], ["KRITA_UNAUTHORIZED", "S2-C", "S3-F"]);
  assert.match(r.stderr, /^LINT_FAILED: changelog:verify/m);
});

test("CO-2 shallow clone → SKIP_PLATFORM exit 0; lint:ci runs changelog:verify", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3g-shallow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = spawnSync("git", ["clone", "-q", "--depth", "1", `file://${ROOT}`, dir], { encoding: "utf8" });
  if (c.status !== 0) return t.skip("SKIP_PLATFORM: cannot make a shallow clone here");
  const r = node([path.join(ROOT, "scripts/changelog-verify.mjs")], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SKIP_PLATFORM: shallow clone/m);
  assert.match(fs.readFileSync(path.join(ROOT, "scripts/lint-ci.mjs"), "utf8"), /changelog-verify\.mjs/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["changelog:verify"], "node scripts/changelog-verify.mjs");
});

// ---------------------------------------------------------------- CO-3
test("CO-3 fixture importmeta-minimal.json passes ImportMetaSchema; makeImportMeta merges + drops undefined", () => {
  const req = createRequire(path.join(ROOT, "/"));
  const { ImportMetaSchema } = req("./packages/asset-schema/dist/index.js");
  const fx = JSON.parse(fs.readFileSync(IMPORTMETA_MINIMAL_PATH, "utf8"));
  assert.deepEqual(fx, { source: "unknown" });
  assert.ok(ImportMetaSchema.safeParse(fx).success);
  assert.deepEqual(makeImportMeta({ sourceKra: "a.kra" }), { source: "unknown", sourceKra: "a.kra" });
  assert.deepEqual(makeImportMeta({ source: undefined }), {});
});

test("CO-3 importMeta 400s name the first failing field (POST + PATCH), no value echo", async () => {
  const api = await startApi();
  const post = (b) => fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
  const patch = (id, b) => fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
  try {
    const cases = [
      ["missing source", makeImportMeta({ source: undefined }), "importMeta.source"],
      ["bad enum", makeImportMeta({ source: "zzsecretzz" }), "importMeta.source"],
      ["bad sourceKra", makeImportMeta({ sourceKra: "dir/zzsecretzz.kra" }), "importMeta.sourceKra"],
    ];
    for (const [label, im, field] of cases) {
      const r = await post({ ...billboardBody(runId("co3"), `co3-${label.replace(/ /g, "-")}`), importMeta: im });
      assert.equal(r.status, 400, label);
      const j = await r.json();
      assert.equal(j.code, "VALIDATION", label);
      assert.equal(j.field, field, label);
      assert.ok(j.error.startsWith(`${field}: `), `${label}: ${j.error}`);
      assert.ok(!JSON.stringify(j).includes("zzsecretzz"), `${label}: value never echoed`);
    }
    const b = { ...billboardBody(runId("co3ok"), "co3-ok"), importMeta: makeImportMeta() };
    assert.equal((await post(b)).status, 201);
    const p1 = await patch(b.id, { importMeta: "nope" });
    assert.equal(p1.status, 400);
    assert.equal((await p1.json()).field, "importMeta");
    const p2 = await patch(b.id, { importMeta: { source: "zzsecretzz" } });
    const j2 = await p2.json();
    assert.equal(p2.status, 400);
    assert.equal(j2.field, "importMeta.source");
    assert.ok(!JSON.stringify(j2).includes("zzsecretzz"));
  } finally {
    await api.stop();
  }
});

// ---------------------------------------------------------------- CO-4
test("CO-4 test:ui:repeat: a deliberate flip fixture → exit 1 with a flip table; stable → exit 0", () => {
  const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s3g-flip-")), "n");
  const env = { ...process.env, FLIP_STATE: state, UI_REPEAT_FILES: "tests/fixtures/flip-fixture.test.mjs" };
  const r = node(["scripts/ui-repeat.mjs", "2"], { env });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\| flip fixture \| pass \| fail \| FLIP \|/);
  assert.match(r.stdout, /\| steady fixture \| pass \| pass \| ok \|/);
  fs.writeFileSync(state, "0");
  const one = node(["scripts/ui-repeat.mjs", "1"], { env });
  assert.equal(one.status, 0, one.stdout);
  assert.equal(node(["scripts/ui-repeat.mjs", "0"], { env }).status, 2);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:ui:repeat"], "node scripts/ui-repeat.mjs");
});

test("CO-4 wiring: client data-scene-ready hook, s3e-ui-scene waits on it, CI ui-repeat job (Node 24, 2 runs)", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  assert.match(app, /data-scene-ready=\{/);
  assert.match(app, /function FirstFrame/);
  const ui = fs.readFileSync(path.join(ROOT, "tests/s3e-ui-scene.test.mjs"), "utf8");
  assert.match(ui, /data-scene-ready"\) === "1"/);
  assert.match(ui, /timeout: 15000/);
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const job = ci.split("\n  ui-repeat:\n")[1]?.split("\n  # ")[0] || "";
  assert.match(job, /node-version: "24"/);
  assert.match(job, /npm run test:ui:repeat -- 2/);
});
