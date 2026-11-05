/**
 * S3-F E3 (tip3) — #106 dependabot groups + lint:ci shape check, #148 contract changelog doc test,
 * #149 AGENTS.md playbook doc test. Specs: R1 + D2 @1f687da.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers/s3d-synth.mjs";
import { parseDoc, sourceFiles } from "./helpers/error-codes-scan.mjs";
import { SKIP_CODES } from "./reporters/skip-summary.mjs";
import { dependabotProblems } from "../scripts/dependabot-check.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const docCodes = () => new Set(parseDoc(read("docs/error-codes.md")).flatMap((g) => g.rows.flatMap((r) => r.codes)));

// ---------------------------------------------------------------- #106
test("#106 dependabot.yml: groups added, dev target + major ignore kept; shape check passes", () => {
  assert.deepEqual(dependabotProblems(read(".github/dependabot.yml")), []);
});

test("#106 shape check catches: bad YAML, wrong target, dropped major ignore, missing groups", () => {
  const good = read(".github/dependabot.yml");
  assert.match(dependabotProblems("version: 2\nupdates: [\n")[0], /not valid YAML/);
  assert.ok(dependabotProblems(good.replaceAll('target-branch: "dev"', 'target-branch: "main"')).some((p) => /target-branch/.test(p)));
  assert.ok(dependabotProblems(good.replaceAll("version-update:semver-major", "version-update:semver-minor")).some((p) => /semver-major/.test(p)));
  assert.ok(dependabotProblems(good.replace("npm-minor-patch:", "npm-other:")).some((p) => /npm-minor-patch/.test(p)));
  assert.ok(dependabotProblems(good.replace("dependency-type: development", "dependency-type: production")).some((p) => /npm-dev/.test(p)));
  assert.ok(dependabotProblems(good.replace(/\n {6}actions:\n {8}patterns: \["\*"\]\n?/, "\n      other:\n        patterns: [\"x\"]\n")).some((p) => /groups\.actions/.test(p)));
  assert.ok(dependabotProblems("version: 1\nupdates: []\n").length >= 2);
});

test("#106 lint:ci: a bad dependabot.yml → ERROR LINT_FAILED: dependabot, exit 1 (no external tools needed)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3f-dep-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github/dependabot.yml"), "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n");
  const env = { ...process.env, PATH: path.dirname(process.execPath) };
  for (const k of ["ACTIONLINT_BIN", "SHELLCHECK_BIN"]) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/lint-ci.mjs")], { cwd: dir, env, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^dependabot: .*target-branch/m);
  assert.match(r.stderr, /^ERROR LINT_FAILED: dependabot$/m);
});

// ---------------------------------------------------------------- #148
function changelog() {
  const md = read("docs/contract-changelog.md");
  const sections = [...md.matchAll(/^## (S\d-[A-G])\b.*$/gm)].map((m) => m[1]);
  const field = (name) =>
    [...md.matchAll(new RegExp(`^- \\*\\*${name}:\\*\\* (.*)$`, "gm"))].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
  return { md, sections, codes: field("Codes"), env: field("Env") };
}

test("#148 contract changelog: one section per sprint S2-C → S3-G, in order", () => {
  const { sections } = changelog();
  assert.deepEqual(sections, ["S2-C", "S2-D", "S2-E", "S2-F", "S2-G", "S3-A", "S3-B", "S3-C", "S3-D", "S3-E", "S3-F", "S3-G"]);
});

test("#148 both ways: every changelog code is in error-codes.md, every error-codes.md code is in the changelog", () => {
  const { codes } = changelog();
  const doc = docCodes();
  assert.deepEqual(codes.filter((c) => !doc.has(c)), [], "changelog names codes error-codes.md lacks");
  const inLog = new Set(codes);
  assert.deepEqual([...doc].filter((c) => !inLog.has(c)).sort(), [], "error-codes.md codes missing from the changelog");
  assert.equal(new Set(codes).size, codes.length, "each code listed once (the sprint it appeared)");
});

test("#148 every env var named is read in apps/ or scripts/", () => {
  const { env } = changelog();
  assert.ok(env.length >= 20);
  const files = sourceFiles().filter((f) => f.startsWith("apps/") || f.startsWith("scripts/"));
  const text = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const unread = env.filter((v) => !new RegExp(`(process\\.env\\.${v}\\b|env\\.${v}\\b|\\[["']${v}["']\\]|\\$\\{?${v}\\b|environ(?:\\.get)?\\(?\\[?["']${v}["']|["']${v}["'])`).test(text));
  assert.deepEqual(unread, []);
  for (const v of ["ACTIVITY_MAX_LINES", "BRIDGE", "PUBLIC_BASE_URL"]) assert.ok(read(".env.example").includes(v), `${v} in .env.example`);
});

test("#148 a tampered changelog is caught (dropped code / unknown code)", () => {
  const doc = docCodes();
  const { codes } = changelog();
  const dropped = codes.filter((c) => c !== "FEATURED_INVALID");
  assert.ok([...doc].some((c) => !dropped.includes(c)));
  assert.ok(!doc.has("NOT_A_REAL_CODE"));
});

// ---------------------------------------------------------------- #149
test("#149 AGENTS.md: ≤ 120 lines; every `npm run X` exists; every linked/backticked repo path exists", () => {
  const md = read("AGENTS.md");
  assert.ok(md.split("\n").length <= 120, "≤ 120 lines");
  const scripts = JSON.parse(read("package.json")).scripts;
  const all = [...md.matchAll(/npm run (?:-s )?([a-z0-9:_-]+)(?: -w (\S+))?/g)];
  const runs = all.filter((m) => !m[2]).map((m) => m[1]);
  for (const s of ["test:s1", "golden:refresh", "scan:secrets", "lint:ci", "changelog"]) assert.ok(runs.includes(s), `mentions npm run ${s}`);
  assert.deepEqual(runs.filter((s) => !scripts[s]), [], "every npm run X exists");
  // `npm run X -w <workspace>` → the workspace's own script
  const wsDirs = ["apps", "packages"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).map((n) => path.join(ROOT, d, n, "package.json"))).filter((f) => fs.existsSync(f));
  const ws = Object.fromEntries(wsDirs.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))).map((p) => [p.name, p.scripts ?? {}]));
  for (const m of all.filter((x) => x[2])) assert.ok(ws[m[2]]?.[m[1]], `npm run ${m[1]} -w ${m[2]} exists`);
  const links = [...md.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
  const ticks = [...md.matchAll(/`((?:docs|tests|scripts|apps|packages|\.github)\/[^`\s]+)`/g)].map((m) => m[1]);
  const paths = [...new Set([...links, ...ticks])];
  assert.ok(paths.length >= 8);
  assert.deepEqual(paths.filter((p) => !fs.existsSync(path.join(ROOT, p))), [], "every repo path exists");
  for (const p of ["docs/error-codes.md", "docs/sprint3f-brief.md", "docs/contract-changelog.md"]) assert.ok(links.includes(p), `links ${p}`);
  assert.match(md, /\/home\/box\/tools\/blender/);
  assert.match(md, /5\.2\.3/);
  assert.match(md, /Node \*\*24\*\*/);
  assert.match(md, /never force-push/);
});

test("#149 AGENTS.md SKIP list equals the reporter's six codes", () => {
  const md = read("AGENTS.md");
  const sec = md.slice(md.indexOf("### Skips are coded"));
  const listed = [...new Set([...sec.slice(0, sec.indexOf("###", 5) > 0 ? sec.indexOf("###", 5) : undefined).matchAll(/`(SKIP_[A-Z_]+)`/g)].map((m) => m[1]))].filter((c) => c !== "SKIP_CODE_MISSING");
  assert.equal(SKIP_CODES.length, 6);
  assert.deepEqual([...listed].sort(), [...SKIP_CODES].sort());
});
