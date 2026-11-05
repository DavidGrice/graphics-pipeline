/** S3-G E3: #150 mermaid lint, #151 AC walkthrough doc check, CO-5 trigger, laneOf `-` nit. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { laneOf } from "../scripts/changelog.mjs";
import { extractMermaid, lintMermaidFiles, docsMarkdown } from "../scripts/mermaid-lint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("nit laneOf: `-` after the lane tag maps (e1b-thing → E1); E10 / E4 / ae1 / node22 stay other", () => {
  assert.equal(laneOf("feat(e1b-thing): x"), "E1");
  assert.equal(laneOf("fix E2-a: y"), "E2");
  assert.equal(laneOf("chore s3g-e3-ci"), "E3");
  for (const s of ["fix E10 thing", "feat E4: x", "fix ae1 bug", "ci node22 leg", "chore e10-thing", "fix ae1-x"]) {
    assert.equal(laneOf(s), "other", s);
  }
});

test("#150 extractMermaid finds fences with their opening line", () => {
  const b = extractMermaid("x\n```mermaid\nflowchart TD\n  A-->B\n```\ny\n```mermaid\npie\n```\n");
  assert.deepEqual(b.map((x) => x.line), [2, 7]);
  assert.equal(b[0].code, "flowchart TD\n  A-->B");
});

test("#150 / E3-D4 every mermaid block in every tracked *.md parses (6 existing + docs/pipeline.md)", async () => {
  const files = docsMarkdown(root);
  assert.ok(files.includes("AGENTS.md") && files.includes("README.md") && files.includes("docs/AGENT_GUIDE.md"));
  const { blocks, problems } = await lintMermaidFiles(root, files);
  assert.deepEqual(problems, []);
  assert.ok(blocks >= 8, `expected ≥ 8 blocks, got ${blocks}`);
  assert.equal(extractMermaid(read("docs/pipeline.md")).length, 2);
  assert.ok(!files.some((f) => /\.(png|svg)$/i.test(f)));
});

test("#150 a broken block → exit 1 LINT_FAILED with file:line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3g-e3-mmd-"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs/bad.md"), "# t\n\n```mermaid\nflowchart TD\n  A -->\n```\n");
  const r = spawnSync(process.execPath, [path.join(root, "scripts/mermaid-lint.mjs"), "docs/bad.md"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /mermaid: docs\/bad\.md:3: /);
  assert.match(r.stderr, /ERROR LINT_FAILED: mermaid/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("#150 lint:ci runs the mermaid lint; mermaid + jsdom are pinned devDependencies", () => {
  assert.match(read("scripts/lint-ci.mjs"), /mermaid-lint\.mjs/);
  const pkg = JSON.parse(read("package.json"));
  for (const d of ["mermaid", "jsdom"]) assert.match(pkg.devDependencies[d] || "", /^\d+\.\d+\.\d+$/, d);
});

test("CO-5 ci.yml: push on enhancement/** added; dev/test/main push + PR + dispatch kept", () => {
  const on = YAML.parse(read(".github/workflows/ci.yml")).on;
  assert.deepEqual(on.push.branches, ["dev", "test", "main", "enhancement/**"]);
  assert.deepEqual(on.pull_request.branches, ["dev", "test", "main"]);
  assert.ok("workflow_dispatch" in on);
});

test("#151 ac-walkthrough: ≤150 lines, links AGENTS.md, every npm run / path / env var exists", () => {
  const doc = read("docs/ac-walkthrough.md");
  assert.ok(doc.split("\n").length <= 150);
  assert.match(doc, /\]\(\.\.\/AGENTS\.md\)/);
  for (const topic of [/Node 22/, /RATE_LIMIT_PER_MIN=100000/, /390, 1280 and 1920/, /#82/, /round-trip/i, /Live CI/i, /FULL PASS/, /makeImportMeta/, /Merge-tip/i]) assert.match(doc, topic);
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const [, s] of doc.matchAll(/npm run ([\w:.-]+)/g)) assert.ok(scripts[s], `npm run ${s}`);
  for (const [, p] of doc.matchAll(/`((?:docs|tests|scripts|apps)\/[\w./-]+)`/g)) assert.ok(fs.existsSync(path.join(root, p)), p);
  const src = ["apps", "scripts", "tests"].map((d) => spawnSync("git", ["grep", "-h", "-o", "process\\.env\\.[A-Z_]*", "--", d], { cwd: root, encoding: "utf8" }).stdout).join("");
  const known = new Set([...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]));
  for (const [, v] of doc.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)=/g)) assert.ok(known.has(v), `env ${v}`);
  for (const v of ["BLENDER_BIN", "UI_URL", "WB_DATA_ROOT", "VITE_PORT", "WB_API_PORT"]) if (doc.includes(v)) assert.ok(known.has(v), `env ${v}`);
});
