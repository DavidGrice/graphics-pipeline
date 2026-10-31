#!/usr/bin/env node
/**
 * S3-E E3 #144 — `npm run scan:secrets`: gitleaks over the git history of the repo (or the path given
 * as argv[2]) with the repo's .gitleaks.toml (default rules; only tests/fixtures/** allowlisted).
 *
 *   exit 0  no findings
 *   exit 0  SKIP_PLATFORM: gitleaks not on PATH (or GITLEAKS_BIN not executable)
 *   exit 1  ERROR SECRETS_FOUND: <n> finding(s) — one line per finding: rule, file:line, short commit.
 *           Secrets are redacted by gitleaks and never echoed here.
 *   exit 2  ERROR SECRETS_SCAN_FAILED: gitleaks itself failed (bad config, not a git repo, …)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTool } from "./tool-bin.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(REPO, ".gitleaks.toml");
const target = path.resolve(process.argv[2] || process.cwd());

const bin = resolveTool("gitleaks", process.env.GITLEAKS_BIN);
if (!bin) {
  console.log("SKIP_PLATFORM: gitleaks not on PATH (install gitleaks >= 8.19 or set GITLEAKS_BIN); secret scan skipped");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scan-secrets-"));
const report = path.join(tmp, "report.json");
try {
  const r = spawnSync(
    bin,
    ["git", "--config", CONFIG, "--no-banner", "--redact", "--exit-code", "1", "--report-format", "json", "--report-path", report, "--log-level", "error", target],
    { encoding: "utf8" },
  );
  if (r.error || (r.status !== 0 && r.status !== 1)) {
    console.error(`ERROR SECRETS_SCAN_FAILED: gitleaks exited ${r.error ? r.error.code : r.status}`);
    process.exit(2);
  }
  let findings = [];
  try {
    findings = JSON.parse(fs.readFileSync(report, "utf8"));
  } catch {
    findings = [];
  }
  if (r.status === 1 || findings.length > 0) {
    console.error(`ERROR SECRETS_FOUND: ${findings.length || "?"} finding(s) — rotate the secret, then rewrite or allowlist (tests/fixtures/** only)`);
    for (const f of findings) {
      const commit = f.Commit ? ` commit ${String(f.Commit).slice(0, 7)}` : "";
      console.error(`  ${f.RuleID} ${f.File}:${f.StartLine}${commit}`);
    }
    process.exit(1);
  }
  console.log("OK scan:secrets — no findings");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
