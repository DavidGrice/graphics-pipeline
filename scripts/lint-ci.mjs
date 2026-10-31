#!/usr/bin/env node
/**
 * S3-E E3 #107 — `npm run lint:ci`: actionlint over .github/workflows and shellcheck over every
 * tracked *.sh (git ls-files, run from the repo root / cwd); shellcheck fails on severity ≥ warning.
 *
 *   exit 0  clean (a missing tool prints `SKIP_PLATFORM: <tool> not on PATH` and is skipped)
 *   exit 1  ERROR LINT_FAILED: <tool> — the tool's own findings are printed above the line
 * ACTIONLINT_BIN / SHELLCHECK_BIN override PATH lookup.
 */
import { spawnSync } from "node:child_process";
import { resolveTool } from "./tool-bin.mjs";

const cwd = process.cwd();
let failed = 0;

function run(tool, override, args) {
  const bin = resolveTool(tool, override);
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

const shellcheck = resolveTool("shellcheck", process.env.SHELLCHECK_BIN);
// actionlint also shellchecks `run:` blocks when shellcheck is resolvable
run("actionlint", process.env.ACTIONLINT_BIN, shellcheck ? ["-shellcheck", shellcheck] : ["-shellcheck="]);

const ls = spawnSync("git", ["ls-files", "-z", "--", "*.sh"], { cwd, encoding: "utf8" });
const files = ls.status === 0 ? ls.stdout.split("\0").filter(Boolean) : [];
if (files.length) run("shellcheck", process.env.SHELLCHECK_BIN, ["-S", "warning", "--", ...files]); // R1 #107: severity ≥ warning fails
else console.log("OK shellcheck (no tracked *.sh)");

process.exit(failed ? 1 : 0);
