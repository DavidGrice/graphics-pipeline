#!/usr/bin/env node
/**
 * S3-E E3 #107 — `npm run lint:ci`: actionlint over .github/workflows and shellcheck over every
 * tracked *.sh (git ls-files, run from the repo root / cwd); shellcheck fails on severity ≥ warning.
 *
 *   exit 0  clean (a missing tool prints `SKIP_PLATFORM: <tool> not on PATH` and is skipped)
 *   exit 1  ERROR LINT_FAILED: <tool> — the tool's own findings are printed above the line
 *   exit 2  ERROR CONFIG_INVALID: ACTIONLINT_BIN / SHELLCHECK_BIN is set but missing, not a file or not
 *           executable (S3-F CO-2; names the variable, never the path; checked before anything runs)
 * ACTIONLINT_BIN / SHELLCHECK_BIN override PATH lookup; unset + not on PATH → SKIP_PLATFORM.
 * S3-F #106 — also parses .github/dependabot.yml and checks its shape (groups, dev target, major
 * ignore); a bad file → `ERROR LINT_FAILED: dependabot` (+ one `dependabot: <problem>` line each), exit 1.
 * S3-G CO-2 — then runs scripts/changelog-verify.mjs (LINT_FAILED exit 1 on a sprint mismatch).
 */
import { spawnSync } from "node:child_process";
import { overrideProblem, resolveTool } from "./tool-bin.mjs";
import { checkDependabotFile } from "./dependabot-check.mjs";

for (const v of ["ACTIONLINT_BIN", "SHELLCHECK_BIN"]) {
  const why = overrideProblem(process.env[v] || "");
  if (why) {
    console.error(`ERROR CONFIG_INVALID: ${v} ${why}`);
    process.exit(2);
  }
}

const cwd = process.cwd();
let failed = 0;

function run(tool, override, args) {
  const bin = resolveTool(tool, override || undefined);
  if (!bin) {
    console.log(`SKIP_PLATFORM: ${tool} not on PATH (install it or set ${tool.toUpperCase()}_BIN); ${tool} skipped`);
    return;
  }
  const r = spawnSync(bin, args, { cwd, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error || r.status !== 0) {
    console.error(`ERROR LINT_FAILED: ${tool} exited ${r.error ? r.error.code : r.status}`);
    failed++;
  } else {
    console.log(`OK ${tool}`);
  }
}

const shellcheck = resolveTool("shellcheck", process.env.SHELLCHECK_BIN || undefined);
// actionlint also shellchecks `run:` blocks when shellcheck is resolvable
run("actionlint", process.env.ACTIONLINT_BIN, shellcheck ? ["-shellcheck", shellcheck] : ["-shellcheck="]);

const ls = spawnSync("git", ["ls-files", "-z", "--", "*.sh"], { cwd, encoding: "utf8" });
const files = ls.status === 0 ? ls.stdout.split("\0").filter(Boolean) : [];
if (files.length) run("shellcheck", process.env.SHELLCHECK_BIN, ["-S", "warning", "--", ...files]); // R1 #107: severity ≥ warning fails
else console.log("OK shellcheck (no tracked *.sh)");

// S3-F #106 — dependabot.yml YAML + shape (no external tool needed, never skipped)
{
  const problems = checkDependabotFile(cwd);
  if (problems.length) {
    for (const p of problems) console.error(`dependabot: ${p}`);
    console.error("ERROR LINT_FAILED: dependabot");
    failed++;
  } else {
    console.log("OK dependabot");
  }
}

// S3-G CO-2 — contract-changelog provenance (#148); only where the doc exists (temp fixture repos skip)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (fs.existsSync(path.join(cwd, "docs/contract-changelog.md")) && fs.existsSync(path.join(cwd, "docs/error-codes.md"))) {
  const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "changelog-verify.mjs")], { cwd, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) failed++;
}

process.exit(failed ? 1 : 0);
