/**
 * S3-E E3 — #144 scan:secrets (gitleaks; SECRETS_FOUND exit 1; tests/fixtures/** allowlisted; missing →
 * SKIP_PLATFORM), #107 lint:ci (actionlint + shellcheck; LINT_FAILED exit 1; missing → SKIP_PLATFORM),
 * #99 Node 22/24 matrix + .nvmrc 24 + engines >=22, #122 changelog (lanes, CHANGELOG_RANGE exit 2),
 * unused `cors` dependency removed. Tool-backed cases skip with SKIP_PLATFORM when the tool is absent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers/s3d-synth.mjs";
import { resolveTool } from "../scripts/tool-bin.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const node = (script, args, opts = {}) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: "utf8", ...opts, env: { ...process.env, ...(opts.env || {}) } });
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
};
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-e3-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  return dir;
}
const commitFile = (dir, rel, body, msg) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
  git(dir, "add", rel);
  git(dir, "commit", "-q", "-m", msg);
  return git(dir, "rev-parse", "--short=7", "HEAD");
};
// assembled at runtime so this file never contains a scannable token
const FAKE_PAT = ["gh", "p_", "R7tQ2vX9mK4pL8sW3nB6yH1cJ5dF0gZaUeIo"].join("");

// ---------- #144 scan:secrets ----------
test("#144 scan:secrets: GITLEAKS_BIN unset + no gitleaks on PATH → SKIP_PLATFORM line, exit 0", () => {
  // S3-F tip1: a bad explicit GITLEAKS_BIN is SECRETS_SCAN_FAILED (tests/s3f-tip1.test.mjs); only this case skips
  const env = { ...process.env, PATH: path.dirname(process.execPath) };
  delete env.GITLEAKS_BIN;
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/scan-secrets.mjs")], { cwd: ROOT, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SKIP_PLATFORM: gitleaks not on PATH/m);
});

test("#144 scan:secrets: planted fake secret → SECRETS_FOUND exit 1 (redacted); same token under tests/fixtures/ → clean", (t) => {
  const bin = resolveTool("gitleaks", process.env.GITLEAKS_BIN);
  if (!bin) return t.skip("SKIP_PLATFORM: gitleaks not on PATH");
  const bad = tempRepo(t);
  commitFile(bad, "README.md", "hello\n", "init");
  const sha = commitFile(bad, "src/config.js", `export const token = "${FAKE_PAT}";\n`, "add config");
  const r = node("scripts/scan-secrets.mjs", [bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^ERROR SECRETS_FOUND: 1 finding\(s\)/m);
  assert.match(r.stderr, new RegExp(`github-pat src/config\\.js:1 commit ${sha}`));
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_PAT), "secret never echoed");

  const ok = tempRepo(t);
  commitFile(ok, "tests/fixtures/fake-token.txt", `${FAKE_PAT}\n`, "fixture");
  const r2 = node("scripts/scan-secrets.mjs", [ok]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /OK scan:secrets/);
});

test("#144 scan:secrets: gitleaks failing (exit ≠ 0/1) → SECRETS_SCAN_FAILED exit 2, never 'clean'", (t) => {
  if (process.platform === "win32") return t.skip("SKIP_PLATFORM: needs an executable sh stub");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-gl-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stub = path.join(dir, "gitleaks");
  fs.writeFileSync(stub, "#!/bin/sh\nexit 126\n", { mode: 0o755 });
  const r = node("scripts/scan-secrets.mjs", [ROOT], { env: { GITLEAKS_BIN: stub } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^ERROR SECRETS_SCAN_FAILED: gitleaks exited 126/m);
  assert.doesNotMatch(r.stdout, /OK scan:secrets/);
});

test("#144 .gitleaks.toml: default rules, only tests/fixtures/** allowlisted (no regex allowlists)", () => {
  const cfg = read(".gitleaks.toml");
  assert.match(cfg, /useDefault\s*=\s*true/);
  const paths = [...cfg.matchAll(/'''([^']+)'''/g)].map((m) => m[1]);
  assert.deepEqual(paths, ["^tests/fixtures/"]);
  assert.doesNotMatch(cfg, /^\s*regexes\s*=/m);
});

// ---------- #107 lint:ci ----------
test("#107 lint:ci: tools unset + not on PATH → two SKIP_PLATFORM lines, exit 0", (t) => {
  // S3-F CO-2: a set-but-bad ACTIONLINT_BIN / SHELLCHECK_BIN is CONFIG_INVALID (tests/s3f-tip1.test.mjs);
  // only unset + absent skips. PATH = node + a dir holding just `git`.
  const gitBin = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).stdout.split(/\r?\n/)[0].trim();
  if (!gitBin || process.platform === "win32") return t.skip("SKIP_PLATFORM: needs git on PATH and symlinks");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-gitonly-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.symlinkSync(gitBin, path.join(dir, "git"));
  const env = { ...process.env, PATH: [path.dirname(process.execPath), dir].join(path.delimiter) };
  delete env.ACTIONLINT_BIN;
  delete env.SHELLCHECK_BIN;
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/lint-ci.mjs")], { cwd: ROOT, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SKIP_PLATFORM: actionlint not on PATH/m);
  assert.match(r.stdout, /^SKIP_PLATFORM: shellcheck not on PATH/m);
});

test("#107 lint:ci: repo is clean; planted bad workflow + bad .sh → LINT_FAILED exit 1 for both", (t) => {
  const al = resolveTool("actionlint", process.env.ACTIONLINT_BIN);
  const sc = resolveTool("shellcheck", process.env.SHELLCHECK_BIN);
  if (!al || !sc) return t.skip("SKIP_PLATFORM: actionlint/shellcheck not on PATH");
  const clean = node("scripts/lint-ci.mjs", [], { cwd: ROOT });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /OK actionlint/);
  assert.match(clean.stdout, /OK shellcheck/);

  const dir = tempRepo(t);
  fs.mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".github/workflows/ci.yml"),
    'on: pull_request\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ github.head_ref }}"\n',
  );
  fs.writeFileSync(path.join(dir, "bad.sh"), "#!/usr/bin/env bash\nUNUSED=1\n");
  git(dir, "add", ".");
  const r = node("scripts/lint-ci.mjs", [], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR LINT_FAILED: actionlint exited 1/m);
  assert.match(r.stderr, /^ERROR LINT_FAILED: shellcheck exited 1/m);
  assert.match(r.stdout + r.stderr, /SC2034/);
});

test("#107 static: workflow passes head_ref via env, shell fixes in place", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.doesNotMatch(ci, /run:[^\n]*\n(?:[^\n]*\n)*?[^\n]*"\$\{\{ github\.head_ref \}\}"/, "head_ref not inlined in a script");
  assert.match(ci, /HEAD_REF: \$\{\{ github\.head_ref \}\}/);
  assert.match(ci, /npm run lint:ci/);
  assert.match(ci, /npm run scan:secrets/);
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /sha256sum -c/);
  assert.doesNotMatch(read("apps/blender-pipeline/run_mvp.sh"), /ls -1t/);
});

// ---------- #99 Node matrix ----------
test("#99 Node 22 + 24 matrix, .nvmrc 24, engines >=22, Blender smoke single-Node via .nvmrc", () => {
  const ci = read(".github/workflows/ci.yml");
  const bt = ci.slice(ci.indexOf("  build-test:"), ci.indexOf("\n  lint-secrets:"));
  assert.match(bt, /node: \["22", "24"\]/);
  assert.match(bt, /fail-fast: false/);
  assert.match(bt, /node-version: \$\{\{ matrix\.node \}\}/);
  for (const step of ["npm run typecheck", "npm run test:s1", "npm run build -w @graphics-pipeline/world-builder-client"]) assert.ok(bt.includes(step), step);
  const smoke = ci.slice(ci.indexOf("  blender-smoke:"));
  assert.doesNotMatch(smoke, /matrix\.node/);
  assert.match(smoke, /node-version-file: "\.nvmrc"/);
  assert.equal(read(".nvmrc").trim(), "24");
  assert.equal(JSON.parse(read("package.json")).engines.node, ">=22");
  assert.equal(JSON.parse(read("package-lock.json")).packages[""].engines.node, ">=22");
  const major = Number(process.versions.node.split(".")[0]);
  assert.ok(major >= 22, `running on Node ${process.versions.node}`);
});

// ---------- #122 changelog ----------
test("#122 changelog: lanes E1/E2/E3/docs/test/other, short SHA + subject, oldest first, merges excluded", (t) => {
  const dir = tempRepo(t);
  const base = commitFile(dir, "a", "0", "chore: base");
  const s = {};
  s.e1 = commitFile(dir, "a", "1", "feat(s3e) E1 1/2: rate limit");
  s.docs = commitFile(dir, "b", "1", "docs(s3e): brief");
  s.e2 = commitFile(dir, "a", "2", "fix(s3e) E2: tombstones");
  s.test = commitFile(dir, "c", "1", "test(s3d): regress");
  s.e3 = commitFile(dir, "a", "3", "test(s3e) E3 4/4: ci suite");
  s.other = commitFile(dir, "d", "1", "chore: bump E10 thing");
  git(dir, "checkout", "-q", "-b", "side", base);
  commitFile(dir, "z", "1", "side work");
  git(dir, "checkout", "-q", "main");
  git(dir, "merge", "-q", "--no-ff", "-m", "Merge branch side E1", "side");
  const r = node("scripts/changelog.mjs", [`${base}..HEAD`], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, new RegExp(`^## Changelog ${base}\\.\\.[0-9a-f]{7} \\(7 commits\\)`));
  const section = (g) => (out.split(`### ${g}\n`)[1] || "").split("\n\n")[0].split("\n").filter(Boolean);
  assert.deepEqual(section("E1"), [`- ${s.e1} feat(s3e) E1 1/2: rate limit`]);
  assert.deepEqual(section("E2"), [`- ${s.e2} fix(s3e) E2: tombstones`]);
  assert.deepEqual(section("E3"), [`- ${s.e3} test(s3e) E3 4/4: ci suite`]);
  assert.deepEqual(section("docs"), [`- ${s.docs} docs(s3e): brief`]);
  assert.deepEqual(section("test"), [`- ${s.test} test(s3d): regress`]);
  assert.equal(section("other").length, 2, "E10 is not lane E1; side work is other");
  assert.doesNotMatch(out, /Merge branch/);
  assert.deepEqual([...out.matchAll(/^### (\S+)/gm)].map((m) => m[1]), ["E1", "E2", "E3", "docs", "test", "other"]);
  // two-arg form == range form
  assert.equal(node("scripts/changelog.mjs", [base, "HEAD"], { cwd: dir }).stdout, out);
});

test("#122 changelog: bad range → CHANGELOG_RANGE exit 2, nothing on stdout; no network in source", (t) => {
  const dir = tempRepo(t);
  commitFile(dir, "a", "0", "init");
  for (const args of [["nope..HEAD"], ["HEAD..nope"], ["--output=/tmp/x"], ["HEAD...HEAD"], [], ["a", "b", "c"], ["HEAD:a..HEAD"]]) {
    const r = node("scripts/changelog.mjs", args, { cwd: dir });
    assert.equal(r.status, 2, `args ${JSON.stringify(args)}`);
    assert.match(r.stderr, /^ERROR CHANGELOG_RANGE: /m);
    assert.equal(r.stdout, "");
  }
  const empty = node("scripts/changelog.mjs", ["HEAD..HEAD"], { cwd: dir });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /\(0 commits\)[\s\S]*_No commits in range\._/);
  const src = read("scripts/changelog.mjs");
  assert.doesNotMatch(src, /node:https?|fetch\(|node:net|"fetch"|ls-remote|git fetch/);
  assert.equal(JSON.parse(read("package.json")).scripts.changelog, "node scripts/changelog.mjs");
});

// ---------- cors removal ----------
test("E3: unused `cors` dependency removed (package.json + lockfile), server never imports it", () => {
  const pkg = JSON.parse(read("apps/world-builder/package.json"));
  assert.equal(pkg.dependencies?.cors, undefined);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages["node_modules/cors"], undefined);
  assert.equal(lock.packages["apps/world-builder"]?.dependencies?.cors, undefined);
  for (const f of fs.readdirSync(path.join(ROOT, "apps/world-builder/server/src"))) {
    assert.doesNotMatch(read(`apps/world-builder/server/src/${f}`), /from\s+["']cors["']|require\(["']cors["']\)/, f);
  }
});
